package main

import (
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
			// true si el rechazo llegó al conectar (connect failure); false si
			// llegó en pleno uso (stream:error). Antes se descartaba, y con eso
			// se perdía la única pista para distinguir un rechazo inmediato de
			// una sesión que se cae ya conectada.
			"onConnect": v.OnConnect,
		})

	// StreamReplaced: otro proceso se conectó con las mismas credenciales y
	// WhatsApp expulsó a esta sesión. whatsmeow no adjunta datos — el hecho de
	// que el evento exista ya es toda la señal. Es la causa más común de una
	// "desconexión silenciosa": el vigilante la relevanta pensando que se cayó
	// sola, cuando en realidad otra sesión (otra línea mal configurada, un
	// proceso duplicado) la echó.
	case *events.StreamReplaced:
		sendEvent("stream_replaced", map[string]interface{}{})

	case *events.StreamError:
		data := map[string]interface{}{
			"code": v.Code,
		}
		// El nodo XML completo sólo viaja cuando whatsmeow no reconoce el
		// código (ver connectionevents.go del propio whatsmeow): es el único
		// rastro de qué mandó el servidor para un código nuevo que este
		// binario todavía no traduce a un evento propio.
		if v.Raw != nil {
			data["raw"] = v.Raw.String()
		}
		sendEvent("stream_error", data)

	// ConnectFailure: el servidor rechazó la conexión con un motivo que
	// whatsmeow no reconoce como uno de sus casos internos (esos salen como
	// LoggedOut o TemporaryBan). "reason" trae el código y su descripción
	// (mismo formato que ya usa logged_out), "message" el texto que mandó el
	// servidor y "raw" el nodo XML completo cuando viajó.
	case *events.ConnectFailure:
		data := map[string]interface{}{
			"reason":  v.Reason.String(),
			"message": v.Message,
		}
		if v.Raw != nil {
			data["raw"] = v.Raw.String()
		}
		sendEvent("connect_failure", data)

	// ClientOutdated: WhatsApp rechazó la conexión porque la versión de
	// cliente que declara whatsmeow quedó vieja. Ningún reintento lo arregla:
	// hace falta actualizar la dependencia go.mau.fi/whatsmeow.
	case *events.ClientOutdated:
		sendEvent("client_outdated", map[string]interface{}{})

	// CATRefreshError: whatsmeow no pudo refrescar el token de cifrado
	// (Client Access Token) antes de reconectar, y por eso la reconexión no
	// sigue. El texto del error de Go es el único dato: no hay un código como
	// en ConnectFailure.
	case *events.CATRefreshError:
		errMsg := ""
		if v.Error != nil {
			errMsg = v.Error.Error()
		}
		sendEvent("cat_refresh_error", map[string]interface{}{
			"error": errMsg,
		})

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
	case *events.AppState:
		if action := v.GetCallLogAction(); action != nil {
			if rec := serializeCallLogRecord(action.GetCallLogRecord(), "appstate"); rec != nil {
				sendEvent("call:log", rec)
			}
		}
	}
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
