import { EventEmitter } from 'node:events';

type JID = string;
interface MessageInfo {
    id: string;
    chat: JID;
    sender: JID;
    isFromMe: boolean;
    isGroup: boolean;
    timestamp: number;
    pushName: string;
}
interface SendResponse {
    id: string;
    timestamp: number;
}
interface ContextInfo {
    stanzaId?: string;
    participant?: JID;
    quotedMessage?: Record<string, unknown>;
}
interface TextMessage {
    conversation: string;
}
interface ExtendedTextMessage {
    extendedTextMessage: {
        text: string;
        contextInfo?: ContextInfo;
    };
}
type MessageContent = TextMessage | ExtendedTextMessage;
interface GroupParticipant {
    jid: JID;
    isAdmin: boolean;
    isSuperAdmin: boolean;
}
interface GroupInfo {
    jid: JID;
    name: string;
    description?: string;
    owner?: JID;
    announce: boolean;
    locked: boolean;
    ephemeral: boolean;
    participants: GroupParticipant[];
}
interface IsOnWhatsAppResult {
    query: string;
    isIn: boolean;
    jid?: JID;
}
interface UserInfo {
    status: string;
    pictureID: string;
    verifiedName: string;
}
interface ProfilePicture {
    url: string;
    id: string;
    type: string;
}
type Presence = "available" | "unavailable";
type ChatPresence = "composing" | "paused";
type ChatPresenceMedia = "audio" | "";
interface NewsletterInfo {
    id: JID;
    name: string;
}
interface NewsletterMetadata {
    id: JID;
    state: string;
    name?: string;
    description?: string;
    pictureUrl?: string;
    role?: string;
    mute?: string;
}
interface NewsletterMessage {
    serverId: number;
    timestamp: number;
    viewsCount: number;
    message?: Record<string, unknown>;
    reactions?: Array<{
        reaction: string;
        count: number;
    }>;
}
interface BusinessProfile {
    jid: JID;
    address?: string;
    email?: string;
    categories?: Array<{
        id: string;
        name: string;
    }>;
    profileOptions?: Record<string, string>;
    businessHoursTimeZone?: string;
    businessHours?: Array<{
        dayOfWeek: string;
        mode: string;
        openTime: string;
        closeTime: string;
    }>;
}
interface BusinessMessageLinkTarget {
    jid: JID;
    pushName: string;
    message: string;
    isSigned?: boolean;
    verifiedLevel?: string;
    verifiedName?: string;
}
interface ContactQRLinkTarget {
    jid: JID;
    type: string;
    pushName: string;
}
type PrivacySettingAllContactsBlacklistNone = "all" | "contacts" | "contact_blacklist" | "none";
type PrivacySettingAllNone = "all" | "none";
type PrivacySettingAllKnown = "all" | "known";
type PrivacySettingAllMatchLastSeen = "all" | "match_last_seen";
type PrivacySettingAllContacts = "all" | "contacts";
type PrivacySettingOnStandardOff = "on_standard" | "off";
type PrivacySettingContactsAllowlistNone = "contacts" | "contact_allowlist" | "none";
interface PrivacySettings {
    groupAdd: PrivacySettingAllContactsBlacklistNone;
    lastSeen: PrivacySettingAllContactsBlacklistNone;
    status: PrivacySettingAllContactsBlacklistNone;
    profile: PrivacySettingAllContactsBlacklistNone;
    readReceipts: PrivacySettingAllNone;
    callAdd: PrivacySettingAllKnown;
    online: PrivacySettingAllMatchLastSeen;
    messages: PrivacySettingAllContacts;
    defense: PrivacySettingOnStandardOff;
    stickers: PrivacySettingContactsAllowlistNone;
}
type StatusPrivacyType = "contacts" | "blacklist" | "whitelist";
interface StatusPrivacy {
    type: StatusPrivacyType;
    list: JID[];
    isDefault: boolean;
}
type PrivacySettingName = "groupadd" | "last" | "status" | "profile" | "readreceipts" | "calladd" | "online" | "messages" | "defense" | "stickers";
type PrivacySettingValue = "all" | "contacts" | "contact_allowlist" | "contact_blacklist" | "match_last_seen" | "known" | "none" | "on_standard" | "off";
interface Blocklist {
    jids: string[];
}
type MediaType = "image" | "video" | "audio" | "document";
interface UploadResponse {
    URL: string;
    directPath: string;
    mediaKey: string;
    fileEncSHA256: string;
    fileSHA256: string;
    fileLength: number;
}
/** Newsletter uploads may or may not include encryption fields depending on the server. */
interface NewsletterUploadResponse {
    URL: string;
    directPath: string;
    mediaKey: string | null;
    fileEncSHA256: string | null;
    fileSHA256: string | null;
    fileLength: number;
}
interface StickerPackItem {
    "media-key": number[];
    "enc-file-hash": number[];
    "file-hash": number[];
    "direct-path": string;
    url: string;
    "file-size": number;
    mimetype: string;
    height: number;
    width: number;
    emojis: string[];
    "accessibility-text": string;
    handle: string;
    "sticker-hash-without-meta": number[];
    "preview-webp-id": string;
}
interface StickerPack {
    "sticker-pack-id": string;
    name: string;
    publisher: string;
    description: string;
    "file-size": string;
    "image-data-hash": string;
    stickers: StickerPackItem[];
    animated: number;
    lottie: number;
    "preview-image-ids": string[];
    "tray-image-id": string;
    "tray-image-preview": string;
}
interface GroupRequestParticipant {
    jid: JID;
    requestedAt: number;
}
interface SubGroupInfo {
    jid: JID;
    name: string;
    isDefaultSub: boolean;
}
type GroupMemberAddMode = "admin_add" | "all_member_add";
type ParticipantRequestAction = "approve" | "reject";
type BlocklistAction = "block" | "unblock";
interface BotListInfo {
    botJid: JID;
    personaId: string;
}
interface BotProfileInfo {
    jid: JID;
    name: string;
    description: string;
    category: string;
    isDefault: boolean;
    personaId: string;
    commandsDescription: string;
    attributes?: string;
    prompts?: string[];
    commands?: unknown[];
}
type AppStatePatchName = "regular_high" | "regular_low" | "regular" | "critical_block" | "critical_unblock_low";
interface InitResult {
    jid?: JID;
}
interface GroupInfoEvent {
    jid: JID;
    name?: string;
    description?: string;
    announce?: boolean;
    locked?: boolean;
    ephemeral?: boolean;
    join?: JID[];
    leave?: JID[];
    promote?: JID[];
    demote?: JID[];
}
/**
 * Who the Go binary is, as answered by the `version` command.
 *
 * This exists because the failure it guards against is total and silent. This
 * fork adds events upstream does not have; with upstream's binary installed
 * those events are never emitted, every subscription stays quiet, and nothing
 * raises an error — a consumer cannot tell "nothing happened" from "this binary
 * cannot tell me when it happens".
 *
 * Ask before depending on anything: compare `events` against the event names you
 * subscribe to, and say so loudly if one is missing.
 */
