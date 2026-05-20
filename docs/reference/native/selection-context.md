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

The surface exposes only the genuinely callable methods below.

| Method        | Payload | Success                            |
| ------------- | ------- | ---------------------------------- |
| `isSupported` | `void`  | `{ supported, reason? }`           |
| `events`      | `void`  | stream of selection context events |

## Capability facts (non-callable)

`readSelection`, `readDocumentContext`, `watchFocus`, and `stopWatching` are **not callable**. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, so callers can discover the intended contract, but the surface does not register them as invocable RPCs.

| Capability fact       | Intended payload                                     | Status        |
| --------------------- | ---------------------------------------------------- | ------------- |
| `readSelection`       | `{ actor, access, traceId? }`                        | `unsupported` |
| `readDocumentContext` | `{ actor, access, traceId? }`                        | `unsupported` |
| `watchFocus`          | `{ actor, watchId?, ownerScope?, access, traceId? }` | `unsupported` |
| `stopWatching`        | `{ actor, watchId, traceId? }`                       | `unsupported` |

## Access

`metadata` responses omit text. `content` responses may include text and are audited separately from metadata access.

The `watchFocus` capability fact's intended contract registers an active watch with the resource registry and releases it through `stopWatching` on scope close. These describe the intended contract; the methods cannot currently be invoked.

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

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. `readSelection`, `readDocumentContext`, `watchFocus`, and `stopWatching` are non-callable capability facts published with `support.status: "unsupported"`, not invocable RPCs.
The bridge-backed `SelectionContext.Event` stream also fails as typed `Unsupported` before opening a host subscription until the native watch adapter can publish selection context events.

## Testing

Use `makeSelectionContextMemoryClient()` for deterministic `isSupported` and event tests without native prompts. Use `makeSelectionContextUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/selection-context.ts`](../../../packages/native/src/selection-context.ts)
- Contract: [`packages/native/src/contracts/selection-context.ts`](../../../packages/native/src/contracts/selection-context.ts)
