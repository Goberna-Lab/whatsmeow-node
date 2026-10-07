package main

import (
	"context"
	"os"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
)

// ── La versión de WhatsApp Web que declara el binario ───────
//
// whatsmeow trae la versión HORNEADA (`store/clientpayload.go`), y WhatsApp
// rechaza las que quedan viejas con `client_outdated`. Pasó el 5-oct-2026: el
// binario declaraba 2.3000.1040847988 (whatsmeow del 11-jun) y las líneas de
// Hermes se cayeron todas en media hora, sin que nada cambiara de este lado.
// Con la versión horneada, la única salida era recompilar.
//
// Dos palancas, en este orden:
//
//  1. WHATSMEOW_WA_VERSION=2.3000.N — la manda el operador. Gana siempre,
//     aunque sea más vieja que la horneada: si alguien la escribe, sabe por qué.
//     Con el valor `compilada` se apaga la consulta y queda la horneada.
//  2. La consulta a web.whatsapp.com (whatsmeow.GetLatestVersion). Sólo se usa
//     si es MÁS NUEVA que la horneada: una respuesta rara nunca puede bajarla.
//
// Si las dos fallan, queda la horneada — que es exactamente lo de antes.

const variableDeVersion = "WHATSMEOW_WA_VERSION"

// Lo que tarda como mucho la consulta. Corre una vez al arrancar, antes de leer
// stdin, y el comando `init` del wrapper espera 30 s: hay margen de sobra.
const esperaDeLaConsulta = 8 * time.Second

type versionElegida struct {
	version store.WAVersionContainer
	origen  string // "env" | "web" | "compilada"
	motivo  string // por qué se descartó lo anterior; vacío si no hubo nada que descartar
}

// elegirVersion es pura: la consulta entra por parámetro para poder testearla
// sin red.
func elegirVersion(
	compilada store.WAVersionContainer,
	deEnv string,
	consultar func() (*store.WAVersionContainer, error),
) versionElegida {
	deEnv = strings.TrimSpace(deEnv)
	motivo := ""

	if deEnv == "compilada" {
		return versionElegida{compilada, "compilada", variableDeVersion + "=compilada"}
	}
	if deEnv != "" {
		v, err := store.ParseVersion(deEnv)
		if err == nil && !v.IsZero() {
			return versionElegida{v, "env", ""}
		}
		motivo = variableDeVersion + " no se pudo leer: " + deEnv
	}

	web, err := consultar()
	switch {
	case err != nil:
		return versionElegida{compilada, "compilada", juntar(motivo, "la consulta falló: "+err.Error())}
	case web == nil || web.IsZero():
		return versionElegida{compilada, "compilada", juntar(motivo, "la consulta no devolvió versión")}
	case !compilada.LessThan(*web):
		return versionElegida{compilada, "compilada", juntar(motivo, "la de la web ("+web.String()+") no es más nueva")}
	}
	return versionElegida{*web, "web", motivo}
}

func juntar(a, b string) string {
	if a == "" {
		return b
	}
	return a + "; " + b
}

// ajustarVersionDeWhatsApp aplica la elegida y lo dice en stderr, que Hermes
// reenvía al journal: el día que vuelva un client_outdated, la primera pregunta
// es qué versión declaraba.
func ajustarVersionDeWhatsApp() {
	compilada := store.GetWAVersion()
	elegida := elegirVersion(compilada, os.Getenv(variableDeVersion), func() (*store.WAVersionContainer, error) {
		ctx, cancel := context.WithTimeout(context.Background(), esperaDeLaConsulta)
		defer cancel()
		return whatsmeow.GetLatestVersion(ctx, nil)
	})
	if elegida.version != compilada {
		store.SetWAVersion(elegida.version)
	}
	campos := []interface{}{"version", elegida.version.String(), "origen", elegida.origen, "compilada", compilada.String()}
	if elegida.motivo != "" {
		campos = append(campos, "motivo", elegida.motivo)
	}
	logInfo("versión de WhatsApp Web", campos...)
}
