---
title: Redaction (bridge)
description: RedactionFilter scrubs secret-shaped fields before they cross the wire.
kind: reference
audience: app-developers
effect_version: 4
---

# Redaction

The bridge runs every outgoing payload through `RedactionFilter` before encoding. Secret-shaped fields are replaced with `Redacted` values whose serialized form is `<redacted>`.

## Import

```ts
import { RedactionFilter, redact } from "@orika/bridge"
```

(Also re-exported as `Desktop.RedactionFilter` and `Desktop.redact` from `@orika/core`.)

## How matching works

Field name patterns from SPEC §14.10 — `token`, `password`, `secret`, `apiKey`, `credential`, `authorization`, `bearer`, etc. The filter walks structured data and replaces matching values, preserving object shape.

Custom patterns and explicit allowlist paths can be configured per-instance.

## Where it runs

- Every audit event, before append.
- Every bridge error, before emission.
- Every `CrashReporter` breadcrumb's `details`.
- Every devtools snapshot.

You can opt **in** to redaction in custom paths but you can't opt **out** at the audit layer.

## Production check

`secret-pattern-not-redacted` rule (in `desktop check`) catches code paths that emit a secret-shaped value without passing through the filter.

## Related

- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Reference: [`AuditEvents`](../services/audit-events.md), [`Secrets`](../services/secrets.md)
- Source: [`packages/bridge/src/redaction.ts`](../../../packages/bridge/src/redaction.ts)
