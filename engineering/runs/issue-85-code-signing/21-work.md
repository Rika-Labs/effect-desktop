# Issue 85 Work: Code Signing

## Issue and branch

- Issue: #85, <https://github.com/Rika-Labs/effect-desktop/issues/85>
- Branch: `issue-85-code-signing`
- Base: `f60c2bd feat(cli): add desktop doctor command (#256)`

## Tasks completed

- Added `packages/cli/src/signing-pipeline.ts` as the `Signer` module.
- Wired `desktop sign --config <path> [--platform <target>] [--json]` through `runCli`.
- Added typed signing failures for config, host target, requested target, file, and command failures.
- Implemented macOS signing plan with generated hardened-runtime entitlements and `codesign --force --sign <identity> --options runtime --entitlements <path>`.
- Implemented Windows signing plan with `powershell Unblock-File` and `signtool sign /fd SHA256 /tr <timestamp> /td SHA256`.
- Implemented Linux AppImage signing with generated AppStream metadata, `.desktop` metadata, and `gpg --armor --detach-sign --local-user`.
- Updated the CLI README and public exports.

## Tests added

- `desktop sign signs macOS app bundle with hardened runtime entitlements`
- `desktop sign fails macOS signing without a Developer ID identity`
- `desktop sign Authenticode-signs Windows MSI with RFC 3161 timestamp`
- `desktop sign GPG-signs Linux AppImage and writes Linux metadata`

## Deviations from design

The signer discovers only artifacts it can sign directly: macOS `.app`/`.dmg`, Windows `.msi`, and Linux AppImage. Unsigned sidecars such as `.zip`, `.deb`, and `.rpm` are not reported as signed.

## Discovered issues

None.

## Verification commands run during work

- `bun test packages/cli/src/index.test.ts -t 'desktop sign'` — passed.
- `bun packages/cli/src/bin.ts sign --config apps/playground/desktop.config.ts --json` — returned typed `SignFileError` for missing packaged artifacts.
- `bun install --frozen-lockfile` — passed.
- `bun run check` — passed.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `bun run lint:types` — passed.
- `bun run format:check` — passed.
- `bun test` — passed, 559 tests.
- `cargo fmt --check` — passed.
- `cargo clippy --workspace --all-targets -- -D warnings` — passed.
- `cargo check --workspace` — passed.
- `cargo test --workspace` — passed.

## Handoff

Implementation in place. Continue to `/verify`.
