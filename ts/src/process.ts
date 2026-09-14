import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IpcCommand, IpcResponse, IpcEvent } from "./types.js";
import { WhatsmeowError, TimeoutError, ProcessExitedError } from "./errors.js";

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The Go subprocess behind one WhatsApp session.
 *
 * 🔴 EVERY `start()` IS A GENERATION, AND A GENERATION ONLY SPEAKS FOR ITSELF.
 * `kill()` drops the reference at once and lets the old child die on its own
 * time (SIGTERM, SIGKILL five seconds later) — so a caller that relaunches a
 * line (`kill()` then `start()`) has the NEW child running while the OLD one is
 * still exiting. Until 14-sep-2026 the handlers registered by `start()` acted on
 * shared state, so the late `exit` of the old child cleared `this.proc` (the new
 * child, now orphaned and unreachable), rejected every pending request (the new
 * child's own `init`, with "exited with code null") and emitted `exit` (read by
 * the consumer as a crash of the line). Measured in production: ten lines
 * relaunched once a minute, one more orphan per line per round, 131 Go
 * processes sitting on the same session files after forty minutes, zero lines
 * connected. Each generation now owns its pending map and checks it is still
 * the current child before touching `this.proc`, emitting an event or
 * announcing its exit.
 */
export class GoProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
  /** In-flight requests of the CURRENT generation. `start()` opens a fresh map. */
  private pending = new Map<string, PendingRequest>();
  private commandTimeout: number;
  private cleanupHandler: (() => void) | null = null;

  constructor(
    private binaryPath: string,
    commandTimeout = 30_000,
  ) {
    super();
    this.commandTimeout = commandTimeout;
  }

  start(): void {
    if (this.proc) return;

    const child = spawn(this.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pending = new Map<string, PendingRequest>();
    this.proc = child;
    this.pending = pending;

    // Is this child still the one this object serves? A replaced generation
    // (`kill()`, `stop()`) keeps draining its own requests but stays silent.
    const current = () => this.proc === child;

    // stdout: responses + events (JSON lines)
    // stdio: ["pipe", "pipe", "pipe"] guarantees these are non-null
    const stdoutRl = createInterface({ input: child.stdout as NodeJS.ReadableStream });
    stdoutRl.on("line", (line) => this.handleStdoutLine(line, pending, current));

    // stderr: structured logs (JSON lines)
    const stderrRl = createInterface({ input: child.stderr as NodeJS.ReadableStream });
    stderrRl.on("line", (line) => {
      if (current()) this.handleStderrLine(line);
    });

    child.on("exit", (code, signal) => {
      const wasCurrent = current();
      if (wasCurrent) this.proc = null;
      // Reject this generation's pending requests — and only these.
      for (const [id, req] of pending) {
        clearTimeout(req.timer);
        req.reject(new ProcessExitedError(code));
        pending.delete(id);
      }
      // A generation that was already replaced died on purpose: nothing to report.
      if (wasCurrent) this.emit("exit", { code, signal });
    });

    child.on("error", (err) => {
      if (current()) this.emit("error", err);
    });

    // Let the child process not keep the event loop alive on its own.
    // Node will still wait for pending I/O (readline), but if user code
    // has nothing else to do, the process can exit and the "exit" handler
    // above will clean up.
    child.unref();

    // Orphan prevention: kill child when Node exits. One handler per object:
    // a generation that crashed never removed its own.
    if (this.cleanupHandler) process.removeListener("exit", this.cleanupHandler);
    this.cleanupHandler = () => this.kill();
    process.on("exit", this.cleanupHandler);
  }

  async send(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.proc?.stdin?.writable) {
      throw new ProcessExitedError(null);
    }

    const id = randomUUID();
    const command: IpcCommand = { id, cmd, args };
    const pending = this.pending;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new TimeoutError(id));
      }, this.commandTimeout);

      pending.set(id, { resolve, reject, timer });
      const stdin = this.proc?.stdin;
      if (stdin) stdin.write(JSON.stringify(command) + "\n");
    });
  }

  /**
   * Kill the Go subprocess: SIGTERM first, SIGKILL if it is still alive after
   * five seconds. Returns at once; the child exits on its own time. If you are
   * going to `start()` again, use `stop()`: the old child still holds the
   * session's SQLite file, and that file does not admit two writers.
   *
   * 🔴 THE ESCALATION HAS TO HOLD ITS OWN REFERENCE. It used to read
   * `this.proc?.kill("SIGKILL")` inside the timer while `this.proc = null` ran
   * synchronously just below — so five seconds later the optional chain
   * short-circuited on null and **SIGKILL was never sent**. A subprocess that
   * did not die on SIGTERM was then orphaned twice over: still running, and no
   * longer reachable, because every later `kill()` returns at the `!proc` guard.
   *
   * That is not theoretical. Measured in production on 9-sep-2026: 59 live Go
   * processes for 5 sessions, up to 20 of them holding the same SQLite session
   * file open — the one thing this store must never have — leaking a fresh
   * generation every four minutes and never losing one.
   */
  kill(): void {
    const proc = this.proc;
    if (!proc) return;

    if (this.cleanupHandler) {
      process.removeListener("exit", this.cleanupHandler);
      this.cleanupHandler = null;
    }

    // Dropped before the signals on purpose: from here on this class does not
    // own the process, and a caller that kills twice must not signal it twice.
    this.proc = null;

    try {
      proc.kill("SIGTERM");
      const forceTimer = setTimeout(() => {
        // Only if it is really still there. A process that exited cleanly has
        // one of these set, and signalling a reaped pid could hit a new process
        // that inherited it.
        if (proc.exitCode !== null || proc.signalCode !== null) return;
        try {
          proc.kill("SIGKILL");
        } catch (_) {
          /* process already dead */
        }
      }, 5000);
      forceTimer.unref();
    } catch (_) {
      /* process already dead */
    }
  }

  /**
   * Kill the Go subprocess and WAIT until it has actually exited: SIGTERM, then
   * SIGKILL after five seconds, then the `exit` of the child. This is the call
   * to make before starting the session again — the old process keeps the
   * session's SQLite file open until it is gone, and a new child spawned on top
   * of it dies at `init`. Resolves at once if there is nothing running.
   */
  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    const alreadyGone = proc.exitCode !== null || proc.signalCode !== null;
    const exited = alreadyGone
      ? Promise.resolve()
      : new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    this.kill();
    await exited;
  }

  get alive(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  private handleStdoutLine(
    line: string,
    pending: Map<string, PendingRequest>,
    current: () => boolean,
  ): void {
    let parsed: IpcResponse | IpcEvent;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    // Response (has `id`) vs Event (has `event`)
    if ("id" in parsed && typeof (parsed as IpcResponse).id === "string") {
      const resp = parsed as IpcResponse;
      const req = pending.get(resp.id);
      if (!req) return;

      clearTimeout(req.timer);
      pending.delete(resp.id);

      if (resp.ok) {
        req.resolve(resp.data);
      } else {
        req.reject(new WhatsmeowError(resp.error ?? "Unknown error", resp.code ?? "ERR_UNKNOWN"));
      }
    } else if ("event" in parsed) {
      // A replaced generation may still emit (`disconnected` while it shuts
      // down); the consumer must only hear the child it is actually talking to.
      if (!current()) return;
      const evt = parsed as IpcEvent;
      this.emit(evt.event, evt.data);
    }
  }

  private handleStderrLine(line: string): void {
    try {
      const log = JSON.parse(line);
      this.emit("log", log);
    } catch {
      // Non-JSON stderr, emit as raw log
      this.emit("log", { level: "raw", msg: line });
    }
  }
}
