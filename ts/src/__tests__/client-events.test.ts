import { describe, it, expect, vi } from "vitest";

// vi.hoisted runs before imports, safe to use in vi.mock factories
const { MockGoProcess } = vi.hoisted(() => {
  // Inline minimal EventEmitter — node:events can't be imported here
  type Listener = (...args: unknown[]) => void;
  class MinimalEmitter {
    private _listeners: Record<string, Listener[]> = {};
    on(event: string, fn: Listener) {
      (this._listeners[event] ??= []).push(fn);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this._listeners[event] ?? []) fn(...args);
      return true;
    }
    removeAllListeners() {
      this._listeners = {};
      return this;
    }
  }

  class MockGoProcess extends MinimalEmitter {
    send = vi.fn();
    start = vi.fn();
    kill = vi.fn();
    get alive() {
      return true;
    }
  }

  return { MockGoProcess };
});

vi.mock("../process.js", () => ({ GoProcess: MockGoProcess }));

// Mock resolveBinary (statSync)
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    statSync: vi.fn(() => ({ isFile: () => true })),
  };
});

import { WhatsmeowClient } from "../client.js";

// The Go process dispatches events generically, but the client re-emits them one
// hand-written line at a time. A missing line is invisible: the Go side keeps
// sending the event, no error is raised anywhere, and the consumer's handler
// simply never runs. These tests are the wire check.
function createTestClient() {
  const client = new WhatsmeowClient({
    store: "test.db",
    binaryPath: "/fake/binary",
  });
  const proc = (client as unknown as { proc: { emit(event: string, data: unknown): boolean } })
    .proc;
  return { client, proc };
}

describe("event forwarding", () => {
  describe("labels", () => {
    it("forwards label:edit", () => {
      const { client, proc } = createTestClient();
      const seen = vi.fn();
      client.on("label:edit", seen);

      const payload = {
        labelId: "12",
        name: "Diploma Inteligencia",
        color: 5,
        deleted: false,
        timestamp: 1_781_000_000,
        fromFullSync: false,
      };
      proc.emit("label:edit", payload);

      expect(seen).toHaveBeenCalledWith(payload);
    });

    it("forwards label:chat", () => {
      const { client, proc } = createTestClient();
      const seen = vi.fn();
      client.on("label:chat", seen);

      const payload = {
        jid: "51970043155@s.whatsapp.net",
        labelId: "12",
        labeled: true,
        timestamp: 1_781_000_000,
        fromFullSync: false,
      };
      proc.emit("label:chat", payload);

      expect(seen).toHaveBeenCalledWith(payload);
    });

    it("forwards label:message", () => {
      const { client, proc } = createTestClient();
      const seen = vi.fn();
      client.on("label:message", seen);

      const payload = {
        jid: "51970043155@s.whatsapp.net",
        labelId: "12",
        messageId: "3EB0A1B2C3",
        labeled: true,
        timestamp: 1_781_000_000,
        fromFullSync: false,
      };
      proc.emit("label:message", payload);

      expect(seen).toHaveBeenCalledWith(payload);
    });

    it("forwards un-labeling, not just labeling", () => {
      const { client, proc } = createTestClient();
      const seen = vi.fn();
      client.on("label:chat", seen);

      proc.emit("label:chat", {
        jid: "51970043155@s.whatsapp.net",
        labelId: "12",
        labeled: false,
        timestamp: 1_781_000_000,
        fromFullSync: false,
      });

      expect(seen).toHaveBeenCalledWith(expect.objectContaining({ labeled: false }));
    });
  });

  describe("integrity", () => {
    it("forwards message:undecryptable", () => {
      const { client, proc } = createTestClient();
      const seen = vi.fn();
      client.on("message:undecryptable", seen);

      const payload = {
        info: {
          id: "3EB0A1B2C3",
          chat: "51970043155@s.whatsapp.net",
          sender: "51970043155@s.whatsapp.net",
          isFromMe: false,
          isGroup: false,
          timestamp: 1_781_000_000,
          pushName: "Luz",
        },
        isUnavailable: true,
        unavailableType: "view_once",
        decryptFailMode: "hide",
      };
      proc.emit("message:undecryptable", payload);

      expect(seen).toHaveBeenCalledWith(payload);
    });

    it("forwards event:panic", () => {
      const { client, proc } = createTestClient();
      const seen = vi.fn();
      client.on("event:panic", seen);

      const payload = {
        where: "event *events.Message",
        error: "runtime error: invalid memory address",
        stack: "goroutine 1 [running]:\nmain.serializeMessageInfo(...)",
      };
      proc.emit("event:panic", payload);

      expect(seen).toHaveBeenCalledWith(payload);
    });

    it("forwards event:unhandled", () => {
      const { client, proc } = createTestClient();
      const seen = vi.fn();
      client.on("event:unhandled", seen);

      proc.emit("event:unhandled", { type: "*events.Contact", count: 10 });

      expect(seen).toHaveBeenCalledWith({ type: "*events.Contact", count: 10 });
    });

    it("forwards stream_replaced", () => {
      const { client, proc } = createTestClient();
      const seen = vi.fn();
      client.on("stream_replaced", seen);

      proc.emit("stream_replaced", {});

      expect(seen).toHaveBeenCalledWith({});
    });
  });
});
