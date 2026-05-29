---
title: CrashReporter capability truth
date: 2026-05-18
issue: 1332
---

# CrashReporter capability truth

## Context

#1332 requires observable crash artifacts, consent boundaries, local inspection,
host permission enforcement, and native crash capture. The existing TypeScript
surface only validates start options, records breadcrumbs through a bridge or
memory client, and can enqueue breadcrumb payloads for submission workflows.

## What changed

- Marked `CrashReporter.start`, `CrashReporter.recordBreadcrumb`, and
  `CrashReporter.flush` unsupported on macOS, Windows, and Linux while the Rust
  host adapter is absent.
- Regenerated the native parity matrix so support metadata matches the missing
  host dispatch methods.
- Corrected the CrashReporter reference page and bridge redaction page to match
  the current TypeScript contract.

## Verification

- `bun scripts/generate-native-parity-matrix.ts`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'CrashReporter|NativeCapabilities|NativeParityMatrix'`
- `bun test packages/native/src/crash-report-workflow.test.ts`
- `git diff --check`

## Architecture-debt sweep

Touched area: CrashReporter TypeScript surface, crash-report workflow, native
capability metadata, generated parity matrix, diagnostics references, bridge
redaction docs, and Rust host protocol/router search results.

Debt found: the current TypeScript memory client and workflow are useful test
ports for breadcrumb policy, but they are not native crash reporting. They do not
own durable desktop semantics for crash capture, symbol handling, artifact
storage, consent-gated upload, or local report inspection. The correct future
shape is a small Effect service backed by real Rust host methods and a durable
artifact source that diagnostics can inspect.

No wrapper was removed in this patch because the issue remains open for the real
host adapter. The corrective change prevents the unsupported adapter from being
advertised as supported.
