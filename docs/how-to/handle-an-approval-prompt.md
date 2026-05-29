---
title: How to handle an approval prompt
description: Render the host approval queue in your renderer with PermissionApprovalQueue.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to handle an approval prompt

When a permission resolves to `approval`, the framework drives the user-facing prompt through `PermissionApprovalWorkflow` and `ApprovalBroker`. The renderer keeps a local queue of pending requests and resolves each by calling back into the workflow.

## 1. Wire a resolver and queue

`usePermissionApproval(resolver)` returns the local queue state. The `resolver` is the effectful callback the renderer runs when the user picks approve / deny — typically a generated client method that resolves the approval-prompt durable deferred.

```tsx
import { Effect } from "effect"
import {
  PermissionApprovalQueue,
  usePermissionApproval,
  type ApprovalResolver,
  type PendingApproval
} from "@orika/react"

const resolveApproval: ApprovalResolver = (token, approved) =>
  Effect.gen(function* () {
    // call the generated client that drives resolveApprovalDeferred on the host
    yield* yourGeneratedClient.permission.resolve({ token, approved })
  })

export function AppShell() {
  const state = usePermissionApproval(resolveApproval)

  return <PermissionApprovalQueue state={state} />
}
```

`PermissionApprovalQueue` renders nothing while `state.pending` is empty. When requests arrive (see step 2) it renders the default prompt, which calls `state.resolve(token, approved)` on the user's pick. `resolve(token, approved)` runs the resolver, tracks the `ApprovalResolution`, and removes the entry on success.

## 2. Feed pending approvals into the queue

The queue does not subscribe to host events on its own. Wire a subscription that pushes new approvals into `state.push(...)`. `useApprovalNotifications` is a thin helper that takes a `push` function and a `subscribe(handler)` function and bridges the two:

```tsx
import { useApprovalNotifications } from "@orika/react"

useApprovalNotifications(state.push, (handler) => {
  // subscribe to whatever stream you expose for pending approvals
  const unsubscribe = pendingApprovalsStream.subscribe(handler)
  return unsubscribe
})
```

`PendingApproval` carries `{ token, traceId, capability, actor, resource? }`. The `token` is the durable-deferred token; resolving it with the workflow completes the underlying approval.

## 3. Customize the prompt

`PermissionApprovalQueue` accepts a `renderPrompt` prop for full visual control:

```tsx
<PermissionApprovalQueue
  state={state}
  renderPrompt={({ approval, resolution, onApprove, onDeny }) => (
    <Modal>
      <h3>Approve {String(approval.traceId)}?</h3>
      <p>{approval.resource}</p>
      <button disabled={resolution.waiting} onClick={() => onApprove(approval.token)}>
        Allow
      </button>
      <button disabled={resolution.waiting} onClick={() => onDeny(approval.token)}>
        Deny
      </button>
    </Modal>
  )}
/>
```

`resolution` is an `AsyncResult`; check `resolution.waiting` to disable buttons while the resolver runs and inspect the `Exit` once it completes.

## Why the prompt is renderer-rendered but broker-decided

The prompt visual is your renderer's responsibility. The **decision** is the broker's: it coalesces duplicates, queues per-actor, caches denied-for-scope, and emits `approval-requested` / `approval-granted` / `approval-denied` audit events. You can ship a custom modal without losing any of that infrastructure.

The renderer never gets to construct an authoritative prompt directly — it can only render approvals routed through `ApprovalBroker` / `PermissionApprovalWorkflow`. (See [boundary rule](../explanation/boundary-rule.md).)

## Development bypass

When iterating, build the broker with `devApproveAll: true` to skip prompts:

```ts
import { makeApprovalBroker } from "@orika/core"

const broker =
  yield *
  makeApprovalBroker({
    prompt: hostPromptPort,
    devApproveAll: true
  })
```

Approvals still emit `approval-requested` + `approval-granted` audit events, and the granted outcome carries `source: "dev-bypass"` (under `details.outcome.source`) so the bypass is reviewable, not invisible.

## Related

- How-to: [Declare a permission](declare-a-permission.md)
- Explanation: [Permissions model](../explanation/permissions-model.md)
- Reference: [`ApprovalBroker`](../reference/services/approval-broker.md)
- Source: [`packages/react/src/permission-approval.ts`](../../packages/react/src/permission-approval.ts)
