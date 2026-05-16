# Issue 813 Review: Validate ContextMenu.show Position Coordinates

## Locked Decision

Use `Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))` for each context menu coordinate.

## Pressure Test

- Correctness: blocks JSON-lossy numbers before request construction.
- Scope: changes only the ContextMenu input contract and bridge tests.
- Compatibility: preserves the existing object shape and keeps fractional logical pixels valid.
- Simplicity: no new abstraction beyond a private schema constant.
- Observability: tests assert both the `InvalidArgument` error tag and an empty request log.

## Tradeoff

This treats negative positions as invalid because the coordinate space is window-local. If a future API needs screen-global menu placement, that should be a separate contract with a name that exposes the coordinate space.

Handoff: `/work`
