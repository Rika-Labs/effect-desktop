# Validate Trace And Target Boundaries

## Planned

Close validation gaps for mixed protocol targets, generated event trace IDs, and telemetry trace span identity.

## Shipped

Protocol decoding now rejects stream and cancel envelopes that carry both request and resource targets. EventHub validates generated trace IDs before constructing event envelopes or publishing to subscribers. Telemetry trace spans now reject blank trace/span identifiers and required labels before storage.

## Review Surface

The wire shape and public APIs did not change. Invalid generated or decoded metadata now fails before fanout, dispatch, or trace-ring mutation.

## Lesson

Generated metadata is still boundary input. If a caller can override an ID generator, the module that consumes the generated value owns validation before mutation or fanout.

## AGENTS.md Amendment Candidate

None.
