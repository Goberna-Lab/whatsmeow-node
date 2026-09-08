# Fork de `whatsmeow-node` — los eventos que el puente descartaba

Este repo es un fork de [`nicastelo/whatsmeow-node`](https://github.com/nicastelo/whatsmeow-node)
(MIT) con **un solo tipo de agregado**: exponer al lado JavaScript eventos que llegan completos al
proceso Go y se descartan antes de cruzar el puente.

Lo consume [Hermes](https://github.com/Goberna-Lab/hermes), el CRM de la Escuela.

## Por qué se pierden

El `switch` de `cmd/whatsmeow-node/events.go` es cerrado y **no tiene `default`**. Un evento sin
`case` propio no produce error, no se loguea y no sale del proceso: whatsmeow emite unos 74 tipos y
el wrapper original reenviaba 19. Lo que falta no falla — falta en silencio, que es la razón por la
que estos huecos se descubren tarde y desde el lado del negocio ("Hermes no muestra las etiquetas
de Luz"), nunca desde un stack trace.

## Qué agrega este fork

### `call:log` — el registro de llamadas

WhatsApp le sincroniza a un dispositivo vinculado su propio registro de llamadas, el de la pestaña
«Llamadas» del celular, **incluidas las que marcó el dueño de la línea** —que son justo las que no
tienen evento en vivo—. Ese dato se descartaba en dos lugares: `case *events.HistorySync:` reenviaba
el tipo de sincronización y tiraba `v.Data` entero (donde vive `GetCallLogRecords()`), y no existía
`case *events.AppState:`, así que el `callLogAction` con el que WhatsApp va sumando cada llamada
nueva nunca salía.

Un registro por llamada, con la misma forma venga de donde venga; lo distingue `source`:

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

Un registro sin `callId` se descarta: no se puede deduplicar, y guardarlo duplicaría la fila en cada
resincronización. Una llamada duplicada es peor que una que falta, porque infla los totales sin
síntoma.

### `label:edit`, `label:chat`, `label:message` — las etiquetas de WhatsApp Business

Las etiquetas que una vendedora le pone a sus chats y mensajes desde el celular. Viajan por *app
state* y whatsmeow ya las emitía como tres eventos tipados; el `switch` no tenía `case` para
ninguno.

```ts
cliente.on('label:edit', (e) => {
  e.labelId       // la llave
  e.name          // el nombre que le puso la vendedora
  e.color         // índice de la paleta de WhatsApp, no un color CSS
  e.deleted       // true = la borró; el evento NO deja de llegar, llega con el flag
  e.timestamp     // segundos desde el epoch, sin formatear
  e.fromFullSync  // true = viene de la tanda que WhatsApp reenvía al resincronizar
})

cliente.on('label:chat', (e) => {
  e.jid           // el chat etiquetado
  e.labelId
  e.labeled       // true = se la puso | false = se la sacó
  e.timestamp
  e.fromFullSync
})

cliente.on('label:message', (e) => {
  e.jid           // el chat donde vive el mensaje
  e.messageId     // el mensaje etiquetado
  e.labelId
  e.labeled
  e.timestamp
  e.fromFullSync
})
```

**`fromFullSync` hace acá el trabajo que hace `source` en `call:log`**: una resincronización de 700
etiquetas que ya existían no son 700 ediciones nuevas, y un consumidor que las trate igual va a
duplicar todo el historial.

Un evento de etiqueta **sin acción se descarta**, igual que una llamada sin `callId`. El motivo es
peor que el de la llamada: en una asociación, la acción ausente hace que `labeled` lea `false`, que
es indistinguible de un desetiquetado deliberado. Perder un evento se recupera en la próxima
sincronización; desetiquetar en silencio los 700 contactos de una vendedora, no.

> ⚠️ **Trampa al mantener esto.** whatsmeow despacha `events.AppState` **además** del evento tipado,
> para la misma mutación (`appstate.go`: primero agrega el `AppState`, después el que devuelve
> `dispatchAppState`). Como el `case *events.AppState:` ya existe para el registro de llamadas, es
> tentador colgar ahí las etiquetas con `GetLabelEditAction()` y ahorrarse tres casos. **No**: cada
> cambio saldría dos veces. Y el evento tipado es además la mejor fuente, porque trae el `labelId`,
> el `jid` y el `messageId` ya parseados del índice de la mutación, y se despacha también en los
> borrados, que el `AppState` crudo no. Hay un test que se pone en rojo si alguien hace el atajo.

### `message:undecryptable` — los mensajes que no se pudieron descifrar

whatsmeow le pide al emisor que reintente por su cuenta; si funciona, después llega un `message`
normal con el mismo `info.id`. Si no funciona, este evento es **el único rastro** de que a la
conversación le falta un turno. Antes desaparecían sin dejar señal, que es un agujero en el dato y
no una molestia.

`unavailableType` y `decryptFailMode` viajan tal cual los reporta whatsmeow, **cadena vacía
incluida**: arriba el `""` es un valor y no una ausencia (`""` en `decryptFailMode` significa que el
mensaje igual se muestra; `"hide"`, que no).

### `stream_replaced` — otro cliente tomó la sesión

Otro cliente se conectó con las mismas llaves y se quedó con el socket. La conexión ya no vuelve
sola. Es exactamente el «la línea se quedó sorda y el estado seguía diciendo conectado» del **ADR
0073** de Hermes, que se resolvió con un ping activo *porque no había señal*. Esta es la señal.

En la práctica lo dispara abrir un segundo proceso sobre el mismo archivo de sesión — por ejemplo,
levantar un cliente propio sobre `.wa-sessions/<numero>.db` de una vendedora para inspeccionarle
algo mientras el servicio de VPS1 la tiene abierta. **No se hace**: SQLite no admite dos escritores
y puedes desloguearla de su línea de trabajo.

### `version` — quién es este binario

**El fallo que esto tapa es total y silencioso.** Este fork agrega eventos que upstream no tiene; con
el binario de upstream instalado esos eventos no se emiten **nunca**, todas las suscripciones quedan
mudas y nadie levanta un error. Un consumidor no puede distinguir «no pasó nada» de «este binario no
me puede avisar cuando pasa».

El binario expone 106 comandos IPC y hasta ahora ninguno decía qué build era. Ahora se pregunta:

```ts
const quien = await cliente.version()
quien.fork       // 'goberna' — cualquier otra cosa es un binario SIN estos eventos
quien.version    // '0.7.0-goberna.4'
quien.whatsmeow  // contra qué whatsmeow se enlazó, leído del build info
quien.events     // los 29 nombres de evento que este binario puede emitir
```

`events` es la lista que un consumidor compara contra lo que escucha, para poder decir en voz alta
«este binario no hace lo que necesito» en vez de quedarse esperando. Se pregunta **antes de `init`**:
no necesita sesión.

> ⚠️ **Una lista declarada que se desfasa es peor que no tener lista**, porque el consumidor le cree.
> `eventNames` se verifica contra cada `sendEvent("…")` del código, en los dos sentidos: un nombre que
> se emite y no está declarado haría que el handshake niegue una capacidad que el binario tiene, y uno
> declarado que nadie emite dejaría a un consumidor esperando para siempre. Es el mismo candado que
> `scripts/client-parity.json` ya le pone a los 133 métodos del cliente, aplicado a los eventos.

### `event:unhandled` — qué estamos tirando

El `switch` ahora tiene `default`. Un tipo de evento sin `case` propio ya no desaparece: se reporta
con **su nombre de tipo de Go y nada más**.

```ts
cliente.on('event:unhandled', (e) => {
  e.type   // '*events.Contact'
  e.count  // 1, 10, 100… (ver abajo)
})
```

🔴 **Sólo cruza el nombre del tipo.** El payload de un evento no manejado puede traer el nombre de un
contacto, un teléfono o el texto de un mensaje, y nada de eso tiene consumidor del otro lado: la
pregunta que este evento contesta es «¿qué estamos tirando?», y el nombre solo la contesta. Reenviar
el payload derramaría la agenda de una vendedora en un log que nadie audita.

Se reporta en **potencias de diez**, no en cada aparición: una sincronización completa de app state
dispara miles de `Contact`, y un reporte por evento inundaría el mismo pipe que usa el tráfico real —
el reporte sería la caída. Cinco líneas por tipo en toda la vida del proceso igual dicen si algo pasa
una vez o un millón, que es lo que decide si vale la pena cablearlo.

Con esto, «qué nos estamos perdiendo» pasa a ser una consulta y no una investigación de meses. De los
~70 tipos que declara whatsmeow, el `switch` cubre 25.

## Convenciones de forma

Valen para todo lo que agregue este fork:

- **Los enums viajan con su NOMBRE de protobuf**, no como número. Con números, cada consumidor
  tendría que llevar su propia copia del orden del enum — una copia que se pudre en silencio el día
  que WhatsApp inserta un valor en el medio.
- **Los timestamps van crudos, en segundos desde el epoch.** Formatearlos del lado Go hornearía la
  zona horaria de *ese* proceso adentro del dato.
- **Lo que no se puede identificar se descarta**, y el descarte está comentado y testeado. Un
  registro sin llave no se puede deduplicar ni corregir después; entra una vez por cada
  resincronización.

Cubierto por `cmd/whatsmeow-node/events_calllog_test.go`, `events_labels_test.go`,
`events_integrity_test.go`, `events_unhandled_test.go` y `capabilities_test.go` del lado Go, y
`ts/src/__tests__/client-events.test.ts` del lado TypeScript. Los tests de Go van contra
`eventHandler` entero y por el `sendEvent` real, así que verifican el JSON que efectivamente cruza el
puente, no una struct de Go.

## Lo que cambia respecto del original, para poder instalarlo desde git

El paquete npm del proyecto vive en `ts/`, así que el repo **no tenía `package.json` en la raíz** y
una dependencia de git no resolvía. Este fork agrega:

- **`package.json` en la raíz**, que apunta a `ts/dist/`.
- **`ts/dist/` y el binario `whatsmeow-node` de la raíz commiteados** (el original los ignora,
  porque los arma en cada release). Acá tienen que viajar, porque `npm ci` en el VPS no compila Go
  ni TypeScript.

El binario de la raíz es justo la ruta que `resolveBinary()` mira **primero**, así que se encuentra
solo: no hace falta `binaryPath` ni variable de entorno.

> ⚠️ **Sólo se publica el binario de `linux-x64`**, que es lo que corre el servidor. Este fork **no**
> declara las `optionalDependencies` de plataforma del original, y es a propósito: si las declarara,
> en otra plataforma npm bajaría el binario **de upstream** —el que no tiene estos parches— y los
> eventos no se emitirían **nunca, sin un solo error**. Es preferible que falle ruidosamente a que
> falte una capacidad en silencio.
>
> Corolario: el binario que hay en `node_modules/@whatsmeow-node/darwin-arm64/` de un proyecto que
> consume el fork **es el de upstream**, no el de acá. Analizarlo da conclusiones falsas.

## Cómo se reconstruye

```bash
# El binario (no hace falta tener Go instalado)
docker run --rm -v "$PWD":/src -v "$PWD/.gocache":/go/pkg/mod -w /src \
  -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH=amd64 \
  golang:1.25 go build -buildvcs=false -trimpath -ldflags=-s -o /src/whatsmeow-node ./cmd/whatsmeow-node

# El paquete JS
cd ts && npm install && npm run build

# Las pruebas
docker run --rm -v "$PWD":/src -v "$PWD/.gocache":/go/pkg/mod -w /src golang:1.25 \
  go test -buildvcs=false ./...
cd ts && npm test
```

> ⚠️ **`GOARCH=amd64` no es opcional.** En una Mac con Apple Silicon la imagen `golang:1.25` corre
> nativa en arm64, así que sin esa variable el build produce un binario **ARM** y pisa el de
> `linux-x64`, que es el que ejecuta VPS1. Nada se queja al commitearlo: falla recién al arrancar en
> el servidor. Verifica siempre antes de commitear:
>
> ```bash
> file whatsmeow-node                      # => ELF 64-bit LSB executable, x86-64
> strings -a whatsmeow-node | grep -c 'label:edit'   # => 1, el evento está adentro
> ```
>
> La misma trampa la dispara reproducir CI a mano: **`go build ./cmd/whatsmeow-node`, sin `-o`,
> escribe `./whatsmeow-node`** y pisa el binario commiteado con uno nativo, sin `-trimpath` y sin
> stripear. En CI eso es inofensivo porque el runner es descartable; en tu checkout no. Si lo
> corriste, recompila con el comando de arriba antes de commitear.

### El chequeo que corre CI sobre el binario commiteado

`scripts/check-committed-binary.sh` revisa que el archivo que viaja en el repo sea **de este commit y
de la arquitectura correcta**: que sea `x86-64`, que esté enlazado estáticamente, que contenga la
`forkVersion` del código y que traiga los 29 eventos que `eventNames` promete. Corre solo en CI, y
conviene correrlo a mano antes de commitear:

```bash
./scripts/check-committed-binary.sh
```

Existe porque publicar el binario dentro del repo convierte un problema de build en un problema de
contenido: el archivo puede quedar viejo o de otra arquitectura, el commit sale limpio igual, y no se
nota hasta que arranca en el servidor. Las dos formas de romperlo están descritas arriba y las dos
pasaron el mismo día.

Después se commitean `whatsmeow-node` y `ts/dist/`, y se sube una etiqueta nueva
(`v0.7.0-goberna.N`) para que Hermes la fije en `server/package.json`. La etiqueta dispara el
workflow **Release**, que arma los binarios de todas las plataformas, intenta publicar a npm (falla
sin ruido: el scope `@whatsmeow-node` es de upstream), crea el GitHub Release y **pushea a `main` un
commit de sync de versiones**.

## Al día con upstream

`Goberna-Lab/whatsmeow-node` **no es un fork de GitHub** (`fork: false`, `parent: null`): es una
copia con la historia de upstream adentro. No hay «compare across forks» ni PR automático hacia
`nicastelo/whatsmeow-node` — traer una actualización de upstream es agregar el remoto y mergear a
mano.

El agregado es chico y está aislado en `events.go`, así que traer una versión nueva de upstream es
`git merge` de su tag y volver a compilar. **El destino de esto es un PR a upstream**: el hueco es
de ellos, no de Goberna, y si lo aceptan este fork se puede tirar.
