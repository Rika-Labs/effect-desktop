---
title: How to handle an approval prompt
description: Render the host approval queue in your renderer with PermissionApprovalQueue.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to handle an approval prompt

When a permission resolves to `approval`, `ApprovalBroker` queues the request. The renderer subscribes to pending approvals and shows them through `PermissionApprovalQueue`.

## 1. Mount the queue component

Place `PermissionApprovalQueue` near your app root so it can render approval modals over your UI:

```tsx
import { PermissionApprovalQueue } from "@effect-desktop/react"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PermissionApprovalQueue
        onResolve={(resolution) => {
          // optional: telemetry, log, etc.
        }}
        onReject={() => {
          // optional
        }}
      />
    </>
  )
}
```

The component reads `ApprovalBroker`'s pending queue, renders the host-rendered prompt for each request, and passes the user's choice back through the broker.

## 2. Customize the prompt

The default prompt is functional but plain. To customize:

```tsx
import { usePermissionApproval } from "@effect-desktop/react"

function CustomApprovalQueue() {
  const { pending, resolve } = usePermissionApproval()

  if (pending.length === 0) return null
  const next = pending[0]

  return (
    <Modal>
      <h3>{next.operation} requires permission</h3>
      <p>{next.resource}</p>
      <button onClick={() => resolve(next.id, { approved: true })}>Allow</button>
      <button onClick={() => resolve(next.id, { approved: false })}>Deny</button>
    </Modal>
  )
}
```

`usePermissionApproval` exposes `{ pending, resolve }` directly. Render whatever UI you want; the broker doesn't care about the visual.

## 3. Notify the user when there's a pending request

For background flows, you may want a system notification when an approval is waiting:

```tsx
import { useApprovalNotifications } from "@effect-desktop/react"

function App() {
  useApprovalNotifications({
    title: (request) => `Approve ${request.operation}?`,
    body: (request) => request.resource
  })
  return <Routes />
}
```

The hook subscribes to approval queue changes and posts a `Notification` for each new request.

## Why the prompt is renderer-rendered but broker-decided

The prompt visual is your renderer's responsibility. The **decision** is the broker's: it coalesces duplicates, queues per-actor, caches denied-for-scope, and emits audit events. You can ship a custom modal without losing any of that infrastructure.

The renderer never gets to construct an authoritative prompt directly — it can only render the queue the broker provides. (See [boundary rule](../explanation/boundary-rule.md).)

## Development bypass

When iterating, set `devApproveAll: true` on the broker to skip prompts:

```ts
const ApprovalBrokerLive = makeApprovalBroker({ devApproveAll: true, ... })
```

Approvals still emit audit events with `source: "dev-approve-all"` so the bypass is reviewable, not invisible.

## Related

- How-to: [Declare a permission](declare-a-permission.md)
- Explanation: [Permissions model](../explanation/permissions-model.md)
- Reference: [`ApprovalBroker`](../reference/services/approval-broker.md), [React permissions](../reference/react/permissions.md)
