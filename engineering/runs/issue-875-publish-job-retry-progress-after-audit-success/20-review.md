# Issue 875 Review - Publish job retry progress after audit success

## Locked architecture

Keep retry scheduling unchanged and move only the progress commit point. `JobRetrying` may be constructed before audit so audit details stay redacted, but it must not enter replay state or the progress bus until `emitAuditEvent` succeeds.

## Reality check

- Existing successful retry behavior must still emit retry progress and write audit rows.
- Failed retry audit must fail the job with `JobAuditFailedError`.
- Failed retry audit must leave `handle.progress` without a replayable `JobRetrying`.
- Runtime progress streams and audit logs should no longer disagree about retry attempts.

## Handoff

Proceed to `/work` for issue #875.
