# @effect-desktop/core

> **Status:** Phase 2 runtime entry exists; the public API remains reserved for Phase 4+. See `engineering/SPEC.md`.

## Purpose

Public framework API and runtime contracts (`Desktop.run`, `Desktop.window`, `Desktop.Api`, `Desktop.Resource`, `Desktop.Command`, `Desktop.Capability`, `Desktop.Errors`, `Desktop.Config`).

## Public API

The package exports runtime primitives as they land by phase. Phase 16 adds the
`PermissionRegistry`, `ApprovalBroker`, and `AuditEvents` services to the Phase
15 `SqlClientLive`, `Settings`, `Transport`, `WindowState`, `Secrets`, and
`RedactionFilter` services/utilities for scope-bound local storage, app-owned
protocol transport, platform-backed credential storage, and human-visible
emission safety.

### Desktop RPC surfaces

`Desktop.Rpc.surface(name, group, options)` packages one Effect `RpcGroup` into the Layer-first artifacts needed by a framework capability: server layer, generated client layer, deterministic test client layer, schema docs, and contract-law checks.

The `RpcGroup` remains the source of truth for endpoint tags, schemas, endpoint kind metadata, capability metadata, and support metadata. Use the direct surface shape when the public service is the generated `DesktopRpcClient<Rpcs>`. Use the mapped shape when a capability already owns a durable service API and needs to hide generated RPC calls behind it.

`Desktop.Rpc.supportedGroup(group)` filters a descriptor group to RPCs annotated as supported. Unsupported RPCs remain available to schema docs and descriptors, but they are absent from `SupportedDesktopRpcClient<Rpcs>`.

`packages/native/src/screen.ts` is the current full surface proof. `packages/native/src/window.ts` is the supported-client proof: `WindowRpcs` keeps the full descriptor surface, while `WindowSupportedRpcs` generates only the callable `create` and `close` client methods.

### SQLite

SQLite uses Effect SQL directly. `SqlClientLive({ filename, ownerScope })`
validates the desktop boundary, checks `sqlite.open` for file-backed databases,
registers a scoped `sqlite` resource, and then delegates query execution,
transactions, prepared statements, and driver errors to
`@effect/sql-sqlite-bun`.

Application code should depend on `SqlClient` and `SqlModel`, not on a local
connection wrapper. Use `sql.withTransaction(effect)` for transactions and
`SqlModel.makeRepository` for typed table access.

### Settings

`Settings` is a typed key/value store built on Effect `KeyValueStore`. `open`
validates the database path, owner scope, namespace, and schema version before
opening the store. `get`, `set`, `delete`, `keys`, and `update` validate values
through Effect Schema and return typed `SettingsError` values instead of
throwing.

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

Effect Desktop keeps the raw `effect/unstable/eventlog` primitive as the
advanced dependency and exposes `@effect-desktop/core/runtime/event-log` for
desktop policy. `DesktopEventLog` owns the closed desktop operation event
schema, redaction before append, bounded query results, identity setup, and
Inspector emission for append, query, recovery, and read-only transitions.

### AuditEvents

`AuditEvents` is the typed audit surface for permission-relevant runtime
transitions. `emit(event)` writes closed `audit/<kind>` rows through the Effect
`EventLog` service after running the shared redaction filter, so secret-shaped
fields in structured details are replaced before persistence.

Permission and approval services emit structured audit rows for grants, denials,
revocations, expiry, one-time consumption, use, approval requests, approval
grants, and approval denials. Each row carries source, trace id, outcome, and
the owning actor/resource/capability fields available to the emitting service.

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
native invoke methods match explicit declared entries. When an `AuditEventsApi`
is supplied, every check writes a structured audit row with the normalized
capability, actor, resource, source, and trace id. Grant lifecycle transitions
write typed audit rows for grant, use, revoke, expire, and one-time consumption.
Revoked, expired, and consumed grants fail as typed Effect values instead of
thrown exceptions.

`listDecisions()` and `observeDecisions()` expose the registry-owned permission
decision history for devtools. This keeps denial reasons and remediation hints
anchored to the permission source of truth instead of a panel-side cache.

