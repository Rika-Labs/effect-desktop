## Findings

No blocking architecture findings.

## Reality check

- A typed close error is preferable to logging-and-suppressing because callers already consume Effect values from `send` and `receive`.
- A dedicated close tag avoids overloading `TransportWriteFailed` with lifecycle cleanup failures.
- Existing call sites using `Effect.runPromise(connection.close())` remain valid because they already run an effect; they will now fail if cleanup fails instead of always succeeding.

## Locked architecture

Widen `TransportConnection.close` to `Effect<void, TransportError, never>`, add `TransportCloseFailed`, map `makeConnection` close exceptions to that tag, and add a regression that the issue repro exits with typed failure.

Handoff: `/work`
