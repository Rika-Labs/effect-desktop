---
title: Permissions (React)
description: Hooks and components for permission checks and approval prompts.
kind: reference
audience: app-developers
effect_version: 4
---

# Permission hooks

Renderer-side wrappers over `PermissionRegistry` and `ApprovalBroker`.

## Imports

```ts
import {
  usePermission,
  usePermissionApproval,
  useApprovalNotifications,
  PermissionApprovalQueue,
  type PermissionApprovalState,
  type PermissionApprovalQueueProps,
  type PendingApproval,
  type ApprovalResolver,
  type ApprovalResolution
} from "@orika/react"
```

## `usePermission(capability)`

Reads the current grant state for a capability.

```ts
const fsGrant = usePermission({ kind: "filesystem.read", roots: ["/Users/me/Documents"] })
// { granted: boolean, isPending, error? }
```

## `usePermissionApproval()`

Returns `{ pending, resolve }` for the approval queue. Build your own UI:

```tsx
const { pending, resolve } = usePermissionApproval()
return pending.map((req) => (
  <Modal key={req.id}>
    <button onClick={() => resolve(req.id, { approved: true })}>Allow</button>
    <button onClick={() => resolve(req.id, { approved: false })}>Deny</button>
  </Modal>
))
```

## `<PermissionApprovalQueue />`

Prebuilt approval queue component. Mount near app root:

```tsx
<PermissionApprovalQueue
  onResolve={(resolution) => {
    /* telemetry */
  }}
  onReject={() => {
    /* telemetry */
  }}
/>
```

## `useApprovalNotifications(options?)`

Posts a `Notification` for each new pending approval. Useful for background flows.

## Related

- How-to: [Declare a permission](../../how-to/declare-a-permission.md), [Handle an approval prompt](../../how-to/handle-an-approval-prompt.md)
- Reference: [`PermissionRegistry`](../services/permission-registry.md), [`ApprovalBroker`](../services/approval-broker.md)
- Explanation: [Permissions model](../../explanation/permissions-model.md)
- Source: [`packages/react/src/permission.ts`](../../../packages/react/src/permission.ts), [`permission-approval.ts`](../../../packages/react/src/permission-approval.ts)
