# Issue 872 Scout - Require audit for wildcard secret access

## Grounding

- Issue #872 targets the production checker, not runtime secret authorization.
- `packages/config/src/index.ts` defines `secretAuditRule`.
- `secretAuditRule` currently computes secret access through `hasScopedList(secrets?.read) || hasScopedList(secrets?.write)`.
- `hasScopedList` returns false when the list contains `"*"`, which is correct for filesystem/process scope checks but wrong for audit requirements.
- Runtime secret authorization in `packages/core/src/runtime/secrets.ts` already treats `"*"` as access, but runtime behavior is out of scope.

## Failure

A production config with `permissions.secrets.read: ["*"]` and audit missing or set to `"never"` passes even though §14.6 requires secret access to be audited.

## Constraint

Keep `hasScopedList` unchanged for rules that need explicit non-wildcard scope. Change only the secret audit access predicate.
