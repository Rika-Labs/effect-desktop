# Validate API Contract Boundaries

## Planned

Close API contract validation gaps for contract tags, method names, event names, permission names, resource outputs, and layer handlers.

## Shipped

Contract registration now rejects blank tags, method names, event names, and permission names. Resource outputs must carry the handle schema installed by `BridgeRpc.Resource`. Layer construction now validates that every declared method has a callable handler while preserving prototype method support.

## Review Surface

The API shape did not change. Invalid contract metadata now fails at registration or layer construction instead of entering the registry.

## Lesson

TypeScript catches normal authoring mistakes, but contract registries are runtime boundaries. A registry must validate the shape it exposes because generated code and casts can bypass static checks.

## AGENTS.md Amendment Candidate

None.
