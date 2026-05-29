---
title: DiagnosticsBundle (native)
description: Product-neutral diagnostics bundle exporter with redaction evidence.
kind: reference
audience: app-developers
effect_version: 4
---

# `DiagnosticsBundle`

Product-neutral diagnostics bundle exporter. It writes one user-shareable JSON artifact containing host state plus explicit source records for logs, traces, crash reports, extension health, and audit events.

The public service is Layer-first and test-substitutable. The Rust host adapter validates input, runs each requested source through the host collector registry, applies JSON redaction, and writes the artifact to the requested destination.

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

When omitted, the host and memory clients use all sources.

The host artifact never uses metadata-only placeholders. Each source entry is either:

```json
{
  "source": "host-state",
  "status": "collected",
  "items": [{ "kind": "host-state", "os": "macos", "arch": "aarch64" }]
}
```

or:

```json
{
  "source": "logs",
  "status": "unavailable",
  "items": [
    {
      "kind": "source-unavailable",
      "reason": "collector-unavailable",
      "message": "host logs are not connected to a persisted log source",
      "recoverable": false
    }
  ],
  "unavailable": {
    "reason": "collector-unavailable",
    "message": "host logs are not connected to a persisted log source",
    "recoverable": false
  }
}
```

`host-state` is collected from the running host process. `crash-reports` is collected from the persisted crash report store (status `collected` when reports exist, `unavailable` only on a read error). Logs, traces, extension health, and audit events currently appear as explicit unavailable records until those durable host stores are connected.

## Events

- `collect-started`
- `source-redacted`
- `write-completed`
- `failed`

Events carry the bundle id, timestamp, and source/write/error details needed to debug export progress. Callers subscribe with a bundle id so one export cannot observe another export's event stream.

`events(identity)` is exposed as the canonical `DiagnosticsBundle.events.Event` RPC stream. The stream payload is the typed `DiagnosticsBundleEvent` union and the input is `DiagnosticsBundleIdentity`, so bundle scoping is part of the RPC contract. Bridge clients keep translating that contract to the existing host event channels `DiagnosticsBundle.CollectStarted`, `DiagnosticsBundle.SourceRedacted`, `DiagnosticsBundle.WriteCompleted`, and `DiagnosticsBundle.Failed`.

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

`supported` means the host can validate requests, run the source registry, write the JSON artifact, and report unavailable sources in-band. It does not mean every source has a durable backing store on every platform.

## Architecture-debt sweep

The legacy `DiagnosticsBundleRpcEvents` side object has been removed. Diagnostics events now live in the same `RpcGroup` contract as request/response methods. The zero-policy `DiagnosticsBundleLive` and `DiagnosticsBundleServiceApi` aliases were also removed; callers should use `DiagnosticsBundle.layer` and `DiagnosticsBundleClientApi`.

The diagnostics host path keeps the source registry inside the Rust adapter because it owns desktop-specific source availability and artifact layout. The bridge event merge helper stays private because it owns native/web protocol translation from one bundle-scoped RPC stream to the host's four legacy event channels.

## Testing

Use `makeDiagnosticsBundleMemoryClient()` for deterministic success and failure tests without OS dialogs. Use `makeDiagnosticsBundleUnsupportedClient()` when a test needs a typed unsupported failure.

## Related

- Source: [`packages/native/src/diagnostics-bundle.ts`](../../../packages/native/src/diagnostics-bundle.ts)
- Contract: [`packages/native/src/contracts/diagnostics-bundle.ts`](../../../packages/native/src/contracts/diagnostics-bundle.ts)
