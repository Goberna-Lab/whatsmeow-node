package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// UN PANIC NO PUEDE SER FATAL PARA LA LÍNEA DE UNA VENDEDORA.
//
// Hasta acá no había un solo `recover()` en el proceso. `handleCommand` corre en
// su propia goroutine y el manejador de eventos corre en las de whatsmeow, así
// que un nil deref serializando un mensaje raro tumbaba el proceso entero.
//
// Sobrevivirlo se sobrevive —el vigilante de Hermes lo relevanta en menos de un
// minuto—, salvo que el panic sea determinista: reconecta, resincroniza, llega el
// mismo mensaje, panic. Un «mensaje veneno» deja la línea en un bucle de reinicio
// que desde afuera se lee igual que una caída de red.

func TestPanicoSeReportaYNoPropaga(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("el pánico se propagó fuera: %v", r)
			}
		}()
		func() {
			defer app.recoverPanic("event *events.Inventado", "")
			panic("boom")
		}()
	})

	got := onlyEvent(t, emitted, "event:panic")
	if got["where"] != "event *events.Inventado" {
		t.Errorf("where = %v, quiero saber DÓNDE fue", got["where"])
	}
	if !strings.Contains(asString(got["error"]), "boom") {
		t.Errorf("error = %v, want el valor del panic", got["error"])
	}
	// Sin la traza, «se cayó» no se puede accionar: hay que poder ver la línea.
	if !strings.Contains(asString(got["stack"]), "panic_test.go") {
		t.Errorf("stack no apunta al origen: %v", got["stack"])
	}
}

// Un comando que revienta tiene que contestarle a quien lo pidió. Sin eso, el
// lado Node espera hasta el timeout por algo que ya falló.
func TestPanicoEnUnComandoContestaAlQuePregunto(t *testing.T) {
	app := &App{}

	replies := captureResponses(t, func() {
		func() {
			defer app.recoverPanic("command sendMessage", "cmd-1")
			panic("boom")
		}()
	})

	// El captor decodifica todas las líneas, y acá también salió el evento: las
	// respuestas son las que traen `id`.
	var respuestas []Response
	for _, r := range replies {
		if r.ID != "" {
			respuestas = append(respuestas, r)
		}
	}

	if len(respuestas) != 1 {
		t.Fatalf("want una respuesta al comando, got %d (todas: %+v)", len(respuestas), replies)
	}
	if respuestas[0].ID != "cmd-1" || respuestas[0].OK {
		t.Errorf("respuesta = %+v, want un error para cmd-1", respuestas[0])
	}
	if respuestas[0].Code != "ERR_PANIC" {
		t.Errorf("code = %q, want ERR_PANIC", respuestas[0].Code)
	}
}

// Sin id de comando no hay a quién contestarle: sale el evento y nada más.
func TestPanicoSinComandoSoloEmiteElEvento(t *testing.T) {
	app := &App{}

	// Sin anidar los dos captores: el de respuestas decodifica TODAS las líneas,
	// incluida la del evento, así que alcanza con mirar si alguna trae `id`.
	replies := captureResponses(t, func() {
		func() {
			defer app.recoverPanic("event *events.Inventado", "")
			panic("boom")
		}()
	})

	for _, r := range replies {
		if r.ID != "" {
			t.Errorf("no había comando que contestar, pero salió una respuesta: %+v", r)
		}
	}
}

// Sin pánico, el defer no hace nada. Un `recover()` que emitiera siempre sería
// ruido en cada evento.
func TestSinPanicoNoEmiteNada(t *testing.T) {
	app := &App{}

	emitted := captureEvents(t, func() {
		func() {
			defer app.recoverPanic("event *events.Inventado", "")
		}()
	})

	if found := eventsNamed(emitted, "event:panic"); len(found) != 0 {
		t.Errorf("emitió sin haber pánico: %v", found)
	}
}

// 🔴 EL CANDADO DE VERDAD. La protección sirve si está PUESTA en los dos lugares
// donde el proceso corre código que puede reventar. Un helper perfecto que nadie
// difiere no protege nada — es el defecto de ADR 0024 otra vez.
func TestLosDosPuntosDeEntradaEstanProtegidos(t *testing.T) {
	casos := []struct {
		archivo string
		funcion string
	}{
		{"app.go", "handleCommand"},
		{"events.go", "eventHandler"},
	}

	for _, c := range casos {
		fuente, err := os.ReadFile(c.archivo)
		if err != nil {
			t.Fatalf("no se pudo leer %s: %v", c.archivo, err)
		}
		// La firma, y en las líneas que siguen el defer.
		patron := regexp.MustCompile(`func \(a \*App\) ` + c.funcion + `\([^)]*\)[^{]*\{(?s).{0,300}?a\.recoverPanic\(`)
		if !patron.MatchString(string(fuente)) {
			t.Errorf("%s: %s no difiere recoverPanic al entrar — un pánico ahí mata el proceso", c.archivo, c.funcion)
		}
	}
}

func asString(v interface{}) string {
	s, _ := v.(string)
	return s
}
