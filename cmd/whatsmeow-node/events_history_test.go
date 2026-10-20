package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

// Los mensajes que trae una tanda de historial se tiraban en el case de
// *events.HistorySync: el 19-oct-2026 una línea de Hermes se re-vinculó
// después de una semana caída y esa semana no volvió nunca. Estos tests
// arman la tanda a mano y leen lo que sendEvent escribe de verdad.

func mensajeWeb(id string, deMi bool, texto string) *waHistorySync.HistorySyncMsg {
	web := &waWeb.WebMessageInfo{
		Key:              &waCommon.MessageKey{ID: proto.String(id), FromMe: proto.Bool(deMi)},
		MessageTimestamp: proto.Uint64(1760900000),
	}
	if texto != "" {
		web.Message = &waE2E.Message{Conversation: proto.String(texto)}
	}
	return &waHistorySync.HistorySyncMsg{Message: web}
}

// parseFalso hace lo mínimo que hace client.ParseWebMessage, sin cliente
// logueado. "roto" simula un mensaje que whatsmeow no puede leer.
func parseFalso(chat types.JID, web *waWeb.WebMessageInfo) (*events.Message, error) {
	if web.GetKey().GetID() == "roto" {
		return nil, errors.New("couldn't find sender")
	}
	return &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{Chat: chat, Sender: chat, IsFromMe: web.GetKey().GetFromMe()},
			ID:            web.GetKey().GetID(),
			Timestamp:     time.Unix(int64(web.GetMessageTimestamp()), 0),
		},
		Message: web.GetMessage(),
	}, nil
}

func todosLosEventos(t *testing.T, buf *bytes.Buffer) []Event {
	t.Helper()
	var out []Event
	sc := bufio.NewScanner(buf)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var e Event
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			t.Fatalf("línea no es JSON: %v (%q)", err, sc.Text())
		}
		out = append(out, e)
	}
	return out
}

func TestHistorialEmiteCadaMensajeComoHistoryMessage(t *testing.T) {
	buf := capturarEventos(t)
	data := &waHistorySync.HistorySync{
		SyncType: waHistorySync.HistorySync_RECENT.Enum(),
		Conversations: []*waHistorySync.Conversation{
			{
				ID: proto.String("66396084027513@lid"),
				Messages: []*waHistorySync.HistorySyncMsg{
					mensajeWeb("A1", false, "Hola"),
					mensajeWeb("A2", true, "Buen día"),
					mensajeWeb("stub", false, ""), // sin mensaje: un stub de protocolo
					mensajeWeb("roto", false, "x"),
				},
			},
			{
				ID:       proto.String("status@broadcast"),
				Messages: []*waHistorySync.HistorySyncMsg{mensajeWeb("S1", false, "un estado")},
			},
		},
	}

	forwardHistoryMessages(data, parseFalso)

	evts := todosLosEventos(t, buf)
	if len(evts) != 2 {
		t.Fatalf("salieron %d eventos, quería 2 (A1 y A2): %+v", len(evts), evts)
	}
	for i, id := range []string{"A1", "A2"} {
		if evts[i].EventName != "history:message" {
			t.Fatalf("evento %d = %q, quería history:message", i, evts[i].EventName)
		}
		d := datos(t, evts[i])
		if d["syncType"] != "RECENT" {
			t.Fatalf("syncType = %v, quería RECENT", d["syncType"])
		}
		info := d["info"].(map[string]interface{})
		if info["id"] != id || info["chat"] != "66396084027513@lid" {
			t.Fatalf("info = %v, quería id %s en el chat lid", info, id)
		}
		if info["timestamp"].(float64) != 1760900000 {
			t.Fatalf("timestamp = %v, se perdió la fecha original", info["timestamp"])
		}
		if _, ok := d["message"].(map[string]interface{}); !ok {
			t.Fatalf("message = %#v, quería el proto como objeto", d["message"])
		}
	}
	if evts[1].Data.(map[string]interface{})["info"].(map[string]interface{})["isFromMe"] != true {
		t.Fatal("A2 lo mandó la línea y perdió isFromMe")
	}
}

// Sin cliente (el proceso todavía no hizo connect) el case no puede parsear,
// pero tampoco puede caerse: el aviso history_sync y el registro de llamadas
// tienen que seguir saliendo.
func TestHistorialSinClienteSoloAvisaLaTanda(t *testing.T) {
	buf := capturarEventos(t)
	(&App{}).eventHandler(&events.HistorySync{Data: &waHistorySync.HistorySync{
		SyncType: waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(),
		Conversations: []*waHistorySync.Conversation{
			{ID: proto.String("51900000000@s.whatsapp.net"), Messages: []*waHistorySync.HistorySyncMsg{mensajeWeb("A1", false, "Hola")}},
		},
	}})

	evts := todosLosEventos(t, buf)
	if len(evts) != 1 || evts[0].EventName != "history_sync" {
		t.Fatalf("eventos = %+v, quería sólo history_sync", evts)
	}
}
