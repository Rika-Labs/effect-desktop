# Record Origin Verification Failures

## Planned

Make renderer origin denials visible in the bridge call lifecycle without weakening origin verification.

## Shipped

Dispatch now records `Pending` before origin verification, then routes origin verification failures through the shared failed terminal-state path. The handler still fails before lookup, decode, authorization, or invocation, but `onState` now observes `Pending` then `Failed` for forged origin tokens.

## Lesson

Fail-closed security checks still need lifecycle observability. Record the attempt before the denial, then terminate it through the same typed failure path as other rejected calls.
