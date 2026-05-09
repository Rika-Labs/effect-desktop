# Issue 872 Review - Require audit for wildcard secret access

## Locked architecture

Use a separate secret-access predicate that treats any non-empty read or write list as access. Do not alter `hasScopedList`, because that helper encodes a different question: whether a capability has a concrete non-wildcard scope.

## Reality check

- The fix is one rule-level behavior change.
- Runtime `Secrets` authorization remains unchanged.
- Tests must prove `read: ["*"]` and `write: ["*"]` fail without `audit: "always"`.
- A config with no `read` or `write` remains valid without audit.

## Handoff

Proceed to `/work` for issue #872.
