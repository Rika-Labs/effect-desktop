---
date: 2026-05-16
type: in-flight-feature
topic: Add diagnostics bundle exporter
issue: https://github.com/Rika-Labs/effect-desktop/issues/1390
pr: none
---

# Add diagnostics bundle exporter

## Decision

Native diagnostics capabilities must prove a real host path before they are marked supported; a Schema contract, typed errors, and capability metadata are not enough when the host still returns typed unsupported.

## What changed

The issue asked for a product-neutral diagnostics exporter with Schema contracts, Effect service layers, typed failures, streams, Rust protocol structs, host routing, docs, tests, and API snapshots. The shipped version adds `DiagnosticsBundle` as a narrow native service with collect, redact, write, support, and bundle-scoped event operations, plus a deterministic memory client, unsupported client, bridge client tests, capability metadata, Rust protocol structs, Rust router coverage, a host-backed artifact writer, docs, and snapshot updates.

The platform review changed the result. The first implementation had a complete TypeScript contract and Rust method names, but the Rust host still returned `Unsupported` for the privileged operations. The final version validates payloads on both sides, stores bundle records in the host adapter, writes redacted JSON artifacts, and scopes event subscriptions by `bundleId` so one caller cannot observe another bundle's lifecycle.

The architecture-debt sweep found the same event-aware native bridge adapter repetition tracked in #1393. No wrapper was removed in this issue because consolidation belongs in the shared `NativeSurface` helper across multiple event-capable services.

## Why it mattered

Diagnostics export is a privileged evidence path. The invariant is that supported means executable, malformed payloads fail before transport or filesystem effects, redaction records evidence without leaking secrets, and event streams do not cross bundle boundaries. A typed unsupported result is useful for unavailable platforms, but it is not a supported implementation.

The local incentive was to treat the public Effect contract as the hard part and leave host behavior as a later adapter detail. The platform review corrected that incentive by checking the whole path against the acceptance criteria instead of only the API shape.

## Example

```ts
readonly events: (input: DiagnosticsBundleIdentity) =>
  subscribeDiagnosticsBundleEvent(exchange).pipe(
    Stream.filter((event) => event.bundleId === input.bundleId),
  )
```

## Rule candidate

Before marking a native capability supported, add one host adapter test that performs the real operation end-to-end and decodes through the public Schema result. Why: typed `Unsupported` is a valid unavailable-platform failure, not proof that a supported capability exists.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
