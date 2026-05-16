# Command invalid id telemetry

## Planned

Close issue #530 by proving invalid command ids cannot publish `CommandInvocationRecord` values.

## Shipped

Added a focused regression that observes command invocation telemetry, invokes `registry.invoke("", {}, context)`, and verifies the call fails with `CommandRegistryInvalidInputError` without publishing an invocation record.

## Review surfaced

The implementation already validates the command id before failure telemetry can publish. The missing artifact was the explicit regression for the malformed-id boundary.

## Lesson

Telemetry streams should describe accepted domain identities, not every malformed call attempt. Invalid identity attempts belong in typed failures or audit channels, not in state-derived devtools streams.

## AGENTS.md amendment candidate

None.
