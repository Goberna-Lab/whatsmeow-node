---
title: Events Reference
sidebar_label: Events
sidebar_position: 2
description: "All whatsmeow-node events — connection, message, group, presence, call, newsletter, and QR events with fully typed payloads."
keywords: [whatsmeow events, whatsapp message event, whatsapp webhook nodejs, whatsapp event listener typescript]
---

# Events

`WhatsmeowClient` extends `EventEmitter` and emits typed events. All [whatsmeow events](https://pkg.go.dev/go.mau.fi/whatsmeow#section-readme) are forwarded.

## Usage

```typescript
client.on("message", ({ info, message }) => { /* ... */ });
client.on("connected", ({ jid }) => { /* ... */ });
```

## Connection Events

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{ jid: string }` | WhatsApp connection established. Safe to send messages. |
| `disconnected` | `{}` | Connection lost. Auto-reconnect is automatic. |
| `logged_out` | `{ reason: string, onConnect: boolean }` | Session revoked. Must re-pair. `onConnect` is `true` when the rejection happened while connecting, `false` when the session dropped mid-use. |
| `stream_replaced` | `{}` | Another process connected with the same credentials and WhatsApp kicked this session out. No auto-reconnect will help — check for a duplicate login. |
| `stream_error` | `{ code: string, raw?: string }` | Protocol error. Usually followed by auto-reconnect. `raw` (the XML node as text) is only present when whatsmeow didn't recognize the code. |
| `connect_failure` | `{ reason: string, message: string, raw?: string }` | Server rejected the connection with a reason whatsmeow doesn't translate into one of its own events (those come out as `logged_out` or `temporary_ban`). `raw` is only present when the XML node travelled with the event. |
| `client_outdated` | `{}` | Server rejected this build's client version. No reconnect will succeed until the `whatsmeow` dependency is upgraded. |
| `cat_refresh_error` | `{ error: string }` | whatsmeow failed to refresh the CAT (crypto auth token) before reconnecting, so the reconnect did not proceed. |
| `temporary_ban` | `{ code: string, expire: string }` | Temporary ban from WhatsApp. |
| `keep_alive_timeout` | `{ errorCount: number }` | Keep-alive pings failing. Connection may be degraded. |
| `keep_alive_restored` | `{}` | Keep-alive recovered. Connection is healthy. |

## Message Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `{ info: MessageInfo, message: Record<string, unknown> }` | New message received. |
| `message:receipt` | `{ type: string, chat: string, sender: string, isGroup: boolean, ids: string[], timestamp: number }` | Read/delivery receipt. |

### MessageInfo

```typescript
interface MessageInfo {
  id: string;
  chat: string;      // JID of the chat
  sender: string;    // JID of the sender
  isFromMe: boolean;
  isGroup: boolean;
  timestamp: number;  // Unix timestamp
  pushName: string;   // Sender's display name
}
```

## Presence Events

| Event | Payload | Description |
|-------|---------|-------------|
| `presence` | `{ jid: string, presence: "available" \| "unavailable", lastSeen?: number }` | Contact online/offline status. |
| `chat_presence` | `{ chat: string, sender: string, state: "composing" \| "paused", media: "audio" \| "" }` | Typing/recording indicator. |

## Group Events

| Event | Payload | Description |
|-------|---------|-------------|
| `group:info` | `GroupInfoEvent` | Group metadata changed. |
| `group:joined` | `{ jid: string, name: string }` | You joined a group. |

### GroupInfoEvent

```typescript
interface GroupInfoEvent {
  jid: string;
  name?: string;         // New group name
  description?: string;  // New description
  announce?: boolean;     // Announcement mode changed
  locked?: boolean;       // Lock status changed
  ephemeral?: boolean;    // Disappearing messages changed
  join?: string[];        // JIDs that joined
  leave?: string[];       // JIDs that left
  promote?: string[];     // JIDs promoted to admin
  demote?: string[];      // JIDs demoted from admin
}
```

## Media Events

| Event | Payload | Description |
|-------|---------|-------------|
| `picture` | `{ jid: string, remove: boolean, pictureId?: string }` | Profile/group picture changed. |

## Call Events

| Event | Payload | Description |
|-------|---------|-------------|
| `call:offer` | `{ from: string, callId: string }` | Incoming call. |
| `call:accept` | `{ from: string, callId: string }` | Call accepted. |
| `call:terminate` | `{ from: string, callId: string, reason: string }` | Call ended. |

## Other Events

| Event | Payload | Description |
|-------|---------|-------------|
| `identity_change` | `{ jid: string, timestamp: number }` | Contact's identity key changed (re-registered). |
| `history_sync` | `{ type: string }` | History sync progress. |
| `qr` | `{ code: string }` | QR code for pairing. |
| `qr:timeout` | `null` | QR pairing timed out. |
| `qr:error` | `{ event: string }` | QR channel error. |
| `log` | `{ level: string, msg: string, [key: string]: unknown }` | Go binary log output. Useful for debugging. |
| `error` | `Error` | Internal error. |
| `exit` | `{ code: number \| null }` | Go binary exited. |
