package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

// captureEvents swaps the process's stdout encoder for a buffer, runs fn, and
// returns everything sendEvent wrote — decoded the way the Node side decodes it.
//
// Going through the real JSON round trip is the point: these tests are about
// what actually crosses the bridge, so a value that only looks right as a Go
// struct fails here. A time.Time left unconverted, for instance, marshals to an
// RFC 3339 string instead of the raw epoch seconds this repo promises.
func captureEvents(t *testing.T, fn func()) []Event {
	t.Helper()

	var buf bytes.Buffer

	outMu.Lock()
	previous := outEnc
	outEnc = json.NewEncoder(&buf)
	outMu.Unlock()

	defer func() {
		outMu.Lock()
		outEnc = previous
		outMu.Unlock()
	}()

	fn()

	var emitted []Event
	decoder := json.NewDecoder(&buf)
	for decoder.More() {
		var e Event
		if err := decoder.Decode(&e); err != nil {
			t.Fatalf("could not decode an emitted event: %v", err)
		}
		emitted = append(emitted, e)
	}
	return emitted
}

// eventsNamed returns the payloads of the events emitted under a given name, as
// the maps a JSON consumer sees.
func eventsNamed(emitted []Event, name string) []map[string]interface{} {
	var out []map[string]interface{}
	for _, e := range emitted {
		if e.EventName != name {
			continue
		}
		data, ok := e.Data.(map[string]interface{})
		if !ok {
			data = map[string]interface{}{}
		}
		out = append(out, data)
	}
	return out
}

// onlyEvent asserts that exactly one event was emitted under a name and returns
// its payload.
func onlyEvent(t *testing.T, emitted []Event, name string) map[string]interface{} {
	t.Helper()
	found := eventsNamed(emitted, name)
	if len(found) != 1 {
		t.Fatalf("want exactly one %q event, got %d (all events: %v)", name, len(found), emitted)
	}
	return found[0]
}
