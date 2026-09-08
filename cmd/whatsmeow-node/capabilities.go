package main

import "runtime/debug"

// WHO THIS BINARY IS, ANSWERABLE OVER THE WIRE.
//
// The binary exposes 106 IPC commands and, until this one, not a single one said
// which build it was. That gap has a cost that is already written down in the
// consumer: the call:log handler in Hermes ends with "if the Calls view ever
// shows up empty, first check which binary is installed" — a note for a human
// where a check belongs.
//
// The failure it guards against is total and silent. This fork adds events that
// upstream does not have; with upstream's binary installed, those events are
// never emitted, every subscription stays quiet, and nothing anywhere raises an
// error. The consumer cannot tell "nothing happened" from "this binary cannot
// tell me when it happens". Now it can ask.

// forkName is what tells this build apart from upstream's. A consumer that finds
// anything else here is talking to a binary without the fork's events.
const forkName = "goberna"

// forkVersion has to match the version in the repository's root package.json —
// locked by a test, because a handshake that reports a stale version is one more
// thing that lies confidently.
const forkVersion = "0.7.0-goberna.4"

// eventNames is every event name this binary can emit, sorted so a diff on the
// list reads as one added line.
//
// 🔴 A DECLARED LIST THAT DRIFTS IS WORSE THAN NO LIST, because a consumer trusts
// it. `TestVersionEventListMatchesEverySendEventInTheSource` checks it against
// every `sendEvent("…")` in the source, in both directions: a name emitted and
// not declared would make the handshake deny a capability the binary has, and a
// name declared and not emitted would leave a consumer waiting forever for an
// event that never comes.
//
// This is the same lock `scripts/client-parity.json` already puts on the 133
// client methods, applied to events.
var eventNames = []string{
	"call:accept",
	"call:log",
	"call:offer",
	"call:terminate",
	"chat_presence",
	"connected",
	"disconnected",
	"event:unhandled",
	"group:info",
	"group:joined",
	"history_sync",
	"identity_change",
	"keep_alive_restored",
	"keep_alive_timeout",
	"label:chat",
	"label:edit",
	"label:message",
	"logged_out",
	"message",
	"message:receipt",
	"message:undecryptable",
	"picture",
	"presence",
	"qr",
	"qr:error",
	"qr:timeout",
	"stream_error",
	"stream_replaced",
	"temporary_ban",
}

// whatsmeowVersion reads the whatsmeow build the binary was actually linked
// against, out of the module info the toolchain embeds. Read and never
// hand-written, so it cannot drift from what was linked — which is the whole
// point of a handshake.
func whatsmeowVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, dep := range info.Deps {
		if dep.Path == "go.mau.fi/whatsmeow" {
			return dep.Version
		}
	}
	return ""
}

// cmdVersion answers the handshake. It needs no session and no `init`: a consumer
// asks it right after spawning the process, before deciding whether this binary
// can do what it is about to depend on.
func (a *App) cmdVersion(cmd Command) {
	sendResponse(cmd.ID, map[string]interface{}{
		"fork":      forkName,
		"version":   forkVersion,
		"whatsmeow": whatsmeowVersion(),
		"events":    eventNames,
	})
}
