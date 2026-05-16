---
title: Audit and redaction
description: Why every privileged operation writes a structured event — and how secrets stay out of the log.
kind: explanation
audience: app-developers
effect_version: 4
---

# Audit and redaction

The framework records what privileged code does. Permission checks, approvals, secret access, process spawns, updater installs, native invoke calls — each writes a structured `AuditEvent` to the runtime `EventLog` after passing through a `RedactionFilter`. You don't have to instrument anything to get this; it's wired into the services that own those operations.

## Why audit

Three reasons that get more important the older the app gets:

- **Forensics.** When something happens that shouldn't, the audit log answers "what did the app actually do, when, on whose behalf?" without needing logs you remembered to add.
- **Review.** A new permission declaration is a code change you can review. The audit events it produces are a runtime fact you can verify.
- **Trust.** When a feature is gated by an approval prompt, the audit record proves the prompt was shown and the user answered.

Audit is not logging. Logging is human-readable narration; audit is machine-readable claims about specific operations. Both have a place. The framework wires audit into the privileged path so you don't accidentally lose it under a refactor.

## What gets recorded

`AuditEventsApi.emit(event)` accepts a closed union of `AuditEvent` shapes. The framework emits these from inside the services that produce them:

| Source                     | Events                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PermissionRegistry`       | `permission/check`, `permission/grant`, `permission/use`, `permission/revoke`, `permission/expire`, `permission/consume` |
| `ApprovalBroker`           | `approval/requested`, `approval/granted`, `approval/denied`                                                              |
| `Secrets`                  | `secret/accessed`                                                                                                        |
| `Process`, `PTY`, `Worker` | lifecycle transitions, retries, crashes                                                                                  |
| `Updater`                  | `update/checked`, `update/downloaded`, `update/installed`                                                                |

Every event carries:

- **`source`** — which service emitted it.
- **`kind`** — the event tag.
- **`actor`** — `{ kind, id }` for the calling actor when known.
- **`resource`** — the resource id when applicable.
- **`capability`** — the normalized capability when applicable.
- **`outcome`** — `granted`, `denied`, `expired`, `revoked`, `succeeded`, `failed`, etc.
- **`traceId`** — joins this event to the Effect trace span that produced it.
- **`details`** — service-specific structured fields.

You can replay events from the event log via `EventLog.query(...)` and observe new events with `observeDecisions()` (for permissions) or service-specific streams.

## Why redaction is not optional

Audit events are stored, replayed, surfaced in devtools, and potentially shipped off-machine. If a secret value ever lands in `details`, it is now in your event log forever. The framework refuses to take that risk.

`RedactionFilter` walks structured data and replaces values whose **field names** match the secret pattern (`token`, `password`, `secret`, `apiKey`, etc., per SPEC §14.10) with an Effect `Redacted` value. The redacted value's string and JSON forms are `<redacted>` — even if you `JSON.stringify` it, the secret does not appear.

You can:

- Add custom patterns via filter options.
- Allowlist specific paths if a value happens to live under a sensitive-sounding name but is not a secret.

But you cannot turn redaction _off_ at the audit layer. It runs before every event is appended.

## Secrets never live in logs

`Secrets.get(...)` returns `Redacted<Uint8Array>`. The bytes are an opaque container — you have to call `Redacted.value(...)` to access them, and you should `wipeSecretBytes(...)` when you're done. The audit event for `secret/accessed` records the namespace and key but never the value.

`SafeStorage.encrypt` and `SafeStorage.decrypt` deal in raw bytes (because they are the encryption boundary), but everything else in the runtime traffics in `Redacted`. The bridge knows about `Redacted` and refuses to send it across the wire as plaintext.

## What you do with this

You usually do nothing. The framework writes the events; the redaction filter scrubs the details; the event log persists them. You consume the audit trail when:

- **Debugging.** Devtools' event-log panel shows you the recent audit history.
- **Testing.** `assertAuditedThat(registry, kind, predicate)` (in `@effect-desktop/test`) lets you assert events were emitted with the shape you expect.
- **Compliance.** If you ship something audit-relevant — say, an installer for an enterprise — you can export the log and prove behavior.

## When to add custom audit

You can emit your own audit events by depending on `AuditEventsApi` and calling `emit(event)`. Reach for it when:

- A privileged operation in your app is **not** routed through one of the framework's instrumented services (rare; usually the right answer is to route it through a service).
- A user action has **regulatory** weight (e.g. accepting a license, exporting data) and you want a structured record.

Don't reach for it as a substitute for normal logging. `Telemetry`'s structured logs are the right place for "the app fetched 12 records." Audit is for "the user granted permission to read /Users/me/Documents at 14:02:33."

## Related

- [Permissions model](permissions-model.md) — produces most of the audit events
- [Boundary rule](boundary-rule.md) — why everything privileged is observable
- Reference: [`AuditEvents`](../reference/services/audit-events.md), [`Secrets`](../reference/services/secrets.md), [`Telemetry`](../reference/services/telemetry.md)
