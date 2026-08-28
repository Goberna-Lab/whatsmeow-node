package main

import (
	"testing"

	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"go.mau.fi/whatsmeow/store"
	"google.golang.org/protobuf/proto"
)

// The phone only sends its call log to a companion that declared it can handle
// one. Losing this flag breaks no build and no other test: it just means
// `call:log` never fires again, which reads exactly like a line that never had
// a single call.
func TestSupportCallLogHistoryIsRequested(t *testing.T) {
	if !store.DeviceProps.GetHistorySyncConfig().GetSupportCallLogHistory() {
		t.Fatal("SupportCallLogHistory must be true — whatsmeow defaults it to false and the phone then sends nothing")
	}
}

// A record without a call ID cannot be deduplicated by the consumer, so it is
// dropped rather than forwarded: keeping it would duplicate a row on every
// re-sync, and a duplicated call is worse than a missing one because it inflates
// the totals silently.
func TestSerializeCallLogRecordDropsRecordsWithoutID(t *testing.T) {
	if got := serializeCallLogRecord(nil, "history"); got != nil {
		t.Fatalf("a nil record must be dropped, got %v", got)
	}

	empty := &waSyncAction.CallLogRecord{}
	if got := serializeCallLogRecord(empty, "history"); got != nil {
		t.Fatalf("a record without callID must be dropped, got %v", got)
	}
}

// Enums travel as their protobuf NAMES. If they were sent as numbers, every
// consumer would need its own copy of the enum ordering, and that copy rots
// silently the day WhatsApp inserts a value in the middle.
func TestSerializeCallLogRecordSendsEnumNames(t *testing.T) {
	rec := &waSyncAction.CallLogRecord{
		CallID:        proto.String("ABC123"),
		CallResult:    waSyncAction.CallLogRecord_MISSED.Enum(),
		CallType:      waSyncAction.CallLogRecord_REGULAR.Enum(),
		SilenceReason: waSyncAction.CallLogRecord_PRIVACY.Enum(),
	}

	got := serializeCallLogRecord(rec, "appstate")
	if got == nil {
		t.Fatal("a record with a callID must be forwarded")
	}
	if got["result"] != "MISSED" {
		t.Errorf("result = %v, want the enum name MISSED", got["result"])
	}
	if got["callType"] != "REGULAR" {
		t.Errorf("callType = %v, want the enum name REGULAR", got["callType"])
	}
	if got["silenceReason"] != "PRIVACY" {
		t.Errorf("silenceReason = %v, want the enum name", got["silenceReason"])
	}
}

// An outgoing call that connected is the case the whole feature exists for: it
// is the one WhatsApp never reports live, only through the call log.
func TestSerializeCallLogRecordCarriesOutgoingCallsWithDuration(t *testing.T) {
	rec := &waSyncAction.CallLogRecord{
		CallID:         proto.String("OUT-1"),
		CallCreatorJID: proto.String("51999000111@s.whatsapp.net"),
		CallResult:     waSyncAction.CallLogRecord_CONNECTED.Enum(),
		IsIncoming:     proto.Bool(false),
		IsVideo:        proto.Bool(true),
		Duration:       proto.Int64(266),
		StartTime:      proto.Int64(1_781_000_000),
		Participants: []*waSyncAction.CallLogRecord_ParticipantInfo{
			{UserJID: proto.String("51970043155@s.whatsapp.net"), CallResult: waSyncAction.CallLogRecord_CONNECTED.Enum()},
		},
	}

	got := serializeCallLogRecord(rec, "history")

	if got["source"] != "history" {
		t.Errorf("source = %v, want history", got["source"])
	}
	if got["isIncoming"] != false {
		t.Errorf("isIncoming = %v, want false — this is the outgoing case", got["isIncoming"])
	}
	if got["duration"] != int64(266) {
		t.Errorf("duration = %v, want 266", got["duration"])
	}
	// Seconds since the epoch, untouched: formatting it here would bake this
	// process's timezone into the data.
	if got["startTime"] != int64(1_781_000_000) {
		t.Errorf("startTime = %v, want the raw epoch seconds", got["startTime"])
	}

	participants, ok := got["participants"].([]map[string]interface{})
	if !ok || len(participants) != 1 {
		t.Fatalf("participants = %v, want one entry", got["participants"])
	}
	if participants[0]["jid"] != "51970043155@s.whatsapp.net" {
		t.Errorf("participant jid = %v", participants[0]["jid"])
	}
}

// Optional fields stay absent instead of being sent as empty strings: a
// consumer that stores "" for a group JID cannot tell "not a group call" from
// "group call whose JID we lost".
func TestSerializeCallLogRecordOmitsAbsentOptionalFields(t *testing.T) {
	rec := &waSyncAction.CallLogRecord{CallID: proto.String("X")}
	got := serializeCallLogRecord(rec, "history")

	for _, campo := range []string{"silenceReason", "groupJid", "scheduledCallId"} {
		if _, presente := got[campo]; presente {
			t.Errorf("%s should be absent when the record does not carry it", campo)
		}
	}
}
