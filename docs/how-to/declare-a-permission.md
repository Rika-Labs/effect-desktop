---
title: How to declare a permission
description: Add an allow, deny, or approval declaration to PermissionRegistry.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to declare a permission

Privileged operations cross `PermissionRegistry`. By default, every check returns `PermissionDenied`. To let an operation through, declare the matching capability.

## The shapes

A declaration is `{ capability, effect, source, audit?, expiresAt?, oneTime? }`:

- `capability` — normalized value: `{ kind, ...details }`.
- `effect` — `"allow"`, `"deny"`, or `"approval"`.
- `source` — string for the audit log ("app-init", "user-grant", a feature name).
- `audit` — `"always"`, `"on-deny"`, or `"never"` (default `"always"`).

## 1. Allow at startup

```ts
import { PermissionRegistry } from "@orika/core"

const permissions = yield * PermissionRegistry

yield *
  permissions.declare(
    { kind: "filesystem.read", roots: ["/Users/me/Documents"] },
    { effect: "allow", source: "app-init" }
  )
```

The whole tree under `/Users/me/Documents` is now readable. Writes still return `PermissionDenied` because `filesystem.write` is a separate capability.

## 2. Require approval

```ts
yield *
  permissions.declare(
    { kind: "filesystem.write", roots: ["/Users/me/Downloads"] },
    { effect: "approval", source: "Notes.export" }
  )
```

The first call to write under `/Users/me/Downloads` triggers an approval prompt via `ApprovalBroker`. The user's answer is cached for the same `(operation, actor, resource)` so they aren't re-prompted.

## 3. Explicit deny

```ts
yield *
  permissions.declare(
    { kind: "process.spawn", command: "rm" },
    { effect: "deny", source: "policy" }
  )
```

A deny **wins** over any subsequent allow. Use it when a specific shape should never be permitted regardless of other declarations.

## 4. Per-actor scoping

Declarations can be actor-scoped so a window or worker has narrower authority than the app as a whole:

```ts
yield *
  permissions.declare(
    { kind: "secrets.read", namespaces: ["tokens"] },
    { effect: "allow", source: "main-window", actor: { kind: "window", id: "main" } }
  )
```

Other windows and workers don't get this declaration; calls from elsewhere fall through to default-deny.

## Capability shapes

| Kind               | Shape                                                                                                                                                                           | Containment       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `filesystem.read`  | `{ kind: "filesystem.read", roots: string[] }`                                                                                                                                  | Path-prefix       |
| `filesystem.write` | `{ kind: "filesystem.write", roots: string[] }`                                                                                                                                 | Path-prefix       |
| `process.spawn`    | `{ kind: "process.spawn", commands: string[], cwd?: string[], environment: "none" \| "allowlist", shell: false \| "requires-explicit-approval", audit: "always" \| "on-deny" }` | Command allowlist |
| `network.connect`  | `{ kind: "network.connect", hosts: string[], askUnknownHosts: boolean, audit: AuditPolicy }`                                                                                    | Host allowlist    |
| `secrets.read`     | `{ kind: "secrets.read", namespaces: string[] }`                                                                                                                                | Exact             |
| `secrets.write`    | `{ kind: "secrets.write", namespaces: string[] }`                                                                                                                               | Exact             |
| `native.invoke`    | `{ kind: "native.invoke", primitive: string, methods: string[] }`                                                                                                               | Exact             |

Filesystem capabilities use **path containment** — declaring root `/Users/me/Documents` permits any descendant. `network.connect` declares an outbound host allowlist for permission and egress-policy checks; it does not provide a native HTTP, WebSocket, upload, or localhost transport service.

## Granting at runtime

If the user explicitly authorizes something (clicks "Allow this app to access your Downloads"), call `grant(...)` instead of `declare(...)`:

```ts
const grant =
  yield *
  permissions.grant({ kind: "filesystem.write", roots: ["/Users/me/Downloads"] }, context, {
    expiresAt: Date.now() + 24 * 3600 * 1000,
    oneTime: false
  })

// Use the grant
yield * permissions.use(grant, doTheWork)
```

`use(grant, effect)` runs the effect after verifying the grant is still valid. Revoked, expired, or consumed grants fail as typed errors.

## Related

- Explanation: [Permissions model](../explanation/permissions-model.md), [Audit and redaction](../explanation/audit-and-redaction.md)
- How-to: [Handle an approval prompt](handle-an-approval-prompt.md)
- Reference: [`PermissionRegistry`](../reference/services/permission-registry.md)
