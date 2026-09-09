// src/client.ts
import { EventEmitter as EventEmitter2 } from "events";
import { statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// src/process.ts
import { spawn } from "child_process";
import { createInterface } from "readline";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";

// src/errors.ts
var WhatsmeowError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "WhatsmeowError";
  }
};
var TimeoutError = class extends WhatsmeowError {
  constructor(commandId) {
    super(`Command ${commandId} timed out`, "ERR_TIMEOUT");
    this.name = "TimeoutError";
  }
};
var ProcessExitedError = class extends WhatsmeowError {
  constructor(exitCode) {
    super(`Go process exited with code ${exitCode}`, "ERR_PROCESS_EXITED");
    this.name = "ProcessExitedError";
  }
};

// src/process.ts
var GoProcess = class extends EventEmitter {
  constructor(binaryPath, commandTimeout = 3e4) {
    super();
    this.binaryPath = binaryPath;
    this.commandTimeout = commandTimeout;
  }
  proc = null;
  pending = /* @__PURE__ */ new Map();
  commandTimeout;
  cleanupHandler = null;
  start() {
    if (this.proc) return;
    this.proc = spawn(this.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutRl = createInterface({ input: this.proc.stdout });
    stdoutRl.on("line", (line) => this.handleStdoutLine(line));
    const stderrRl = createInterface({ input: this.proc.stderr });
    stderrRl.on("line", (line) => this.handleStderrLine(line));
    this.proc.on("exit", (code) => {
      this.proc = null;
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
    this.proc.unref();
    this.cleanupHandler = () => this.kill();
    process.on("exit", this.cleanupHandler);
  }
  async send(cmd, args = {}) {
    if (!this.proc?.stdin?.writable) {
      throw new ProcessExitedError(null);
    }
    const id = randomUUID();
    const command = { id, cmd, args };
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(id));
      }, this.commandTimeout);
      this.pending.set(id, { resolve: resolve2, reject, timer });
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
  kill() {
    const proc = this.proc;
    if (!proc) return;
    if (this.cleanupHandler) {
      process.removeListener("exit", this.cleanupHandler);
      this.cleanupHandler = null;
    }
    this.proc = null;
    try {
      proc.kill("SIGTERM");
      const forceTimer = setTimeout(() => {
        if (proc.exitCode !== null || proc.signalCode !== null) return;
        try {
          proc.kill("SIGKILL");
        } catch (_) {
        }
      }, 5e3);
      forceTimer.unref();
    } catch (_) {
    }
  }
  get alive() {
    return this.proc !== null && !this.proc.killed;
  }
  handleStdoutLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if ("id" in parsed && typeof parsed.id === "string") {
      const resp = parsed;
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
      const evt = parsed;
      this.emit(evt.event, evt.data);
    }
  }
  handleStderrLine(line) {
    try {
      const log = JSON.parse(line);
      this.emit("log", log);
    } catch {
      this.emit("log", { level: "raw", msg: line });
    }
  }
};

