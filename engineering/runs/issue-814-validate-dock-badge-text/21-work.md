# Work: Validate Dock.setBadgeText display strings

## Issue

https://github.com/Rika-Labs/effect-desktop/issues/814

## Changes

- Added a private `DockBadgeText` schema in `packages/native/src/contracts/dock.ts`.
- Changed `DockSetBadgeTextInput.text` from raw nullable string to `Schema.NullOr(DockBadgeText)`.
- Extended the Dock bridge test to prove `"1"` and `null` keep the host request shape.
- Added a regression test proving NUL, newline, and tab badge text fail as `InvalidArgument` before transport.
- Regenerated the native public API snapshot for the intentional schema-signature change.

## Verification

- `bun test packages/native/src/index.test.ts`
- `bun packages/cli/src/bin.ts check --api --write`
- `bun packages/cli/src/bin.ts check --api`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bunx prettier --check packages/native/src/contracts/dock.ts packages/native/src/index.test.ts engineering/runs/issue-814-validate-dock-badge-text/05-architect.md engineering/runs/issue-814-validate-dock-badge-text/19-review.md issues.json api/snapshots/@orika__native.snapshot.json`
- `bun run check`
- `bun test`
