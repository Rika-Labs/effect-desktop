---
title: DistributionParity (native)
description: Capability parity verification for distribution artifacts, plugin registration, templates, and docs.
kind: reference
audience: app-developers
effect_version: 4
---

# `DistributionParity`

Distribution parity verifies that packaging evidence, plugin registration, templates, and docs all describe the same capability contract before release artifacts are treated as shippable.

The public service is Layer-first and test-substitutable. It validates Schema contracts before native transport, checks `native.invoke` permission before host verification, and returns typed failures when evidence is malformed, denied, unsupported, or rejected by the host.

## Methods

| Method        | Payload                                          | Success                                                  |
| ------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `verify`      | `{ packageId, version, capabilities, evidence }` | `{ packageId, version, capabilityCount, evidenceCount }` |
| `isSupported` | `void`                                           | `{ supported, reason? }`                                 |
| `events`      | `void`                                           | stream of distribution parity events                     |

`events()` is exposed as the canonical `DistributionParity.events.Event` RPC stream. Renderer direct clients consume that stream through the RPC protocol; bridge clients translate it to the host event channel `DistributionParity.Event` at the native/web boundary.

## Evidence

Every `verify` request includes a non-empty package capability list and at least one evidence row for each required kind:

- `package-artifact`
- `plugin-registration`
- `template`
- `docs`

Each evidence row carries its own capability list. The host rejects the request unless every evidence row matches the package capability contract exactly. Release and diagnostic artifacts can add paths and SHA-256 values so failures remain debuggable without embedding secret material.

The host reads every evidence `path`. Evidence files must be non-empty JSON documents with a `capabilities` array, and an optional `sha256:` digest must match the file bytes. The host compares the request capability contract, each evidence row capability contract, and each evidence file capability contract. This keeps verification tied to concrete package, plugin, template, and documentation artifacts instead of accepting detached caller assertions.

## Permissions

The service checks native invoke permission before host verification:

- `Native.Permissions.distributionParity.verify`

Denied requests do not cross the host boundary. Successful verification emits `permission-used`; denied requests emit `permission-denied`; host failures emit failure audit rows.

## Support

| Platform | Status      | Reason |
| -------- | ----------- | ------ |
| macOS    | `supported` |        |
| Windows  | `supported` |        |
| Linux    | `supported` |        |

## Architecture Debt Sweep

The legacy `DistributionParityRpcEvents` side object has been removed. Distribution parity events now live in the same `RpcGroup` contract as request/response methods, while bridge-specific host event naming stays local to the bridge client adapter.

## Related

- Service: [`packages/native/src/distribution-parity.ts`](../../../packages/native/src/distribution-parity.ts)
- Contract: [`packages/native/src/contracts/distribution-parity.ts`](../../../packages/native/src/contracts/distribution-parity.ts)
- Host protocol: [`crates/host-protocol/src/lib.rs`](../../../crates/host-protocol/src/lib.rs)
- Host router: [`crates/host/src/methods/distribution_parity.rs`](../../../crates/host/src/methods/distribution_parity.rs)
