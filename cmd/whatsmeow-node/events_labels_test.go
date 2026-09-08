package main

import (
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

// The labels a WhatsApp Business account puts on chats and messages reach the Go
// process as three app-state events. Until now the switch in eventHandler had no
// case for any of them, so a seller's whole label set — the reason this feature
// exists — was dropped without a trace.

func TestEventHandlerEmitsLabelEdit(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.LabelEdit{
			LabelID:   "12",
			Timestamp: time.Unix(1_781_000_000, 0),
			Action: &waSyncAction.LabelEditAction{
				Name:    proto.String("Diploma Inteligencia"),
				Color:   proto.Int32(5),
				Deleted: proto.Bool(false),
			},
		})
	})

	got := onlyEvent(t, emitted, "label:edit")

	if got["labelId"] != "12" {
		t.Errorf("labelId = %v, want 12", got["labelId"])
	}
	if got["name"] != "Diploma Inteligencia" {
		t.Errorf("name = %v, want the label name", got["name"])
	}
	if got["color"] != float64(5) {
		t.Errorf("color = %v, want 5", got["color"])
	}
	if got["deleted"] != false {
		t.Errorf("deleted = %v, want false", got["deleted"])
	}
	// Raw epoch seconds, like every other timestamp this bridge sends.
	// Formatting it here would bake this process's timezone into the data.
	if got["timestamp"] != float64(1_781_000_000) {
		t.Errorf("timestamp = %#v, want the raw epoch seconds as a number", got["timestamp"])
	}
}

// Deleting a label is the same event with deleted=true. A consumer that misses
// this keeps showing a label the seller already removed from her phone.
func TestEventHandlerEmitsLabelEditForDeletions(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.LabelEdit{
			LabelID:   "12",
			Timestamp: time.Unix(1_781_000_100, 0),
			Action: &waSyncAction.LabelEditAction{
				Name:    proto.String("Diploma Inteligencia"),
				Deleted: proto.Bool(true),
			},
		})
	})

	got := onlyEvent(t, emitted, "label:edit")
	if got["deleted"] != true {
		t.Errorf("deleted = %v, want true", got["deleted"])
	}
}

// fromFullSync tells the batch WhatsApp pushes when it re-syncs app state apart
// from a label the seller just edited. It is the labels' equivalent of the
// `source` field on call:log: without it a consumer cannot tell a re-sync of 700
// existing labels from 700 new edits.
func TestEventHandlerMarksLabelsThatComeFromAFullSync(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.LabelEdit{
			LabelID:      "12",
			Timestamp:    time.Unix(1_781_000_000, 0),
			Action:       &waSyncAction.LabelEditAction{Name: proto.String("Diploma")},
			FromFullSync: true,
		})
		app.eventHandler(&events.LabelAssociationChat{
			JID:          types.NewJID("51970043155", types.DefaultUserServer),
			LabelID:      "12",
			Timestamp:    time.Unix(1_781_000_000, 0),
			Action:       &waSyncAction.LabelAssociationAction{Labeled: proto.Bool(true)},
			FromFullSync: true,
		})
	})

	if got := onlyEvent(t, emitted, "label:edit"); got["fromFullSync"] != true {
		t.Errorf("label:edit fromFullSync = %v, want true", got["fromFullSync"])
	}
	if got := onlyEvent(t, emitted, "label:chat"); got["fromFullSync"] != true {
		t.Errorf("label:chat fromFullSync = %v, want true", got["fromFullSync"])
	}
}

func TestEventHandlerEmitsLabelChat(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.LabelAssociationChat{
			JID:       types.NewJID("51970043155", types.DefaultUserServer),
			LabelID:   "12",
			Timestamp: time.Unix(1_781_000_000, 0),
			Action:    &waSyncAction.LabelAssociationAction{Labeled: proto.Bool(true)},
		})
	})

	got := onlyEvent(t, emitted, "label:chat")

	if got["jid"] != "51970043155@s.whatsapp.net" {
		t.Errorf("jid = %v, want the chat JID", got["jid"])
	}
	if got["labelId"] != "12" {
		t.Errorf("labelId = %v, want 12", got["labelId"])
	}
	if got["labeled"] != true {
		t.Errorf("labeled = %v, want true", got["labeled"])
	}
	if got["timestamp"] != float64(1_781_000_000) {
		t.Errorf("timestamp = %#v, want the raw epoch seconds as a number", got["timestamp"])
	}
	if got["fromFullSync"] != false {
		t.Errorf("fromFullSync = %v, want false", got["fromFullSync"])
	}
}

// Un-labeling is the same event with labeled=false. A consumer that only
// listened for the true case would never remove the label.
func TestEventHandlerEmitsLabelChatWhenUnlabeled(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.LabelAssociationChat{
			JID:       types.NewJID("51970043155", types.DefaultUserServer),
			LabelID:   "12",
			Timestamp: time.Unix(1_781_000_000, 0),
			Action:    &waSyncAction.LabelAssociationAction{Labeled: proto.Bool(false)},
		})
	})

	got := onlyEvent(t, emitted, "label:chat")
	if got["labeled"] != false {
		t.Errorf("labeled = %v, want false", got["labeled"])
	}
}

