# Issue 770 Work

## Scope

- Issue: #770, <https://github.com/Rika-Labs/effect-desktop/issues/770>
- Base: `f9e99cf01290f66f44b160586cb3ebc6275f4fe4`

## Changes

- Added root `package.json#scripts.desktop` so `bun desktop ...` resolves from the repo root.
- Kept `packages/cli/src/bin.ts` as the single CLI process entrypoint and made the file executable to match its package-bin shebang contract.
- Added `templates/basic-react-tailwind/package.json#scripts.desktop` and an explicit template dependency on `@effect-desktop/cli` so generated app manifests carry the documented command shape.
- Added a repo-shape smoke that runs `bun desktop` and asserts Bun does not fail with `Script not found "desktop"`.
- Added a template package assertion for the documented command and CLI dependency.

## Verification

- `bun install --frozen-lockfile` - passed.
- `bun test tests/repo-shape.test.ts templates/basic-react-tailwind/src/template.test.ts` - passed.
- `bun desktop doctor --config apps/playground/desktop.config.ts` - passed and printed the doctor report.
- `bun run typecheck` - passed.
- `bun run lint` - passed.
- `bun run lint:types` - passed.
- `bunx prettier --check engineering/runs/issue-770-desktop-entrypoint/05-architect.md engineering/runs/issue-770-desktop-entrypoint/19-review.md templates/basic-react-tailwind/src/template.test.ts tests/repo-shape.test.ts package.json templates/basic-react-tailwind/package.json issues.json` - passed.

## Known environment note

- Full `bun run format:check` still reports pre-existing formatting drift in `.devin/config.local.json`, which is outside the changed tracked files.

## Handoff

Work complete. Continue to `/pr`.
