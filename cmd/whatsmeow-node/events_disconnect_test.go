package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types/events"
)

// Estos cuatro eventos son la causa real de las "desconexiones silenciosas"
// de producción: whatsmeow los recibe y los descarta, así que journal nunca
// dice por qué una línea perdió el socket, y el vigilante la relevanta como
// si hubiera sido la red. Cada test construye el evento de whatsmeow a mano
// (no hay forma de provocarlo sin una sesión real) y comprueba el JSON que
// sendEvent manda de verdad — no sólo que el switch compile.

// capturarEventos redirige outEnc — el *json.Encoder que sendEvent usa para
// escribir a os.Stdout — hacia un buffer en memoria, y lo devuelve a su
// destino original al terminar el test. Sin este cambio no hay forma de leer
// lo que eventHandler emite: sendEvent no acepta un writer por parámetro.
func capturarEventos(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	original := outEnc
	outEnc = json.NewEncoder(&buf)
	t.Cleanup(func() { outEnc = original })
	return &buf
}

// decodificarEvento asume una sola línea JSON en el buffer, que es como cada
// test de abajo llama a eventHandler (un evento por vez).
func decodificarEvento(t *testing.T, buf *bytes.Buffer) Event {
	t.Helper()
	if buf.Len() == 0 {
		t.Fatal("eventHandler no mandó nada — sendEvent no se llamó")
	}
	var evt Event
	if err := json.Unmarshal(buf.Bytes(), &evt); err != nil {
		t.Fatalf("el JSON emitido no se pudo decodificar: %v (crudo: %q)", err, buf.String())
	}
	return evt
}

// datos exige que evt.Data haya llegado como objeto JSON. Estos cuatro
// eventos siempre mandan un mapa (vacío o con campos), nunca null.
func datos(t *testing.T, evt Event) map[string]interface{} {
	t.Helper()
	m, ok := evt.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("evt.Data = %#v (%T), se esperaba un objeto JSON", evt.Data, evt.Data)
	}
	return m
}

// StreamReplaced: otro proceso se conectó con las mismas credenciales y
// WhatsApp expulsó a esta sesión. whatsmeow no adjunta datos.
func TestEventHandlerEmiteStreamReplaced(t *testing.T) {
	buf := capturarEventos(t)
	(&App{}).eventHandler(&events.StreamReplaced{})

	evt := decodificarEvento(t, buf)
	if evt.EventName != "stream_replaced" {
		t.Fatalf("event = %q, quería %q", evt.EventName, "stream_replaced")
	}
	if d := datos(t, evt); len(d) != 0 {
		t.Fatalf("data = %v, quería un mapa vacío", d)
	}
}

// ClientOutdated: WhatsApp rechazó la versión de cliente que declara
// whatsmeow. Tampoco trae datos propios.
func TestEventHandlerEmiteClientOutdated(t *testing.T) {
	buf := capturarEventos(t)
	(&App{}).eventHandler(&events.ClientOutdated{})

	evt := decodificarEvento(t, buf)
	if evt.EventName != "client_outdated" {
		t.Fatalf("event = %q, quería %q", evt.EventName, "client_outdated")
	}
	if d := datos(t, evt); len(d) != 0 {
		t.Fatalf("data = %v, quería un mapa vacío", d)
	}
}

// ConnectFailure es el caso central del issue: el servidor rechazó la
// conexión con un motivo, y ese motivo (+ el nodo XML crudo, cuando viaja)
// tiene que llegar íntegro a Node.
func TestEventHandlerEmiteConnectFailureConRawPresente(t *testing.T) {
	buf := capturarEventos(t)
	raw := &waBinary.Node{Tag: "failure", Attrs: waBinary.Attrs{"reason": "500"}}
	(&App{}).eventHandler(&events.ConnectFailure{
		Reason:  events.ConnectFailureInternalServerError,
		Message: "server error",
		Raw:     raw,
	})

	evt := decodificarEvento(t, buf)
	if evt.EventName != "connect_failure" {
		t.Fatalf("event = %q, quería %q", evt.EventName, "connect_failure")
	}
	d := datos(t, evt)
	if quiero := events.ConnectFailureInternalServerError.String(); d["reason"] != quiero {
		t.Errorf("reason = %v, quería %q", d["reason"], quiero)
	}
	if d["message"] != "server error" {
		t.Errorf("message = %v, quería %q", d["message"], "server error")
	}
	if quiero := raw.String(); d["raw"] != quiero {
		t.Errorf("raw = %v, quería %q", d["raw"], quiero)
	}
}

