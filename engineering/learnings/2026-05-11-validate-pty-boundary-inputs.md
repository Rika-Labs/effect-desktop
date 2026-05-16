# Validate PTY Boundary Inputs

## Planned

Keep invalid PTY lifecycle timing and malformed environment names from reaching adapter activity.

## Shipped

`makePty` now rejects non-finite and non-positive `gracefulShutdownMs` values with `HostProtocolInvalidArgumentError`, matching the process service boundary. The PTY tests now also prove empty environment variable names are rejected before adapter open calls, alongside the existing NUL-name and value coverage.

## Lesson

Lifecycle timing and process-boundary metadata are service input contracts. Validate them before resource registration or adapter calls so host behavior does not become the de facto schema.
