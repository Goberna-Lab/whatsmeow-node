package main

import (
	"fmt"
	"time"

	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// eventHandler is registered on the whatsmeow client to forward events as JSON.
func (a *App) eventHandler(evt interface{}) {
	switch v := evt.(type) {

	// ── Connection ─────────────────────────────────
	case *events.Connected:
		jid := ""
		a.mu.Lock()
		if a.client != nil && a.client.Store != nil && a.client.Store.ID != nil {
			jid = a.client.Store.ID.String()
		}
		a.mu.Unlock()
		sendEvent("connected", map[string]interface{}{"jid": jid})

	case *events.Disconnected:
		sendEvent("disconnected", map[string]interface{}{})

	case *events.LoggedOut:
		sendEvent("logged_out", map[string]interface{}{
			"reason": v.Reason.String(),
		})

	case *events.StreamError:
		sendEvent("stream_error", map[string]interface{}{
			"code": v.Code,
		})

	// Another client connected with the same session keys and took the socket
	// over. It is not coming back on its own, and without this event nothing
	// told the Node side: the connection state kept saying "connected" while the
	// line was already deaf.
	case *events.StreamReplaced:
		sendEvent("stream_replaced", map[string]interface{}{})

	case *events.TemporaryBan:
		sendEvent("temporary_ban", map[string]interface{}{
			"code":   v.Code.String(),
			"expire": v.Expire.String(),
		})

	case *events.KeepAliveTimeout:
		sendEvent("keep_alive_timeout", map[string]interface{}{
			"errorCount": v.ErrorCount,
		})

	case *events.KeepAliveRestored:
		sendEvent("keep_alive_restored", map[string]interface{}{})

	// ── Messages ──────────────────────────────────
	case *events.Message:
		sendEvent("message", map[string]interface{}{
			"info":    serializeMessageInfo(v.Info),
			"message": protoToMap(v.Message),
		})

	// A message arrived and could not be decrypted. whatsmeow asks the sender to
	// retry on its own, and if that works a normal `message` follows; when it
	// does not, this is the only trace that the conversation is missing a turn.
	case *events.UndecryptableMessage:
		sendEvent("message:undecryptable", map[string]interface{}{
			"info":          serializeMessageInfo(v.Info),
			"isUnavailable": v.IsUnavailable,
			// These two travel even when empty. Upstream an empty string is a
			// value and not an absence: "" is DecryptFailShow, and an unknown
			// unavailable type is also "".
			"unavailableType": string(v.UnavailableType),
			"decryptFailMode": string(v.DecryptFailMode),
		})

	case *events.Receipt:
		sendEvent("message:receipt", map[string]interface{}{
			"type":      string(v.Type),
			"chat":      v.MessageSource.Chat.String(),
			"sender":    v.MessageSource.Sender.String(),
			"isGroup":   v.MessageSource.IsGroup,
			"ids":       v.MessageIDs,
			"timestamp": v.Timestamp.Unix(),
		})

	case *events.ChatPresence:
		sendEvent("chat_presence", map[string]interface{}{
			"chat":   v.MessageSource.Chat.String(),
			"sender": v.MessageSource.Sender.String(),
			"state":  string(v.State),
			"media":  string(v.Media),
		})

	case *events.Presence:
		pres := "available"
		if v.Unavailable {
			pres = "unavailable"
		}
		data := map[string]interface{}{
			"jid":      v.From.String(),
			"presence": pres,
		}
		if !v.LastSeen.IsZero() {
			data["lastSeen"] = v.LastSeen.Unix()
		}
		sendEvent("presence", data)

	// ── Groups ────────────────────────────────────
	case *events.GroupInfo:
		data := map[string]interface{}{
			"jid": v.JID.String(),
		}
		if v.Name != nil {
			data["name"] = v.Name.Name
		}
		if v.Topic != nil {
			data["description"] = v.Topic.Topic
		}
		if v.Announce != nil {
			data["announce"] = v.Announce.IsAnnounce
		}
		if v.Locked != nil {
			data["locked"] = v.Locked.IsLocked
		}
		if v.Ephemeral != nil {
			data["ephemeral"] = v.Ephemeral.IsEphemeral
		}
		if len(v.Join) > 0 {
			data["join"] = serializeJIDs(v.Join)
		}
		if len(v.Leave) > 0 {
			data["leave"] = serializeJIDs(v.Leave)
		}
		if len(v.Promote) > 0 {
			data["promote"] = serializeJIDs(v.Promote)
		}
		if len(v.Demote) > 0 {
			data["demote"] = serializeJIDs(v.Demote)
		}
		sendEvent("group:info", data)

	case *events.JoinedGroup:
		sendEvent("group:joined", map[string]interface{}{
			"jid":  v.JID.String(),
			"name": v.GroupName.Name,
		})

	case *events.Picture:
		data := map[string]interface{}{
			"jid":    v.JID.String(),
			"remove": v.Remove,
		}
		if v.PictureID != "" {
			data["pictureId"] = v.PictureID
		}
		sendEvent("picture", data)

	// ── Calls ─────────────────────────────────────
	case *events.CallOffer:
		sendEvent("call:offer", map[string]interface{}{
			"from":   v.CallCreator.String(),
			"callId": v.CallID,
		})

	case *events.CallAccept:
		sendEvent("call:accept", map[string]interface{}{
			"from":   v.CallCreator.String(),
			"callId": v.CallID,
		})

	case *events.CallTerminate:
		sendEvent("call:terminate", map[string]interface{}{
			"from":   v.CallCreator.String(),
			"callId": v.CallID,
			"reason": v.Reason,
		})

	// ── Identity / Push Name ─────────────────────
	case *events.IdentityChange:
		sendEvent("identity_change", map[string]interface{}{
			"jid":       v.JID.String(),
			"timestamp": v.Timestamp.Unix(),
		})

	// ── History Sync ─────────────────────────────
	case *events.HistorySync:
		sendEvent("history_sync", map[string]interface{}{
			"type": v.Data.GetSyncType().String(),
		})
		// The phone pushes its call log alongside the message history. Each
		// record is forwarded on its own so the Node side has a single shape to
		// handle, whether it came from the initial sync or from a later
		// app-state patch.
		for _, r := range v.Data.GetCallLogRecords() {
			if rec := serializeCallLogRecord(r, "history"); rec != nil {
				sendEvent("call:log", rec)
			}
		}

	// ── App state ────────────────────────────────
	// Call log entries keep arriving here after the initial history sync: every
	// call placed or received on the phone becomes a callLogAction patch.
	// Without this case those updates never leave the Go process.
	//
	// Only the call log is read here. whatsmeow dispatches this event *in
	// addition to* the typed one for the same mutation, so anything that has a
	// typed event of its own — the labels below, for instance — must be handled
	// there and not here, or it would be emitted twice.
	case *events.AppState:
		if action := v.GetCallLogAction(); action != nil {
			if rec := serializeCallLogRecord(action.GetCallLogRecord(), "appstate"); rec != nil {
				sendEvent("call:log", rec)
			}
		}

	// ── Labels ───────────────────────────────────
	// The labels a WhatsApp Business account puts on chats and messages. They
	// travel through app state, and these typed events are the source to use:
	// they carry the label, chat and message IDs already parsed out of the
	// mutation index, and they are dispatched for removals too, which the raw
	// AppState event above is not.
	case *events.LabelEdit:
		if data := serializeLabelEdit(v); data != nil {
			sendEvent("label:edit", data)
		}

	case *events.LabelAssociationChat:
		if data := serializeLabelAssociation(v.JID, v.LabelID, v.Timestamp, v.Action, v.FromFullSync); data != nil {
			sendEvent("label:chat", data)
		}

	case *events.LabelAssociationMessage:
		data := serializeLabelAssociation(v.JID, v.LabelID, v.Timestamp, v.Action, v.FromFullSync)
		if data != nil && v.MessageID != "" {
			data["messageId"] = v.MessageID
			sendEvent("label:message", data)
		}

	// ── Everything else ──────────────────────────
	// Until this case existed the switch was closed and had no default, so an
	// event type without a case of its own vanished here: no error, no log, no
	// trace. That silence is why every hole in this bridge has been found from
	// the business side months later ("Hermes does not show Luz's labels")
	// instead of from a log line.
	default:
		a.reportUnhandled(evt)
	}
}

// reportUnhandled says that an event type crossed the switch without a case.
//
// 🔴 ONLY THE TYPE NAME CROSSES THE BRIDGE. The payload of an unhandled event can
// carry a contact's name, a phone number or message text, and none of it has a
// consumer on the other side — the question this answers is "what are we
// dropping?", which the name alone answers. Forwarding the payload would spill a
// seller's address book into a log nobody audits.
//
// Reported at powers of ten and not on every sighting: a full app-state sync
// fires thousands of Contact events, and a report per event would flood the same
// pipe real traffic uses — the report would become the outage. Five lines per
// type over the life of the process still say whether something happens once or a
// million times, which is what decides whether it is worth wiring up.
func (a *App) reportUnhandled(evt interface{}) {
	name := fmt.Sprintf("%T", evt)

	a.unhandledMu.Lock()
	if a.unhandled == nil {
		a.unhandled = make(map[string]int)
	}
	a.unhandled[name]++
	seen := a.unhandled[name]
	a.unhandledMu.Unlock()

	if !isPowerOfTen(seen) {
		return
	}
	sendEvent("event:unhandled", map[string]interface{}{
		"type":  name,
		"count": seen,
	})
}

func isPowerOfTen(n int) bool {
	if n < 1 {
		return false
	}
	for n >= 10 && n%10 == 0 {
		n /= 10
	}
	return n == 1
}

// ── Serialization helpers ────────────────────────────

// serializeCallLogRecord flattens a CallLogRecord into the JSON the Node side
// receives. Returns nil when there is no usable record: a call without an ID
// cannot be deduplicated, and silently keeping it would duplicate rows on every
// re-sync.
//
// Enums are sent as their protobuf names (CONNECTED, MISSED, REJECTED,
// DECLINED, CANCELLED, ABANDONED, ACCEPTED_ELSEWHERE) rather than as numbers, so
// a consumer never has to keep its own copy of the enum ordering — that mapping
// would silently rot the day a value is inserted in the middle.
func serializeCallLogRecord(r *waSyncAction.CallLogRecord, source string) map[string]interface{} {
	if r == nil || r.GetCallID() == "" {
		return nil
	}

	out := map[string]interface{}{
		"source":         source,
		"callId":         r.GetCallID(),
		"callCreatorJid": r.GetCallCreatorJID(),
		"result":         r.GetCallResult().String(),
		"callType":       r.GetCallType().String(),
		"isIncoming":     r.GetIsIncoming(),
		"isVideo":        r.GetIsVideo(),
		"isCallLink":     r.GetIsCallLink(),
		"isDndMode":      r.GetIsDndMode(),
		"duration":       r.GetDuration(),
		// Seconds since the epoch, as WhatsApp stores it. Left as a number on
		// purpose: turning it into a string here would bake this process's
		// timezone into the data.
		"startTime": r.GetStartTime(),
	}

	if r.SilenceReason != nil {
		out["silenceReason"] = r.GetSilenceReason().String()
	}
	if r.GroupJID != nil {
		out["groupJid"] = r.GetGroupJID()
	}
	if r.ScheduledCallID != nil {
		out["scheduledCallId"] = r.GetScheduledCallID()
	}

	participants := make([]map[string]interface{}, 0, len(r.GetParticipants()))
	for _, p := range r.GetParticipants() {
		participants = append(participants, map[string]interface{}{
			"jid":        p.GetUserJID(),
			"callResult": p.GetCallResult().String(),
		})
	}
	out["participants"] = participants

	return out
}

// serializeLabelEdit flattens a label creation, rename or deletion. Returns nil
// when the event cannot be applied: without a label ID there is nothing to key
// the row on, and without an action every field would read as its zero value —
// which would turn a deletion into a nameless label that never goes away.
//
// `color` is WhatsApp's own palette index, forwarded as the number it is: unlike
// an enum it has no name to send instead, and the palette is the consumer's to
// map. `timestamp` is raw epoch seconds, like every other timestamp here.
func serializeLabelEdit(v *events.LabelEdit) map[string]interface{} {
	if v == nil || v.LabelID == "" || v.Action == nil {
		return nil
	}

	return map[string]interface{}{
		"labelId":      v.LabelID,
		"name":         v.Action.GetName(),
		"color":        v.Action.GetColor(),
		"deleted":      v.Action.GetDeleted(),
		"timestamp":    v.Timestamp.Unix(),
		"fromFullSync": v.FromFullSync,
	}
}

// serializeLabelAssociation builds the payload shared by label:chat and
// label:message — a label being put on or taken off something.
//
// Returns nil when the association cannot be keyed or applied. The action
// matters most: with it missing, `labeled` would default to false, which reads
// as a deliberate un-labeling and is indistinguishable from one. Dropping a
// silent event is recoverable; silently stripping a seller's labels is not.
//
// `fromFullSync` tells the batch WhatsApp re-sends on a full app-state sync
// apart from a label the seller just changed — the same job `source` does on
// call:log.
func serializeLabelAssociation(
	jid types.JID,
	labelID string,
	timestamp time.Time,
	action *waSyncAction.LabelAssociationAction,
	fromFullSync bool,
) map[string]interface{} {
	if labelID == "" || jid.IsEmpty() || action == nil {
		return nil
	}

	return map[string]interface{}{
		"jid":          jid.String(),
		"labelId":      labelID,
		"labeled":      action.GetLabeled(),
		"timestamp":    timestamp.Unix(),
		"fromFullSync": fromFullSync,
	}
}

func serializeMessageInfo(info types.MessageInfo) map[string]interface{} {
	return map[string]interface{}{
		"id":        info.ID,
		"chat":      info.Chat.String(),
		"sender":    info.Sender.String(),
		"isFromMe":  info.IsFromMe,
		"isGroup":   info.IsGroup,
		"timestamp": info.Timestamp.Unix(),
		"pushName":  info.PushName,
	}
}

func serializeJIDs(jids []types.JID) []string {
	result := make([]string, len(jids))
	for i, jid := range jids {
		result[i] = jid.String()
	}
	return result
}
