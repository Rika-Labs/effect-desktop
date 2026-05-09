## Work

Implemented `Window.create` chrome validation in the native SDK and bridge payload schemas.

## Behavior

- Empty supplied window titles fail as `InvalidArgument`.
- Unsupported vibrancy material names fail as `InvalidArgument`.
- Negative traffic-light coordinates fail as `InvalidArgument`.
- Valid macOS polish fields continue to reach the host with the same payload shape.
- Invalid inputs fail before a `Window.create` request is sent.

## Verification

- `bun test packages/bridge/src/window.test.ts`
- `bun test packages/native/src/index.test.ts -t "Window bridge client rejects invalid chrome inputs"`
- `bun test packages/native/src/index.test.ts -t "host WindowClient adapter"`
- `bun test packages/native/src/index.test.ts -t "Window service"`
- `bun run typecheck --filter=@effect-desktop/native --filter=@effect-desktop/bridge`
- `bun run lint --filter=@effect-desktop/native --filter=@effect-desktop/bridge`
- `bun install --frozen-lockfile`
- `bun run check`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun prettier --check packages/native/src/window.ts packages/bridge/src/window.ts packages/native/src/index.test.ts packages/bridge/src/window.test.ts docs/runs/issue-806-validate-window-create-chrome-inputs/05-scout.md docs/runs/issue-806-validate-window-create-chrome-inputs/19-architect.md docs/runs/issue-806-validate-window-create-chrome-inputs/20-review.md docs/runs/issue-806-validate-window-create-chrome-inputs/21-work.md issues.json`
- `bun test`
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo check --workspace`
- `cargo test --workspace`

`bun run format:check` still fails on pre-existing `.devin/config.local.json` formatting outside this change.

Handoff: /pr
