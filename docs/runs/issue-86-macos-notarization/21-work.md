# Issue 86 Work: macOS Notarization

## Issue and branch

- Issue: #86, <https://github.com/Rika-Labs/effect-desktop/issues/86>
- Branch: `issue-86-macos-notarization`
- Base: `ae5eed7 add desktop signing pipeline (#257)`

## Tasks completed

- Added `packages/cli/src/notarization-pipeline.ts` as the `Notarizer` module.
- Wired `desktop notarize --config <path> [--platform macos-arm64|macos-x64] [--json]` through `runCli`.
- Added typed notarization failures for config, host target, requested target, file, and command failures.
- Implemented idempotent `stapler validate` handling: exit code `0` skips submit/staple; non-zero continues to submit.
- Implemented `xcrun notarytool submit <artifact> --wait --output-format json`, `xcrun stapler staple`, and `spctl --assess --type execute --verbose=4`.
- Added keychain-profile and Apple ID credential resolution with password redaction in persisted reports.
- Skipped zip sidecar artifacts during discovery because `xcrun stapler` cannot staple zip archives.
- Updated the CLI README and public exports.

## Tests added

- `desktop notarize submits staples and assesses unstapled macOS artifacts`
- `desktop notarize is a no-op submit when staple validation already passes`
- `desktop notarize ignores zip sidecars that stapler cannot staple`
- `desktop notarize surfaces rejected notarytool output`
- `desktop notarize returns malformed notarytool JSON as a typed failure`

## Deviations from design

The Notarizer discovers `.app` and `.dmg` artifacts only. Zip artifacts are not reported as stapled because Apple `stapler` does not support zip files.

## Discovered issues

None.

## Verification commands run during work

- `bun test packages/cli/src/index.test.ts -t 'desktop notarize'` — passed, 5 tests, 14 assertions.
- `APPLE_NOTARYTOOL_PROFILE=smoke bun packages/cli/src/bin.ts notarize --config apps/playground/desktop.config.ts --json` — returned typed `NotarizeFileError` for missing packaged artifacts.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `bun run lint:types` — passed.
- Full validation gate passed:
  - `bun install --frozen-lockfile`
  - `bun run check`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run format:check`
  - `bun test` — 564 tests passed.
  - `cargo fmt --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo check --workspace`
  - `cargo test --workspace`

## Handoff

Implementation in place. Continue to `/verify`.
