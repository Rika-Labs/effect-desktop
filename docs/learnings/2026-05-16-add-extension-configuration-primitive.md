---
date: 2026-05-16
type: in-flight-feature
topic: Add extension configuration primitive
issue: https://github.com/Rika-Labs/effect-desktop/issues/1387
pr: none
---

# Add extension configuration primitive

## Decision

Secret-bearing public APIs should use `SecretBytes`, while bridge DTOs should carry only proof keys or handles.

## What changed

The issue asked for a product-neutral extension configuration primitive with Schema contracts, tagged Effect failures, permission enforcement, safe-storage-backed secret fields, redacted diagnostics, host wiring, docs, tests, and API snapshots. The shipped primitive keeps typed values in the host config payload, stores secret material through safe storage, and exposes reset/read/redact/write through a Layer-backed `ExtensionConfig` service and substitutable clients.

The platform-fit review changed the public write shape. A Schema class that accepted raw `Uint8Array` would have made secret bytes a serializable application contract. The final public request accepts `SecretBytes`; the bridge request carries only `secretKeys` and rejects attempts to use bridge writes as a secret-value path.

## Why it mattered

The invariant is that secret material must never become ordinary structured payload data. The hidden assumption was that one Schema request could serve both the public service and bridge transport. That collapsed two boundaries: the caller boundary, where redaction and explicit secret construction matter, and the native bridge boundary, where only non-secret evidence should travel.

## Example

```ts
export interface ExtensionConfigWriteRequest {
  readonly values?: readonly ExtensionConfigValueEntry[]
  readonly secrets?: readonly {
    readonly key: string
    readonly value: SecretBytes
  }[]
}
```

## Rule candidate

Do not reuse bridge DTOs as public secret-bearing request types. Why: bridge schemas optimize for transport evidence, while public service APIs must preserve redaction and secret construction invariants.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
