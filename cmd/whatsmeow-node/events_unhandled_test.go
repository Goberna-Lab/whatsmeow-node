package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

// An event type without a case of its own used to vanish here: no error, no log,
// no trace. That silence is the reason a missing capability always gets
// discovered from the business side months later instead of from a log line.

func TestEventHandlerReportsUnhandledEventTypes(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.Archive{})
	})

	got := onlyEvent(t, emitted, "event:unhandled")
	if got["type"] != "*events.Archive" {
		t.Errorf("type = %v, want the Go type name *events.Archive", got["type"])
	}
	if got["count"] != float64(1) {
		t.Errorf("count = %v, want 1 for the first sighting", got["count"])
	}
}

// 🔴 ONLY THE TYPE NAME CROSSES. The payload of an unhandled event can carry a
// contact's name, a phone number or message text, and none of it has a consumer
// on the other side — the question this event answers is "what are we dropping?",
// which the name alone answers. Forwarding the payload would leak a seller's
// address book into a log nobody audits.
func TestEventHandlerNeverForwardsThePayloadOfAnUnhandledEvent(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.Contact{
			JID:       types.NewJID("51970043155", types.DefaultUserServer),
			Timestamp: time.Unix(1_781_000_000, 0),
			Action: &waSyncAction.ContactAction{
				FullName:  proto.String("Luz Fernández"),
				FirstName: proto.String("Luz"),
			},
		})
	})

	got := onlyEvent(t, emitted, "event:unhandled")

	for clave := range got {
		if clave != "type" && clave != "count" {
			t.Errorf("unexpected field %q — only the type name and the count may cross", clave)
		}
	}

	// Belt and braces: nothing identifying may appear anywhere in the JSON.
	crudo, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("no se pudo serializar: %v", err)
	}
	for _, secreto := range []string{"51970043155", "Luz", "Fernández"} {
		if strings.Contains(string(crudo), secreto) {
			t.Errorf("the payload leaked %q: %s", secreto, crudo)
		}
	}
}

// A full app-state sync fires thousands of Contact events. Reporting each one
// would flood the IPC pipe the bridge shares with real traffic — the report
// would become the outage. Powers of ten keep the output bounded (five lines per
// type, ever) while still saying whether something happens once or a million
// times, which is what tells a maintainer whether it is worth wiring up.
func TestEventHandlerThrottlesRepeatedUnhandledTypes(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		for i := 0; i < 100; i++ {
			app.eventHandler(&events.Archive{})
		}
	})

	found := eventsNamed(emitted, "event:unhandled")
	if len(found) != 3 {
		t.Fatalf("want 3 reports in 100 sightings (at 1, 10 and 100), got %d", len(found))
	}
	for i, quiero := range []float64{1, 10, 100} {
		if found[i]["count"] != quiero {
			t.Errorf("report %d has count %v, want %v", i, found[i]["count"], quiero)
		}
	}
}

// Each type is counted on its own: a chatty one must not silence a rare one.
func TestEventHandlerCountsEachUnhandledTypeSeparately(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		for i := 0; i < 5; i++ {
			app.eventHandler(&events.Archive{})
		}
		app.eventHandler(&events.Mute{})
	})

	found := eventsNamed(emitted, "event:unhandled")
	if len(found) != 2 {
		t.Fatalf("want one report per type, got %d: %v", len(found), found)
	}
	if found[1]["type"] != "*events.Mute" {
		t.Errorf("the rare type was not reported: %v", found[1])
	}
}

// The default must not shadow the cases. If it ever fires for an event that has
// one, something above it stopped matching.
func TestEventHandlerDoesNotReportEventsThatHaveACase(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		app.eventHandler(&events.LabelEdit{
			LabelID:   "12",
			Timestamp: time.Unix(1_781_000_000, 0),
			Action:    &waSyncAction.LabelEditAction{Name: proto.String("Diploma")},
		})
		app.eventHandler(&events.StreamReplaced{})
		app.eventHandler(&events.Disconnected{})
	})

	if found := eventsNamed(emitted, "event:unhandled"); len(found) != 0 {
		t.Errorf("a handled event was reported as unhandled: %v", found)
	}
}
