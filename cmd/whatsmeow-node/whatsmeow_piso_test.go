package main

import (
	"runtime/debug"
	"strings"
	"testing"
)

// La fecha del commit de whatsmeow que agregó el handler de los nodos <status>
// (a238105, «client: handle <status> nodes», 20-jul-2026).
//
// Antes de ese commit la tabla de handlers de whatsmeow no tenía «status»: el
// nodo se descartaba sin ack, el servidor dejaba de entregar lo que venía
// detrás y a los ~50 min cortaba con <stream:error><ack class="status" …/>.
// Reconectaba, salían unos pocos mensajes y la cola se volvía a trabar. Así
// estuvo la línea 593992073457 de Hermes del 15 al 23-oct-2026: recibiendo en
// orden, pero un día y medio tarde.
const pisoDeWhatsmeow = "20260720135917"

func TestWhatsmeowNoBajaDelArregloDeLosNodosStatus(t *testing.T) {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		t.Fatal("el binario de prueba no trae BuildInfo")
	}
	for _, dep := range info.Deps {
		if dep.Path != "go.mau.fi/whatsmeow" {
			continue
		}
		version := dep.Version
		if dep.Replace != nil {
			version = dep.Replace.Version
		}
		// Pseudo-versión: v0.0.0-AAAAMMDDhhmmss-<commit>.
		partes := strings.Split(version, "-")
		if len(partes) < 3 || len(partes[len(partes)-2]) != len(pisoDeWhatsmeow) {
			t.Fatalf("no reconozco la versión de whatsmeow %q: si ya es un tag, revisa a mano que incluya a238105", version)
		}
		if fecha := partes[len(partes)-2]; fecha < pisoDeWhatsmeow {
			t.Fatalf("whatsmeow %s es anterior al handler de <status> (a238105): las líneas vuelven a trabarse con un estado sin ack", version)
		}
		return
	}
	t.Fatal("go.mau.fi/whatsmeow no aparece entre las dependencias")
}
