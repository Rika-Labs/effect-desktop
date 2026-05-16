---
title: CrashReporter (native)
description: Crash reporter setup, breadcrumbs, and report flushing.
kind: reference
audience: app-developers
effect_version: 4
---

# `CrashReporter`

Crash reporter setup and breadcrumb collection.

## Methods

| Method   | Payload                                            | Success |
| -------- | -------------------------------------------------- | ------- |
| `start`  | `{ productName, version, companyName, submitUrl }` | `void`  |
| `report` | `CrashReporterBreadcrumb`                          | `void`  |

## Types

`CrashReporterBreadcrumb` — event payload (timestamp, level, category, message, data).

`CrashReporterStartOptions` — `{ productName, version, companyName, submitUrl }`.

## Errors

`CrashReporterError`.

## Redaction

Breadcrumb `data` passes through `RedactionFilter` before submission. Secret-shaped fields are scrubbed.

## Related

- Reference: [`Telemetry`](../services/telemetry.md)
- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Source: [`packages/native/src/crash-reporter.ts`](../../../packages/native/src/crash-reporter.ts)