interface BinaryVersion {
    /** `"goberna"` for this fork. Anything else is a binary without its events. */
    fork: string;
    /** The fork's own version, e.g. `"0.7.0-goberna.4"`. */
    version: string;
    /** The whatsmeow build it was linked against, read from the embedded module info. */
    whatsmeow: string;
    /** Every event name this binary can emit. Checked against the source in CI. */
    events: string[];
}
interface WhatsmeowEvents {
    connected: {
        jid: JID;
    };
    disconnected: Record<string, never>;
    logged_out: {
        reason: string;
    };
    stream_error: {
        code: string;
    };
    /**
     * Another client connected with the same session keys and took the socket
     * over. The connection is gone and it will not come back on its own.
     *
     * Usually a second process opened on the same store file. Nothing else
     * reports it: without this event the client keeps looking connected while the
     * line is already deaf.
     */
    stream_replaced: Record<string, never>;
    temporary_ban: {
        code: string;
        expire: string;
    };
    keep_alive_timeout: {
        errorCount: number;
    };
    keep_alive_restored: Record<string, never>;
    message: {
        info: MessageInfo;
        message: Record<string, unknown>;
    };
    /**
     * A message arrived and could not be decrypted.
     *
     * whatsmeow asks the sender to retry on its own; when that works a normal
     * `message` follows carrying the same `info.id`. When it does not, this event
     * is the only trace that the conversation is missing a turn.
     *
     * `unavailableType` and `decryptFailMode` are forwarded exactly as whatsmeow
     * reports them, empty string included — upstream an empty string is a value,
     * not an absence. For `decryptFailMode`, `""` means the message should still
     * be shown and `"hide"` means it should not; for `unavailableType`, `""`
     * means the reason is unknown and `"view_once"` means the message was never
     * meant to be readable twice.
     */
    "message:undecryptable": {
        info: MessageInfo;
        isUnavailable: boolean;
        unavailableType: string;
        decryptFailMode: string;
    };
    "message:receipt": {
        type: string;
        chat: JID;
        sender: JID;
        isGroup: boolean;
        ids: string[];
        timestamp: number;
    };
    chat_presence: {
        chat: JID;
        sender: JID;
        state: ChatPresence;
        media: ChatPresenceMedia;
    };
    presence: {
        jid: JID;
        presence: Presence;
        lastSeen?: number;
    };
    "group:info": GroupInfoEvent;
    "group:joined": {
        jid: JID;
        name: string;
    };
    picture: {
        jid: JID;
        remove: boolean;
        pictureId?: string;
    };
    "call:offer": {
        from: JID;
        callId: string;
    };
    "call:accept": {
        from: JID;
        callId: string;
    };
    "call:terminate": {
        from: JID;
        callId: string;
        reason: string;
    };
    identity_change: {
        jid: JID;
        timestamp: number;
    };
    /**
     * One entry of the phone's own call log — the list shown in WhatsApp's
     * "Calls" tab, including calls placed from the phone itself.
     *
     * Arrives from two places, told apart by `source`: `"history"` for the batch
     * the phone pushes when the device is linked, and `"appstate"` for every call
     * that happens afterwards. Both carry the same shape, so a consumer only
     * needs one handler.
     *
     * `result` and `callType` are the protobuf enum names, not numbers, so the
     * consumer never has to mirror the enum ordering. `startTime` is seconds
     * since the epoch and `duration` is in seconds (0 when the call never
     * connected).
     */
    "call:log": {
        source: "history" | "appstate";
        callId: string;
        callCreatorJid: string;
        result: string;
        callType: string;
        isIncoming: boolean;
        isVideo: boolean;
        isCallLink: boolean;
        isDndMode: boolean;
        duration: number;
        startTime: number;
        silenceReason?: string;
        groupJid?: string;
        scheduledCallId?: string;
        participants: {
            jid: string;
            callResult: string;
        }[];
    };
    /**
     * A label of a WhatsApp Business account was created, renamed, recoloured or
     * deleted on the phone.
     *
     * Deleting does not withhold the event: it arrives with `deleted: true`, which
     * is what tells a consumer to stop showing a label the seller already removed.
     *
     * `color` is WhatsApp's own palette index, not a CSS colour — the palette is
     * the consumer's to map. `timestamp` is seconds since the epoch, unformatted.
     *
     * `fromFullSync` marks the batch WhatsApp re-sends whenever it syncs app state
     * in full, as opposed to a label the seller just edited. It does the same job
     * `source` does on `call:log`: a re-sync of 700 existing labels is not 700 new
     * edits, and a consumer that treats it as such will double-count.
     */
    "label:edit": {
        labelId: string;
        name: string;
        color: number;
        deleted: boolean;
        timestamp: number;
        fromFullSync: boolean;
    };
    /**
     * A label was put on or taken off a chat.
     *
     * `labeled` says which, and `false` is a real un-labeling rather than a
     * missing value — the bridge drops any association it cannot read instead of
     * letting it default to `false`, precisely so this field can be trusted.
     */
    "label:chat": {
        jid: JID;
        labelId: string;
        labeled: boolean;
        timestamp: number;
        fromFullSync: boolean;
    };
    /**
     * A label was put on or taken off a single message. Same shape as
     * `label:chat` plus the message it applies to; `jid` is the chat the message
     * lives in.
     */
    "label:message": {
        jid: JID;
        labelId: string;
        messageId: string;
        labeled: boolean;
        timestamp: number;
        fromFullSync: boolean;
    };
    /**
     * An event type crossed the Go switch without a case of its own — this bridge
     * is dropping it.
     *
     * 🔴 Only the Go type name crosses, never the payload: an unhandled event can
     * carry a contact's name, a phone number or message text, and none of it has a
     * consumer here. The question this answers is "what are we dropping?", which
     * the name alone answers.
     *
     * Reported at powers of ten (`count` is 1, 10, 100…), not on every sighting: a
     * full app-state sync fires thousands of `*events.Contact`, and a report per
     * event would flood the same pipe real traffic uses.
     */
    /**
     * El proceso de Go se recuperó de un pánico y sigue vivo.
     *
     * Antes esto no existía porque un pánico mataba el proceso entero: la sesión
     * se caía, todo lo pendiente se rechazaba y la vendedora dejaba de recibir. Y
     * si el pánico era determinista —un mensaje que siempre lo dispara— la línea
     * quedaba en un bucle de reinicio indistinguible de una caída de red.
     *
     * Ahora se pierde un evento en vez de una sesión, y queda dicho. **Recibir
     * esto es un bug del puente, no un problema de red**: `where` dice qué se
     * estaba haciendo y `stack` dónde reventó.
     */
    "event:panic": {
        where: string;
        error: string;
        stack: string;
    };
    "event:unhandled": {
        type: string;
        count: number;
    };
    history_sync: {
        type: string;
    };
    qr: {
        code: string;
    };
    "qr:timeout": null;
    "qr:error": {
        event: string;
    };
    log: {
        level: string;
        msg: string;
        [key: string]: unknown;
    };
    error: Error;
    exit: {
        code: number | null;
    };
}
interface ClientOptions {
    store: string;
    binaryPath?: string;
    commandTimeout?: number;
}

