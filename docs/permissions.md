---
title: Permissions
description: Deny-by-default capability chokepoint with audit and approval flows.
kind: explanation
audience: app-developers
effect_version: 4
---

# Permissions

> Full essay: [`explanation/permissions-model.md`](explanation/permissions-model.md). Reference: [`PermissionRegistry`](reference/services/permission-registry.md), [`ApprovalBroker`](reference/services/approval-broker.md). How-to: [`declare a permission`](how-to/declare-a-permission.md).

Permissions make privileged behavior explicit. Filesystem writes, process execution, secret access, updater install, external navigation, and native operations cross **named capability policy**.

## Public surface

`@effect-desktop/core` exports:

- `PermissionRegistry`.
- Permission interceptor helpers (`PermissionInterceptor`, `makePermissionInterceptorLayer`).
- `PermissionApprovalWorkflow`.
- Capability declarations and approval records.

`@effect-desktop/react` exports `usePermission`, `usePermissionApproval`, `useApprovalNotifications`, and `<PermissionApprovalQueue />` for UI-driven approval flows.

## Decision order (fixed)

1. Explicit deny.
2. Revoked / expired / consumed.
3. Approval-denied cache.
4. Approval (routes to `ApprovalBroker`).
5. Allow.
6. Default deny.

## Verify Permission Exports

```ts run
import { PermissionApprovalWorkflow, PermissionRegistry } from "../packages/core/src/index.js"

if (PermissionRegistry === undefined || PermissionApprovalWorkflow === undefined) {
  throw new Error("PermissionRegistry or PermissionApprovalWorkflow is unavailable")
}
```

## Rule

Do not silently allow privileged behavior. A denial is a **typed result** that's observable and testable.

## Where to go next

- [Permissions model essay](explanation/permissions-model.md) — the why
- [How-to: declare a permission](how-to/declare-a-permission.md)
- [How-to: handle an approval prompt](how-to/handle-an-approval-prompt.md)
- [`PermissionRegistry` reference](reference/services/permission-registry.md)
