# Fork de `whatsmeow-node` — el registro de llamadas

Este repo es un fork de [`nicastelo/whatsmeow-node`](https://github.com/nicastelo/whatsmeow-node)
(MIT) con **un solo agregado**: exponer al lado JavaScript el **registro de llamadas** que
WhatsApp le sincroniza a un dispositivo vinculado.

Lo consume [Hermes](https://github.com/Goberna-Lab/hermes), el CRM de la Escuela, para su vista
**Llamadas**.

## Qué le falta al paquete original

El dato llega completo al proceso Go y se descarta en dos lugares de
`cmd/whatsmeow-node/events.go`:

1. **El historial que empuja el teléfono al vincular.** El evento se reenviaba con el tipo de
   sincronización y nada más, tirando el contenido:

   ```go
   case *events.HistorySync:
       sendEvent("history_sync", map[string]interface{}{
           "type": v.Data.GetSyncType().String(),   // ← y se descarta v.Data entero
       })
   ```

   `v.Data.GetCallLogRecords()` trae el registro de llamadas.

2. **Las llamadas posteriores.** No existía `case *events.AppState:`, así que el
   `callLogAction` —el parche de app-state con el que WhatsApp va sumando cada llamada nueva—
   nunca salía del proceso.

## Qué agrega este fork

Un evento nuevo, `call:log`, con **un registro por llamada** y la misma forma venga de donde
venga (lo distingue el campo `source`):

```ts
cliente.on('call:log', (ll) => {
  ll.source      // 'history' = la tanda inicial | 'appstate' = una llamada nueva
  ll.callId      // la llave de idempotencia
  ll.result      // CONNECTED | MISSED | REJECTED | DECLINED | CANCELLED | ABANDONED | ACCEPTED_ELSEWHERE
  ll.isIncoming  // false = la marcó el dueño de la línea desde su celular
  ll.duration    // segundos hablados (0 si no conectó)
  ll.startTime   // segundos desde el epoch, sin formatear
})
```

Los enums viajan con su **nombre** de protobuf y no como número: así ningún consumidor tiene
que llevar su propia copia del orden del enum, que es una copia que se pudre en silencio el día
que WhatsApp inserta un valor en el medio.

`startTime` va crudo, en segundos: formatearlo del lado Go hornearía la zona horaria de ese
proceso adentro del dato.

Cubierto por `cmd/whatsmeow-node/events_calllog_test.go`.

## Lo que cambia respecto del original, para poder instalarlo desde git

El paquete npm del proyecto vive en `ts/`, así que el repo **no tenía `package.json` en la
raíz** y una dependencia de git no resolvía. Este fork agrega:

- **`package.json` en la raíz**, que apunta a `ts/dist/`.
- **`ts/dist/` y el binario `whatsmeow-node` de la raíz commiteados** (el original los ignora,
  porque los arma en cada release). Acá tienen que viajar, porque `npm ci` en el VPS no compila
  Go ni TypeScript.

El binario de la raíz es justo la ruta que `resolveBinary()` mira **primero**, así que se
encuentra solo: no hace falta `binaryPath` ni variable de entorno.

> ⚠️ **Sólo se publica el binario de `linux-x64`**, que es lo que corre el servidor. Este fork
> **no** declara las `optionalDependencies` de plataforma del original, y es a propósito: si las
> declarara, en otra plataforma npm bajaría el binario **de upstream** —el que no tiene este
> parche— y `call:log` no se emitiría **nunca, sin un solo error**. Es preferible que falle
> ruidosamente a que falte una capacidad en silencio.

## Cómo se reconstruye

```bash
# El binario (no hace falta tener Go instalado)
docker run --rm -v "$PWD":/src -v "$PWD/.gocache":/go/pkg/mod -w /src -e CGO_ENABLED=0 \
  golang:1.25 go build -buildvcs=false -trimpath -ldflags=-s -o /src/whatsmeow-node ./cmd/whatsmeow-node

# El paquete JS
cd ts && npm install && npm run build

# Las pruebas
docker run --rm -v "$PWD":/src -w /src golang:1.25 go test -buildvcs=false ./...
cd ts && npm test
```

Después se commitean `whatsmeow-node` y `ts/dist/`, y se sube una etiqueta nueva
(`v0.7.0-goberna.N`) para que Hermes la fije.

## Al día con upstream

El agregado es chico y está aislado en `events.go`, así que traer una versión nueva de upstream
es `git merge` de su tag y volver a compilar. **El destino de esto es un PR a upstream**: el
hueco es de ellos, no de Goberna, y si lo aceptan este fork se puede tirar.