// Sin nodo crudo, "raw" no debe aparecer — mismo criterio que ya usa
// serializeCallLogRecord para sus campos opcionales (silenceReason, groupJid).
func TestEventHandlerConnectFailureSinRawOmiteLaClave(t *testing.T) {
	buf := capturarEventos(t)
	(&App{}).eventHandler(&events.ConnectFailure{
		Reason:  events.ConnectFailureGeneric,
		Message: "",
	})

	d := datos(t, decodificarEvento(t, buf))
	if valor, presente := d["raw"]; presente {
		t.Errorf("raw = %v, debía estar ausente sin nodo crudo", valor)
	}
}

// CATRefreshError: whatsmeow no pudo refrescar el token de cifrado antes de
// reconectar. El texto del error es el único dato — no hay un código como en
// ConnectFailure.
func TestEventHandlerEmiteCatRefreshError(t *testing.T) {
	buf := capturarEventos(t)
	(&App{}).eventHandler(&events.CATRefreshError{Error: errors.New("token vencido")})

	evt := decodificarEvento(t, buf)
	if evt.EventName != "cat_refresh_error" {
		t.Fatalf("event = %q, quería %q", evt.EventName, "cat_refresh_error")
	}
	if d := datos(t, evt); d["error"] != "token vencido" {
		t.Errorf("error = %v, quería %q", d["error"], "token vencido")
	}
}

// logged_out ya mandaba "reason"; onConnect se descartaba. Sin él, un
// consumidor no puede distinguir un rechazo al conectar (OnConnect: true) de
// una sesión que se cae ya conectada, en pleno uso (OnConnect: false).
func TestEventHandlerLoggedOutIncluyeOnConnect(t *testing.T) {
	buf := capturarEventos(t)
	(&App{}).eventHandler(&events.LoggedOut{OnConnect: true, Reason: events.ConnectFailureLoggedOut})

	d := datos(t, decodificarEvento(t, buf))
	if quiero := events.ConnectFailureLoggedOut.String(); d["reason"] != quiero {
		t.Errorf("reason = %v, quería %q", d["reason"], quiero)
	}
	if d["onConnect"] != true {
		t.Errorf("onConnect = %v, quería true", d["onConnect"])
	}
}

// stream_error ya mandaba "code"; el nodo XML completo (v.Raw) se descartaba.
// Cuando whatsmeow no reconoce el código es el único rastro de qué mandó el
// servidor.
func TestEventHandlerStreamErrorIncluyeRawCuandoHay(t *testing.T) {
	buf := capturarEventos(t)
	raw := &waBinary.Node{Tag: "stream:error", Attrs: waBinary.Attrs{"code": "515"}}
	(&App{}).eventHandler(&events.StreamError{Code: "515", Raw: raw})

	d := datos(t, decodificarEvento(t, buf))
	if d["code"] != "515" {
		t.Errorf("code = %v, quería %q", d["code"], "515")
	}
	if quiero := raw.String(); d["raw"] != quiero {
		t.Errorf("raw = %v, quería %q", d["raw"], quiero)
	}
}

// Sin nodo crudo, stream_error se queda como estaba: sólo "code".
func TestEventHandlerStreamErrorSinRawOmiteLaClave(t *testing.T) {
	buf := capturarEventos(t)
	(&App{}).eventHandler(&events.StreamError{Code: "999"})

	d := datos(t, decodificarEvento(t, buf))
	if valor, presente := d["raw"]; presente {
		t.Errorf("raw = %v, debía estar ausente sin nodo crudo", valor)
	}
}
