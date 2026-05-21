# Work

Implemented #824 on branch `issue-824-honor-json-production-check`.

Changes:

- Updated `runProductionCheckCli` so `--json` serializes the existing `ProductionCheckReport`.
- Routed passed JSON reports to stdout with exit 0.
- Routed failed JSON reports to stderr with exit 1.
- Added CLI tests for passed and failed production-check JSON output.

Verification:

- `bun test packages/cli/src/index.test.ts -t "desktop check --production"`
- `bun run typecheck --filter=@orika/cli`
- `bun run lint --filter=@orika/cli`
- `bun packages/cli/src/bin.ts check --production --config apps/playground/desktop.config.ts --json`
- `bun prettier --check packages/cli/src/index.ts packages/cli/src/index.test.ts`
