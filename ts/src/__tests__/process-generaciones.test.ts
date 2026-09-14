import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

/**
 * LAS GENERACIONES DEL SUBPROCESO — un `exit` viejo no puede matar al nuevo.
 *
 * Medido en producción el 14-sep-2026 (Hermes, VPS1): a las 11:15 las diez líneas
 * whatsmeow dijeron «no conectado» a la vez (un hipo de red) y el vigilante las
 * relevantó: `kill()` del proceso viejo y `start()` del nuevo, uno detrás del otro.
 * Cada `init` del proceso nuevo falló con «Go process exited with code null», el
 * nuevo quedó vivo y SIN referencia, y la ronda siguiente volvió a hacer lo mismo:
 * 131 procesos sentados sobre los mismos `.wa-sessions/<numero>.db` en 40 minutos,
 * y cero líneas conectadas al final.
 *
 * La causa está acá: el manejador de `exit` que `start()` registra sobre el hijo
 * viejo corre CUANDO ESE HIJO MUERE —después del SIGTERM, ya con el hijo nuevo
 * arrancado— y hacía tres cosas sobre el estado COMPARTIDO: `this.proc = null`
 * (borrando la referencia al nuevo), rechazar TODOS los pedidos pendientes (los del
 * nuevo incluidos: su `init`) y emitir `exit` (que el consumidor lee como una
 * caída). Cada generación tiene que ser dueña de lo suyo y nada más.
 *
 * Y `kill()` volvía en el acto: el que relanzaba abría el proceso nuevo mientras el
 * viejo todavía tenía abierto el SQLite de la sesión. `stop()` espera la salida real.
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

  /** El hijo muere: como lo reporta Node, con el código o la señal. */
  morir(code: number | null, signal: string | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  /** Una línea en su stdout (una respuesta o un evento del proceso Go). */
  escribe(objeto: unknown): void {
    this.stdout.push(JSON.stringify(objeto) + "\n");
  }
}

const { spawnFalso } = vi.hoisted(() => ({ spawnFalso: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnFalso }));

import { GoProcess } from "../process.js";
import { ProcessExitedError } from "../errors.js";

/** Un tick del event loop: readline entrega las líneas de forma asíncrona. */
const respirar = () => new Promise<void>((r) => setImmediate(r));

function arrancar(go: GoProcess): ProcesoFalso {
  const proc = new ProcesoFalso();
  spawnFalso.mockReturnValueOnce(proc);
  go.start();
  return proc;
}

/** El id con el que salió el ÚLTIMO comando por el stdin de ese proceso. */
function idDelUltimoComando(proc: ProcesoFalso): string {
  const linea = proc.stdin.write.mock.calls.at(-1)?.[0] as string;
  return (JSON.parse(linea) as { id: string }).id;
}

describe("GoProcess — cada generación es dueña de lo suyo", () => {
  beforeEach(() => {
    spawnFalso.mockReset();
  });

  it("🔴 el exit del proceso viejo NO borra la referencia al nuevo ni rechaza sus pedidos", async () => {
    const go = new GoProcess("/fake/binary");
    const viejo = arrancar(go);

    go.kill(); // relevantar: el viejo recibe SIGTERM y muere un rato después
    const nuevo = arrancar(go);
    const init = go.send("init");
    const id = idDelUltimoComando(nuevo);

    viejo.morir(null, "SIGTERM"); // el exit tardío del viejo, ya con el nuevo andando

    expect(go.alive, "la referencia al proceso nuevo se perdió").toBe(true);

    nuevo.escribe({ id, ok: true, data: { jid: "51999@s.whatsapp.net" } });
    await respirar();
    await expect(init).resolves.toEqual({ jid: "51999@s.whatsapp.net" });
  });

  it("🔴 un exit viejo no se anuncia como caída: `exit` sólo lo emite la generación vigente", async () => {
    const go = new GoProcess("/fake/binary");
    const salidas: unknown[] = [];
    go.on("exit", (d) => salidas.push(d));
    const viejo = arrancar(go);

    go.kill();
    const nuevo = arrancar(go);
    viejo.morir(null, "SIGTERM");
    expect(salidas, "el consumidor leyó la muerte deliberada del viejo como una caída").toEqual([]);

    nuevo.morir(1); // ésta sí es una caída del proceso vigente
    expect(salidas).toEqual([{ code: 1, signal: null }]);
    expect(go.alive).toBe(false);
  });

  it("🔴 los eventos que todavía escupe el proceso viejo no llegan al consumidor", async () => {
    const go = new GoProcess("/fake/binary");
    const eventos: string[] = [];
    go.on("disconnected", () => eventos.push("disconnected"));
    go.on("connected", () => eventos.push("connected"));
    const viejo = arrancar(go);

    go.kill();
    const nuevo = arrancar(go);

    viejo.escribe({ event: "disconnected", data: {} }); // el viejo cerrando su socket
    nuevo.escribe({ event: "connected", data: {} });
    await respirar();

    expect(eventos).toEqual(["connected"]);
  });

  it("el exit del viejo sí rechaza LOS SUYOS: un pedido en vuelo hacia el viejo no queda colgado", async () => {
    const go = new GoProcess("/fake/binary");
    const viejo = arrancar(go);
    const pendiente = go.send("isConnected");

    go.kill();
    arrancar(go);
    viejo.morir(null, "SIGTERM");

    await expect(pendiente).rejects.toBeInstanceOf(ProcessExitedError);
  });
});

describe("GoProcess.stop — espera la salida real", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnFalso.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("🔴 resuelve recién cuando el proceso salió, escalando a SIGKILL a los 5 s", async () => {
    const go = new GoProcess("/fake/binary");
    const proc = arrancar(go);
    let salio = false;
    const parada = go.stop().then(() => {
      salio = true;
    });

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(4999);
    expect(salio, "resolvió antes de que el proceso saliera").toBe(false);
    expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");

    await vi.advanceTimersByTimeAsync(1);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    expect(salio).toBe(false);

    proc.morir(null, "SIGKILL");
    await parada;
    expect(salio).toBe(true);
    expect(go.alive).toBe(false);
  });

  it("resuelve en el acto si el proceso ya había salido, y sobre uno que nunca arrancó", async () => {
    const go = new GoProcess("/fake/binary");
    await expect(go.stop()).resolves.toBeUndefined();

    const proc = arrancar(go);
    proc.morir(0);
    await expect(go.stop()).resolves.toBeUndefined();
  });

  it("después de stop(), start() abre una generación nueva que atiende sus pedidos", async () => {
    vi.useRealTimers();
    const go = new GoProcess("/fake/binary");
    const viejo = arrancar(go);
    const parada = go.stop();
    viejo.morir(null, "SIGTERM");
    await parada;

    const nuevo = arrancar(go);
    const ping = go.send("isConnected");
    nuevo.escribe({ id: idDelUltimoComando(nuevo), ok: true, data: { connected: true } });
    await respirar();
    await expect(ping).resolves.toEqual({ connected: true });
  });
});
