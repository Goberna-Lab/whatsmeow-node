package main

import (
	"testing"
	"time"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// A message that fails to decrypt used to vanish here: whatsmeow reported it,
// the switch had no case for it, and the Node side never learned the message
// existed. That is a hole in the record, not a nuisance — the conversation is
// missing a turn and nothing says so.
func TestEventHandlerEmitsUndecryptableMessage(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.UndecryptableMessage{
			Info: types.MessageInfo{
				MessageSource: types.MessageSource{
					Chat:   types.NewJID("51970043155", types.DefaultUserServer),
					Sender: types.NewJID("51970043155", types.DefaultUserServer),
				},
				ID:        "3EB0A1B2C3",
				Timestamp: time.Unix(1_781_000_000, 0),
				PushName:  "Luz",
			},
			IsUnavailable:   true,
			UnavailableType: events.UnavailableTypeViewOnce,
			DecryptFailMode: events.DecryptFailHide,
		})
	})

	got := onlyEvent(t, emitted, "message:undecryptable")

	info, ok := got["info"].(map[string]interface{})
	if !ok {
		t.Fatalf("info = %#v, want the same message info shape as the `message` event", got["info"])
	}
	if info["id"] != "3EB0A1B2C3" {
		t.Errorf("info.id = %v, want the message ID", info["id"])
	}
	if info["chat"] != "51970043155@s.whatsapp.net" {
		t.Errorf("info.chat = %v, want the chat JID", info["chat"])
	}
	if info["timestamp"] != float64(1_781_000_000) {
		t.Errorf("info.timestamp = %#v, want the raw epoch seconds as a number", info["timestamp"])
	}
	if got["isUnavailable"] != true {
		t.Errorf("isUnavailable = %v, want true", got["isUnavailable"])
	}
	if got["unavailableType"] != "view_once" {
		t.Errorf("unavailableType = %v, want view_once", got["unavailableType"])
	}
	if got["decryptFailMode"] != "hide" {
		t.Errorf("decryptFailMode = %v, want hide", got["decryptFailMode"])
	}
}

// The common case carries neither flag. Both fields still travel, because their
// empty value is meaningful upstream ("" is DecryptFailShow, not "unset"), and a
// consumer that had to guess whether an absent field meant show or hide would
// guess wrong half the time.
func TestEventHandlerEmitsUndecryptableMessageWithoutFlags(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.UndecryptableMessage{
			Info: types.MessageInfo{
				MessageSource: types.MessageSource{
					Chat: types.NewJID("51970043155", types.DefaultUserServer),
				},
				ID:        "3EB0A1B2C4",
				Timestamp: time.Unix(1_781_000_000, 0),
			},
		})
	})

	got := onlyEvent(t, emitted, "message:undecryptable")

	if got["isUnavailable"] != false {
		t.Errorf("isUnavailable = %v, want false", got["isUnavailable"])
	}
	if value, present := got["unavailableType"]; !present || value != "" {
		t.Errorf("unavailableType = %#v (present=%v), want an empty string that is still sent", value, present)
	}
	if value, present := got["decryptFailMode"]; !present || value != "" {
		t.Errorf("decryptFailMode = %#v (present=%v), want an empty string that is still sent", value, present)
	}
}

// StreamReplaced means another client took the session over with the same keys.
// The socket is gone and it is not coming back on its own, but nothing in the
// old bridge said so — which is exactly the "the line went deaf while the state
// still said connected" of ADR 0073, worked around there with an active ping
// because there was no signal. This is the signal.
func TestEventHandlerEmitsStreamReplaced(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.StreamReplaced{})
	})

	if found := eventsNamed(emitted, "stream_replaced"); len(found) != 1 {
		t.Fatalf("want exactly one stream_replaced event, got %d (all events: %v)", len(found), emitted)
	}
}
