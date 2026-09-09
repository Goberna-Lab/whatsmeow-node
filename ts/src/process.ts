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

export class GoProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
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

    this.proc = spawn(this.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // stdout: responses + events (JSON lines)
    // stdio: ["pipe", "pipe", "pipe"] guarantees these are non-null
    const stdoutRl = createInterface({ input: this.proc.stdout as NodeJS.ReadableStream });
    stdoutRl.on("line", (line) => this.handleStdoutLine(line));

    // stderr: structured logs (JSON lines)
    const stderrRl = createInterface({ input: this.proc.stderr as NodeJS.ReadableStream });
    stderrRl.on("line", (line) => this.handleStderrLine(line));

    this.proc.on("exit", (code) => {
      this.proc = null;
      // Reject all pending requests
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new ProcessExitedError(code));
        this.pending.delete(id);
      }
      this.emit("exit", { code });
    });

    this.proc.on("error", (err) => {
      this.emit("error", err);
    });

    // Let the child process not keep the event loop alive on its own.
    // Node will still wait for pending I/O (readline), but if user code
    // has nothing else to do, the process can exit and the "exit" handler
    // below will clean up.
    this.proc.unref();

    // Orphan prevention: kill child when Node exits
    this.cleanupHandler = () => this.kill();
    process.on("exit", this.cleanupHandler);
  }

  /**
   * `timeoutMs` overrides the process-wide default for this one command.
   *
   * One number for all 106 commands meant `isConnected` — the watchdog's ping,
   * which has to be quick so "no answer" stays distinguishable from "slow" —
   * shared its limit with downloading a 16 MB video. When the download ran over,
   * the Node side rejected with TimeoutError while the Go side kept going: it
   * finished, wrote its temp file, and nobody collected it. The message lost its
   * attachment for good, because nothing retries.
   */
  async send(
    cmd: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = this.commandTimeout,
  ): Promise<unknown> {
    if (!this.proc?.stdin?.writable) {
      throw new ProcessExitedError(null);
    }

    const id = randomUUID();
    const command: IpcCommand = { id, cmd, args };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(id));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const stdin = this.proc?.stdin;
      if (stdin) stdin.write(JSON.stringify(command) + "\n");
    });
  }

  /**
   * Kill the Go subprocess: SIGTERM first, SIGKILL if it is still alive after
   * five seconds.
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

        // 🔴 KILLING HAS TO BE VERIFIABLE, NOT JUST ATTEMPTED. Nothing used to
        // check that the process was actually gone — which is why a leak of 59
        // live processes was found with `ps` in production instead of in a log.
        // Surviving SIGKILL is rare (it takes uninterruptible sleep) but if it
        // happens it must say so: that process still holds a session store open.
        const verifyTimer = setTimeout(() => {
          if (proc.exitCode !== null || proc.signalCode !== null) return;
          this.emit("log", {
            level: "error",
            msg: `whatsmeow subprocess survived SIGKILL (pid ${proc.pid}) — it still holds the session store open`,
            pid: proc.pid,
          });
        }, 2000);
        verifyTimer.unref();
      }, 5000);
      forceTimer.unref();
    } catch (_) {
      /* process already dead */
    }
  }

  get alive(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  private handleStdoutLine(line: string): void {
    let parsed: IpcResponse | IpcEvent;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    // Response (has `id`) vs Event (has `event`)
    if ("id" in parsed && typeof (parsed as IpcResponse).id === "string") {
      const resp = parsed as IpcResponse;
      const req = this.pending.get(resp.id);
      if (!req) return;

      clearTimeout(req.timer);
      this.pending.delete(resp.id);

      if (resp.ok) {
        req.resolve(resp.data);
      } else {
        req.reject(new WhatsmeowError(resp.error ?? "Unknown error", resp.code ?? "ERR_UNKNOWN"));
      }
    } else if ("event" in parsed) {
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