### Process

`Process` is the runtime primitive for spawned child processes. It validates
spawn inputs, enforces the process permission policy before adapter activity,
registers each child as a scoped `ResourceRegistry` handle, bounds stdout and
stderr streams, and terminates process trees during resource cleanup.

`list()` and `observe()` expose devtools snapshots with pid, command, args,
owner scope, child pids, state, and last exit. Spawn, kill, stdout, stderr,
stdin, and exit failures remain typed `HostProtocolError` values on the
operation that produced them; the snapshot stream is read-only runtime state.

### Telemetry

`Telemetry` owns the runtime diagnostic stream for structured logs, trace spans,
and metric snapshots. Logs are redacted before storage and include the required
level, timestamp, subsystem, operation, trace id, optional resource/window ids,
message, and safe structured fields. Trace spans are stored in a bounded ring
with `traceRingSize` defaulting to 10,000 and can be explicitly disabled, which
leaves the trace panel empty without pretending tracing succeeded. Counters and
histograms are aggregated by name and tags, with `maxMetrics` bounding the
snapshot map for high-cardinality callers. Histograms retain bounded samples and
publish p50, p95, and p99 for performance overlays.

`snapshot()`, `listLogs()`, `listTraces()`, `listMetrics()`, and the matching
`observe*()` streams keep devtools and tests attached to the telemetry owner
instead of a panel-side cache. Invalid buffer sizes fail construction as typed
`InvalidArgument` values.

### Worker

`Worker` is the runtime primitive for isolated background TypeScript work. It
spawns Bun workers through a substitutable adapter, validates every outbound and
inbound channel message with Effect Schema, and registers each worker as a
scope-bound `ResourceRegistry` handle.

`spawn({ script, ownerScope, inputSchema, outputSchema, context, capabilities })`
checks every declared capability against `PermissionRegistry` before touching
the adapter. Missing authority returns `CapabilityNotHeld`; malformed sends and
outputs return `ChannelError`; worker close/crash signals surface as
`WorkerCrashed` on the message stream. Closing the owning scope shuts down the
worker and releases the per-scope concurrency budget.

`list()` returns read-only live worker snapshots for devtools with worker id,
script, owner scope, resource id, status, uptime, declared capabilities, and
last error when available. The worker service remains the source of truth;
devtools only projects these snapshots.

### Job

`Job` is the runtime primitive for long-running cancelable Effect work. It
starts the supplied Effect in a managed fiber, registers a running `job`
resource, exposes a replayable typed progress stream, and returns a handle with
`result`, `status`, and `cancel` effects.

`run({ effect, ownerScope, progress, progressSchema, timeoutMs, retry })`
validates inputs before registration. Cancellation interrupts the job fiber and
returns `Canceled` through the result channel; timeout interrupts the effect and
returns `JobTimedOut`; ordinary failures are wrapped as `JobFailed` with the job
and resource ids, attempt count, and last typed failure when available. Progress
payloads are decoded through Effect Schema and redacted before replay or
devtools-facing snapshots.

Retry is explicit per job through `CrashRetryPolicy`. The exported
`exponentialJittered`, `fixed`, and `oncePerMinute` constructors wrap Effect
`Schedule` values with a max retry ceiling, optional max total duration, and a
recoverability predicate.
Recoverable failures emit redacted `JobRetrying` progress events and
`audit/job-retrying` rows before sleeping for the scheduled delay and rerunning
the effect. Non-recoverable failures such as `PermissionDenied` and
`CapabilityNotHeld` bypass retry.

### ApprovalBroker

`ApprovalBroker` owns runtime approval coalescing and prompt-fatigue controls.
`ask(request)` validates an `ApprovalRequest`, emits an `approval requested`
audit event, coalesces identical `(operation, actor, resource)` requests, and
routes the visible prompt through an explicit `ApprovalPromptPort`. The port is
the host-rendered UI seam; renderer code never receives an API for constructing
authoritative approval prompts.

