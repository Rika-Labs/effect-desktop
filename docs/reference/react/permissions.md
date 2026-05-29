---
title: Permissions (React)
description: Hooks and components for permission checks and approval prompts.
kind: reference
audience: app-developers
effect_version: 4
---

# Permission hooks

Renderer-side hooks for the in-flight approval flow. The host owns the durable `PermissionRegistry`/`ApprovalBroker` — these hooks model only the renderer half: declaring intent (`usePermission`) and driving an in-flight prompt queue (`usePermissionApproval` + `PermissionApprovalQueue`).

## Imports

```ts
import {
  usePermission,
  usePermissionApproval,
  useApprovalNotifications,
  PermissionApprovalQueue,
  type PermissionState,
  type PermissionApprovalState,
  type PermissionApprovalQueueProps,
  type PermissionApprovalPromptProps,
  type PendingApproval,
  type ApprovalResolver,
  type ApprovalResolution
} from "@orika/react"
```

## `usePermission(permission)` → `PermissionState`

Marks the component as depending on `permission` (a non-empty string identifier such as `"dialog.open"`). The current renderer build returns a placeholder shape so callsites compile and survive future wiring; it is the renderer hook surface the host approval pipeline will resolve against.

```tsx
const dialog = usePermission("dialog.open")
// { status: "deferred", permission: "dialog.open" }
```

Throws `RangeError` if `permission` is an empty string.

## `usePermissionApproval(resolver)` → `PermissionApprovalState`

Drives an in-renderer queue of `PendingApproval` requests against an `ApprovalResolver`:

```ts
type ApprovalResolver<E = unknown> = (
  token: string,
  approved: boolean,
  approval: PendingApproval
) => Effect.Effect<void, E, never>
```

Returns:

- `pending: readonly PendingApproval[]` — unresolved prompts in insertion order.
- `resolutions: ReadonlyMap<string, AsyncResult<void, E>>` — per-token resolution state (waiting / success / failure).
- `push(approval)` — append a new pending approval (no-op if its token is already pending).
- `resolve(token, approved)` — fire-and-forget; runs the resolver.
- `resolvePromise(token, approved)` — same, returning `Promise<Exit.Exit<void, E>>`. In-flight calls for the same token are deduplicated.
- `clearResolution(token)` — drop a stored resolution (e.g. after surfacing a failure).

```tsx
const queue = usePermissionApproval((token, approved) => host.decideApproval(token, approved))

return queue.pending.map((req) => (
  <Modal key={req.token}>
    <button onClick={() => queue.resolve(req.token, true)}>Allow</button>
    <button onClick={() => queue.resolve(req.token, false)}>Deny</button>
  </Modal>
))
```

## `<PermissionApprovalQueue state={...} renderPrompt={...} />`

Renders each pending approval. Returns `null` when `state.pending` is empty. `renderPrompt` is optional; the default prompt is a minimal `Approve`/`Deny` pair carrying the trace id.

```tsx
<PermissionApprovalQueue
  state={queue}
  renderPrompt={({ approval, resolution, onApprove, onDeny }) => (
    <ApprovalDialog
      approval={approval}
      busy={resolution.waiting}
      onApprove={() => onApprove(approval.token)}
      onDeny={() => onDeny(approval.token)}
    />
  )}
/>
```

## `useApprovalNotifications(push, subscribe)`

Bridges an external subscription (e.g. a host event stream) into a `PermissionApprovalState`. Calls `subscribe(handler)` once per `subscribe` reference; each emitted `PendingApproval` is forwarded to `push`. The returned unsubscribe runs on cleanup.

```tsx
useApprovalNotifications(queue.push, (handler) => host.onApproval(handler))
```

## Related

- How-to: [Declare a permission](../../how-to/declare-a-permission.md), [Handle an approval prompt](../../how-to/handle-an-approval-prompt.md)
- Reference: [`PermissionRegistry`](../services/permission-registry.md), [`ApprovalBroker`](../services/approval-broker.md)
- Explanation: [Permissions model](../../explanation/permissions-model.md)
- Source: [`packages/react/src/permission.ts`](../../../packages/react/src/permission.ts), [`permission-approval.ts`](../../../packages/react/src/permission-approval.ts)
