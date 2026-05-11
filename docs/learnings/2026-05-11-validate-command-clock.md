# Validate Command Registry Clocks

## Planned

Close the command registry timestamp boundary so injected clocks cannot produce malformed invocation records or raw schema failures.

## Shipped

`CommandRegistry` now validates command clock reads as finite non-negative safe integers before constructing invocation records or command audit events. Invalid clock values fail as `CommandRegistryInvalidInputError` and do not publish invocation snapshots.

## Review Surface

The important edge was preserving failure-duration semantics: once an invocation has a validated start timestamp, failure recording reuses it instead of reading a second start value.

## Lesson

Schema-backed records should not be the first validation point for framework-owned clocks. Validate the clock at the boundary, then construct the durable record.
