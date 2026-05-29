---
title: Audit and redaction
description: Why every privileged operation writes a structured event — and how secrets stay out of the log.
kind: explanation
audience: app-developers
effect_version: 4
---

# Audit and redaction

The framework records what privileged code does. Permission checks, approvals, secret access, command transitions, and job retries each write a structured `AuditEvent` through the runtime `EventLog` after passing through the inspector safety policy (which delegates to the shared redaction filter). You don't have to instrument anything to get this; it's wired into the services that own those operations.

## Why audit

Three reasons that get more important the older the app gets:

- **Forensics.** When something happens that shouldn't, the audit log answers "what did the app actually do, when, on whose behalf?" without needing logs you remembered to add.
- **Review.** A new permission declaration is a code change you can review. The audit events it produces are a runtime fact you can verify.
- **Trust.** When a feature is gated by an approval prompt, the audit record proves the prompt was shown and the user answered.

Audit is not logging. Logging is human-readable narration; audit is machine-readable claims about specific operations. Both have a place. The framework wires audit into the privileged path so you don't accidentally lose it under a refactor.

## What gets recorded

`AuditEventsApi.emit(event)` accepts a closed union of `AuditEvent` shapes. The kind tags are hyphenated (`permission-granted`, not `permission/check`). The framework emits these from inside the services that produce them:

| Source                                         | Event kinds                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PermissionRegistry`                           | `permission-granted`, `permission-denied`, `permission-revoked`, `permission-expired`, `permission-consumed`, `permission-used` |
| `ApprovalBroker`, `PermissionApprovalWorkflow` | `approval-requested`, `approval-granted`, `approval-denied`                                                                     |
| `Secrets`                                      | `secrets-accessed`                                                                                                              |
| Command runtime                                | `command-registered`, `command-unregistered`, `command-invoked`                                                                 |
| Job runner                                     | `job-retrying`                                                                                                                  |
| Bridge / RPC                                   | `trace-id-missing`                                                                                                              |

Every event carries:

- **`kind`** — the closed-union tag.
- **`source`** — which subsystem emitted it (e.g. `"ApprovalBroker"`, `"PermissionRegistry"`).
- **`traceId`** — joins this event to the trace span that produced it. Required.
- **`outcome`** — `granted`, `denied`, `revoked`, `expired`, `consumed`, `requested`, `succeeded`, etc.
- **`timestamp?`** — non-negative finite number when supplied by the emitter.
- **`normalizedCapability?`**, **`actor?`**, **`resource?`** — permission-shaped events.
- **`details?`** — service-specific structured fields, validated per kind by `AuditGroup`.

You consume the live stream via `AuditEvents.observe()`. Historical replay goes through `EventLog`/`EventJournal` directly using the `AuditGroup` schema; `AuditEvents` itself does not expose a `query` method.

## Why redaction is not optional

Audit events are stored, replayed, surfaced in devtools, and potentially shipped off-machine. If a secret value ever lands in `details`, it is now in your event log forever. The framework refuses to take that risk.

The inspector safety policy walks structured event data and runs each event through `RedactionFilter` (`packages/bridge/src/redaction.ts`) before persistence. Secret-shaped fields are replaced with `Redacted` values. Grant tokens are emitted as `Redacted` via `makeSecretString(token, { label: "PermissionGrantToken" })` so they never reach the log in plaintext.

You can:

- Pass `RedactionFilterOptions` through `AuditEventsOptions.redaction` to add custom patterns.
- Provide a pre-built `inspectorSafety` policy to override the default.

You cannot turn redaction off at the audit layer. It runs on every event before `EventLog.write`.

## Secrets never live in logs

`Secrets.get(...)` returns `Redacted<Uint8Array>`. The bytes are an opaque container — you have to call `Redacted.value(...)` to read them and should `wipeSecretBytes(...)` when done. The `secrets-accessed` audit event records the namespace and operation (and key when present) but never the value.

`SafeStorage` is the lower-level key/value credential-store boundary. Its public service accepts and returns `SecretBytes`; the bridge payload carries raw bytes only inside the Schema-validated native request. Everything above that boundary traffics in `Redacted`, and there is no plaintext fallback when the platform credential store is unavailable.

## What you do with this

You usually do nothing. The framework writes the events; the inspector safety policy redacts them; the event log persists them. You consume the audit trail when:

- **Debugging.** Devtools' event-log panel shows you the recent audit history. `AuditEvents.observe()` is also a live stream.
- **Testing.** Assert against events you collected through a captured `AuditEventsApi` (e.g. by collecting from `audit.observe()` in test layers). `@orika/test` does not export a dedicated audit-assertion helper at the time of writing.
- **Compliance.** Export the underlying event log when you need to prove behavior.

## When to add custom audit

Emit your own events by depending on `AuditEvents` and calling `emit(event)` (or by building events with `permissionAuditEvent`, `approvalAuditEvent`, `secretsAuditEvent`). Reach for it when:

- A privileged operation in your app is **not** routed through one of the framework's instrumented services (rare; usually the right answer is to route it through a service).
- A user action has **regulatory** weight (e.g. accepting a license, exporting data) and you want a structured record. Pick an existing `AuditEventKind` whose payload matches — adding new kinds requires extending `AuditGroup` in `@orika/core`.

Don't reach for it as a substitute for normal logging. `Telemetry`'s structured logs are the right place for "the app fetched 12 records."

## Related

- [Permissions model](permissions-model.md) — produces most of the audit events
- [Boundary rule](boundary-rule.md) — why everything privileged is observable
- Reference: [`AuditEvents`](../reference/services/audit-events.md), [`Secrets`](../reference/services/secrets.md), [`Telemetry`](../reference/services/telemetry.md)
