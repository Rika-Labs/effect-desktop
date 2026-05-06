# @effect-desktop/core

> **Status:** Phase 2 runtime entry exists; the public API remains reserved for Phase 4+. See `docs/SPEC.md`.

## Purpose

Public framework API and runtime contracts (`Desktop.run`, `Desktop.window`, `Desktop.Api`, `Desktop.Resource`, `Desktop.Command`, `Desktop.Capability`, `Desktop.Errors`, `Desktop.Config`).

## Public API

The package exports runtime primitives as they land by phase. Phase 16 adds the
`PermissionRegistry` service to the Phase 15 `SQLite`, `Settings`, `EventLog`,
`Transport`, `WindowState`, `Secrets`, and `RedactionFilter` services/utilities
for scope-bound local storage, app-owned protocol transport, platform-backed
credential storage, and human-visible emission safety.

### SQLite

`SQLite` wraps `bun:sqlite` behind Effect values. `connect({ path, ownerScope })`
opens a database and registers the connection in `ResourceRegistry` under the
given scope. `query`, `exec`, `prepare`, and prepared statement methods all
return typed `Effect` values with `SqliteError` failures instead of throwing.

Transactions are explicit Effect programs: `connection.transaction(effect)` runs
`BEGIN`, executes the supplied Effect, commits on success, and rolls back when
the Effect fails. Connections and prepared statements close when their owning
scope closes.

SQLite error codes are mapped to typed tags: `Constraint`, `Busy`, `Locked`,
`Corrupt`, `IoError`, `InvalidArgument`, and `InvalidState`.

### Settings

`Settings` is a typed key/value store built on `SQLite`. `open` validates the
database path, owner scope, namespace, and schema version before opening the
database. `get`, `set`, `delete`, `keys`, and `update` validate values through
Effect Schema and return typed `SettingsError` values instead of throwing.

`set` is last-writer-wins. `update` runs inside a SQLite transaction, so
read-modify-write calls for the same database connection serialize. Versioned
migrations run in the same transaction as the metadata update and emit
`SettingsMigrated` events. When opening detects a corrupt database and an
explicit `backupPath` is provided, Settings replaces the corrupt file with the
backup and reopens it; backup copy failures return
`SettingsRecoveredFromBackup`.

The `changes()` stream emits `{ key, oldValue, newValue, source }` for writes,
and `migrated()` replays recent migration events for observers that subscribe
after open.

### EventLog

`EventLog` is a SQLite-backed append-only event stream for audit, replay,
debugging, and recovery. `append({ type, payload })` validates input, writes the
event in a SQLite transaction, applies the configured retention ring, publishes
to the live tail after commit, and returns the assigned monotonic event id.

`query({ from, to, type, limit })` returns events in event-id order. `subscribe`
first replays from the requested cursor, then follows committed live events
through a bounded PubSub stream. `maxEvents` bounds the stored ring by deleting
the oldest committed rows after each append.

SQLite is configured with `PRAGMA synchronous = FULL` when the log opens, so
committed appends use SQLite's durability path. Underlying `SQLITE_FULL` errors
map to `EventLogFull`; once a log is read-only, appends fail while query and
subscribe continue.

### PermissionRegistry

`PermissionRegistry` is the deny-by-default capability chokepoint for privileged
runtime operations. `declare(capability, options)` records normalized allow,
deny, approval, and revocation rules; `query(kind, actor)` returns the global and
actor-scoped declarations that apply to an actor; and
`check(capability, context)` returns a tracked `GrantedCapability` token or a
typed `PermissionDenied` value. Approval code can call
`grant(capability, context, { expiresAt, oneTime })` directly once an external
broker has approved a request. Callers execute privileged work through
`use(grant, effect)`, inspect state with `inspect(token)`, and revoke with
`revoke(token)`.

Decision order is fixed: explicit deny, revoked/expired/consumed,
approval-denied, approval, allow, then default deny. Filesystem roots authorize
descendant paths, while process commands, network hosts, secret namespaces, and
native invoke methods match explicit declared entries. When an `EventLogStore`
is supplied, every check writes a `permission decision` audit event with the
normalized capability, actor, resource, source, and trace id. Grant lifecycle
transitions write `permission lifecycle` events for grant, use, revoke, expire,
and one-time consumption. Revoked, expired, and consumed grants fail as typed
Effect values instead of thrown exceptions.

### Transport

`Transport` owns app-protocol framing helpers and substitutable runtime
connections. `frame`, `unframe`, and `unframeStream` support the existing
big-endian length-prefixed framing plus LSP-style JSON-RPC `Content-Length`
frames. Invalid inputs, oversized frames, truncated frames, closed transports,
and write failures are returned as typed `TransportError` values.

`connect({ target: "stdio" })` wraps the runtime stdio transport. Tests can use
`makeInMemoryTransportPair()` to substitute a pair of Effect-native connections
without reaching into raw host transport internals. `send`, `receive`, and
`close` are Effect values/streams, so cancellation and cleanup stay explicit.

### WindowState

