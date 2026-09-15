# Fork de `whatsmeow-node` — registro de llamadas y eventos de desconexión

Este repo es un fork de [`nicastelo/whatsmeow-node`](https://github.com/nicastelo/whatsmeow-node)
(MIT) con **dos agregados**, los dos aislados en `cmd/whatsmeow-node/events.go`:

1. Exponer al lado JavaScript el **registro de llamadas** que WhatsApp le sincroniza a un
   dispositivo vinculado.
2. Traducir los **eventos de desconexión** que whatsmeow ya emite pero que el binario original
   descartaba, así que una caída de sesión llegaba a Node sin decir por qué.

Lo consume [Hermes](https://github.com/Goberna-Lab/hermes), el CRM de la Escuela: el registro de
llamadas para su vista **Llamadas**, los eventos de desconexión para que el vigilante que
relanza las diez líneas de WhatsApp sepa si vale la pena reintentar o si el problema es otro
(una sesión duplicada, un cliente desactualizado, un rechazo del servidor).

## Registro de llamadas

### Qué le falta al paquete original

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

### Qué agrega este fork

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

## Eventos de desconexión

### Qué le faltaba al paquete original

whatsmeow ya recibe y emite estos cuatro eventos — están en
`go.mau.fi/whatsmeow/types/events` desde hace rato — pero `events.go` no tenía `case` para
ninguno, así que el switch de `eventHandler` los dejaba caer sin más:

- `*events.StreamReplaced`: otra sesión con las mismas credenciales se conectó y WhatsApp
  expulsó a esta. Es la causa más común de una "desconexión silenciosa": dos procesos (o dos
  líneas mal configuradas) hablándole al mismo número.
- `*events.ClientOutdated`: el servidor rechazó la versión de cliente que declara whatsmeow.
- `*events.ConnectFailure`: el servidor rechazó la conexión con un motivo que whatsmeow no
  traduce a uno de sus casos internos (esos salen como `LoggedOut` o `TemporaryBan`).
- `*events.CATRefreshError`: whatsmeow no pudo refrescar el token de cifrado antes de
  reconectar.

Medido en producción el 14-sep-2026: las diez líneas de WhatsApp de Hermes perdían el socket
cada pocos minutos y el vigilante las relanzaba — 175 veces en 3 h — sin que el journal dijera
nunca por qué. Con estos cuatro eventos traducidos, la próxima vez que pase se sabe si fue una
sesión duplicada, un cliente desactualizado, un rechazo del servidor o algo que de verdad no
tiene motivo (`Disconnected` a secas, que whatsmeow ya mandaba y sigue sin traer datos propios).

De paso, `logged_out` suma `onConnect` (distingue un rechazo al conectar de una sesión que se
cae ya conectada) y `stream_error` suma `raw` cuando whatsmeow no reconoce el código — los dos
se descartaban sin necesidad, y ninguno de los dos cambia la forma que ya tenían.

### Qué agrega este fork

Cuatro eventos nuevos:

```ts
cliente.on('stream_replaced', () => { /* sin datos — el hecho de que pase ya es la señal */ })
cliente.on('client_outdated', () => { /* sin datos — hace falta actualizar whatsmeow */ })
cliente.on('connect_failure', (f) => {
  f.reason   // el código y su descripción, ej. "500: unknown error"
  f.message  // el texto que mandó el servidor (puede venir vacío)
  f.raw      // el nodo XML completo, sólo si viajó con el evento
})
cliente.on('cat_refresh_error', (e) => {
  e.error    // el texto del error de Go — no hay un código como en connect_failure
})
```

Y dos eventos existentes con un campo nuevo (nunca rompen la forma que ya tenían):

```ts
cliente.on('logged_out', (lo) => {
  lo.reason     // como antes
  lo.onConnect  // nuevo: true = rechazo al conectar, false = sesión caída en pleno uso
})
cliente.on('stream_error', (se) => {
  se.code  // como antes
  se.raw   // nuevo, sólo si whatsmeow no reconoció el código
})
```

Cubierto por `cmd/whatsmeow-node/events_disconnect_test.go` (Go) y
`ts/src/__tests__/client-eventos-desconexion.test.ts` (TypeScript, simulando una línea JSON real
por el stdout de un proceso Go falso).

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
> declarara, en otra plataforma npm bajaría el binario **de upstream** —el que no tiene estos
> parches— y ni `call:log` ni los eventos de desconexión se emitirían **nunca, sin un solo
> error**. Es preferible que falle ruidosamente a que falte una capacidad en silencio.

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

Los dos agregados son chicos y están aislados en `events.go`, así que traer una versión nueva de
upstream es `git merge` de su tag y volver a compilar. **El destino de esto es un PR a
upstream**: el hueco es de ellos, no de Goberna, y si lo aceptan este fork se puede tirar (o al
menos la parte que acepten).
