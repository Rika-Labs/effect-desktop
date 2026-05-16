---
title: ApprovalBroker
description: Coalesces approval requests and routes prompts through a substitutable host port.
kind: reference
audience: app-developers
effect_version: 4
---

# `ApprovalBroker`

Owns runtime approval coalescing and prompt-fatigue controls. Renderer code never constructs authoritative approval prompts; the broker does.

## Import

```ts
import {
  ApprovalBroker,
  type ApprovalBrokerApi,
  type ApprovalRequest,
  type ApprovalResolution,
  type ApprovalPromptPort,
  ApprovalBrokerError
} from "@effect-desktop/core"
```

## API

| Method    | Signature                                                      | Description                                          |
| --------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| `ask`     | `(request) => Effect<ApprovalResolution, ApprovalBrokerError>` | Validates, coalesces, queues, and routes the prompt. |
| `observe` | `() => Stream<ApprovalRequest>`                                | Live stream of new requests.                         |
| `cancel`  | `(requestId) => Effect<void>`                                  | Cancel a pending request.                            |

## Behavior

- **Coalescing.** Identical `(operation, actor, resource)` requests share one prompt.
- **At most one prompt per actor.** Distinct requests queue behind it up to `maxQueueDepthPerActor` (default 8).
- **Denied-for-scope cache.** A denial is cached so future identical requests fail without re-prompting.
- **`devApproveAll` bypass.** Grants once without touching the host port; emits the same audit path with `source: "dev-approve-all"`.

## `ApprovalPromptPort`

The substitutable seam. Production: a host-rendered native modal. Tests: a deterministic resolver. The renderer's `PermissionApprovalQueue` consumes the port through React.

## Errors

- `ApprovalBrokerError.QueueOverflow` — per-actor queue full (default depth 8).
- `ApprovalBrokerError.PortError` — `ApprovalPromptPort` failed.
- `ApprovalBrokerError.Canceled` — request canceled before resolution.

## Layer

`makeApprovalBroker({ port, maxQueueDepthPerActor?, devApproveAll? })` returns a layer.

## Example

```ts
const broker = yield * ApprovalBroker
const resolution =
  yield *
  broker.ask({
    id: crypto.randomUUID(),
    operation: "filesystem.write",
    actor: { kind: "window", id: "main" },
    resource: "/Users/me/Downloads/file.md",
    context: {
      /* additional details */
    }
  })
if (resolution.approved) {
  // proceed
}
```

## Related

- Explanation: [Permissions model](../../explanation/permissions-model.md)
- Reference: [`PermissionRegistry`](permission-registry.md), [React permissions](../react/permissions.md)
- How-to: [Handle an approval prompt](../../how-to/handle-an-approval-prompt.md)
- Source: [`packages/core/src/runtime/approval-broker.ts`](../../../packages/core/src/runtime/approval-broker.ts)
