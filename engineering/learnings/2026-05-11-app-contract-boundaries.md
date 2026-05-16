# App Contract Boundaries

## Planned

Close the App bridge validation gaps for URL events, lifecycle arguments, metadata output, and single-instance PID output.

## Shipped

`App.onOpenUrl` and `App.getInfo` were already decoded through strict schemas, so the work added focused verification for those existing boundaries. Lifecycle argument strings now reject empty values and NUL bytes before a host request is built. Single-instance results now reject non-positive `primaryPid` values in addition to the existing `acquired: true` invariant.

## Review Surface

The host protocol shape did not change. The accepted value set narrowed at the client boundary.

## Lesson

Input schemas need tests for both request-time rejection and response-time rejection. A type that says `number` is not enough when the protocol invariant is `positive process id`.

## AGENTS.md Amendment Candidate

None.
