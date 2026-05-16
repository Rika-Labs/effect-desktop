# Decode Production Check Files

## Planned

Issue #656 required `runProductionCheck` to reject malformed renderer file inputs through its typed `ProductionCheckInvalidInput` channel instead of crashing inside rule scanners.

## Shipped

The production checker now validates every renderer file record before building the internal rule context. Missing or non-string `path`/`content` fields fail as `ProductionCheckInvalidInput`; valid file records still scan normally.

## Review surfaced

Rule code was written as if it owned validated strings, but the public input boundary did not enforce that contract. The scanners were correct to use string operations; the missing piece was boundary decoding.

## Non-obvious lesson

Release gates need typed failures for malformed caller input. A thrown scanner exception is a checker bug from the operator's point of view.

## AGENTS.md amendment candidate

None.
