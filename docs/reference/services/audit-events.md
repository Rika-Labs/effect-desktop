---
title: AuditEvents
description: Typed audit surface for permission-relevant runtime transitions.
kind: reference
audience: app-developers
effect_version: 4
---

# `AuditEvents`

Writes closed `audit/<kind>` rows through the Effect `EventLog` after running the shared redaction filter. Secret-shaped fields are replaced before persistence.

## Import

```ts
import {
  type AuditEventsApi,
  type AuditEvent,
  type AuditEventKind,
  makeAuditEvents
} from "@effect-desktop/core"
```

## API

| Method    | Signature                          | Description                           |
| --------- | ---------------------------------- | ------------------------------------- |
| `emit`    | `(event) => Effect<void>`          | Redact, then append to the event log. |
| `observe` | `(filter?) => Stream<AuditEvent>`  | Live stream of audit events.          |
| `query`   | `(filter) => Effect<AuditEvent[]>` | Bounded historical query.             |

## Event shapes

`AuditEvent` is a closed union. Common kinds:

- `permission/check`, `permission/grant`, `permission/use`, `permission/revoke`, `permission/expire`, `permission/consume`
- `approval/requested`, `approval/granted`, `approval/denied`
- `secret/accessed`
- `process/spawned`, `process/exited`
- `worker/spawned`, `worker/crashed`
- `job/started`, `job/succeeded`, `job/failed`, `job/canceled`, `job/retrying`
- `update/checked`, `update/downloaded`, `update/installed`

Every event carries `source`, `kind`, `actor?`, `resource?`, `capability?`, `outcome`, `traceId`, `details`.

## Layer

`makeAuditEvents({ eventLog, redactionFilter })` returns the layer. Depends on `EventLog` and `RedactionFilter`.

## Example

```ts
const audit = yield * AuditEvents
yield *
  audit.emit({
    source: "MyApp",
    kind: "license/accepted",
    actor: { kind: "user", id: currentUser.id },
    outcome: "granted",
    traceId,
    details: { licenseVersion: "2.0" }
  })
```

## When to emit your own

The framework emits audit events for permission, approval, secret, process, worker, job, and updater operations. You add custom events for **regulatory** operations in your app (license acceptance, data export, etc.). Don't use audit for general logging — see [`Telemetry`](telemetry.md).

## Related

- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Reference: [`Telemetry`](telemetry.md), [`PermissionRegistry`](permission-registry.md)
- Source: [`packages/core/src/runtime/audit-events.ts`](../../../packages/core/src/runtime/audit-events.ts)
