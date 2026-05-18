---
title: SelectionContext (native)
description: Product-neutral selection and document context broker with separated metadata and content access.
kind: reference
audience: app-developers
effect_version: 4
---

# `SelectionContext`

Product-neutral broker for the active selection and surrounding document context. Callers choose `access: "metadata"` when they only need counts, IDs, source application, and document descriptors; they must request `access: "content"` to receive selected text or document text.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before host side effects, audits both metadata and content access, emits typed events, and preserves typed host failures.

## Methods

| Method                | Payload                                              | Success                            |
| --------------------- | ---------------------------------------------------- | ---------------------------------- |
| `readSelection`       | `{ actor, access, traceId? }`                        | `{ metadata, text? }`              |
| `readDocumentContext` | `{ actor, access, traceId? }`                        | `{ metadata, text? }`              |
| `watchFocus`          | `{ actor, watchId?, ownerScope?, access, traceId? }` | `{ watchId, active, access }`      |
| `stopWatching`        | `{ actor, watchId, traceId? }`                       | `{ watchId, stopped }`             |
| `isSupported`         | `void`                                               | `{ supported, reason? }`           |
| `events`              | `void`                                               | stream of selection context events |

## Access

`metadata` responses omit text. `content` responses may include text and are audited separately from metadata access.

`watchFocus` registers an active watch with the resource registry when one is provided to the service layer. Closing the owning resource scope releases the watch through `stopWatching` and emits a `watch-stopped` event in substitutable clients.

The actor is data:

- `kind`: `"workspace"`, `"extension"`, `"tool"`, `"process"`, `"native"`, `"app"`, or `"window"`
- `id`: printable non-empty string

## Support

The current Rust host adapter is intentionally fail-closed while OS selection and document adapters are not implemented.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. Host requests decode and validate payloads, then return typed `Unsupported`; invalid payloads are rejected before the unsupported response.

## Testing

Use `makeSelectionContextMemoryClient()` for deterministic selection, document, focus-watch, cleanup, and event tests without native prompts. Use `makeSelectionContextUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/selection-context.ts`](../../../packages/native/src/selection-context.ts)
- Contract: [`packages/native/src/contracts/selection-context.ts`](../../../packages/native/src/contracts/selection-context.ts)