declare class WhatsmeowClient extends EventEmitter {
    private proc;
    private store;
    constructor(options: ClientOptions);
    on<K extends keyof WhatsmeowEvents>(event: K, listener: (data: WhatsmeowEvents[K]) => void): this;
    once<K extends keyof WhatsmeowEvents>(event: K, listener: (data: WhatsmeowEvents[K]) => void): this;
    emit<K extends keyof WhatsmeowEvents>(event: K, data: WhatsmeowEvents[K]): boolean;
    init(): Promise<InitResult>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    logout(): Promise<void>;
    /**
     * Who this binary is, and what it can emit.
     *
     * Needs no session: it is meant to be asked right after the process starts, to
     * decide whether this build can do what you are about to depend on. Throws on
     * a binary that predates the command — which is itself the answer, and the one
     * a consumer has to handle rather than let pass.
     */
    version(): Promise<BinaryVersion>;
    isConnected(): Promise<boolean>;
    isLoggedIn(): Promise<boolean>;
    waitForConnection(timeoutMs?: number): Promise<boolean>;
    close(): void;
    getQRChannel(): Promise<void>;
    pairCode(phone: string): Promise<string>;
    sendMessage(jid: JID, message: MessageContent): Promise<SendResponse>;
    sendRawMessage(jid: JID, message: Record<string, unknown>): Promise<SendResponse>;
    revokeMessage(chat: JID, sender: JID, id: string): Promise<void>;
    markRead(ids: string[], chat: JID, sender?: JID): Promise<void>;
    downloadMedia(msg: {
        directPath: string;
        mediaKey: number[];
        fileSha256: number[];
        fileEncSha256: number[];
        mediaType?: string;
    }): Promise<string>;
    isOnWhatsApp(phones: string[]): Promise<IsOnWhatsAppResult[]>;
    getUserInfo(jids: JID[]): Promise<Record<string, UserInfo>>;
    getProfilePicture(jid: JID): Promise<ProfilePicture>;
    createGroup(name: string, participants: JID[]): Promise<{
        jid: JID;
        name: string;
    }>;
    getGroupInfo(jid: JID): Promise<GroupInfo>;
    getJoinedGroups(): Promise<GroupInfo[]>;
    getGroupInviteLink(jid: JID, reset?: boolean): Promise<string>;
    joinGroupWithLink(code: string): Promise<JID>;
    leaveGroup(jid: JID): Promise<void>;
    setGroupName(jid: JID, name: string): Promise<void>;
    setGroupTopic(jid: JID, topic: string, previousId?: string, newId?: string): Promise<void>;
    setGroupPhoto(jid: JID, path: string): Promise<string>;
    setGroupAnnounce(jid: JID, announce: boolean): Promise<void>;
    setGroupLocked(jid: JID, locked: boolean): Promise<void>;
    updateGroupParticipants(jid: JID, participants: JID[], action: "add" | "remove" | "promote" | "demote"): Promise<void>;
    sendPresence(presence: Presence): Promise<void>;
    sendChatPresence(jid: JID, presence: ChatPresence, media?: ChatPresenceMedia): Promise<void>;
    subscribePresence(jid: JID): Promise<void>;
    getSubscribedNewsletters(): Promise<NewsletterInfo[]>;
    newsletterSubscribeLiveUpdates(jid: JID): Promise<number>;
    rejectCall(from: JID, callId: string): Promise<void>;
    sendReaction(chat: JID, sender: JID, id: string, reaction: string): Promise<SendResponse>;
    editMessage(chat: JID, id: string, message: MessageContent): Promise<SendResponse>;
    sendPollCreation(jid: JID, name: string, options: string[], selectableCount: number): Promise<SendResponse>;
    sendPollVote(pollChat: JID, pollSender: JID, pollId: string, pollTimestamp: number, options: string[]): Promise<SendResponse>;
    setGroupDescription(jid: JID, description: string): Promise<void>;
    getGroupInfoFromLink(code: string): Promise<GroupInfo>;
    getGroupRequestParticipants(jid: JID): Promise<GroupRequestParticipant[]>;
    updateGroupRequestParticipants(jid: JID, participants: JID[], action: ParticipantRequestAction): Promise<void>;
    setGroupMemberAddMode(jid: JID, mode: GroupMemberAddMode): Promise<void>;
    setGroupJoinApprovalMode(jid: JID, enabled: boolean): Promise<void>;
    linkGroup(parent: JID, child: JID): Promise<void>;
    unlinkGroup(parent: JID, child: JID): Promise<void>;
    getSubGroups(jid: JID): Promise<SubGroupInfo[]>;
    getLinkedGroupsParticipants(jid: JID): Promise<string[]>;
    createNewsletter(name: string, description: string, picture?: string): Promise<{
        id: JID;
        name: string;
    }>;
    getNewsletterInfo(jid: JID): Promise<NewsletterMetadata>;
    getNewsletterInfoWithInvite(key: string): Promise<NewsletterMetadata>;
    followNewsletter(jid: JID): Promise<void>;
    unfollowNewsletter(jid: JID): Promise<void>;
    getNewsletterMessages(jid: JID, count: number, before?: number): Promise<NewsletterMessage[]>;
    newsletterMarkViewed(jid: JID, serverIds: number[]): Promise<void>;
    newsletterSendReaction(jid: JID, serverId: number, reaction: string, messageId: string): Promise<void>;
    newsletterToggleMute(jid: JID, mute: boolean): Promise<void>;
    getUserDevices(jids: JID[]): Promise<string[]>;
    getBusinessProfile(jid: JID): Promise<BusinessProfile>;
    setStatusMessage(message: string): Promise<void>;
    getPrivacySettings(): Promise<PrivacySettings>;
    tryFetchPrivacySettings(ignoreCache?: boolean): Promise<PrivacySettings>;
    setPrivacySetting(name: PrivacySettingName, value: PrivacySettingValue): Promise<PrivacySettings>;
    getStatusPrivacy(): Promise<StatusPrivacy[]>;
    setDefaultDisappearingTimer(seconds: number): Promise<void>;
    setDisappearingTimer(jid: JID, seconds: number): Promise<void>;
    getBlocklist(): Promise<Blocklist>;
    updateBlocklist(jid: JID, action: BlocklistAction): Promise<Blocklist>;
    getContactQRLink(revoke?: boolean): Promise<string>;
    resolveContactQRLink(code: string): Promise<ContactQRLinkTarget>;
    resolveBusinessMessageLink(code: string): Promise<BusinessMessageLinkTarget>;
    uploadMedia(path: string, mediaType: MediaType): Promise<UploadResponse>;
    deleteMedia(mediaType: MediaType, directPath: string, encFileHash: number[], encHandle?: string): Promise<void>;
    setPassive(passive: boolean): Promise<void>;
    setForceActiveDeliveryReceipts(active: boolean): Promise<void>;
    acceptTOSNotice(noticeId: string, stage: string): Promise<void>;
    getNewsletterMessageUpdates(jid: JID, count: number, opts?: {
        since?: number;
        after?: number;
    }): Promise<NewsletterMessage[]>;
    getGroupInfoFromInvite(jid: JID, inviter: JID, code: string, expiration: number): Promise<GroupInfo>;
    joinGroupWithInvite(jid: JID, inviter: JID, code: string, expiration: number): Promise<void>;
    uploadNewsletter(path: string, mediaType: MediaType): Promise<NewsletterUploadResponse>;
    downloadAny(message: Record<string, unknown>): Promise<string>;
    resetConnection(): Promise<void>;
    generateMessageID(): Promise<string>;
    buildMessageKey(chat: JID, sender: JID, id: string): Promise<Record<string, unknown>>;
    buildUnavailableMessageRequest(chat: JID, sender: JID, id: string): Promise<Record<string, unknown>>;
    buildHistorySyncRequest(info: {
        chat: JID;
        sender: JID;
        id: string;
        timestamp?: number;
    }, count: number): Promise<Record<string, unknown>>;
    sendPeerMessage(message: Record<string, unknown>): Promise<SendResponse>;
    sendMediaRetryReceipt(info: {
        chat: JID;
        sender: JID;
        id: string;
        timestamp?: number;
    }, mediaKey: number[]): Promise<void>;
    sendHistorySyncServerErrorReceipt(msgID: string, mediaKey: number[]): Promise<void>;
    sendProtocolMessageReceipt(id: string, msgType: string): Promise<void>;
    setMaxParallelRetryReceiptHandling(maxParallel: number): Promise<void>;
    downloadMediaWithPath(opts: {
        directPath: string;
        encFileHash: number[];
        fileHash: number[];
        mediaKey: number[];
        mediaType: MediaType;
        mmsType?: string;
    }): Promise<string>;
    downloadMediaWithOnlyPath(directPath: string): Promise<string>;
    fetchStickerPack(packID: string): Promise<StickerPack>;
    getBotListV2(): Promise<BotListInfo[]>;
    getBotProfiles(bots: BotListInfo[]): Promise<BotProfileInfo[]>;
    fetchAppState(name: AppStatePatchName, fullSync?: boolean, onlyIfNotSynced?: boolean): Promise<void>;
    markNotDirty(cleanType: string, timestamp: number): Promise<void>;
    decryptComment(info: Record<string, unknown>, message: Record<string, unknown>): Promise<Record<string, unknown>>;
    decryptPollVote(info: Record<string, unknown>, message: Record<string, unknown>): Promise<Record<string, unknown>>;
    decryptReaction(info: Record<string, unknown>, message: Record<string, unknown>): Promise<Record<string, unknown>>;
    decryptSecretEncryptedMessage(info: Record<string, unknown>, message: Record<string, unknown>): Promise<Record<string, unknown>>;
    encryptComment(info: Record<string, unknown>, message: Record<string, unknown>): Promise<Record<string, unknown>>;
    encryptPollVote(info: Record<string, unknown>, vote: Record<string, unknown>): Promise<Record<string, unknown>>;
    encryptReaction(info: Record<string, unknown>, reaction: Record<string, unknown>): Promise<Record<string, unknown>>;
    parseWebMessage(chatJid: JID, webMsg: Record<string, unknown>): Promise<{
        info: Record<string, unknown>;
        message: Record<string, unknown>;
    }>;
    call(method: string, args?: Record<string, unknown>): Promise<unknown>;
}

