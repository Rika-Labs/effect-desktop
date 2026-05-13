---
date: 2026-05-13
type: in-flight-feature
topic: Harden Inspector redaction and sampling
issue: https://github.com/Rika-Labs/effect-desktop/issues/1251
pr: none
---

# Harden Inspector Redaction And Sampling

## Decision

Inspector safety evidence is itself a security boundary: it must be produced by the same policy layer, scrub its paths, and never be assembled by display-side adapters.

## What changed

The plan started as a shared redaction/sampling policy for telemetry and devtools surfaces. Review changed the final shape: devtools panels now require a shared `InspectorSafetyPolicy` layer instead of creating isolated default policies, telemetry exposes dropped/sampled evidence in its snapshot, and snapshot export returns a typed safety error instead of crashing when policy drops the payload.

## Why it mattered

The non-obvious failure mode was that metadata about redaction can leak what the redaction removed. A key such as `authorization: Bearer abc` can leak through `evidence.path` even if the value is redacted. The same review exposed a second mechanism problem: a string flag like `inspectorCapture: "safe"` is not a safety mechanism unless it validates an actual production-mode policy and the capture surfaces consume that policy.

## Example

```ts
const policy = yield* InspectorSafetyPolicy
const decision = yield* policy.sanitize({
  source: "devtools.snapshot",
  payload: snapshot
})
```

## Rule candidate

When adding evidence for omitted or redacted data, treat evidence fields as untrusted output too. Why: keys, paths, counters, and reasons can leak the sensitive payload even when values are redacted.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
