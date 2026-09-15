# Changelog

All notable changes to this project will be documented in this file.

> **0.x** — We stay on 0.x because the upstream whatsmeow library is pre-1.0. Breaking changes are signaled by minor version bumps (`0.5 → 0.6`). Pin your version if stability matters.

## [0.7.0-goberna.6] - 2026-09-15

### Added (en español — este agregado es de Goberna, no de upstream)

whatsmeow ya emitía `*events.StreamReplaced`, `*events.ClientOutdated`, `*events.ConnectFailure`
y `*events.CATRefreshError`, pero `events.go` no traducía ninguno: el switch de `eventHandler`
los dejaba caer sin más. En producción (Hermes, VPS1) las diez líneas de WhatsApp perdían el
socket cada pocos minutos y el vigilante las relanzaba — 175 veces en 3 h — sin que el journal
dijera nunca por qué, porque la causa real nunca llegaba a Node.

- `stream_replaced`: otra sesión con las mismas credenciales se conectó y WhatsApp expulsó a
  esta — la causa más común de una desconexión "silenciosa".
- `client_outdated`: el servidor rechazó la versión de cliente que declara whatsmeow.
- `connect_failure`: el servidor rechazó la conexión con un motivo propio (`reason`, `message`
  y `raw` cuando el nodo XML viajó con el evento).
- `cat_refresh_error`: whatsmeow no pudo refrescar el token de cifrado antes de reconectar
  (`error`).
- `logged_out` suma `onConnect` y `stream_error` suma `raw` (opcional) — ninguno de los dos
  cambia la forma que ya tenían.

Ver `README-GOBERNA.md` § Eventos de desconexión para el detalle y los ejemplos de uso.

## [0.7.0-goberna.5] - 2026-09-14

### Fixed

- `GoProcess`: every `start()` is a generation that only speaks for itself. The late `exit` of a child replaced by `kill()` no longer clears the reference to the new child, rejects the new child's pending requests (its `init` failed with "exited with code null") or is reported as a crash; events still emitted by a replaced child are dropped. Measured on Hermes' VPS on 14-sep-2026: ten lines relaunched once a minute, one more orphan per line per round, 131 Go processes on the same session files.

### Added

- `client.stop()` / `GoProcess.stop()`: kill the subprocess and wait until it has really exited (SIGTERM, SIGKILL after 5 s), for callers that relaunch a session — the old process holds the session's SQLite file until it is gone.

## [0.7.0] - 2026-06-20

### Added

- `downloadMediaWithOnlyPath` method wrapping whatsmeow's `DownloadMediaWithOnlyPath`
- `fetchStickerPack` method wrapping whatsmeow's `FetchStickerPack`
- Three new receipt/retry method wrappers

### Changed

- Bump whatsmeow to `v0.0.0-20260611094716-089932318bc2`

## [0.6.0] - 2026-04-23

### Added

- `deleteMedia` method wrapping whatsmeow's `DeleteMedia`

### Changed

- Bump whatsmeow to `v0.0.0-20260416104156-3ff20cd3462a`

### Fixed

- Release watch workflow: clone upstream for diff and add AI analysis

## [0.5.3] - 2026-03-26

### Changed

- Bump whatsmeow to `v0.0.0-20260322133016-ce4daa5e5a86`
- npm homepage now points to the docs site

## [0.5.2] - 2026-03-22

### Added

- 15 example scripts bundled in the npm package (`examples/` directory) — echo bot, media send, groups, polls, stickers, presence, newsletters, and more

### Changed

- Test files (`src/__tests__/`) excluded from the published npm package to reduce install size

## [0.5.1] - 2026-03-08

### Added

- Documentation site with Docusaurus + GitHub Pages deployment
- Google Search Console verification and `llms.txt` for AI discoverability
- Google Analytics (GA4) tracking on docs site
- `robots.txt` with sitemap reference for search engine indexing
- Open Graph and Twitter Card meta tags for social previews
- Comparison guide: whatsmeow-node vs Baileys vs whatsapp-web.js vs official API

### Fixed

- Logo URL in README for npm rendering
- Release workflow: fetch main branch before checkout
- Release sync: check staged changes, not working tree
- Main npm publish made idempotent for re-runs

## [0.5.0] - 2026-03-07

### Added

- 20 new method wrappers — API coverage now **100/126** (up from 80), P1/P2/P3 backlogs cleared:
  - Connection: `resetConnection`
  - Message helpers: `generateMessageID`, `buildMessageKey`, `buildUnavailableMessageRequest`, `buildHistorySyncRequest`
  - Peer & retry: `sendPeerMessage`, `sendMediaRetryReceipt`
  - Download: `downloadMediaWithPath`
  - Bots: `getBotListV2`, `getBotProfiles`
  - App state: `fetchAppState`, `markNotDirty`
  - Crypto: `decryptComment`, `decryptPollVote`, `decryptReaction`, `decryptSecretEncryptedMessage`, `encryptComment`, `encryptPollVote`, `encryptReaction`
  - Parsing: `parseWebMessage`
