# Validate Window IDs

## Planned

Prevent blank window IDs from crossing the host window client boundary in create responses or destroy requests.

## Shipped

`WindowCreateResponse.windowId` and `WindowDestroyPayload.windowId` now use `Schema.NonEmptyString`. The regressions prove blank create response IDs fail as `InvalidOutput` and blank destroy IDs fail as `InvalidArgument` before any exchange request is sent.

## Lesson

Lifecycle handles are identities, not arbitrary strings. Validate non-empty handles at the client boundary so host lifecycle code receives only meaningful targets.
