import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

/**
 * LOS MENSAJES DEL HISTORIAL. El binario Go los saca de la tanda de history
 * sync como `history:message`; si el cliente no reenvía ese nombre, se pierden
 * acá igual que antes se perdían en Go, sin un solo error.
 *
 * Mismo andamio que client-eventos-desconexion.test.ts: una línea JSON real
 * por el stdout de un proceso Go falso.
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

  /** Una línea de stdout, tal como la escribe el binario Go real: un evento por línea. */
  escribe(objeto: unknown): void {
    this.stdout.push(JSON.stringify(objeto) + "\n");
  }
}

const { spawnFalso } = vi.hoisted(() => ({ spawnFalso: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnFalso }));

import { WhatsmeowClient } from "../client.js";

/** Un tick del event loop: readline entrega las líneas de forma asíncrona. */
const respirar = () => new Promise<void>((r) => setImmediate(r));

function arrancarCliente(): { client: WhatsmeowClient; proceso: ProcesoFalso } {
  const proceso = new ProcesoFalso();
  spawnFalso.mockReturnValueOnce(proceso);
  // binaryPath explícito: resolveBinary() no entra a jugar y no hace falta
  // mockear node:fs.
  const client = new WhatsmeowClient({ store: "test.db", binaryPath: "/fake/binary" });
  // start() es privado en el tipo, no en tiempo de ejecución — mismo truco
  // que ya usa client.test.ts para llegar a `proc`.
  (client as unknown as { proc: { start: () => void } }).proc.start();
  return { client, proceso };
}

describe("WhatsmeowClient — historial", () => {
  beforeEach(() => {
    spawnFalso.mockReset();
  });

  it("reenvía history:message aparte de message", async () => {
    const { client, proceso } = arrancarCliente();
    const historial = vi.fn();
    const enVivo = vi.fn();
    client.on("history:message", historial);
    client.on("message", enVivo);

    const data = {
      syncType: "RECENT",
      info: { id: "A1", chat: "66396084027513@lid", sender: "66396084027513@lid", isFromMe: false, isGroup: false, timestamp: 1760900000, pushName: "" },
      message: { conversation: "Hola" },
    };
    proceso.escribe({ event: "history:message", data });
    await respirar();

    expect(historial).toHaveBeenCalledWith(data);
    expect(enVivo).not.toHaveBeenCalled();
  });
});
