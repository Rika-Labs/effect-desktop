# Issue 88 Verification

## Verification Matrix

| Item                         | Command                                                 | Result | Evidence                                                                                       |
| ---------------------------- | ------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Install reproducibility      | `bun install --frozen-lockfile`                         | pass   | Checked 126 installs, no changes.                                                              |
| TypeScript package checks    | `bun run check`                                         | pass   | 11 successful tasks.                                                                           |
| TypeScript package typecheck | `bun run typecheck`                                     | pass   | 11 successful tasks.                                                                           |
| TypeScript lint              | `bun run lint`                                          | pass   | 11 successful tasks, zero oxlint warnings/errors.                                              |
| Type-aware lint              | `bun run lint:types`                                    | pass   | Zero warnings/errors across 137 files.                                                         |
| Formatting                   | `bun run format:check`                                  | pass   | All matched files use Prettier style.                                                          |
| Bun tests                    | `bun test`                                              | pass   | 571 tests passed, 0 failed.                                                                    |
| Rust formatting              | `cargo fmt --check`                                     | pass   | No formatting diff.                                                                            |
| Rust clippy                  | `cargo clippy --workspace --all-targets -- -D warnings` | pass   | Workspace clippy completed with warnings denied.                                               |
| Rust workspace check         | `cargo check --workspace`                               | pass   | Workspace check completed.                                                                     |
| Rust workspace tests         | `cargo test --workspace`                                | pass   | Host, host-protocol, native-pty, and native-updater tests passed; native-updater has 12 tests. |

## Evidence

The strongest issue-specific proof is `cargo test -p native-updater`, which directly exercises:

- stable rejects beta with `WrongChannel`;
- canary accepts canary and resolves `{platform}/{channel}`;
- configured `minVersion` rejects `1.1.9` below `1.2.0`;
- manifest `minVersion` is also enforced;
- installed/equal version rejects with `DowngradeRefused`;
- rollback packs are accepted only when `installed.version > manifest.maxVersion`;
- feed URL templates missing `{channel}` fail closed.

## Failures And Unverifieds

The first `bun run format:check` failed on the two new run markdown files. I ran Prettier on the run artifacts, amended the commit, and reran `bun run format:check` successfully.

No required item remains unverified locally.

## Verdict

proven

## Handoff

Verification complete. Continue to `/pr`.
