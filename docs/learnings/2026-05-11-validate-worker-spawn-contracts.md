# Validate Worker Spawn Contracts

## Planned

Reject invalid worker lifecycle timing and channel schemas before worker adapters can spawn runtime resources.

## Shipped

Worker spawn now validates `gracefulShutdownMs` as a non-negative safe integer before adapter activity. It also checks that `inputSchema` and `outputSchema` are Effect schema objects before authorization, budget reservation, adapter spawn, or resource registration.

## Lesson

Worker handles only make sense when their channel contracts are valid. Validate service options and schemas before creating a runtime so a live worker never exists without the contracts needed to operate it safely.