declare class WhatsmeowError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
declare class TimeoutError extends WhatsmeowError {
    constructor(commandId: string);
}
declare class ProcessExitedError extends WhatsmeowError {
    constructor(exitCode: number | null);
}

declare function createClient(options: ClientOptions): WhatsmeowClient;

export { type AppStatePatchName, type BinaryVersion, type Blocklist, type BlocklistAction, type BotListInfo, type BotProfileInfo, type BusinessMessageLinkTarget, type BusinessProfile, type ChatPresence, type ChatPresenceMedia, type ClientOptions, type ContactQRLinkTarget, type ContextInfo, type ExtendedTextMessage, type GroupInfo, type GroupInfoEvent, type GroupMemberAddMode, type GroupParticipant, type GroupRequestParticipant, type InitResult, type IsOnWhatsAppResult, type JID, type MediaType, type MessageContent, type MessageInfo, type NewsletterInfo, type NewsletterMessage, type NewsletterMetadata, type NewsletterUploadResponse, type ParticipantRequestAction, type Presence, type PrivacySettingName, type PrivacySettingValue, type PrivacySettings, ProcessExitedError, type ProfilePicture, type SendResponse, type StatusPrivacy, type StatusPrivacyType, type StickerPack, type StickerPackItem, type SubGroupInfo, type TextMessage, TimeoutError, type UploadResponse, type UserInfo, WhatsmeowClient, WhatsmeowError, type WhatsmeowEvents, createClient };
