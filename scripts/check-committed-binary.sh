#!/usr/bin/env bash
#
# ¿EL BINARIO COMMITEADO ES EL QUE DICE SER?
#
# Este fork publica el binario de linux-x64 dentro del repo, porque `npm ci` en el
# VPS no compila Go. Eso mueve un problema de build a un problema de contenido: el
# archivo puede quedar viejo, o de otra arquitectura, y nada se queja hasta que
# arranca en el servidor.
#
# Las dos formas de romperlo no son hipotéticas — las dos pasaron el 8-sep-2026:
#
#   · El comando de Docker sin GOARCH produce un binario ARM en una Mac con Apple
#     Silicon, porque la imagen golang corre nativa en arm64.
#   · `go build ./cmd/whatsmeow-node`, sin `-o` —el paso de CI reproducido a
#     mano—, escribe ./whatsmeow-node en la raíz y pisa el commiteado.
#
# En los dos casos el commit sale limpio. Esto lo convierte en un fallo de CI.
set -uo pipefail

BINARIO="whatsmeow-node"
FUENTE="cmd/whatsmeow-node/capabilities.go"
fallas=0

fallar() {
  echo "❌ $1" >&2
  fallas=$((fallas + 1))
}

if [ ! -f "$BINARIO" ]; then
  echo "❌ no existe ./$BINARIO — este fork lo commitea, no lo construye al instalar" >&2
  exit 1
fi

# ── 1. La arquitectura ──────────────────────────────────────────────
descripcion=$(file -b "$BINARIO")
if [[ "$descripcion" != *"x86-64"* ]]; then
  fallar "arquitectura equivocada: $descripcion
   VPS1 corre linux-x64. Reconstruye con GOOS=linux GOARCH=amd64 (ver README-GOBERNA.md)."
else
  echo "✓ arquitectura: x86-64"
fi

if [[ "$descripcion" != *"statically linked"* ]]; then
  fallar "no está enlazado estáticamente: $descripcion
   Falta CGO_ENABLED=0. Un binario dinámico depende de la libc del host."
else
  echo "✓ enlazado estáticamente"
fi

# ── 2. ¿Es de esta versión del código? ──────────────────────────────
version=$(grep -oE 'forkVersion = "[^"]+"' "$FUENTE" | sed 's/.*"\(.*\)"/\1/')
if [ -z "$version" ]; then
  fallar "no se pudo leer forkVersion de $FUENTE"
elif ! grep -aqF "$version" "$BINARIO"; then
  fallar "el binario no contiene la versión $version — quedó de un build anterior.
   Reconstruye antes de commitear (README-GOBERNA.md)."
else
  echo "✓ versión embebida: $version"
fi

# ── 3. ¿Trae todos los eventos que el handshake promete? ────────────
# El binario le dice a Hermes qué eventos puede emitir. Si el archivo commiteado
# es viejo, la promesa la hace el código y no la cumple el binario — que es
# exactamente el fallo silencioso que el handshake existe para evitar.
faltantes=0
while read -r evento; do
  [ -z "$evento" ] && continue
  if ! grep -aqF "$evento" "$BINARIO"; then
    fallar "el binario no contiene el evento '$evento' que eventNames declara"
    faltantes=$((faltantes + 1))
  fi
done < <(sed -n '/^var eventNames = \[\]string{/,/^}/p' "$FUENTE" | grep -oE '"[^"]+"' | tr -d '"')

if [ "$faltantes" -eq 0 ]; then
  total=$(sed -n '/^var eventNames = \[\]string{/,/^}/p' "$FUENTE" | grep -cE '"[^"]+"')
  echo "✓ los $total eventos declarados están en el binario"
fi

if [ "$fallas" -gt 0 ]; then
  echo >&2
  echo "El binario commiteado NO corresponde al código de este commit ($fallas problema(s))." >&2
  exit 1
fi

echo "El binario commiteado corresponde al código de este commit."
