# @orika/test

> **Status:** Active headless harness, deterministic test layers, and memory
> service substitutes. See `engineering/SPEC.md`.

## Purpose

Test harness and mock layers: mock host, mock bridge, memory filesystem, mock
permissions, mock process, mock PTY, headless runtime, and memory secrets.

## Public API

The root `@orika/test` export remains the aggregate compatibility
surface. New tests should prefer explicit fixture-family subpaths:
`@orika/test/core`, `@orika/test/bridge`,
`@orika/test/native`, and `@orika/test/renderer`.

`MockHostLive(options)` provides `MockHost`, an in-process host-protocol
substitute that accepts real host-protocol request envelopes, preserves trace
IDs on responses, records calls, and maintains an in-memory window registry for
`Window.create` / `Window.destroy`.

`makeMockBridge(options)` returns a contract-aware `BridgeClientExchange` fake for
typed bridge clients. Tests pin success, failure, and stream responses by full
contract method name while the fake records method, payload, trace id, and
timestamp for assertions.

`MemoryFilesystem.layer(options)` provides the core `Filesystem` service backed
by an in-memory tree. It supports reads, writes, atomic replacement, stats,
removal, watcher streams, permissions, and symlink fixtures through the same
core service policy used by the live filesystem.

`MockProcess.layer(options)` and `MockPTY.layer(options)` provide the core
`Process` and `PTY` services with deterministic in-memory children. The mocks
record stdin, writes, resizes, kills, tree cleanup calls, output chunks, and
exit statuses while keeping validation, permissions, budgets, typed errors, and
resource cleanup in the production core service path.

`HeadlessRuntime.layer(options)` composes `MockHost`, `MockBridge`,
`MemoryFilesystem`, `MockProcess`, `MockPTY`, and the real `ResourceRegistry`,
`Telemetry`, and `PermissionRegistry` services into one CI-safe layer.
`HeadlessRuntime.run(effect, options)` provides the same layer and runs leak
detection as a typed failure by default; pass `leakDetection: false` to disable
that final check.

`ScreenTest(options)`, `ClipboardTest()`, and `DialogTest(options)` are the
current Layer-first contract proof for native services. The same service program
runs through the capability `Live` layer with a direct client, the `Live` layer
with an RPC client layer, and the deterministic test layer.

`TestWindow.layer()` provides the supported Window service surface for tests.
`makeTestWindowClient()` records `Window.create` and `Window.close` calls and
tracks open handles. Unsupported descriptor-only Window methods are intentionally
absent from the test client so tests cannot depend on methods the generated
runtime client cannot call.

`runHeadless(body, options)` runs host-protocol clients against `MockHost` and
fails with a typed `ResourceLeakError` if non-app resources remain open.

`assertNoOpenResourcesIn(registry, options)` and
`installResourceLeakDetection(registry, options)` provide leak checks for tests
that own a `ResourceRegistry`.

`makeMemorySecretsSafeStorage(options)` returns a substitutable
`SecretsSafeStorageApi` for `@orika/core` `Secrets` tests. It stores
copied bytes in memory, returns typed not-found failures, can model unavailable
platform storage, and exposes `snapshot()` for assertions without leaking
mutable internal state.

## Non-goals

See `engineering/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { Effect } from "effect"

import { makeSecretBytesFromUtf8, makeSecrets } from "@orika/core"
import { makeMemorySecretsSafeStorage } from "@orika/test"

const program = Effect.gen(function* () {
  const secrets = yield* makeSecrets(makeMemorySecretsSafeStorage(), {
    appId: "com.example.app",
    permissions: { read: ["auth"], write: ["auth"] }
  })

  yield* secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
  return yield* secrets.get("auth", "token")
})
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

CI-safe by default. Mock layers run in-process and avoid OS prompts or native
hosts unless a test explicitly opts into a live adapter.

## Internal architecture

Test substitutes depend on public package contracts. Runtime packages do not
depend on `@orika/test`.
