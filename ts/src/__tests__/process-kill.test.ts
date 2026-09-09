import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

/**
 * MATAR AL SUBPROCESO DE VERDAD.
 *
 * El subproceso de Go tiene abierto el SQLite de la sesión de WhatsApp, y ese
 * archivo no admite dos escritores. Un proceso que sobrevive a su `kill()` no es
 * un recurso desperdiciado: es un segundo escritor sobre la sesión de una
 * vendedora, y el que viene después tampoco va a poder trabajar.
 *
 * Medido en producción el 9-sep-2026: 59 procesos vivos para 5 sesiones, hasta 20
 * sobre el mismo archivo, una generación nueva cada cuatro minutos y ninguna que
 * se fuera. Estas pruebas son el candado de que eso no vuelva.
 */

class ProcesoFalso extends EventEmitter {
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
  stdin = { writable: true, write: vi.fn() };
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn((_senal?: string) => true);
  unref = vi.fn();
}

const { spawnFalso, ultimoProceso } = vi.hoisted(() => {
  const ultimoProceso: { actual: unknown } = { actual: null };
  const spawnFalso = vi.fn();
  return { spawnFalso, ultimoProceso };
});

vi.mock("node:child_process", () => ({ spawn: spawnFalso }));

import { GoProcess } from "../process.js";

function arrancar(): { go: GoProcess; proc: ProcesoFalso } {
  const proc = new ProcesoFalso();
  ultimoProceso.actual = proc;
  spawnFalso.mockReturnValue(proc);
  const go = new GoProcess("/fake/binary");
  go.start();
  return { go, proc };
}

describe("GoProcess.kill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnFalso.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("manda SIGTERM primero", () => {
    const { go, proc } = arrancar();
    go.kill();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  // 🔴 EL CANDADO. Antes, el timer leía `this.proc?.kill("SIGKILL")` mientras
  // `this.proc = null` corría de forma síncrona justo debajo: a los cinco
  // segundos el `?.` cortaba en null y el SIGKILL NUNCA se mandaba.
  it("escala a SIGKILL si a los 5 s el proceso sigue vivo", () => {
    const { go, proc } = arrancar();

    go.kill();
    expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");

    vi.advanceTimersByTime(5000);

    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("escala aunque se haya llamado a kill() dos veces", () => {
    // La segunda llamada sale por la guarda `!proc`, pero el proceso real sigue
    // ahí: la escalada de la PRIMERA tiene que seguir en pie.
    const { go, proc } = arrancar();

    go.kill();
    go.kill();
    vi.advanceTimersByTime(5000);

    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    expect(proc.kill).toHaveBeenCalledTimes(2); // un SIGTERM y un SIGKILL
  });

  it("NO manda SIGKILL a un proceso que ya salió", () => {
    // Un pid ya cosechado puede haber sido reasignado, y mandarle una señal
    // sería matar a un proceso ajeno.
    const { go, proc } = arrancar();

    go.kill();
    proc.exitCode = 0;
    vi.advanceTimersByTime(5000);

    expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");
  });

  it("NO manda SIGKILL a uno que ya murió por una señal", () => {
    const { go, proc } = arrancar();

    go.kill();
    proc.signalCode = "SIGTERM";
    vi.advanceTimersByTime(5000);

    expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");
  });

  it("kill() sobre un proceso que nunca arrancó no explota", () => {
    const go = new GoProcess("/fake/binary");
    expect(() => go.kill()).not.toThrow();
  });
});
