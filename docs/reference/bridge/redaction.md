---
title: Redaction (bridge)
description: RedactionFilter scrubs secret-shaped fields before they cross the wire.
kind: reference
audience: app-developers
effect_version: 4
---

# Redaction

`RedactionFilter` walks structured data and replaces secret-shaped values with Effect `Redacted` instances. When the value is later serialized (or materialized via `redactForJson`), the redacted slot reads as a label-qualified `<redacted:LABEL>` placeholder (e.g. `<redacted:redacted>` for pattern matches, `<redacted:SecretBytes>` for secret bytes).

## Import

```ts
import {
  RedactionFilter,
  redact,
  redactForJson,
  redactWithEvidence,
  redactForJsonWithEvidence,
  type RedactionFilterOptions,
  type RedactionEvidence
} from "@orika/bridge"
```

`RedactionFilter` is also re-exported as `Desktop.RedactionFilter`, and `redact` as a top-level named export, from `@orika/core`.

## How matching works

Keys are matched against `RedactionFilter.defaultPattern` (case-insensitive):

```
/api[_-]?key|token|password|secret|bearer|authorization|cookie|session[_-]?id|refresh[_-]?token|client[_-]?secret|private[_-]?key/i
```

Pass `RedactionFilterOptions.additionalPatterns` to extend matching, `allowlist` to exempt specific keys or dotted paths, and `defaultPatternEnabled: false` to disable the built-in pattern. The filter preserves object identity when nothing changed, handles cycles, and never touches `Uint8Array` payloads or already-`Redacted` values.

`redactWithEvidence` / `redactForJsonWithEvidence` return `{ value, evidence }` where each `RedactionEvidence` row carries the redacted dotted path, the action, and whether the reason was `secret-pattern` or an existing `redacted-value`.

## Where it runs

Redaction is opt-in per integration. The framework wires it through:

- `AuditEvents` — when `redaction` is passed to `makeAuditEvents`, the whole event payload is routed through an inspector safety policy (redaction + high-risk omission) before append.
- `CrashReporter` breadcrumb `details` (via `redactForJson` in `@orika/native`).
- The inspector safety policy (`redactForJsonWithEvidence` in `@orika/core`), used by devtools snapshots and diagnostic bundles.

Application code can call `redact` / `redactForJson` directly when emitting custom telemetry or logs.

## Production check

The `secret-pattern-not-redacted` lint rule in `@orika/config` flags configurations that emit secret-shaped values without passing through the filter.

## Related

- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Reference: [`AuditEvents`](../services/audit-events.md), [`Secrets`](../services/secrets.md)
- Source: [`packages/bridge/src/redaction.ts`](../../../packages/bridge/src/redaction.ts)
