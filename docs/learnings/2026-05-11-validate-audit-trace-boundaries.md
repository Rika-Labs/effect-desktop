# Validate Audit Trace Boundaries

## Planned

Keep malformed audit timestamps and repaired host trace IDs inside typed runtime boundaries.

## Shipped

Audit event payload timestamps are now finite non-negative numbers when present. Host protocol missing-trace repair validates generated trace IDs before audit construction and fails as `InvalidOutput` without appending audit rows when the generator is invalid.

## Lesson

Repair paths need the same validation as primary protocol paths. Audit construction should never be the first place malformed metadata is discovered, because that turns evidence gathering into an unrelated failure mode.
