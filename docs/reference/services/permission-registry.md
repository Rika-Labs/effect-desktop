---
title: PermissionRegistry
description: Deny-by-default capability chokepoint for privileged runtime operations.
kind: reference
audience: app-developers
effect_version: 4
---

# `PermissionRegistry`

Deny-by-default capability chokepoint. Every privileged operation in the runtime checks a capability against the registry before executing.

## Import

```ts
import {
  PermissionRegistry,
  makePermissionRegistry,
  type NormalizedCapability,
  type PermissionContext,
  type GrantedCapability,
  type PermissionDecision,
  type PermissionGrantSnapshot,
  PermissionDeniedError,
  PermissionGrantNotFoundError,
  PermissionInvalidArgumentError,
  PermissionRevokedError
} from "@effect-desktop/core"
```

## Service

`PermissionRegistry: Context.Service<PermissionRegistry, PermissionRegistryApi>`

## API

| Method | Signature | Description |
| --- | --- | --- |
| `declare` | `(capability, options) => Effect<void, InvalidArgument>` | Records an allow / deny / approval / revocation rule. |
| `query` | `(kind, actor) => Effect<PermissionQuery>` | Returns global and actor-scoped declarations that apply. |
| `check` | `(capability, context) => Effect<GrantedCapability, PermissionDenied>` | Issues a tracked grant or returns a typed denial. |
| `grant` | `(capability, context, options) => Effect<GrantedCapability>` | Bypass the check (for approval-broker callbacks); records a grant. |
| `use` | `<A, E>(grant, effect) => Effect<A, E \| GrantNotFound \| Revoked>` | Runs an effect under a grant; verifies validity. |
| `inspect` | `(token) => Effect<PermissionGrantSnapshot \| undefined>` | Inspects current state of a grant. |
| `revoke` | `(token) => Effect<void>` | Revokes a grant; future `use` calls fail. |
| `listDecisions` | `() => Effect<PermissionDecision[]>` | Recent decisions for devtools. |
| `observeDecisions` | `() => Stream<PermissionDecision>` | Live decision stream. |

## Decision order (fixed)

1. Explicit deny.
2. Revoked / expired / consumed.
3. Approval-denied cache.
4. Approval (routes to `ApprovalBroker`).
5. Allow.
6. Default deny.

## Errors

- `PermissionDeniedError` — capability did not match an allow.
- `PermissionInvalidArgumentError` — malformed capability.
- `PermissionGrantNotFoundError` — `use(grant)` referred to an unknown grant.
- `PermissionRevokedError` — grant was revoked between issue and use.

## Layer

```ts
import { Layer } from "effect"
import { PermissionRegistry, makePermissionRegistry } from "@effect-desktop/core"

const PermissionRegistryLive = Layer.effect(PermissionRegistry)(makePermissionRegistry())
```

`makePermissionRegistry({ auditEvents? })` accepts an optional `AuditEventsApi` so every check writes a structured event.

## Example

```ts
import { Effect } from "effect"
import { PermissionRegistry } from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const permissions = yield* PermissionRegistry
  yield* permissions.declare(
    { kind: "filesystem.read", roots: ["/Users/me/Documents"] },
    { effect: "allow", source: "app-init" }
  )
  const grant = yield* permissions.check(
    { kind: "filesystem.read", path: "/Users/me/Documents/notes.md" },
    { actor: { kind: "window", id: "main" }, traceId: "trace-1", timestamp: Date.now() }
  )
  return yield* permissions.use(grant, Effect.succeed("ok"))
})
```

## Related

- Explanation: [Permissions model](../../explanation/permissions-model.md)
- Reference: [`ApprovalBroker`](approval-broker.md), [`AuditEvents`](audit-events.md)
- How-to: [Declare a permission](../../how-to/declare-a-permission.md)
- Source: [`packages/core/src/runtime/permission-registry.ts`](../../../packages/core/src/runtime/permission-registry.ts)