func TestEventHandlerEmitsLabelMessage(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.LabelAssociationMessage{
			JID:       types.NewJID("51970043155", types.DefaultUserServer),
			LabelID:   "12",
			MessageID: "3EB0A1B2C3",
			Timestamp: time.Unix(1_781_000_000, 0),
			Action:    &waSyncAction.LabelAssociationAction{Labeled: proto.Bool(true)},
		})
	})

	got := onlyEvent(t, emitted, "label:message")

	if got["messageId"] != "3EB0A1B2C3" {
		t.Errorf("messageId = %v, want the message ID", got["messageId"])
	}
	if got["jid"] != "51970043155@s.whatsapp.net" {
		t.Errorf("jid = %v, want the chat JID", got["jid"])
	}
	if got["labelId"] != "12" {
		t.Errorf("labelId = %v, want 12", got["labelId"])
	}
	if got["labeled"] != true {
		t.Errorf("labeled = %v, want true", got["labeled"])
	}
}

// A label event with no action carries no state at all. Forwarding it would make
// every optional field read as its zero value — and for an association that zero
// value is `labeled: false`, which a consumer cannot tell apart from a real
// un-labeling. Dropping a silent event is recoverable; silently un-labeling 700
// contacts is not.
func TestEventHandlerDropsLabelEventsWithoutAnAction(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.LabelEdit{LabelID: "12", Timestamp: time.Unix(1, 0)})
		app.eventHandler(&events.LabelAssociationChat{
			JID:     types.NewJID("51970043155", types.DefaultUserServer),
			LabelID: "12",
		})
		app.eventHandler(&events.LabelAssociationMessage{
			JID:       types.NewJID("51970043155", types.DefaultUserServer),
			LabelID:   "12",
			MessageID: "3EB0A1B2C3",
		})
	})

	for _, name := range []string{"label:edit", "label:chat", "label:message"} {
		if found := eventsNamed(emitted, name); len(found) != 0 {
			t.Errorf("%s was emitted without an action: %v", name, found)
		}
	}
}

// The IDs are what a consumer keys on. Without them a row cannot be matched to
// an existing label, a chat or a message, so it can only be stored as a
// duplicate that never resolves.
func TestEventHandlerDropsLabelEventsMissingTheirIdentifiers(t *testing.T) {
	app := &App{}
	labeled := &waSyncAction.LabelAssociationAction{Labeled: proto.Bool(true)}
	chat := types.NewJID("51970043155", types.DefaultUserServer)

	cases := []struct {
		name  string
		event interface{}
		emits string
	}{
		{
			name:  "an edit with no label ID",
			event: &events.LabelEdit{Action: &waSyncAction.LabelEditAction{Name: proto.String("x")}},
			emits: "label:edit",
		},
		{
			name:  "a chat association with no label ID",
			event: &events.LabelAssociationChat{JID: chat, Action: labeled},
			emits: "label:chat",
		},
		{
			// whatsmeow parses this JID out of the mutation index and ignores the
			// parse error, so a malformed index arrives here as an empty JID.
			name:  "a chat association with no chat",
			event: &events.LabelAssociationChat{LabelID: "12", Action: labeled},
			emits: "label:chat",
		},
		{
			name:  "a message association with no message ID",
			event: &events.LabelAssociationMessage{JID: chat, LabelID: "12", Action: labeled},
			emits: "label:message",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			emitted := captureEvents(t, func() { app.eventHandler(tc.event) })
			if found := eventsNamed(emitted, tc.emits); len(found) != 0 {
				t.Errorf("%s was emitted for %s: %v", tc.emits, tc.name, found)
			}
		})
	}
}

// whatsmeow dispatches BOTH events.AppState and the typed event for the same
// mutation (appstate.go: the AppState is appended, then dispatchAppState returns
// the typed one). Handling labels in the AppState case as well — the tempting
// shortcut, since that case already exists for the call log — would emit every
// label change twice.
//
// This guard is green today by construction; it exists so it turns red the day
// someone adds that shortcut.
func TestEventHandlerDoesNotEmitLabelsFromTheAppStateCatchAll(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.AppState{
			Index: []string{"label_edit", "12"},
			SyncActionValue: &waSyncAction.SyncActionValue{
				LabelEditAction: &waSyncAction.LabelEditAction{
					Name:  proto.String("Diploma Inteligencia"),
					Color: proto.Int32(5),
				},
			},
		})
	})

	for _, name := range []string{"label:edit", "label:chat", "label:message"} {
		if found := eventsNamed(emitted, name); len(found) != 0 {
			t.Errorf("%s came out of the AppState catch-all — it would duplicate the typed event: %v", name, found)
		}
	}
}
