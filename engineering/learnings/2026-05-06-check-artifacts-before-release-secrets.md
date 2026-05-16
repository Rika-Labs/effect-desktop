# Check Artifacts Before Release Secrets

## Observation

The notarization command originally resolved Apple credentials before checking for packaged macOS artifacts. That made a fresh checkout without package output fail with a credential error instead of the actionable "run package first" error.

## Evidence

- Review comment on PR #258: <https://github.com/Rika-Labs/effect-desktop/pull/258#discussion_r3197885785>
- Fixed in `packages/cli/src/notarization-pipeline.ts` by reading packaged artifacts before resolving notarization credentials.
- `packages/cli/src/index.test.ts` now verifies the Apple ID/password-env path passes the real password to the runner while persisting `<redacted>` in `notarize-report.json`.
- Address checks passed locally: `bun run typecheck`, `bun test packages/cli/src/index.test.ts -t 'desktop notarize'`, `bun run lint`, and `bun run lint:types`.
- PR CI passed on `blacksmith-2vcpu-ubuntu-2404`, `blacksmith-2vcpu-windows-2025`, and `blacksmith-6vcpu-macos-latest` after the address commit.

## General principle

Release commands should validate local, non-secret preconditions before resolving release credentials, then test the credential path separately for redaction.

## Trigger condition

Apply this when a command consumes local build/package output and also needs signing, notarization, publishing, or upload credentials.

## Limits / counterexamples

Do not reorder checks when the local precondition itself depends on credentials, such as downloading a protected artifact. Do not skip credential validation once a releasable artifact exists.

## Codification target

- test fixture

## Proposed amendment or issue

Keep the notarization missing-artifact smoke path and password-redaction test as the guards. No AGENTS.md amendment is needed because the repo already requires explicit preconditions, no swallowed errors, and no secret leakage.
