# Shellless Processes Do Not Expand Secret Env

## Observation

The Windows PFX signing path originally passed `%PASSWORD_ENV%` to `signtool /p`, assuming shell-style expansion. The signer uses `Bun.spawn([...])`, so no shell expands that string; the command would receive the literal percent-wrapped value.

## Evidence

- Automated review comment: <https://github.com/Rika-Labs/effect-desktop/pull/257#discussion_r3197830643>
- Fixed in `packages/cli/src/signing-pipeline.ts` by reading `process.env[passwordEnv]` before invoking `signtool`.
- `packages/cli/src/index.test.ts` now verifies that the command runner receives the PFX password while `sign-report.json` records `<redacted>`.
- CI passed on `blacksmith-2vcpu-ubuntu-2404`, `blacksmith-2vcpu-windows-2025`, and `blacksmith-6vcpu-macos-latest`.

## General principle

When a command runner uses exec-form arguments, environment indirection must be resolved explicitly before spawning, and any resolved secret must be redacted from reports, logs, and persisted metadata.

## Trigger condition

Apply this when a config field names an environment variable and the value is passed to a subprocess without a shell.

## Limits / counterexamples

Do not resolve environment variables for non-secret path or flag fields unless the config contract explicitly says the field is an env-var name. Do not switch to shell execution to get expansion; that trades correctness for injection risk.

## Codification target

- test fixture

## Proposed amendment or issue

Keep the PFX env/redaction test as the guard. No AGENTS.md amendment is needed because the repo already requires explicit contracts, typed failure handling, and no secret leakage.
