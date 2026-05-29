---
title: How to declare a permission
description: Add an allow, deny, or approval declaration to PermissionRegistry.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to declare a permission

Privileged operations cross `PermissionRegistry`. By default, every check returns `PermissionDenied`. To let an operation through, declare the matching capability.

## The shape

`registry.declare(capability, options?)` accepts:

- `capability` — a `NormalizedCapability` value: `{ kind, ...details, audit }`. Use the `P` helpers (`P.filesystemRead`, `P.processSpawn`, `P.networkConnect`, `P.secretsRead`, `P.nativeInvoke`, etc.) so `audit` and other required fields default sanely.
- `options.effect` — `"allow"` (default), `"deny"`, `"approval"`, `"approval-denied"`, `"revoked"`, `"expired"`, or `"consumed"`. The lifecycle effects are mostly written by the registry itself; apps reach for `"allow"`, `"deny"`, or `"approval"`.
- `options.actor` — optional `PermissionActor` (`{ kind, id }`). When set, the rule only matches that actor.
- `options.source` — non-empty string for the audit log (`"app-init"`, `"user-grant"`, a feature name).

Audit policy (`"always" | "on-deny" | "never"`) is part of the capability itself, not the declaration. Grant-only options (`expiresAt`, `oneTime`) live on `check` / `grant`, not `declare`.

## 1. Allow at startup

```ts
import { Effect } from "effect"
import { P, PermissionRegistry } from "@orika/core"

const init = Effect.gen(function* () {
  const permissions = yield* PermissionRegistry
  yield* permissions.declare(P.filesystemRead({ roots: ["/Users/me/Documents"] }), {
    effect: "allow",
    source: "app-init"
  })
})
```

The whole tree under `/Users/me/Documents` is now readable. Writes still return `PermissionDenied` because `filesystem.write` is a separate capability.

## 2. Require approval

```ts
yield *
  permissions.declare(P.filesystemWrite({ roots: ["/Users/me/Downloads"] }), {
    effect: "approval",
    source: "Notes.export"
  })
```

When `check` resolves to `approval`, the framework still issues a grant; the user-facing prompt is driven separately by `PermissionApprovalWorkflow` / `ApprovalBroker` for capabilities your app routes through the workflow. The broker caches a `denied-for-scope` outcome per `(operation, actor, resource)` so the user is not re-prompted.

## 3. Explicit deny

```ts
yield *
  permissions.declare(P.processSpawn({ commands: ["rm"] }), { effect: "deny", source: "policy" })
```

A deny **wins** over any later allow. Use it when a specific shape should never be permitted regardless of other declarations.

## 4. Per-actor scoping

Declarations can be actor-scoped so a window or worker has narrower authority than the app as a whole:

```ts
yield *
  permissions.declare(P.secretsRead({ namespaces: ["tokens"] }), {
    effect: "allow",
    source: "main-window",
    actor: { kind: "window", id: "main" }
  })
```

Other windows and workers don't get this declaration; calls from elsewhere fall through to default-deny.

## Capability shapes

| Kind                     | Builder                   | Containment              |
| ------------------------ | ------------------------- | ------------------------ |
| `filesystem.read`        | `P.filesystemRead`        | Path-prefix              |
| `filesystem.write`       | `P.filesystemWrite`       | Path-prefix              |
| `filesystem.delete`      | `P.filesystemDelete`      | Path-prefix              |
| `sqlite.open`            | (use raw `{ kind }`)      | Path-prefix              |
| `process.spawn`          | `P.processSpawn`          | Command allowlist        |
| `pty.spawn`              | `P.ptySpawn`              | Command allowlist        |
| `network.connect`        | `P.networkConnect`        | Host allowlist           |
| `secrets.read/write`     | `P.secretsRead/Write`     | Namespace exact          |
| `safeStorage.read/write` | `P.safeStorageRead/Write` | Namespace exact          |
| `native.invoke`          | `P.nativeInvoke`          | Primitive + method exact |

Filesystem capabilities use **path containment** — declaring root `/Users/me/Documents` permits any descendant unless a path appears in `deny`. `network.connect` declares an outbound host allowlist for `PermissionRegistry` and the trusted `EgressPolicy` service; it does not provide a native HTTP, WebSocket, upload, or localhost transport.

Process and PTY capabilities must include `audit: "always"` or `"on-deny"` (the `P` helpers set `"always"`), and `shell` must be `false` or `"requires-explicit-approval"`. The `P.processSpawn`/`P.ptySpawn` helpers pin `shell: false`.

## Granting at runtime

If the user explicitly authorizes something (clicks "Allow this app to access your Downloads"), call `grant(...)` instead of `declare(...)`:

```ts
const grant =
  yield *
  permissions.grant(
    P.filesystemWrite({ roots: ["/Users/me/Downloads"] }),
    { actor: { kind: "window", id: "main" }, traceId: "approval:trace-1" },
    {
      expiresAt: Date.now() + 24 * 3_600_000,
      oneTime: false,
      source: "user-grant"
    }
  )

yield * permissions.use(grant, doTheWork)
```

`use(grant, effect)` runs the effect after verifying the grant is still active. Revoked, expired, or consumed grants fail with `PermissionRevoked`. `oneTime` grants transition to `consumed` on the first `use`.

## Related

- Explanation: [Permissions model](../explanation/permissions-model.md), [Audit and redaction](../explanation/audit-and-redaction.md)
- How-to: [Handle an approval prompt](handle-an-approval-prompt.md)
- Reference: [`PermissionRegistry`](../reference/services/permission-registry.md)
