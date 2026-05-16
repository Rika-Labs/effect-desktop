# Issue 769 Work

Changes:

- Added `scripts/pack-installable-cli.ts` to copy the CLI runtime package set into an installable artifact.
- Rewrites only the copied CLI manifest from `workspace:*` to sibling `file:` specs.
- Installs artifact-local production dependencies so the file-installed bin can resolve runtime imports from outside the monorepo.
- Added repo-shape assertions for the CLI bin and workspace dependency contract.
- Added a temp consumer install smoke that installs the generated artifact and runs `bunx desktop`.

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
