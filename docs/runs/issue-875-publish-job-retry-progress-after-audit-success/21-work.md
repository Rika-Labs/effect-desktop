# Issue 875 Work - Publish job retry progress after audit success

## Change

- Reordered `emitRetrying` so `emitAuditEvent` succeeds before `progressLog` is updated or `progressBus` publishes `JobRetrying`.
- Added a retry audit failure regression that asserts `JobAuditFailedError`, one audit attempt, no retry attempt after the failed audit, and no replayable retry progress.
- Kept successful retry progress and audit behavior unchanged.

## Verification

- `bun test packages/core/src/runtime/job.test.ts`
- Issue reproduction adapted to treat timeout as no replayed progress
- `bun run typecheck`
- `bun run lint`
- `bunx prettier --check packages/core/src/runtime/job.ts packages/core/src/runtime/job.test.ts docs/runs/issue-875-publish-job-retry-progress-after-audit-success/05-scout.md docs/runs/issue-875-publish-job-retry-progress-after-audit-success/19-architect.md docs/runs/issue-875-publish-job-retry-progress-after-audit-success/20-review.md docs/runs/issue-875-publish-job-retry-progress-after-audit-success/21-work.md issues.json`
- `bun run check`
- `bun run lint:types`
- `bun test`
