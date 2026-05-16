---
title: DiagnosticsBundle (native)
description: Product-neutral diagnostics bundle exporter with redaction evidence.
kind: reference
audience: app-developers
effect_version: 4
---

# `DiagnosticsBundle`

Product-neutral diagnostics bundle exporter. It collects logs, traces, crash reports, host state, extension health, and audit events into one user-shareable artifact.

The public service is Layer-first and test-substitutable. The Rust host adapter validates input, collects source metadata, applies JSON redaction, and writes a JSON bundle artifact to the requested destination.

## Methods

| Method        | Payload                                   | Success                                                |
| ------------- | ----------------------------------------- | ------------------------------------------------------ |
| `collect`     | `{ bundleId?, sources?, traceId? }`       | `{ bundleId, collectedAt, sources, artifactCount }`    |
| `redact`      | `{ bundleId, source, payload }` JSON      | `{ bundleId, source, payload, redactionPolicy }`       |
| `write`       | `{ bundleId, destinationPath, traceId? }` | `{ bundleId, destinationPath, bytesWritten, sources }` |
| `isSupported` | `void`                                    | `{ supported, reason? }`                               |

## Sources

`sources` is a closed set:

- `logs`
- `traces`
- `crash-reports`
- `host-state`
- `extension-health`
- `audit-events`

When omitted, the memory client uses all sources.

## Events

- `collect-started`
- `source-redacted`
- `write-completed`
- `failed`

Events carry the bundle id, timestamp, and source/write/error details needed to debug export progress. Callers subscribe with a bundle id so one export cannot observe another export's event stream.

## Redaction

`redact` applies the shared bridge redaction filter. The result includes the redacted payload plus a `redactionPolicy` record:

```ts
{
  id: "default-secret-patterns",
  evidence: [{ path, action: "redacted", reason }]
}
```

Evidence records which source policy was used and where redaction happened without preserving secret values.

## Errors

`DiagnosticsBundleError` is the canonical host protocol error union. Permission denial, unsupported platforms, invalid input, invalid bundle lifecycle, and host failures are typed tagged failures.

## Support

| Platform | Status      |
| -------- | ----------- |
| macOS    | `supported` |
| Windows  | `supported` |
| Linux    | `supported` |

## Testing

Use `makeDiagnosticsBundleMemoryClient()` for deterministic success and failure tests without OS dialogs. Use `makeDiagnosticsBundleUnsupportedClient()` when a test needs a typed unsupported failure.

## Related

- Source: [`packages/native/src/diagnostics-bundle.ts`](../../../packages/native/src/diagnostics-bundle.ts)
- Contract: [`packages/native/src/contracts/diagnostics-bundle.ts`](../../../packages/native/src/contracts/diagnostics-bundle.ts)
