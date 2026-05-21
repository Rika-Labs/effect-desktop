---
title: CrashReporter (native)
description: Crash reporter API status, breadcrumbs, and report flushing.
kind: reference
audience: app-developers
effect_version: 4
---

# `CrashReporter`

Crash reporter setup and breadcrumb collection.

The Rust host implements local breadcrumb collection, flushes breadcrumbs into
inspectable JSON artifacts, rediscovers existing breadcrumb artifacts from disk,
and reports those artifacts through `getReports`.
`recordBreadcrumb`, `flush`, and `getReports` are fully supported for host-owned
breadcrumb artifacts. `start` reports `partial` on macOS, Windows, and Linux
because host crash capture, minidumps, symbol handling, upload consent, and
native crash hooks are still unavailable.
A successful `start()` call only enables or disables that local breadcrumb
collector. It does not install process crash handlers or create native crash
artifacts.

## Methods

| Method             | Payload                   | Success                    | Runtime support |
| ------------------ | ------------------------- | -------------------------- | --------------- |
| `start`            | `{ enabled?: boolean }`   | `void`                     | partial         |
| `recordBreadcrumb` | `CrashReporterBreadcrumb` | `void`                     | supported       |
| `flush`            | `void`                    | `{ flushed: number >= 0 }` | supported       |
| `getReports`       | `void`                    | `{ reports: Report[] }`    | supported       |

## Types

`CrashReporterBreadcrumb` — breadcrumb payload with `category`, `message`, optional
`details`, and optional `timestamp`.

`CrashReporterStartOptions` — `{ enabled?: boolean }`.

`CrashReporterReport` — local crash artifact metadata with `reportId`,
`artifactPath`, `createdAt`, `sizeBytes`, and `uploaded`. The production host
populates this for flushed breadcrumb artifacts. `uploaded` is currently always
`false`. `getReports` is backed by host-owned artifact discovery, so breadcrumb
artifacts remain visible after a host restart. The host retains the newest 20
breadcrumb artifacts and prunes older local breadcrumb artifacts on flush.

## Errors

`CrashReporterError` is the host protocol error union. `recordBreadcrumb` and
`flush` fail as `InvalidState` until `start({ enabled: true })` is called.
The public service checks the declared `native.invoke` permission before host
transport; denied calls fail as `PermissionDenied` and do not reach the native
host.

## Redaction

Breadcrumb `details` pass through `RedactionFilter` before host transport.
Secret-shaped fields are scrubbed.

The in-memory test client can validate breadcrumbs and flush recorded entries,
but it does not capture process crashes, upload reports, or prove symbol
boundaries. The Rust host persists local breadcrumb artifacts; native crash
artifacts remain future work.

## Related

- Reference: [`Telemetry`](../services/telemetry.md)
- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Source: [`packages/native/src/crash-reporter.ts`](../../../packages/native/src/crash-reporter.ts)
