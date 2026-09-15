import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

/**
 * LOS CUATRO EVENTOS QUE EXPLICAN UNA DESCONEXIÓN SILENCIOSA.
 *
 * whatsmeow ya los manda (StreamReplaced, ClientOutdated, ConnectFailure,
 * CATRefreshError), pero hasta este cambio el binario Go los traducía a
 * nada: el switch de `events.go` no tenía case para ninguno, así que se
 * perdían ahí mismo y el cliente TypeScript nunca se enteraba de POR QUÉ se
 * cayó una línea.
 *
 * Cada test de acá empuja una línea JSON real por el stdout de un proceso Go
 * falso — la misma ruta que toma un evento de verdad, sin mockear GoProcess —
 * y comprueba que WhatsmeowClient la reenvía con el nombre nuevo. Es el mismo
 * patrón que ya usa process-generaciones.test.ts para el proceso, aplicado acá
 * al cliente.
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

describe("WhatsmeowClient — eventos de desconexión", () => {
  beforeEach(() => {
    spawnFalso.mockReset();
  });

  it("reenvía stream_replaced sin datos", async () => {
    const { client, proceso } = arrancarCliente();
    const recibido = vi.fn();
    client.on("stream_replaced", recibido);

    proceso.escribe({ event: "stream_replaced", data: {} });
    await respirar();

    expect(recibido).toHaveBeenCalledWith({});
  });

  it("reenvía client_outdated sin datos", async () => {
    const { client, proceso } = arrancarCliente();
    const recibido = vi.fn();
    client.on("client_outdated", recibido);

    proceso.escribe({ event: "client_outdated", data: {} });
    await respirar();

    expect(recibido).toHaveBeenCalledWith({});
  });

  it("reenvía connect_failure con reason, message y raw", async () => {
    const { client, proceso } = arrancarCliente();
    const recibido = vi.fn();
    client.on("connect_failure", recibido);

    const datos = {
      reason: "500: unknown error",
      message: "server error",
      raw: '<failure reason="500"/>',
    };
    proceso.escribe({ event: "connect_failure", data: datos });
    await respirar();

    expect(recibido).toHaveBeenCalledWith(datos);
  });

  it("reenvía connect_failure sin raw cuando el evento no lo trae", async () => {
    const { client, proceso } = arrancarCliente();
    const recibido = vi.fn();
    client.on("connect_failure", recibido);

    const datos = { reason: "400: unknown error", message: "" };
    proceso.escribe({ event: "connect_failure", data: datos });
    await respirar();

    expect(recibido).toHaveBeenCalledWith(datos);
    const recibidoData = recibido.mock.calls[0][0] as Record<string, unknown>;
    expect("raw" in recibidoData).toBe(false);
  });

  it("reenvía cat_refresh_error con el texto del error", async () => {
    const { client, proceso } = arrancarCliente();
    const recibido = vi.fn();
    client.on("cat_refresh_error", recibido);

    proceso.escribe({ event: "cat_refresh_error", data: { error: "token vencido" } });
    await respirar();

    expect(recibido).toHaveBeenCalledWith({ error: "token vencido" });
  });

  it("logged_out ahora incluye onConnect", async () => {
    const { client, proceso } = arrancarCliente();
    const recibido = vi.fn();
    client.on("logged_out", recibido);

    const datos = { reason: "401: logged out from another device", onConnect: true };
    proceso.escribe({ event: "logged_out", data: datos });
    await respirar();

    expect(recibido).toHaveBeenCalledWith(datos);
  });

  it("stream_error ahora puede incluir raw", async () => {
    const { client, proceso } = arrancarCliente();
    const recibido = vi.fn();
    client.on("stream_error", recibido);

    const datos = { code: "515", raw: '<stream:error code="515"/>' };
    proceso.escribe({ event: "stream_error", data: datos });
    await respirar();

    expect(recibido).toHaveBeenCalledWith(datos);
  });
});
