---
title: PermissionRegistry
description: Deny-by-default capability chokepoint for privileged runtime operations.
kind: reference
audience: app-developers
effect_version: 4
---

# `PermissionRegistry`

Deny-by-default capability chokepoint. Every privileged operation in the runtime checks a normalized capability against the registry before executing.

`PermissionRegistry` is app/runtime capability policy, not a browser session permission manager. WebView permission prompts for camera, microphone, notifications, geolocation, clipboard, and display capture are owned by the [`SessionPermission`](../native/session-permission.md) native surface.

## Import

```ts
import {
  PermissionRegistry,
  makePermissionRegistry,
  PermissionInterceptor,
  makePermissionInterceptorLayer,
  P,
  PermissionDeniedError,
  PermissionGrantNotFoundError,
  PermissionInvalidArgumentError,
  PermissionRevokedError,
  PermissionAuditFailedError,
  type PermissionRegistryApi,
  type PermissionRegistryOptions,
  type PermissionGrantOptions,
  type NormalizedCapability,
  type PermissionContext,
  type PermissionActor,
  type PermissionDecision,
  type PermissionGrantSnapshot,
  type PermissionRule,
  type GrantedCapability,
  type GrantStatus,
  capabilityCovers
} from "@orika/core"
```

## Service

`PermissionRegistry: Context.Service<PermissionRegistry, PermissionRegistryApi>` with a default `make` of `makePermissionRegistry()` (no audit wiring).

## API

| Method             | Signature                                                                               | Description                                                         |
| ------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `declare`          | `(capability, options?) => Effect<PermissionRule, PermissionInvalidArgumentError>`      | Records an allow / deny / approval / revocation rule.               |
| `query`            | `(kind, actor) => Effect<readonly PermissionRule[], PermissionInvalidArgumentError>`    | Returns global and actor-scoped rules that apply.                   |
| `check`            | `(capability, context, options?) => Effect<GrantedCapability, PermissionRegistryError>` | Issues a tracked grant or returns a typed denial.                   |
| `grant`            | `(capability, context, options?) => Effect<GrantedCapability, PermissionRegistryError>` | Bypass the rule check (for approval workflows); records a grant.    |
| `use`              | `<A, E, R>(grant, effect) => Effect<A, E \| PermissionRegistryError, R>`                | Runs an effect; fails if the grant is revoked or expired.           |
| `inspect`          | `(token) => Effect<PermissionGrantSnapshot, PermissionRegistryError>`                   | Returns the current snapshot; fails with `GrantNotFound` if absent. |
| `revoke`           | `(token) => Effect<PermissionGrantSnapshot, PermissionRegistryError>`                   | Transitions the grant to `revoked` and wakes in-flight `use` calls. |
| `listDecisions`    | `() => Effect<readonly PermissionDecision[]>`                                           | Last 1024 decisions for devtools.                                   |
| `observeDecisions` | `() => Stream<PermissionDecision>`                                                      | Live decision stream from a sliding PubSub (capacity 1024).         |

`declare` options: `{ effect?: PermissionEffect, actor?: PermissionActor, source?: string }` (defaults `effect: "allow"`, `source: "declaration"`). `PermissionEffect` is `"allow" | "deny" | "approval" | "approval-denied" | "revoked" | "expired" | "consumed"`.

`PermissionGrantOptions`: `{ expiresAt?, oneTime?, source? }`.

## Decision order (fixed)

1. Explicit `deny`.
2. Revoked / expired / consumed declarations.
3. Approval-denied cache (`approval-denied` declarations).
4. `approval` — issues a grant; the broker is invoked elsewhere (see [`PermissionApprovalWorkflow`](../../explanation/permissions-model.md)).
5. `allow`.
6. Default deny.

`use(grant, effect)` re-checks the grant on entry. If the grant is `oneTime`, it transitions to `consumed` before running the effect. Otherwise the effect races against revocation; if `revoke` is called during execution the effect fails with `PermissionRevoked`.

## Errors

- `PermissionInvalidArgumentError` (`_tag: "InvalidArgument"`) — malformed input.
- `PermissionDeniedError` (`_tag: "PermissionDenied"`) — capability did not match an allow.
- `PermissionGrantNotFoundError` (`_tag: "PermissionGrantNotFound"`) — `use` / `inspect` / `revoke` referred to an unknown token.
- `PermissionRevokedError` (`_tag: "PermissionRevoked"`) — grant was revoked, expired, or consumed.
- `PermissionAuditFailedError` (`_tag: "PermissionAuditFailed"`) — audit emission failed during a decision.

## Capability shapes

`NormalizedCapability` is a tagged union (validated via Schema). See [How to declare a permission](../../how-to/declare-a-permission.md). The `P` helpers (`P.filesystemRead`, `P.processSpawn`, `P.networkConnect`, `P.secretsRead`, `P.nativeInvoke`, etc.) build capabilities with `audit: "always"` defaults.

`capabilityCovers(declared, requested)` is exported for use in custom containment checks.

## Layer

```ts
import { Layer } from "effect"
import { PermissionRegistry, makePermissionRegistry } from "@orika/core"

const PermissionRegistryLive = Layer.effect(PermissionRegistry, makePermissionRegistry())
```

`makePermissionRegistry({ audit?, traceId?, nextToken?, now? })` accepts an optional `AuditEventsApi`; every check, grant, and lifecycle transition then writes a structured audit event.

## RPC interceptor

`PermissionInterceptor` (an `RpcMiddleware.Service`) decodes the RPC-level capability annotation and routes the check through `PermissionRegistry`. Apply it to an RPC group with `group.middleware(PermissionInterceptor)`. `makePermissionInterceptorLayer({ nextTraceId?, actorId?, actorKind? })` constructs the layer.

## Example

```ts
import { Effect } from "effect"
import { PermissionRegistry, P } from "@orika/core"

const program = Effect.gen(function* () {
  const permissions = yield* PermissionRegistry
  yield* permissions.declare(P.filesystemRead({ roots: ["/Users/me/Documents"] }), {
    effect: "allow",
    source: "app-init"
  })
  const grant = yield* permissions.check(
    P.filesystemRead({ roots: ["/Users/me/Documents/notes.md"] }),
    { actor: { kind: "window", id: "main" }, traceId: "trace-1" }
  )
  return yield* permissions.use(grant, Effect.succeed("ok"))
})
```

## Related

- Explanation: [Permissions model](../../explanation/permissions-model.md)
- Reference: [`ApprovalBroker`](approval-broker.md), [`AuditEvents`](audit-events.md)
- How-to: [Declare a permission](../../how-to/declare-a-permission.md)
- Source: [`packages/core/src/runtime/permission-registry.ts`](../../../packages/core/src/runtime/permission-registry.ts), [`permission-interceptor.ts`](../../../packages/core/src/runtime/permission-interceptor.ts)
