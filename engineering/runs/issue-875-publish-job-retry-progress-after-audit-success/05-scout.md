# Issue 875 Scout - Publish job retry progress after audit success

## Grounding

- `packages/core/src/runtime/job.ts` owns retry execution, retry progress emission, replay state, and job audit writes.
- `emitRetrying` currently creates a redacted `JobRetrying`, appends it to `progressLog`, publishes it to `progressBus`, and only then writes `audit/job-retrying`.
- The issue reproduction still fails on the synced branch: an audit append failure leaves one replayable `JobRetrying` progress event.
- Existing tests cover successful retry progress plus audit, but not retry audit failure ordering.

## Failure

Retry progress is operational evidence. Publishing it before audit success lets runtime replay state claim a retry happened when the durable audit row was rejected.

## Constraint

Do not change retry scheduling, recoverability, progress redaction, job IDs, or the event log API. Only change the ordering of retry progress mutation relative to retry audit success.