- New types: `BotListInfo`, `BotProfileInfo`, `AppStatePatchName`, `NewsletterUploadResponse`
- Integration test suite: 88 tests across 14 files (bots, crypto, media, messages, groups, newsletters, etc.)
- 119 unit tests (up from 98)
- `UploadResponse` aligned with proto field naming (`URL`, `fileSHA256`, `fileEncSHA256`)
- Examples type-checked in CI via `check:examples`

### Changed

- `uploadNewsletter()` now returns `NewsletterUploadResponse` (encryption fields are `string | null`) instead of `UploadResponse` — newsletter uploads may not include E2E encryption metadata
- Integration test `commandTimeout` reduced from 30s to 15s to prevent timeout races with vitest
- 26 methods moved to intentional exclusions with documented rationale (context variants, file variants, FB/push APIs)

## [0.4.0] - 2026-03-05

### Added

- Bump whatsmeow to `0.0.0-20260305` (upstream patch, no API changes)
- E2E test suite running nightly against a real WhatsApp session
- E2E workflow cancels gracefully on session expiry instead of failing
- `run-e2e` label trigger to run E2E on PRs
- CI-enforced whatsmeow client parity checker
- Release watch workflow enriched with upstream release notes and commit summary
- New wrappers: `WaitForConnection`, `SetGroupTopic`, `GetStatusPrivacy`, `TryFetchPrivacySettings`
- Tighter `PrivacySettings` value unions
- Parity policy, priorities, and wrapper PR template
- npm and CI badges in README

## [0.3.0] - 2026-03-05

### Breaking Changes

- **`sendMessage` no longer accepts arbitrary message objects** — `MessageContent` was narrowed from `TextMessage | ExtendedTextMessage | Record<string, unknown>` to just `TextMessage | ExtendedTextMessage`. Use `sendRawMessage` for arbitrary `waE2E.Message`-shaped JSON (image, sticker, location, etc.).
- **Strict protojson parsing** — `DiscardUnknown` removed from `buildProtoMessage`. Messages with invalid or misspelled proto fields now return `ERR_INVALID_ARGS` instead of being silently accepted.

### Added

- 38 new methods: polls, communities, newsletters, privacy, blocklist, QR/link resolution, media upload, configuration
- `sendRawMessage` escape hatch via protojson (supports any `waE2E.Message` field)
- `BusinessProfile` now includes `profileOptions`, `businessHoursTimeZone`, `businessHours`
- `BusinessMessageLinkTarget` now includes `isSigned`, `verifiedLevel`
- 84 vitest tests with full mock-based coverage
- Smoke test example (`ts/examples/smoke-test.ts`)

### Changed

- Media uploads stream via `UploadReader` instead of buffering entire file in memory
- `setGroupMemberAddMode` validates input against allowed values
- Newsletter reaction counts sorted for deterministic output
- INTERNALS.md rewritten to match actual IPC commands and events

## [0.2.3] - 2026-03-05

### Added

- README and LICENSE included in all published packages

## [0.2.2] - 2026-03-05

### Fixed

- Trusted Publishing: use Node 24 for OIDC auth

## [0.2.1] - 2026-03-05

### Fixed

- Trusted Publishing configuration fixes

## [0.2.0] - 2026-03-05

### Changed

- Mirror whatsmeow API 1:1
- Dual CJS/ESM build

## [0.1.0] - 2026-03-05

First public release. TypeScript/Node.js bindings for whatsmeow via subprocess IPC.

- ~30 commands: messaging, groups, presence, newsletters, calls, media
- Typed EventEmitter with all whatsmeow events forwarded
- SQLite and PostgreSQL session storage
- Precompiled Go binaries for 7 platforms
- Generic `call()` fallback for any whatsmeow method not yet wrapped

[0.7.0]: https://github.com/nicastelo/whatsmeow-node/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/nicastelo/whatsmeow-node/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/nicastelo/whatsmeow-node/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/nicastelo/whatsmeow-node/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/nicastelo/whatsmeow-node/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/nicastelo/whatsmeow-node/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/nicastelo/whatsmeow-node/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/nicastelo/whatsmeow-node/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/nicastelo/whatsmeow-node/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/nicastelo/whatsmeow-node/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/nicastelo/whatsmeow-node/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/nicastelo/whatsmeow-node/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nicastelo/whatsmeow-node/releases/tag/v0.1.0
