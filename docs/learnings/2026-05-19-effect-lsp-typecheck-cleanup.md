# Effect-LSP typecheck cleanup sweep

Date: 2026-05-19
Branch: `fix-pr-1254-lockfile`

## What this was

The branch had accumulated ~3,120 `@effect/language-service` diagnostics that the
project `tsconfig` promotes to errors. This sweep drove the workspace typecheck
from ~3,120 down to 3 residuals (a 99.9% reduction), with no `@effect-diagnostics`
suppression directives anywhere. Workspace lint and format are fully clean.

## What actually shipped

- **Test files** converted en masse to the `Effect.gen` + `runScoped` idiom: a
  `ManagedRuntime.make(layer)` helper that runs through `runPromiseExit` and
  `dispose()`, preserving `Exit` across the test boundary. Tagged errors via
  `Schema.TaggedErrorClass`, `Effect.forkChild` for child fibers,
  `Schema.fromJsonString` for JSON fixtures, module-scoped monotonic counters in
  place of `crypto.randomUUID`.
- **Service keys** promoted to the fully-qualified
  `@effect-desktop/core/<module-path>/<ServiceName>` form the `deterministicKeys`
  rule expects. Tag identity is by class reference, so this is metadata-only.
- **Native-Error subclasses** in `transport.ts` (`FrameTooLargeError`,
  `FrameTruncatedError`, `InvalidFrameLimitError`, `JsonRpcFrame*`) converted to
  `Data.TaggedError`; `frame`/`unframe`/`connect` lifted to module-scoped
  `Effect.fn`.
- **node:fs / node:path** migrated to the Effect `FileSystem` / `Path` services
  in `sqlite.ts`, `filesystem.ts`, `workflows/backup.ts`, `workflows/restore.ts`,
  and the matching test layers wired `BunServices.layer` / `BunPath.layer`.
- **Unknown channels** tightened: dynamic RPC client failures absorbed once at
  the boundary via tagged `RendererRpcError` / `RpcInvokerFailure`;
  `StoredCommand.invoke` narrowed; `DesktopWindowRegistration` constrained to
  `SupervisedWindowDeps`; `bindRegistration` made generic so per-registration
  `E`/`R` survive instead of widening to `unknown`.
- **Layer ordering**: `DesktopApp` / `DesktopRuntime` pulled out of the parallel
  `Layer.mergeAll` into a `Layer.provideMerge` so the `layerMergeAllWithDependencies`
  invariant holds.
- **Nullable returns** replaced with `Option` in `filesystem.ts` and
  `event-log.ts` (`effectSucceedWithVoid`).

## The non-obvious lesson

`@effect/language-service` is not a style linter — most of its rules surface a
real correctness fact the code was hiding:

- `anyUnknownInErrorContext` almost always means a typed failure was being
  widened to `unknown` at some boundary. The fix is a tagged error wrapped in
  exactly one `Effect.mapError` / `Stream.mapError` at that boundary, not a cast.
- `unsafeEffectTypeAssertion` flags an `as` that narrows error/requirement
  channels. Each one hid a genuine declared-vs-actual mismatch — e.g. a layer
  declared `Layer<never, ConfigError, never>` while actually providing many more
  services. Removing the cast forces the upstream declaration to tell the truth.
- `layerMergeAllWithDependencies` is a real bug class: `Layer.mergeAll` builds
  in parallel, so a layer that _requires_ a service another member _provides_
  will not see it.

Running a global `oxfmt .` on this repo can invoke an autofix layer that leaves
unrelated files in a broken state. Always format specific files
(`oxfmt <files>`), never the repo root, when other work is in flight.

## Documented residuals (3)

### 2× `unsafeEffectTypeAssertion` in `desktop-app.ts`

Both are TypeScript type-system limitations — TS cannot reduce a conditional type
applied to a still-generic type parameter. No code change clears them; the only
escape is a cast, asserted once with an inline comment.

`runtime()` (~line 836): `buildSpine` genuinely provides a superset of
`DesktopRuntimeServices` and requires a subset of
`Exclude<RIn, DesktopRuntimeProviderServices | ResourceOwner>`, but its inferred
requirement is the nested `Exclude<Exclude<RIn, …>, …>` that TS will not reduce
against a generic `RIn`. The `dependentLayer` / `runtimeBase` casts that used to
sit alongside this one were genuinely eliminated: dropping the `Layer<never, …>`
annotation on `coreServicesLayer` exposed its real provided services, and
`Layer.orDie` on the config-error-bearing layers (a malformed startup config is
unrecoverable) made the error channel resolve honestly.

`bindRpcGroup` (~1367): `Layer.provide(RpcServer.layer(group.middleware(
PermissionInterceptor)), handlers)` needs `Rpc.ToHandler<AddMiddleware<Rpcs,
PermissionInterceptor>>`, while `handlers` provides `Rpc.ToHandler<Rpcs>`.
`AddMiddleware` adds no RPCs so the handler sets are identical, but TS cannot
reduce `AddMiddleware<Rpcs, X>` while `Rpcs` is generic. `RpcServer.Protocol`
is also genuinely supplied by the bridge package at integration time.

### 1× `globalTimers` in `process.test.ts`

`makeFakeChild` drives its simulated natural-exit with `setTimeout(...).unref()`.
The `.unref()` is deliberate — it lets the fake child stop holding the event loop
open exactly like a real OS process. Rewriting it as a forked `Effect.sleep`
fiber regressed 7 process tests because microtask vs macrotask scheduling shifts
the observed exit ordering. The raw timer is the correct primitive for an
OS-process simulation fixture.

## Verification-gate note

`cargo test --workspace` has 9 failing `runtime::tests::*` integration tests
(subprocess framed-IO round-trip, e.g.
`child_runtime_round_trips_ping_and_version_after_ready_for_bun_and_node`). These
fail **identically on `origin/main`** — verified via a clean `git worktree` of
`origin/main` — so they are a pre-existing environmental limitation (the spawned
bun/node child does not complete the framed handshake within the 5s
`EVENT_TIMEOUT` in this sandbox), not a regression introduced by this branch.
The runtime supervisor code under `crates/host/src/runtime/` is unchanged on the
branch.
