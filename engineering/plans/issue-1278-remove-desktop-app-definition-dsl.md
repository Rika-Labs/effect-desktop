# Issue #1278: Remove the custom DesktopAppDefinition builder DSL

> **Note:** the `Desktop.Rpcs.layer(...)` mechanism this plan refers to was
> superseded in PR #1306. Today the registration shape is
> `Desktop.rpc(group, handlers)` returning `Layer<DesktopRpcRegistry, ...>`,
> composed via `Layer.mergeAll(...)`. The metadata-pairing rationale below
> still holds — the framework still pairs `RpcGroup` with handlers — but the
> mechanism is now a self-registering Layer instead of a `(group, layer)` pair.
> See ADR-0022's "Amendments" section for the new shape.

## Problem

`Desktop.make(...).pipe(Desktop.provide(...))` is a second app-composition model beside Effect `Layer`. It stores user layers and RPC handler layers in a custom object, reimplements `pipe`, and requires `Desktop.toLayer` to lower that object back into the runtime. The durable desktop semantics are the app id, startup windows, permissions, workflows, and RPC manifest extraction; the custom builder mechanics are debt.

## Target Shape

Use `Desktop.make(config)` as a frozen desktop metadata descriptor and `Desktop.app(App)` / `Desktop.runtime(App)` as the canonical runtime `Layer` surface. App authors compose ordinary Effect layers with normal `Layer` operators before attaching RPC handlers, or around `Desktop.app(App)` when providing external services:

```ts
const NotesLayer = NotesRpcs.toLayer({
  "Notes.List": () => Effect.succeed([])
})

const NotesRpcsLive = NotesRpcs.toLayer({
  "Notes.List": () => Effect.succeed([])
}).pipe(Layer.provide(UserLayer))

export const NotesApp = Desktop.make({
  id: "notes",
  windows: {
    main: { title: "Notes", renderer: "/" }
  },
  rpcs: Desktop.rpc(NotesRpcs, NotesRpcsLive) // amended by PR #1306; was Desktop.Rpcs.layer in the array form.
})

export const MainLayer = Desktop.app(NotesApp)
```

`Desktop.Rpcs.layer(...)` remains because it owns desktop-specific metadata pairing: it keeps the `RpcGroup` available for manifests, endpoint descriptors, duplicate detection, and runtime permission wiring while the handler implementation remains a normal Effect RPC layer.

## Implementation Plan

1. Replace `DesktopAppDefinition` with `DesktopAppDescriptor`: metadata only, no custom `pipe`, no arbitrary `layers`, no stored parallel Layer array.
2. Remove `Desktop.provide` and `Desktop.toLayer`; use `Desktop.app(App)` for runtime lowering.
3. Make `Desktop.manifest(...)` and `Desktop.describeRpcs(...)` read descriptor `rpcs` directly.
4. Keep `Desktop.make(...)`, `Desktop.app(...)`, `Desktop.runtime(...)`, `Desktop.runtimeGraph(...)`, `Desktop.launch(layer)`, and `Desktop.Rpcs.layer(...)`.
5. Update package root exports and API snapshots to remove deleted prerelease DSL symbols.
6. Migrate core tests, React/Vue/Solid/Astro/Next tests, examples, templates, and docs from `Desktop.make(...).pipe(Desktop.provide(...))` and `Desktop.toLayer(...)` to `Desktop.make({ ... rpcs })` and `Desktop.app(App)`.
7. Update error messages that tell users to provide RPCs through the old DSL.

## Architecture-Debt Sweep

Remove the parallel builder DSL in the touched area. While migrating, look for additional thin wrappers over Effect `Layer` or Effect RPC. If a wrapper only renames or mirrors Effect behavior, remove it in this issue. If removal is larger than the ticket, open a follow-up with before/after and record it in the roadmap.

## Verification

- Focused tests for `packages/core/src/index.test.ts` and framework adapter tests.
- API snapshot check/write.
- Full local gates before push: `bun run typecheck`, `bun run lint`, `bun run lint:types`, `bun run format:check`, `bun run check`, `bun packages/cli/src/bin.ts check --api`, `bun run build`, `bun test`, `cargo fmt --check`, `cargo check --workspace`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, and `git diff --check`.
