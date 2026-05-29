---
title: Window lookup should reuse the runtime router
date: 2026-05-18
issue: 1348
---

# Window lookup should reuse the runtime router

Window lookup is not a separate registry. The native adapter already opens, focuses, and closes windows through `AppEventRouter`, so the first public lookup slice should expose that state instead of creating another source of truth.

This change adds `Window.getCurrent`, `Window.getById`, and `Window.list` on the existing Window service. The host-side handlers read the router state after permission checks and re-check handles against the `ResourceRegistry` before returning them. `Window.close` removes windows from lookup before returning. Internal registry events are ordered by router mutation: `opened`, `focused`, then terminal `closed`; a public `Window.events()` stream must wait until the bridge event publisher is wired end to end.

Architecture-debt sweep: no custom DSL or wrapper over Effect was added. The touched area already had `AppEventRouter` as the durable desktop-specific policy owner for window targeting and lifecycle routing; this slice deepens that module by exposing lookup and registry events from the same state. Remaining #1348 work is bridge/host completeness: native host event-loop window events, renderer reconnect/replay policy, and Rust host protocol parity still need explicit contracts before the issue can close.
