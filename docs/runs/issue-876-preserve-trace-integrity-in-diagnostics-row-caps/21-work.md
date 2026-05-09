# Work

Implemented #876 by moving the diagnostics trace cap from raw spans to grouped traces.

## Changes

- `packages/devtools/src/diagnostics-panels.ts`
  - Changed trace projection from `groupTraceSpans(snapshot.traces.slice(-maxRows))` to `groupTraceSpans(snapshot.traces).slice(-maxRows)`.
- `packages/devtools/src/index.test.ts`
  - Added a regression proving `maxRows: 1` returns both root and child spans for a single trace group.

## Verification

- Issue reproduction now returns the root and child spans in the same trace group under `maxRows: 1`.
- `bun test packages/devtools/src/index.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run check`
- `bun run lint:types`
- `bun test`
- `bunx prettier --check packages/devtools/src/diagnostics-panels.ts packages/devtools/src/index.test.ts docs/runs/issue-876-preserve-trace-integrity-in-diagnostics-row-caps/05-scout.md docs/runs/issue-876-preserve-trace-integrity-in-diagnostics-row-caps/19-architect.md docs/runs/issue-876-preserve-trace-integrity-in-diagnostics-row-caps/20-review.md docs/runs/issue-876-preserve-trace-integrity-in-diagnostics-row-caps/21-work.md issues.json`

Handoff: `/pr`
