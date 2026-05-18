---
title: CrashReporter (native)
description: Crash reporter API status, breadcrumbs, and report flushing.
kind: reference
audience: app-developers
effect_version: 4
---

# `CrashReporter`

Crash reporter setup and breadcrumb collection.

The TypeScript surface is present for contract and test-layer work, but the Rust
host crash reporter adapter is not implemented. The native surface reports
`unsupported` on macOS, Windows, and Linux until host crash capture, artifact
storage, permission enforcement, and report inspection are implemented.

## Methods

| Method             | Payload                   | Success                    | Runtime support |
| ------------------ | ------------------------- | -------------------------- | --------------- |
| `start`            | `{ enabled?: boolean }`    | `void`                     | unsupported     |
| `recordBreadcrumb` | `CrashReporterBreadcrumb` | `void`                     | unsupported     |
| `flush`            | `void`                    | `{ flushed: number >= 0 }` | unsupported     |

## Types

`CrashReporterBreadcrumb` — breadcrumb payload with `category`, `message`, optional
`details`, and optional `timestamp`.

`CrashReporterStartOptions` — `{ enabled?: boolean }`.

## Errors

`CrashReporterError` is the host protocol error union. Until the host adapter is
implemented, bridge calls reach an unsupported or missing-method host path rather
than native crash capture.

## Redaction

Breadcrumb `details` pass through `RedactionFilter` before host transport.
Secret-shaped fields are scrubbed.

The in-memory test client can validate breadcrumbs and flush recorded entries,
but it does not capture process crashes, persist crash artifacts, upload reports,
or prove user consent boundaries.

## Related

- Reference: [`Telemetry`](../services/telemetry.md)
- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Source: [`packages/native/src/crash-reporter.ts`](../../../packages/native/src/crash-reporter.ts)
