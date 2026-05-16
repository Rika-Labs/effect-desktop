# Validate Resource Identity

## Planned

Issues #532 and #559 required the resource registry to reject blank identity fields before mutating registry state.

## Shipped

`ResourceRegistry.register` now validates `kind`, `ownerScope`, and `state` before timestamp capture and insertion. `ResourceRegistry.share` validates `targetScope` before it increments the shared cleanup group. `ResourceRegistry.declareScope` validates both the child scope and optional parent before mutating `scopeParents`.

## Review surfaced

The registry already had a typed `ResourceInvalidArgumentError` for invalid timestamps, so identity validation could reuse the same observable failure contract instead of adding a second error type.

## Non-obvious lesson

Identity strings are allocation inputs, not display labels. Validating them after ID generation or cleanup-group mutation would leave invisible registry state behind a failed operation.

## AGENTS.md amendment candidate

None.
