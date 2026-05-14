# Issue 89 Verification

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
| Rust workspace tests         | `cargo test --workspace`                                | pass   | Host, host-protocol, native-pty, and native-updater tests passed; native-updater has 18 tests. |

## Evidence

The strongest issue-specific proof is `cargo test -p native-updater`, which directly exercises:

- truncated download aborts with `UpdateDownloadTruncated` and leaves the current bundle intact;
- verified staged bytes write rollback metadata before commit;
- commit moves the staged bundle to the current path;
- stale unstapled notarization returns typed `UpdateStaleNotarization`;
- restart acknowledgement after the deadline returns a typed timeout and writes a recovery breadcrumb.

## Failures And Unverifieds

No required item failed locally.

Actual platform restart, macOS stapler invocation, and host event transport remain unverified because this slice implements the native staging core before the updater host method exists.

## Verdict

proven for the scoped staging core.

## Handoff

Verification complete. Continue to `/pr`.
