package main

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The binary exposes 106 IPC commands and, until now, not one of them said which
// build it was. That gap is why the call:log comment in Hermes ends with "if the
// Calls view ever shows up empty, first check which binary is installed": a note
// for a human where a check belongs. With upstream's binary the fork's events are
// never emitted, and nothing anywhere raises an error.

func TestVersionReportsWhoTheBinaryIs(t *testing.T) {
	app := &App{}

	replies := captureResponses(t, func() {
		app.cmdVersion(Command{ID: "1", Cmd: "version"})
	})

	if len(replies) != 1 || !replies[0].OK {
		t.Fatalf("want one successful reply, got %v", replies)
	}
	got, ok := replies[0].Data.(map[string]interface{})
	if !ok {
		t.Fatalf("data = %#v, want an object", replies[0].Data)
	}

	if got["fork"] != "goberna" {
		t.Errorf("fork = %v, want goberna — this is what tells upstream's binary apart", got["fork"])
	}
	if got["version"] != forkVersion {
		t.Errorf("version = %v, want %v", got["version"], forkVersion)
	}

	eventos, ok := got["events"].([]interface{})
	if !ok || len(eventos) == 0 {
		t.Fatalf("events = %#v, want the list of event names this binary can emit", got["events"])
	}
	// The list is the whole point: a consumer compares it against what it
	// subscribes to and can then say "this binary cannot do what I need".
	if !contieneCadena(eventos, "call:log") || !contieneCadena(eventos, "label:edit") {
		t.Errorf("events does not carry the fork's own events: %v", eventos)
	}
}

// 🔴 A DECLARED LIST THAT DRIFTS IS WORSE THAN NO LIST: a consumer would trust it
// and be lied to. This is the same lock scripts/client-parity.json puts on the
// 133 client methods, applied to events — the list is checked against the source
// that actually emits them.
func TestVersionEventListMatchesEverySendEventInTheSource(t *testing.T) {
	enElCodigo := map[string]bool{}
	patron := regexp.MustCompile(`sendEvent\("([^"]+)"`)

	for _, archivo := range []string{"events.go", "commands.go"} {
		fuente, err := os.ReadFile(archivo)
		if err != nil {
			t.Fatalf("no se pudo leer %s: %v", archivo, err)
		}
		for _, m := range patron.FindAllStringSubmatch(string(fuente), -1) {
			enElCodigo[m[1]] = true
		}
	}

	declarados := map[string]bool{}
	for _, e := range eventNames {
		if declarados[e] {
			t.Errorf("%q is listed twice in eventNames", e)
		}
		declarados[e] = true
	}

	for e := range enElCodigo {
		if !declarados[e] {
			t.Errorf("the source emits %q and eventNames does not declare it — a consumer asking `version` would be told the binary cannot do something it can", e)
		}
	}
	for e := range declarados {
		if !enElCodigo[e] {
			t.Errorf("eventNames declares %q and nothing emits it — a consumer would wait forever for an event that never comes", e)
		}
	}

	if !sort.SliceIsSorted(eventNames, func(i, j int) bool { return eventNames[i] < eventNames[j] }) {
		t.Error("eventNames must stay sorted, so a diff on it reads as one added line")
	}
}

// The version the binary reports has to be the version the package claims, or the
// handshake becomes another thing that lies confidently.
func TestVersionMatchesTheRootPackageJson(t *testing.T) {
	crudo, err := os.ReadFile("../../package.json")
	if err != nil {
		t.Fatalf("no se pudo leer el package.json de la raíz: %v", err)
	}

	patron := regexp.MustCompile(`"version"\s*:\s*"([^"]+)"`)
	m := patron.FindStringSubmatch(string(crudo))
	if m == nil {
		t.Fatal("el package.json de la raíz no declara version")
	}
	if m[1] != forkVersion {
		t.Errorf("package.json dice %q y el binario reporta %q — se suben juntos o no se sube ninguno", m[1], forkVersion)
	}
}

// Reported, never hand-written: the whatsmeow version comes from the build info
// the toolchain embeds, so it cannot drift from what was actually linked.
func TestVersionReportsTheWhatsmeowItWasBuiltAgainst(t *testing.T) {
	crudo, err := os.ReadFile("../../go.mod")
	if err != nil {
		t.Fatalf("no se pudo leer go.mod: %v", err)
	}

	var enGoMod string
	for _, linea := range strings.Split(string(crudo), "\n") {
		campos := strings.Fields(linea)
		if len(campos) >= 2 && campos[0] == "go.mau.fi/whatsmeow" {
			enGoMod = campos[1]
			break
		}
	}
	if enGoMod == "" {
		t.Fatal("go.mod no declara go.mau.fi/whatsmeow")
	}

	if got := whatsmeowVersion(); got != enGoMod {
		t.Errorf("whatsmeowVersion() = %q, go.mod dice %q", got, enGoMod)
	}
}

func contieneCadena(xs []interface{}, buscado string) bool {
	for _, x := range xs {
		if s, ok := x.(string); ok && s == buscado {
			return true
		}
	}
	return false
}
