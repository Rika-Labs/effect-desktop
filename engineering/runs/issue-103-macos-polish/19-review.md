# Issue 103 Review

## Verdict

LOCKED with one scope constraint: this issue may add host protocol fields and macOS adapters, but it must not invent a second configuration system or bypass the existing Effect service contracts.

## Findings

- **Severity:** Important
- **Principle:** Source of truth / no silent fallbacks
- **Violation:** The issue text says `windows.defaults.vibrancy` and `trafficLights`, but the host currently receives only per-call `Window.create` payloads.
- **Game-theory failure:** If the host reads environment variables or local manifests for visual defaults, app authors get hidden behavior that tests cannot see.
- **Why it matters:** macOS polish would pass local smoke tests while real app config remains disconnected.
- **Fix:** Add explicit typed payload fields and keep config/default merging in the TypeScript/config layer when that layer is present.

- **Severity:** Important
- **Principle:** Effect-first / typed errors
- **Violation:** The architecture references Rust host adapters for `Dock` and `Menu`, but TypeScript service methods are currently host-contract wrappers and unsupported clients.
- **Game-theory failure:** A quick Rust-only implementation would leave public Effect APIs returning unimplemented typed errors.
- **Why it matters:** Appendix K support is a public API claim, not only a host capability.
- **Fix:** Route existing Effect methods through bridge/host handlers and keep all failures in `Effect` error channels.

- **Severity:** Minor
- **Principle:** YAGNI
- **Violation:** A full menu activation lifecycle could exceed #103.
- **Game-theory failure:** Broad menu machinery would delay the platform polish invariant and create shallow event abstractions.
- **Why it matters:** The active issue only requires menu installation, not end-to-end command dispatch redesign.
- **Fix:** Reuse `Menu.bindCommand` and existing event contracts; defer richer activation behavior unless tests prove it is required.

## Reality Check

- `crates/host/src/window.rs` already creates windows on the event-loop thread and is the right place to call macOS window polish.
- `crates/host/src/windows.rs` is a good local template for platform-specific no-op cfg boundaries.
- `packages/native/src/window.ts`, `dock.ts`, and `menu.ts` already use Effect services and Schema validation, so changes should extend those rather than add a parallel API.
- `crates/host-protocol/src/lib.rs` and `packages/bridge/src/window.ts` deny unknown fields, so adding vibrancy/traffic-light payloads requires Rust and TypeScript parity tests.
- `engineering/learnings/2026-05-07-platform-polish-hooks-are-not-launch-gates.md` applies: optional polish cannot gate launch unless the missing behavior is a core invariant, and non-fatal polish must not skip independent work.

## Locked Architecture Edits

```diff
- Window vibrancy uses `NSVisualEffectView` configured per `windows.defaults.vibrancy`.
+ Window vibrancy uses explicit typed window payload/default fields; config merging remains outside the host, and the host only applies values it receives.

- Application menu uses `setMainMenu`; per-window menus follow `Menu.setWindowMenu`.
+ Application/window menu methods reuse the existing Effect `Menu` service and host method router; command activation expansion is out of scope unless needed to preserve existing `bindCommand` semantics.
```

## Handoff

Architecture locked. Continue to `/work`.
