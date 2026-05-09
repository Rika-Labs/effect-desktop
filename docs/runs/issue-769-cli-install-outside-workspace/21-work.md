# Issue 769 Work

Changes:

- Changed `@effect-desktop/cli` first-party runtime dependencies from `workspace:*` to sibling `file:` specs.
- Added repo-shape assertions for the CLI bin and dependency specs.
- Added a temp consumer install smoke that installs `file:<repo>/packages/cli` and runs `bunx desktop`.

Verification:

- `bun install --frozen-lockfile` — passed.
- `bun test scripts/pack-installable-cli.test.ts tests/repo-shape.test.ts` — passed.
- `bun run check` — passed.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `bun run lint:types` — passed.
- Changed-file Prettier check — passed.
- `bun test` — passed.

Known local-only gap: full `bun run format:check` is blocked by existing `.devin/config.local.json` formatting drift outside this change set.