// src/client.ts
var WhatsmeowClient = class extends EventEmitter2 {
  proc;
  store;
  constructor(options) {
    super();
    this.store = options.store;
    this.proc = new GoProcess(options.binaryPath ?? resolveBinary(), options.commandTimeout);
    this.proc.on("connected", (d) => this.emit("connected", d));
    this.proc.on("disconnected", (d) => this.emit("disconnected", d));
    this.proc.on("logged_out", (d) => this.emit("logged_out", d));
    this.proc.on("stream_error", (d) => this.emit("stream_error", d));
    this.proc.on("temporary_ban", (d) => this.emit("temporary_ban", d));
    this.proc.on("keep_alive_timeout", (d) => this.emit("keep_alive_timeout", d));
    this.proc.on("keep_alive_restored", (d) => this.emit("keep_alive_restored", d));
    this.proc.on("message", (d) => this.emit("message", d));
    this.proc.on("message:receipt", (d) => this.emit("message:receipt", d));
    this.proc.on("chat_presence", (d) => this.emit("chat_presence", d));
    this.proc.on("presence", (d) => this.emit("presence", d));
    this.proc.on("group:info", (d) => this.emit("group:info", d));
    this.proc.on("group:joined", (d) => this.emit("group:joined", d));
    this.proc.on("picture", (d) => this.emit("picture", d));
    this.proc.on("call:offer", (d) => this.emit("call:offer", d));
    this.proc.on("call:accept", (d) => this.emit("call:accept", d));
    this.proc.on("call:terminate", (d) => this.emit("call:terminate", d));
    this.proc.on("call:log", (d) => this.emit("call:log", d));
    this.proc.on("identity_change", (d) => this.emit("identity_change", d));
    this.proc.on("history_sync", (d) => this.emit("history_sync", d));
    this.proc.on("qr", (d) => this.emit("qr", d));
    this.proc.on("qr:timeout", (d) => this.emit("qr:timeout", d));
    this.proc.on("qr:error", (d) => this.emit("qr:error", d));
    this.proc.on("log", (d) => this.emit("log", d));
    this.proc.on("error", (e) => this.emit("error", e));
    this.proc.on("exit", (d) => this.emit("exit", d));
  }
  // ── Typed event emitter ──────────────────────────
  on(event, listener) {
    return super.on(event, listener);
  }
  once(event, listener) {
    return super.once(event, listener);
  }
  emit(event, data) {
    return super.emit(event, data);
  }
  // ── Connection & Auth ────────────────────────────
  // Maps to: whatsmeow.NewClient() + store setup
  async init() {
    this.proc.start();
    return await this.proc.send("init", { store: normalizeStore(this.store) });
  }
  // Maps to: client.Connect()
  async connect() {
    await this.proc.send("connect");
  }
  // Maps to: client.Disconnect()
  async disconnect() {
    await this.proc.send("disconnect");
  }
  // Maps to: client.Logout()
  async logout() {
    await this.proc.send("logout");
  }
  // Maps to: client.IsConnected()
  async isConnected() {
    const result = await this.proc.send("isConnected");
    return result.connected;
  }
  // Maps to: client.IsLoggedIn()
  async isLoggedIn() {
    const result = await this.proc.send("isLoggedIn");
    return result.loggedIn;
  }
  // Maps to: client.WaitForConnection()
  async waitForConnection(timeoutMs = 3e4) {
    const result = await this.proc.send("waitForConnection", { timeoutMs });
    return result.connected;
  }
  // Kill the Go subprocess. Called automatically if the Node process exits.
  close() {
    this.proc.kill();
  }
  // ── Pairing ────────────────────────────────────────
  // Maps to: client.GetQRChannel() — call before connect()
  async getQRChannel() {
    await this.proc.send("getQRChannel");
  }
  // Maps to: client.PairPhone() — call after connect()
  async pairCode(phone) {
    const result = await this.proc.send("pairCode", { phone });
    return result.code;
  }
  // ── Messaging ────────────────────────────────────
  async sendMessage(jid, message) {
    return await this.proc.send("sendMessage", {
      jid,
      message
    });
  }
  async sendRawMessage(jid, message) {
    return await this.proc.send("sendMessage", {
      jid,
      message
    });
  }
  async revokeMessage(chat, sender, id) {
    await this.proc.send("revokeMessage", { chat, sender, id });
  }
  async markRead(ids, chat, sender) {
    await this.proc.send("markRead", { ids, chat, sender: sender ?? "" });
  }
  // ── Media ────────────────────────────────────────
  async downloadMedia(msg) {
    const result = await this.proc.send("downloadMedia", msg);
    return result.path;
  }
  // ── Contacts & Users ─────────────────────────────
  async isOnWhatsApp(phones) {
    return await this.proc.send("isOnWhatsApp", { phones });
  }
  async getUserInfo(jids) {
    return await this.proc.send("getUserInfo", { jids });
  }
  async getProfilePicture(jid) {
    return await this.proc.send("getProfilePicture", { jid });
  }
  // ── Groups ───────────────────────────────────────
  async createGroup(name, participants) {
    return await this.proc.send("createGroup", {
      name,
      participants
    });
  }
  async getGroupInfo(jid) {
    return await this.proc.send("getGroupInfo", { jid });
  }
  async getJoinedGroups() {
    return await this.proc.send("getJoinedGroups");
  }
  async getGroupInviteLink(jid, reset = false) {
    const result = await this.proc.send("getGroupInviteLink", {
      jid,
      reset
    });
    return result.link;
  }
  async joinGroupWithLink(code) {
    const result = await this.proc.send("joinGroupWithLink", { code });
    return result.jid;
  }
  async leaveGroup(jid) {
    await this.proc.send("leaveGroup", { jid });
  }
  async setGroupName(jid, name) {
    await this.proc.send("setGroupName", { jid, name });
  }
  async setGroupTopic(jid, topic, previousId = "", newId = "") {
    await this.proc.send("setGroupTopic", { jid, topic, previousId, newId });
  }
  async setGroupPhoto(jid, path) {
    const result = await this.proc.send("setGroupPhoto", {
      jid,
      path
    });
    return result.pictureId;
  }
  async setGroupAnnounce(jid, announce) {
    await this.proc.send("setGroupAnnounce", { jid, announce });
  }
  async setGroupLocked(jid, locked) {
    await this.proc.send("setGroupLocked", { jid, locked });
  }
  async updateGroupParticipants(jid, participants, action) {
    await this.proc.send("updateGroupParticipants", {
      jid,
      participants,
      action
    });
  }
  // ── Presence ─────────────────────────────────────
  async sendPresence(presence) {
    await this.proc.send("sendPresence", { presence });
  }
  async sendChatPresence(jid, presence, media = "") {
    await this.proc.send("sendChatPresence", { jid, presence, media });
  }
  async subscribePresence(jid) {
    await this.proc.send("subscribePresence", { jid });
  }
  // ── Newsletters ──────────────────────────────────
  async getSubscribedNewsletters() {
    return await this.proc.send("getSubscribedNewsletters");
  }
  async newsletterSubscribeLiveUpdates(jid) {
    const result = await this.proc.send("newsletterSubscribeLiveUpdates", {
      jid
    });
    return result.durationMs;
  }
  // ── Calls ────────────────────────────────────────
  async rejectCall(from, callId) {
    await this.proc.send("rejectCall", { from, callId });
  }
  // ── Message Operations (extra) ──────────────────
  async sendReaction(chat, sender, id, reaction) {
    return await this.proc.send("sendReaction", { chat, sender, id, reaction });
  }
  async editMessage(chat, id, message) {
    return await this.proc.send("editMessage", { chat, id, message });
  }
  async sendPollCreation(jid, name, options, selectableCount) {
    return await this.proc.send("sendPollCreation", {
      jid,
      name,
      options,
      selectableCount
    });
  }
  async sendPollVote(pollChat, pollSender, pollId, pollTimestamp, options) {
    return await this.proc.send("sendPollVote", {
      pollChat,
      pollSender,
      pollId,
      pollTimestamp,
      options
    });
  }
  // ── Advanced Groups ─────────────────────────────
  async setGroupDescription(jid, description) {
    await this.proc.send("setGroupDescription", { jid, description });
  }
  async getGroupInfoFromLink(code) {
    return await this.proc.send("getGroupInfoFromLink", { code });
  }
  async getGroupRequestParticipants(jid) {
    return await this.proc.send("getGroupRequestParticipants", {
      jid
    });
  }
  async updateGroupRequestParticipants(jid, participants, action) {
    await this.proc.send("updateGroupRequestParticipants", { jid, participants, action });
  }
  async setGroupMemberAddMode(jid, mode) {
    await this.proc.send("setGroupMemberAddMode", { jid, mode });
  }
  async setGroupJoinApprovalMode(jid, enabled) {
    await this.proc.send("setGroupJoinApprovalMode", { jid, enabled });
  }
  async linkGroup(parent, child) {
    await this.proc.send("linkGroup", { parent, child });
  }
  async unlinkGroup(parent, child) {
    await this.proc.send("unlinkGroup", { parent, child });
  }
  async getSubGroups(jid) {
    return await this.proc.send("getSubGroups", { jid });
  }
  async getLinkedGroupsParticipants(jid) {
    return await this.proc.send("getLinkedGroupsParticipants", { jid });
  }
  // ── Newsletter Operations (extra) ───────────────
  async createNewsletter(name, description, picture) {
    return await this.proc.send("createNewsletter", {
      name,
      description,
      picture: picture ?? ""
    });
  }
  async getNewsletterInfo(jid) {
    return await this.proc.send("getNewsletterInfo", { jid });
  }
  async getNewsletterInfoWithInvite(key) {
    return await this.proc.send("getNewsletterInfoWithInvite", { key });
  }
  async followNewsletter(jid) {
    await this.proc.send("followNewsletter", { jid });
  }
  async unfollowNewsletter(jid) {
    await this.proc.send("unfollowNewsletter", { jid });
  }
  async getNewsletterMessages(jid, count, before = 0) {
    return await this.proc.send("getNewsletterMessages", {
      jid,
      count,
      before
    });
  }
  async newsletterMarkViewed(jid, serverIds) {
    await this.proc.send("newsletterMarkViewed", { jid, serverIds });
  }
  async newsletterSendReaction(jid, serverId, reaction, messageId) {
    await this.proc.send("newsletterSendReaction", { jid, serverId, reaction, messageId });
  }
  async newsletterToggleMute(jid, mute) {
    await this.proc.send("newsletterToggleMute", { jid, mute });
  }
  // ── User & Contact Operations (extra) ───────────
  async getUserDevices(jids) {
    return await this.proc.send("getUserDevices", { jids });
  }
  async getBusinessProfile(jid) {
    return await this.proc.send("getBusinessProfile", { jid });
  }
  async setStatusMessage(message) {
    await this.proc.send("setStatusMessage", { message });
  }
  // ── Privacy & Settings ──────────────────────────
  async getPrivacySettings() {
    return await this.proc.send("getPrivacySettings");
  }
  async tryFetchPrivacySettings(ignoreCache = false) {
    return await this.proc.send("tryFetchPrivacySettings", { ignoreCache });
  }
  async setPrivacySetting(name, value) {
    return await this.proc.send("setPrivacySetting", { name, value });
  }
  async getStatusPrivacy() {
    return await this.proc.send("getStatusPrivacy");
  }
  async setDefaultDisappearingTimer(seconds) {
    await this.proc.send("setDefaultDisappearingTimer", { seconds });
  }
  async setDisappearingTimer(jid, seconds) {
    await this.proc.send("setDisappearingTimer", { jid, seconds });
  }
  // ── Blocklist ───────────────────────────────────
  async getBlocklist() {
    return await this.proc.send("getBlocklist");
  }
  async updateBlocklist(jid, action) {
    return await this.proc.send("updateBlocklist", { jid, action });
  }
  // ── QR & Link Resolution ────────────────────────
  async getContactQRLink(revoke = false) {
    const result = await this.proc.send("getContactQRLink", { revoke });
    return result.link;
  }
  async resolveContactQRLink(code) {
    return await this.proc.send("resolveContactQRLink", { code });
  }
  async resolveBusinessMessageLink(code) {
    return await this.proc.send("resolveBusinessMessageLink", {
      code
    });
  }
  // ── Media Upload ────────────────────────────────
  async uploadMedia(path, mediaType) {
    return await this.proc.send("uploadMedia", { path, mediaType });
  }
  // Maps to: client.DeleteMedia()
  async deleteMedia(mediaType, directPath, encFileHash, encHandle = "") {
    await this.proc.send("deleteMedia", { mediaType, directPath, encFileHash, encHandle });
  }
  // ── Configuration ───────────────────────────────
  async setPassive(passive) {
    await this.proc.send("setPassive", { passive });
  }
  async setForceActiveDeliveryReceipts(active) {
    await this.proc.send("setForceActiveDeliveryReceipts", { active });
  }
  // ── Newsletter Updates & TOS ────────────────────
  async acceptTOSNotice(noticeId, stage) {
    await this.proc.send("acceptTOSNotice", { noticeId, stage });
  }
  async getNewsletterMessageUpdates(jid, count, opts) {
    return await this.proc.send("getNewsletterMessageUpdates", {
      jid,
      count,
      since: opts?.since ?? 0,
      after: opts?.after ?? 0
    });
  }
  // ── Group Invite Operations ───────────────────
  async getGroupInfoFromInvite(jid, inviter, code, expiration) {
    return await this.proc.send("getGroupInfoFromInvite", {
      jid,
      inviter,
      code,
      expiration
    });
  }
  async joinGroupWithInvite(jid, inviter, code, expiration) {
    await this.proc.send("joinGroupWithInvite", { jid, inviter, code, expiration });
  }
  // ── Newsletter Upload ─────────────────────────
  async uploadNewsletter(path, mediaType) {
    return await this.proc.send("uploadNewsletter", {
      path,
      mediaType
    });
  }
  // ── Download Any ──────────────────────────────
  async downloadAny(message) {
    const result = await this.proc.send("downloadAny", { message });
    return result.path;
  }
  // ── Connection Internals ────────────────────────
  async resetConnection() {
    await this.proc.send("resetConnection");
  }
  // ── Message Helpers ───────────────────────────
  async generateMessageID() {
    const result = await this.proc.send("generateMessageID");
    return result.id;
  }
  async buildMessageKey(chat, sender, id) {
    return await this.proc.send("buildMessageKey", { chat, sender, id });
  }
  async buildUnavailableMessageRequest(chat, sender, id) {
    return await this.proc.send("buildUnavailableMessageRequest", {
      chat,
      sender,
      id
    });
  }
  async buildHistorySyncRequest(info, count) {
    return await this.proc.send("buildHistorySyncRequest", {
      info,
      count
    });
  }
  // ── Peer & Retry ──────────────────────────────
  async sendPeerMessage(message) {
    return await this.proc.send("sendPeerMessage", { message });
  }
  async sendMediaRetryReceipt(info, mediaKey) {
    await this.proc.send("sendMediaRetryReceipt", { info, mediaKey });
  }
  async sendHistorySyncServerErrorReceipt(msgID, mediaKey) {
    await this.proc.send("sendHistorySyncServerErrorReceipt", { msgID, mediaKey });
  }
  async sendProtocolMessageReceipt(id, msgType) {
    await this.proc.send("sendProtocolMessageReceipt", { id, msgType });
  }
  async setMaxParallelRetryReceiptHandling(maxParallel) {
    await this.proc.send("setMaxParallelRetryReceiptHandling", { maxParallel });
  }
  // ── Download Variants ─────────────────────────
  async downloadMediaWithPath(opts) {
    const result = await this.proc.send("downloadMediaWithPath", {
      ...opts,
      mmsType: opts.mmsType ?? ""
    });
    return result.path;
  }
  async downloadMediaWithOnlyPath(directPath) {
    const result = await this.proc.send("downloadMediaWithOnlyPath", { directPath });
    return result.path;
  }
  async fetchStickerPack(packID) {
    return await this.proc.send("fetchStickerPack", { packID });
  }
  // ── Bot APIs ──────────────────────────────────
  async getBotListV2() {
    return await this.proc.send("getBotListV2");
  }
  async getBotProfiles(bots) {
    return await this.proc.send("getBotProfiles", { bots });
  }
  // ── App State ─────────────────────────────────
  async fetchAppState(name, fullSync = false, onlyIfNotSynced = false) {
    await this.proc.send("fetchAppState", { name, fullSync, onlyIfNotSynced });
  }
  async markNotDirty(cleanType, timestamp) {
    await this.proc.send("markNotDirty", { cleanType, timestamp });
  }
  // ── Decrypt / Encrypt ─────────────────────────
  async decryptComment(info, message) {
    return await this.proc.send("decryptComment", { info, message });
  }
  async decryptPollVote(info, message) {
    return await this.proc.send("decryptPollVote", { info, message });
  }
  async decryptReaction(info, message) {
    return await this.proc.send("decryptReaction", { info, message });
  }
  async decryptSecretEncryptedMessage(info, message) {
    return await this.proc.send("decryptSecretEncryptedMessage", {
      info,
      message
    });
  }
  async encryptComment(info, message) {
    return await this.proc.send("encryptComment", { info, message });
  }
  async encryptPollVote(info, vote) {
    return await this.proc.send("encryptPollVote", { info, vote });
  }
  async encryptReaction(info, reaction) {
    return await this.proc.send("encryptReaction", { info, reaction });
  }
  // ── Web Message Parsing ───────────────────────
  async parseWebMessage(chatJid, webMsg) {
    return await this.proc.send("parseWebMessage", { chatJid, webMsg });
  }
  // ── Generic fallback ─────────────────────────────
  async call(method, args = {}) {
    return this.proc.send(method, args);
  }
};
function normalizeStore(store) {
  if (store.startsWith("file:") || store.startsWith("postgres://") || store.startsWith("postgresql://")) {
    return store;
  }
  return `file:${store}`;
}
var BINARY_NAME = process.platform === "win32" ? "whatsmeow-node.exe" : "whatsmeow-node";
function resolveBinary() {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const localBin = resolve(thisDir, "../../whatsmeow-node");
  try {
    if (statSync(localBin).isFile()) return localBin;
  } catch {
  }
  const require2 = createRequire(import.meta.url);
  const pkgName = `@whatsmeow-node/${process.platform}-${process.arch}`;
  try {
    return require2.resolve(`${pkgName}/bin/${BINARY_NAME}`);
  } catch {
    throw new Error(
      `Could not find whatsmeow-node binary. Install ${pkgName} or set binaryPath option.`
    );
  }
}

// src/index.ts
function createClient(options) {
  return new WhatsmeowClient(options);
}
export {
  ProcessExitedError,
  TimeoutError,
  WhatsmeowClient,
  WhatsmeowError,
  createClient
};
