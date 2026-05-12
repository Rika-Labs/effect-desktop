# Issue #1229: Introduce the Desktop runtime layer graph

## Current state

`Desktop.toLayer(definition)` and `Desktop.app(config)` already assemble a useful runtime spine, but the provider graph is implicit:

- core services are merged inside `packages/core/src/runtime/desktop-app.ts`;
- Bun platform services are hardcoded through `BunServicesLayer`;
- provider choice is not data-driven;
- tests can build the layer, but they cannot inspect which provider graph was selected without launching or building internals;
- the `DesktopAppDefinition` builder DSL remains in place, but #1278 already tracks removing that larger custom layer-composition DSL.

The narrow fix for this ticket is to make the runtime graph explicit and inspectable while preserving existing app definitions.

## Architecture

Add a `DesktopRuntime` service in `packages/core/src/runtime/desktop-app.ts` that owns runtime composition metadata:

- selected provider ids;
- graph nodes describing selected providers, core services, user layers, RPC handler layers, workflows, and the app service;
- the frozen `DesktopConfig` values needed by adapters.

Add `Desktop.runtime(config)` / `DesktopRuntimeLive(config)` as the explicit composition root. It should use `Layer.unwrap` for provider selection, then merge provider layers, core layers, workflow layers, RPC server bindings, user layers, `DesktopApp`, and `DesktopRuntime`.

Keep `Desktop.app(config)` and `Desktop.toLayer(definition)` as entry points that delegate to the explicit runtime graph. Do not widen this issue into removing `Desktop.make(...).pipe(Desktop.provide(...))`; that is the separate #1278 follow-up.

Provider selection should be data, not app code branching. Start with the provider ids this repo can support locally:

- `runtime: "bun"` for the current Bun platform layer;
- `runtime: "test"` for tests and graph inspection with deterministic no-op platform services.

Unknown provider ids should fail as typed `DesktopConfigError` failures from both `Desktop.runtime(config)` and `Desktop.runtimeGraph(config)`.

## Files

- `packages/core/src/runtime/desktop-app.ts`
  - Add provider selection types, graph types, `DesktopRuntime` service, Effect-returning `runtimeGraph`, `DesktopRuntimeLive`, and provider selection via `Layer.unwrap`.
  - Refactor `app` to delegate to `DesktopRuntimeLive`.
- `packages/core/src/index.ts`
  - Export the new runtime graph/service APIs through the root and `Desktop` facade.
- `packages/core/src/index.test.ts`
  - Add tests for two provider graphs, unknown provider failure, and graph inspection without host launch.
- `api/snapshots/@effect-desktop__core.snapshot.json`
  - Update API snapshot after exports change.
- `docs/roadmap/layer-first-issue-order.md`
  - Mark #1229 implemented.
- `docs/learnings/2026-05-12-desktop-runtime-layer-graph.md`
  - Capture what changed and what remains.

## Tests

Add focused tests before broad checks:

1. The same provider-backed user program can run under `Desktop.runtime({ providers: { runtime: "bun" } })` and `Desktop.runtime({ providers: { runtime: "test" } })` without changing program code.
2. A configured user layer that requires provider services builds under the selected runtime provider.
3. `Desktop.runtimeGraph(config)` returns inspectable nodes for runtime provider, core services, user layers, RPC layers, workflows, and `DesktopApp` without launching a host.
4. Unknown runtime provider selection fails with `DesktopConfigError` and `reason: "missing-provider"` from both runtime acquisition and graph inspection.
5. Existing `Desktop.toLayer` RPC binding tests still pass.

## Thin wrappers / follow-ups

Remove now:

- The implicit hardcoded Bun provider path inside runtime composition. It should become an explicit provider selected by graph data.

Keep as tracked follow-up:

- #1278 removes the custom `DesktopAppDefinition` builder DSL. This issue should not rework public app authoring unless it becomes necessary for the runtime graph.
- #1280 removes zero-policy Effect re-export wrappers; avoid adding new ones here.
