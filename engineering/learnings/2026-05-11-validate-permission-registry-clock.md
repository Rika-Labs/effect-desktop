# Validate Permission Registry Clock

## Planned

Close #476 by treating `PermissionRegistryOptions.now` as untrusted input for grant lifecycle state.

## Shipped

Permission grant timestamps now use a non-negative integer schema, and every lifecycle entry point decodes the clock value before writing or transitioning grant state. Invalid clock output fails as `PermissionInvalidArgumentError` before audit, decision history, waiter notification, or user effects run.

## Review

The tests cover both grant creation paths (`grant` and allowed `check`) plus `inspect`, `revoke`, and `use`. They also verify failed clock validation does not retain new grants, emit lifecycle transition audits, consume one-time grants, or run the protected effect.

## Lesson

Injected clocks are input boundaries. Validate them at the operation edge, not after state is built, so `NaN` cannot enter comparisons, snapshots, audits, or lifecycle notifications.
