# CLAUDE.md — Effect Desktop

`AGENTS.md` is the canonical repo-local instruction file. This file exists for Claude-compatible tooling and repeats only the project vision that must not be missed.

## Layer-first contract

Effect Desktop is an Effect-first desktop framework. The core product promise is full-stack type safety, testability, switchable providers, fast defaults, and small apps.

Implementation rules:

- effectful public APIs return `Effect.Effect<A, E, R>`;
- public capability boundaries use `Schema.Class` data and stable tagged errors;
- every effectful capability is an Effect service with `Live` and `Test` layers;
- renderer/runtime/host boundaries use typed RPC/client layers, not untyped bridge calls;
- concrete runtimes, WebViews, storage engines, transports, host adapters, and package providers are selected by data and supplied as layers;
- app code depends on service requirements, not concrete providers;
- `ManagedRuntime` and `Effect.run*` stay at explicit integration edges;
- optional providers must be lazy or behind subpaths so switchability does not bloat the default app.

If an abstraction does not hide desktop-specific complexity beyond existing Effect primitives, do not add it. Use Effect directly, document the pattern, or expose the primitive.
