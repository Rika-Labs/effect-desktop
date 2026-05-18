---
title: AttachmentIntake (native)
description: Product-neutral attachment intake contract with MIME, size, count, and lifetime limits.
kind: reference
audience: app-developers
effect_version: 4
---

# `AttachmentIntake`

Product-neutral attachment intake service for caller-provided bytes and native intake sources such as drag/drop, paste, file picker, clipboard files, screenshots, and MIME payloads. The service validates intake policy before exposing metadata to callers.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks declared native permissions before privileged work, emits typed lifecycle events, and records audit rows for privileged use and denial.

## Methods

| Method        | Payload                                         | Success                                 |
| ------------- | ----------------------------------------------- | --------------------------------------- |
| `ingest`      | `{ actor, policy, items, intakeId?, traceId? }` | `{ intakeId, items, state, expiresAt }` |
| `inspect`     | `{ intakeId, traceId? }`                        | `{ intakeId, items, state, expiresAt }` |
| `dispose`     | `{ intakeId, traceId? }`                        | `{ intakeId, disposed }`                |
| `isSupported` | `void`                                          | `{ supported, reason? }`                |
| `events`      | `void`                                          | stream of intake lifecycle events       |

## Policy

The policy is data:

- `allowedMimeTypes`
- `maxItems`
- `maxBytesPerItem`
- `maxTotalBytes`
- `lifetimeMillis`

`ingest` rejects disallowed MIME types, too many items, oversized items, oversized total payloads, and invalid lifetime limits before calling the host client.

## Support

The current Rust host adapter is intentionally fail-closed while native OS intake adapters are not implemented.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. Mutating host requests decode and validate payloads, then return typed `Unsupported`; invalid payloads are rejected before the unsupported response.

## Testing

Use `makeAttachmentIntakeMemoryClient()` for deterministic ingest, inspect, dispose, and event tests without native prompts. Use `makeAttachmentIntakeUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/attachment-intake.ts`](../../../packages/native/src/attachment-intake.ts)
- Contract: [`packages/native/src/contracts/attachment-intake.ts`](../../../packages/native/src/contracts/attachment-intake.ts)
