# Permissions

Permissions are explicit grants with audit records, revocation, and scoped authority.

## Runnable Example

```ts run
import { PermissionApprovalWorkflow, PermissionRegistry } from "../packages/core/src/index.js"

if (PermissionRegistry === undefined || PermissionApprovalWorkflow === undefined) {
  throw new Error("permission registry or approval workflow is unavailable")
}
```
