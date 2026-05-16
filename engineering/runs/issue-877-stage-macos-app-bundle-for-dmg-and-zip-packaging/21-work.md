## Work

Implemented package-run staging state in `packages/cli/src/package-pipeline.ts` so macOS `.dmg` and `.zip` artifacts ensure the `.app` bundle is produced before invoking `hdiutil` or `ditto`.

## Behavior

- Default macOS packaging still emits `app`, `dmg`, and `zip` without restaging the app bundle.
- Explicit `--artifact dmg` stages the app bundle, records `macos-app`, then records `macos-dmg`.
- Explicit `--artifact zip` stages the app bundle, records `macos-app`, then records `macos-zip`.
- Metadata is still written only for requested artifacts.

## Verification

- `bun test packages/cli/src/index.test.ts -t "desktop package stages macOS app bundle before explicit"`
- `bun test packages/cli/src/index.test.ts -t "desktop package"`
- `bun run typecheck --filter=@effect-desktop/cli`
- `bun run lint --filter=@effect-desktop/cli`
- `bun install --frozen-lockfile`
- `bun run check`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun test`
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo check --workspace`
- `cargo test --workspace`
- `bun prettier --check packages/cli/src/package-pipeline.ts packages/cli/src/index.test.ts engineering/runs/issue-877-stage-macos-app-bundle-for-dmg-and-zip-packaging/05-scout.md engineering/runs/issue-877-stage-macos-app-bundle-for-dmg-and-zip-packaging/19-architect.md engineering/runs/issue-877-stage-macos-app-bundle-for-dmg-and-zip-packaging/20-review.md issues.json`

`bun run format:check` still fails on pre-existing `.devin/config.local.json` formatting outside this change.

Handoff: /pr
