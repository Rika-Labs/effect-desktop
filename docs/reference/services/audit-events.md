---
title: AuditEvents
description: Typed audit surface for permission-relevant runtime transitions.
kind: reference
audience: app-developers
effect_version: 4
---

# `AuditEvents`

Writes typed audit rows through the Effect `EventLog` after passing each event through the inspector safety policy (redaction filter). Secret-shaped fields are replaced before persistence.

## Import

```ts
import {
  AuditEvents,
  AuditEventsLayer,
  AuditGroup,
  AuditGroupLayer,
  AuditReactivityLayer,
  AuditEvent,
  AuditEventKind,
  makeAuditEvents,
  emitAuditEvent,
  permissionAuditEvent,
  approvalAuditEvent,
  secretsAuditEvent,
  type AuditEventsApi,
  type AuditEventsOptions
} from "@orika/core"
```

## Service

`AuditEvents: Context.Service<AuditEvents, AuditEventsApi>`

The default `make` is a no-op pair (`emit` returns `Effect.void`, `observe` returns `Stream.empty`); production code provides `AuditEventsLayer`, which wires `EventLog.EventLog` through `makeAuditEvents`.

## API

| Method    | Signature                                                             | Description                                              |
| --------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `emit`    | `(event: AuditEvent) => Effect<void, EventJournal.EventJournalError>` | Sanitizes, writes to the event log, publishes on PubSub. |
| `observe` | `() => Stream<AuditEvent>`                                            | Live stream of events emitted after `make`.              |

There is no `query` method on `AuditEvents`. Historical queries go through `EventLog`/`EventJournal` directly using the `AuditGroup` schema.

## Event kinds

`AuditEventKind` is a closed union of hyphenated tags:

- `permission-granted`, `permission-denied`, `permission-revoked`, `permission-expired`, `permission-consumed`, `permission-used`
- `approval-requested`, `approval-granted`, `approval-denied`
- `command-registered`, `command-unregistered`, `command-invoked`
- `job-retrying`
- `secrets-accessed`
- `trace-id-missing`

Every event carries `kind`, `source`, `traceId`, `outcome`, and optional `timestamp`, `normalizedCapability`, `actor`, `resource`, `details`. Per-kind payload schemas (`PermissionAuditPayload`, `ApprovalAuditPayload`, `CommandAuditPayload`, `JobRetryingAuditPayload`, `SecretsAuditPayload`, `TraceIdMissingAuditPayload`) gate writes through `AuditGroup`.

## Layer

```ts
import { AuditEventsLayer, AuditGroupLayer, AuditReactivityLayer } from "@orika/core"
```

`AuditEventsLayer` requires `EventLog.EventLog | EventLog.Registry`. `AuditGroupLayer` registers no-op event handlers for the audit group; `AuditReactivityLayer` registers the `"audit"` reactivity tag.

`makeAuditEvents(log, options?)` returns an `AuditEventsApi` directly. `AuditEventsOptions` accepts:

- `redaction` — `RedactionFilterOptions` forwarded to the inspector safety policy.
- `inspectorSafety` — pre-built `InspectorSafetyPolicyApi` (skips constructing the default policy).

## Helpers

- `permissionAuditEvent(input)` — build a permission event with `normalizedCapability` + `actor`.
- `approvalAuditEvent(input)` — build an approval event with an `actor` that can be a string or `PermissionActor`.
- `secretsAuditEvent(input)` — build a `secrets-accessed` event with `namespace`, `operation`, optional `key`.
- `emitAuditEvent(audit, event)` — emit when `audit` is defined; no-op when undefined.

## Example

```ts
import { Effect } from "effect"
import { AuditEvents, approvalAuditEvent } from "@orika/core"

const program = Effect.gen(function* () {
  const audit = yield* AuditEvents
  yield* audit.emit(
    approvalAuditEvent({
      kind: "approval-granted",
      source: "MyApp",
      traceId: "trace-1",
      outcome: "granted",
      actor: "main",
      details: { feature: "license-accepted" }
    })
  )
})
```

## When to emit your own

The framework already emits audit events for permission, approval, secret, command, and job-retry transitions. Add your own only for app-specific regulatory operations (license acceptance, data export) that are not already routed through an instrumented service. Use [`Telemetry`](telemetry.md) for narrative logging, not audit.

## Related

- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Reference: [`Telemetry`](telemetry.md), [`PermissionRegistry`](permission-registry.md)
- Source: [`packages/core/src/runtime/audit-events.ts`](../../../packages/core/src/runtime/audit-events.ts)
