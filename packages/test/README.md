# @effect-desktop/test

> **Status:** Phase 3.5 headless harness is available. Phase 15 adds a memory
> Secrets safe-storage adapter. See `docs/SPEC.md`.

## Purpose

Test harness and mock layers: mock host, mock bridge, memory filesystem, mock
permissions, mock process, mock PTY, headless runtime, and memory secrets.

## Public API

`MockHostLive(options)` provides `MockHost`, an in-process host-protocol
substitute that accepts real host-protocol request envelopes, preserves trace
IDs on responses, records calls, and maintains an in-memory window registry for
`Window.create` / `Window.destroy`.

`makeMockBridge(options)` returns a contract-aware `ApiClientExchange` fake for
typed bridge clients. Tests pin success, failure, and stream responses by full
contract method name while the fake records method, payload, trace id, and
timestamp for assertions.

`MemoryFilesystem.layer(options)` provides the core `Filesystem` service backed
by an in-memory tree. It supports reads, writes, atomic replacement, stats,
removal, watcher streams, permissions, and symlink fixtures through the same
core service policy used by the live filesystem.

`runHeadless(body, options)` runs host-protocol clients against `MockHost` and
fails with a typed `ResourceLeakError` if non-app resources remain open.

`assertNoOpenResourcesIn(registry, options)` and
`installResourceLeakDetection(registry, options)` provide leak checks for tests
that own a `ResourceRegistry`.

`makeMemorySecretsSafeStorage(options)` returns a substitutable
`SecretsSafeStorageApi` for `@effect-desktop/core` `Secrets` tests. It stores
copied bytes in memory, returns typed not-found failures, can model unavailable
platform storage, and exposes `snapshot()` for assertions without leaking
mutable internal state.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { Effect } from "effect"

import { SecretValue, makeSecrets } from "@effect-desktop/core"
import { makeMemorySecretsSafeStorage } from "@effect-desktop/test"

const program = Effect.gen(function* () {
  const secrets = yield* makeSecrets(makeMemorySecretsSafeStorage(), {
    appId: "com.example.app",
    permissions: { read: ["auth"], write: ["auth"] }
  })

  yield* secrets.set("auth", "token", SecretValue.fromUtf8("refresh-token"))
  return yield* secrets.get("auth", "token")
})
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

None until the package implements native-touching primitives.

## Internal architecture

Test substitutes depend on public package contracts. Runtime packages do not
depend on `@effect-desktop/test`.
