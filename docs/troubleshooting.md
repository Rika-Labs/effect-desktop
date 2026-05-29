---
title: Troubleshooting
description: Typed errors and `desktop doctor` to find the failing path fast.
kind: reference
audience: app-developers
effect_version: 4
---

# Troubleshooting

> Full reference: [`reference/errors.md`](reference/errors.md). How-to: [`diagnose with doctor`](how-to/diagnose-with-doctor.md).

ORIKA failures are typed and observable. Start with the narrowest command that exercises the failing path, then match on the error's `_tag` rather than catching `unknown`.

## First step: run doctor

```bash
bun run desktop doctor
```

The doctor command exits non-zero when a runtime, capability, or config invariant is missing. It fails with `DoctorMissing` (a required artifact is absent) or `DoctorCapabilityTruthUnavailable` (the capability truth file could not be loaded). Both are typed and printed verbatim.

## Symptom: `MissingDesktopContextError`

You called a desktop hook (e.g. `useDesktop`) outside the framework provider.

- Wrap the component tree in the desktop provider for your framework (`DesktopProvider` from `@orika/react`, the Vue plugin, the Solid context, etc.) before invoking hooks.
- The error includes `framework` and a `remediation` string identifying the missing provider.

## Symptom: `MissingDesktopRpcsError`

The renderer is calling an `RpcGroup` that is not in the manifest.

- Register the group on the runtime side with `Desktop.make({ rpcs: Desktop.rpc(group, handlers) })` (compose multiple via `Desktop.rpcs`).
- Pass `Desktop.manifest(App)` to the framework adapter so the renderer sees the same group set.

## Symptom: `MissingDesktopRpcClientError`

The framework adapter could not find a renderer RPC client for the tag in the error's `tag` field.

- Install or wire the renderer client for that group; the error's `remediation` field includes the exact tag.

## Symptom: `DuplicateDesktopRpcNameError`

Two RPC tags lower to the same framework endpoint name.

- Rename one method so the final tag segment is unique inside the `RpcGroup`. The error carries both the offending `name` and the colliding `tags`.

## Symptom: bridge call rejected as `HostProtocolError`

The bridge returned a typed protocol failure. Match on the variant `tag`:

- `Unsupported` — the operation isn't supported on this platform; fall back or guard with a feature check.
- `MethodNotFound` — no handler registered for that method; check the surface declaration and handler wiring.
- `InvalidArgument` — payload failed schema decoding; inspect the error's `field` and `reason`.
- `InvalidOutput` — the host returned data the schema didn't accept; this points at host or schema drift, not user input.
- `PermissionDenied` / `PermissionRevoked` / `OriginInvalid` — denied at the boundary; trace the capability and grant.
- `Timeout`, `Cancelled`, `RuntimeRestarted`, `RuntimeUnavailable`, `HostUnavailable` — transient runtime conditions; consult `recoverable`.

`recoverable: boolean` on every variant indicates whether retry has any chance.

## Symptom: `NativeBoundaryError`

A native capability returned a host error that was classified at the boundary. Match on `reason`:

- `denied` — permission, revocation, or origin failure.
- `unsupported` — operation unavailable on this platform.
- `missing-host-method` — handler not registered in the host router.
- `invalid-input` / `invalid-output` — schema decode/encode failed.
- `host-failed` — any other propagated host failure; the original `HostProtocolError` is in `cause`.

The error carries `hostTag`, `operation`, and `recoverable`.

## Symptom: permission denied

`PermissionDeniedError` includes `reason` (`explicit-deny`, `approval-denied`, `revoked`, `expired`, `consumed`, `default-deny`), the `capability`, the `actor`, and a `traceId`. Cross-reference the trace ID against audit events to see the full decision path.

## Symptom: docs release gate fails

```bash
bun run desktop check --docs
```

The gate returns one of:

- `DocsGateFileError` — manifest or page file unreadable.
- `DocsGateManifestError` — `docs/docs-manifest.json` is invalid.
- `DocsGateMissingPageError` — a release-blocking page is missing or empty.
- `DocsGateExampleFailedError` — a ` ```ts run ` block failed or timed out (default 10s).
- `DocsGateCoverageError` — a required token is missing from a page's runnable block; see `REQUIRED_PAGE_COVERAGE_TOKENS` in `packages/cli/src/docs-release-gate.ts`.

## Symptom: a test reported `ResourceLeakError`

A test-layer scope closed with unreleased resources. The error includes the resource list. Either add the missing release path or use the deterministic test layers from `@orika/test`.

## Verify Doctor exports

```ts run
import { DoctorMissing, runDesktopDoctor } from "../packages/cli/src/index.js"

if (DoctorMissing === undefined || typeof runDesktopDoctor !== "function") {
  throw new Error("DoctorMissing or runDesktopDoctor is unavailable")
}
```

## Debug rule

**Do not swallow errors.** Keep the original tag, path, operation, command, stderr, and `recoverable` flag visible. Effect's typed failures are signal — convert to a domain error only when you have one to point at.

## Where to go next

- [How-to: diagnose with doctor](how-to/diagnose-with-doctor.md)
- [Errors catalog](reference/errors.md)
- [CLI reference](reference/cli.md)
