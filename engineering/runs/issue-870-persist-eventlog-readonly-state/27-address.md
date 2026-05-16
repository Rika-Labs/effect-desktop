## Triage

| #   | Reviewer       | Verdict | File:Line                                    | Reason                                                                                                   |
| --- | -------------- | ------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `/code-review` | Address | `packages/core/src/runtime/event-log.ts:413` | Valid AGENTS.md no-swallowed-errors issue; preserve original failure but log the metadata-write failure. |

## Changes

- Added an `Effect.logWarning` breadcrumb when `event_log_meta.read_only` cannot be persisted.
- Kept the original `EventLogFull` failure as the append result.
- Added a regression for metadata latch failure preserving the original typed full error and in-memory read-only latch.

## Verification

- `bun test packages/core/src/runtime/event-log.test.ts --test-name-pattern 'metadata latch failure'`
- `bun run typecheck`
- `bun run lint`
- `bunx prettier --check packages/core/src/runtime/event-log.ts packages/core/src/runtime/event-log.test.ts`

Handoff: `/learn`
