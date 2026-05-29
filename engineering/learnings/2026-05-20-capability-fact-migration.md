# Capability-fact migration: closing the unsupported-path gate

Date: 2026-05-20
Branch: `fix-pr-1254-lockfile`

## What this was

The branch advertised 62 native methods across 18 surfaces as **callable RPCs**
whose Rust host returned typed `Unsupported`. `GOAL.md`'s unsupported-path gate
forbids that: "No public callable method remains `unsupported`. Any intentionally
unavailable platform behavior is represented as a non-callable capability fact,
not a public method that fails at runtime."

## The blocker, and the primitive that unblocked it

The codebase had no way to express a capability that is _known_ but _not callable_.
`makeNativeCapabilityManifest` builds facts only from `surface.schemaDocs`, and
`schemaDocs` were derived purely from RPC-group membership — removing an RPC also
erased its capability record.

The fix was one deep, narrow primitive (`packages/core/src/runtime/desktop-rpc-surface.ts`):

- `DesktopRpcSchemaDoc` gained a `callable: boolean` discriminator; `payload` /
  `success` / `error` became `Option` (a fact has no schemas).
- `surface()` accepts an optional `capabilityFacts` input — `{ tag, capability,
support }` records that synthesize a _non-callable_ schemaDoc, flowing through
  the existing manifest / parity-matrix / permission pipeline without ever
  joining a callable `RpcGroup`.
- `NativeSurface.capabilityFact(surface, method, { authority, support })` is the
  native ergonomic builder, reusing the same authority→capability mapping as
  `NativeSurface.rpc`.
- The parity matrix gained a `capability-fact` host status — facts are neither
  `routed` nor `missing`, so the gate's `missing: 0` invariant holds.

## What shipped

All 62 unsupported methods across 18 surfaces demoted from callable RPCs to
capability facts: Download, BrowsingData, CookieStore, GlobalShortcut,
ContextMenu, ExecutionSandbox, NetworkAuth, ScopedAccessGrant, SessionPermission,
NativeNetwork, SelectionContext, SessionProfile, TransientWindowRole, WebRequest,
FocusedApplicationContext, Dock, Menu, WebView. Parity matrix `routed` fell
291 → 229; `unsupported` is still 62 but every one is now a `capability-fact`
row, **zero are callable**. The unsupported-path gate is closed.

## The non-obvious lessons

1. **A demotion is not a deletion.** Each surface's stateful service plumbing
   (Ref maps, permission checks, audit ordering, memory clients) collapsed to
   just the remaining callable methods — often a 5–10× line reduction. The
   capability _fact_ is retained so discovery and the parity matrix stay honest;
   only the _callable path_ is removed.

2. **Wire constants are load-bearing for a coverage test.** Each demoted method
   left a `pub const *_METHOD` in `crates/host-protocol/src/lib.rs`. The Rust
   test `host_dispatch_registry_covers_host_protocol_methods` parses every such
   constant and asserts a dispatch route exists — so orphaned constants must be
   removed in lockstep with the routes. `DOCK_SET_MENU_METHOD` was the trap: it
   was still referenced by the dead `set_dock_menu` window-command chain in
   `macos.rs`/`window.rs`, so the constant could only go _after_ that dead
   infrastructure was removed.

3. **Demotion cascades into platform dead code.** Removing 10 WebView + 1 Dock
   handlers orphaned 10 `WindowMethodHandler` trait methods, 10 `WindowCommand`
   variants and their match arms, 2 `WindowCommandResponse` variants, 5 request
   structs, and the macOS dock-menu chain. `cargo check` reports dead code as
   warnings; `cargo clippy -D warnings` (a release gate) fails — so the
   dead window infrastructure had to be pruned, not left.

4. **Parallelise on surface files, serialise on shared files.** ~18 surface
   migrations ran as subagents in batches of 3–4. Each agent owned its surface
   `.ts` + host `.rs` + test + its own `index.ts` lines. The shared, race-prone
   work — `host-protocol/src/lib.rs` constant removal and the parity-matrix
   regeneration — was always done centrally by the coordinating agent, once per
   batch, never by the surface agents.

## AGENTS.md amendment candidate

Worth a repo rule: "An unsupported native method is declared with
`NativeSurface.capabilityFact`, never `NativeSurface.rpc`. A surface's
`RpcGroup` contains only methods with a real host route." That makes the
unsupported-path gate structurally enforced rather than periodically swept.
