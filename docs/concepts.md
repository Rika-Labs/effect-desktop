---
title: Concepts
description: Three process roles, the boundary rule, and where Effect shows up.
kind: explanation
audience: app-developers
effect_version: 4
---

# Concepts

> The deep dive lives at [`explanation/architecture.md`](explanation/architecture.md). This page is the release-gated reference summary.

ORIKA splits a desktop app into four explicit owners:

- **Rust** owns the native shell.
- **Bun** owns the TypeScript runtime.
- The **renderer** owns UI.
- **Effect** owns services, failures, resources, permissions, and observability.

## Core model

An application is assembled with `Desktop.make`. Runtime services are Effect layers. Renderer-callable APIs are canonical Effect `RpcGroup`s. Native authority is exposed through typed services and granted by composing `Desktop.permission(...)` capability values, not by raw renderer access. `BridgeRpc` is a small boundary adapter that translates Effect RPC across the renderer/runtime/host boundary; per `AGENTS.md` it stays only until canonical Effect RPC owns that protocol translation directly.

## The boundary rule

The renderer never receives raw native authority. Every privileged call crosses a typed RPC client → bridge envelope → runtime handler → permission check → adapter. The boundary buys you a permission chokepoint, typed failures, an audit trail, and a deterministic test double — all without per-call work. Permissions are declared as capability values (e.g. `Native.Permissions.clipboard.readText`) and composed via `Desktop.permissions(Desktop.permission(...), ...)`; the runtime's `PermissionRegistry` and `PermissionInterceptor` enforce them at the RPC layer.

## Verify the core exports

```ts run
import { Desktop } from "../packages/core/src/index.js"
import { HostProtocolEnvelope } from "../packages/bridge/src/index.js"

if (typeof Desktop.make !== "function" || HostProtocolEnvelope === undefined) {
  throw new Error("Desktop or HostProtocolEnvelope is unavailable")
}
```

## Where to go next

- [The boundary rule](explanation/boundary-rule.md) — what's allowed and what isn't
- [Layer-first design](explanation/layer-first-design.md) — the structural shape
- [Permissions model](explanation/permissions-model.md) — deny-by-default specifics
- [`Desktop` API reference](reference/desktop-api.md)