Each actor has at most one visible prompt. Distinct requests queue behind it up
to `maxQueueDepthPerActor` (default 8); the ninth distinct queued request fails
as `QueueOverflow`. `denied-for-scope` outcomes are cached for the same
operation, actor, and resource, so future identical requests return the denial
without re-prompting. `devApproveAll` grants once without touching the host port
and emits the same audit path, making the bypass explicit and reviewable.

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

Secret bytes stay in Effect `Redacted.Redacted<Uint8Array>` values whose string
and JSON forms are redacted. When an `AuditEventsApi` is supplied, each
successful operation writes a `secret accessed` audit event with namespace, key,
outcome, and trace id, never the secret value. There are no long-lived handles;
callers can wipe returned byte values with `wipeSecretBytes`.

### RedactionFilter

`RedactionFilter.redact(record)` walks structured data and replaces values for
field names matching the §14.10 secret pattern with an Effect `Redacted` value.
The filter preserves object shape, supports additional patterns and explicit
allowlist paths, and returns the original object when no field changes. Bridge
error emission and CrashReporter breadcrumb details materialize redacted leaves
to strings before values reach renderer-visible or crash-report protocol
surfaces.

## Runtime entry

```bash
bun src/runtime/main.ts
```

The runtime entry emits exactly one newline-terminated JSON ready event to stdout:

```json
{ "event": "runtime.ready", "version": "0.0.0" }
```

Startup windows must be declared through `EFFECT_DESKTOP_APP_MODULE` or
`EFFECT_DESKTOP_STARTUP_WINDOWS`. Launch fails before host negotiation when no
startup window is declared; the runtime does not synthesize a default window.

After the ready line and startup-window validation, the runtime uses the framed
stdio transport to call the required `host.version` and `host.ping` handshake
methods, then calls `Window.create` for each declared window. When
`EFFECT_DESKTOP_WINDOW_SMOKE_TEST` is an Effect Config boolean true value such
as `1`, `true`, `yes`, or `on`, it also calls `Window.destroy` for each returned
`WindowId` before exiting.

## Non-goals

See `engineering/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { Effect, Layer } from "effect"
import {
  PermissionRegistry,
  ResourceRegistryLive,
  SqlClient,
  SqlClientLive,
  makePermissionRegistry
} from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`CREATE TABLE users (name TEXT UNIQUE)`
  yield* sql.withTransaction(sql`INSERT INTO users (name) VALUES (${"Ada"})`)
  return yield* sql`SELECT name FROM users`
})

const PermissionRegistryLive = Layer.effect(PermissionRegistry)(makePermissionRegistry())
const SqliteLive = SqlClientLive({ filename: ":memory:", ownerScope: "window-main" })

await Effect.runPromise(
  program.pipe(
    Effect.provide(SqliteLive),
    Effect.provide(PermissionRegistryLive),
    Effect.provide(ResourceRegistryLive),
    Effect.scoped
  )
)
```

```ts
import { realpath } from "node:fs/promises"

import { Effect, Layer, Schema } from "effect"
import {
  PermissionRegistry,
  ResourceRegistryLive,
  Settings,
  makePermissionRegistry,
  makeSettingsLayer
} from "@effect-desktop/core"

const settingsPath = "settings.sqlite"

const program = Effect.gen(function* () {
  const settings = yield* Settings
  const store = yield* settings.open({
    path: settingsPath,
    ownerScope: "window-main",
    schemaVersion: 1
  })
  yield* store.set("user.name", Schema.String, "alice")
  return yield* store.getOrDefault("user.name", Schema.String, "anonymous")
})

const PermissionRegistryLive = Layer.unwrap(
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    const root = yield* Effect.tryPromise(() => realpath(".")).pipe(Effect.orDie)
    yield* permissions.declare({ kind: "sqlite.open", roots: [root], audit: "always" })
    return Layer.succeed(PermissionRegistry, permissions)
  })
)

await Effect.runPromise(
  program.pipe(
    Effect.provide(makeSettingsLayer(settingsPath, "window-main")),
    Effect.provide(PermissionRegistryLive),
    Effect.provide(ResourceRegistryLive),
    Effect.scoped
  )
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
