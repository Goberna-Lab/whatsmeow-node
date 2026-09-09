package main

import (
	"fmt"
	"runtime/debug"
)

// UN PÁNICO NO PUEDE SER FATAL PARA LA LÍNEA DE UNA VENDEDORA.
//
// Hasta acá no había un solo `recover()` en este proceso. `handleCommand` corre
// en su propia goroutine y `eventHandler` corre en las de whatsmeow, así que un
// nil deref serializando un mensaje raro tumbaba el proceso entero: todo lo
// pendiente se rechazaba, la sesión se caía y la vendedora dejaba de recibir.
//
// Sobrevivirlo se sobrevive —el vigilante de Hermes lo relevanta en menos de un
// minuto—, salvo que el pánico sea determinista. Ahí es peor: reconecta,
// resincroniza, llega el mismo mensaje, vuelve a reventar. Un «mensaje veneno»
// deja la línea en un bucle de reinicio que desde afuera se lee exactamente
// igual que una caída de red, que es el disfraz más caro que puede tener un bug.
//
// Con esto, el pánico pasa de fatal a visible: se reporta con dónde fue y con su
// traza, el proceso sigue vivo, y el mensaje siguiente se procesa. Se pierde un
// evento en vez de una sesión.

// maxTraza recorta la traza para que un pánico en un bucle no inunde el pipe que
// comparte con el tráfico real — el reporte no puede convertirse en la caída.
const maxTraza = 4000

// recoverPanic se difiere al entrar a cada punto donde este proceso corre código
// que puede reventar.
//
// `donde` dice qué se estaba haciendo (el comando, o el tipo de evento).
// `cmdID` es el comando que lo pidió, o "" si fue un evento: sin id no hay a
// quién contestarle, y el lado Node no está esperando nada.
func (a *App) recoverPanic(donde string, cmdID string) {
	r := recover()
	if r == nil {
		return
	}

	traza := string(debug.Stack())
	if len(traza) > maxTraza {
		traza = traza[:maxTraza] + "\n… (traza recortada)"
	}

	sendEvent("event:panic", map[string]interface{}{
		"where": donde,
		"error": fmt.Sprint(r),
		"stack": traza,
	})

	// Si venía de un comando, hay alguien esperando del otro lado. Sin esta
	// respuesta se quedaría colgado hasta el timeout por algo que ya falló.
	if cmdID != "" {
		sendError(cmdID, fmt.Sprintf("panic en %s: %v", donde, r), "ERR_PANIC")
	}
}