`WindowState` persists per-window geometry and UI state across launches.
`persist(windowId, state)` writes the window record atomically, `restore(windowId)`
returns that one window when present, and `restoreAll()` restores every persisted
window independently. `clear(windowId)` removes one window; `clear()` removes the
full store.

Restore applies caller-provided bounds validation and display snapping. When the
stored rectangle is off every configured display, it snaps to the primary
display before returning. Corrupt state files are renamed to
`window-state.corrupt.<timestamp>.json`; the runtime continues with defaults and
emits a `corrupt-renamed` event through `observe()`.

### Secrets

`Secrets` is the app-level facade over native `SafeStorage`. It exposes
`set(namespace, key, value)`, `get(namespace, key)`, `delete(namespace, key)`,
and `list(namespace)` as Effect values. The service derives storage keys as
`appId/namespace/key`, validates namespace and key segments before touching
native storage, checks explicit `secrets.read` / `secrets.write` namespace
permissions, and maps missing keys or unavailable safe storage into typed
`SecretsError` values.

Secret bytes stay in `SecretValue`, whose string and JSON forms are redacted.
When an `EventLogStore` is supplied, each successful operation writes a
`secret accessed` audit event with namespace, key, outcome, and trace id, never
the secret value. There are no long-lived handles; cleanup is the caller's
explicit disposal of returned `SecretValue` copies.

`runSecretsMigration({ settings, secrets, audit })` moves legacy plaintext
Settings entries whose keys match the §14.10 secret pattern into the `legacy`
Secrets namespace. It verifies read-back, writes a `secret-migrated` audit event
without the value, deletes the plaintext row, and writes
`migration.secrets.v1.complete` only after the full pass succeeds. Failures
return `SecretsMigrationFailed` with the key and phase so startup can retry
idempotently on the next launch.

### RedactionFilter

`RedactionFilter.redact(record)` walks structured data and replaces values for
field names matching the §14.10 secret pattern with `"[REDACTED]"`. The filter
preserves object shape, supports additional patterns and explicit allowlist
paths, and returns the original object when no field changes. Bridge error
emission and CrashReporter breadcrumb details use the same filter before values
reach renderer-visible or crash-report surfaces.

## Runtime entry

```bash
bun src/runtime/main.ts
```

The runtime entry emits exactly one newline-terminated JSON ready event to stdout:

```json
{ "event": "runtime.ready", "version": "0.0.0" }
```

After the ready line, the runtime uses the framed stdio transport to call the
required `host.version` and `host.ping` handshake methods, then calls
`Window.create`. When `EFFECT_DESKTOP_WINDOW_SMOKE_TEST=1`, it also calls
`Window.destroy` for the returned `WindowId` before exiting.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { Effect } from "effect"
import { ResourceRegistryLive, SQLite, SQLiteLive } from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const sqlite = yield* SQLite
  const connection = yield* sqlite.connect({ path: ":memory:", ownerScope: "window-main" })
  yield* connection.exec("CREATE TABLE users (name TEXT UNIQUE)")
  yield* connection.transaction(connection.exec("INSERT INTO users (name) VALUES (?)", ["Ada"]))
  return yield* connection.query("SELECT name FROM users")
})

await Effect.runPromise(
  program.pipe(Effect.provide(SQLiteLive), Effect.provide(ResourceRegistryLive))
)
```

```ts
import { Effect, Schema } from "effect"
import { ResourceRegistryLive, makeSettings, SQLite, SQLiteLive } from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const sqlite = yield* SQLite
  const settings = yield* makeSettings(sqlite)
  const store = yield* settings.open({
    path: "settings.sqlite",
    ownerScope: "window-main",
    schemaVersion: 1
  })
  yield* store.set("user.name", Schema.String, "alice")
  return yield* store.getOrDefault("user.name", Schema.String, "anonymous")
})

await Effect.runPromise(
  program.pipe(Effect.provide(SQLiteLive), Effect.provide(ResourceRegistryLive))
)
```

```ts
import { Effect } from "effect"
import { makeEventLog, ResourceRegistryLive, SQLite, SQLiteLive } from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const sqlite = yield* SQLite
  const eventLog = yield* makeEventLog(sqlite)
  const log = yield* eventLog.open({
    path: "events.sqlite",
    ownerScope: "window-main",
    maxEvents: 10_000
  })
  const id = yield* log.append({ type: "user.created", payload: { name: "alice" } })
  return yield* log.query({ from: id })
})

await Effect.runPromise(
  program.pipe(Effect.provide(SQLiteLive), Effect.provide(ResourceRegistryLive))
)
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

SQLite uses Bun's built-in `bun:sqlite` binding and is available when the core
package runs under Bun.

## Dependency notes

- `@effect-desktop/bridge` owns the shared host-protocol schemas plus the
  handshake and window client wrappers used by the runtime entry.
- `effect@4.0.0-beta.60` owns the Effect v4 runtime used to execute those
  handshake wrappers. The version matches the bridge package and the repo's
  Effect v4 baseline.

## Internal architecture

To be documented as the package is built out.
