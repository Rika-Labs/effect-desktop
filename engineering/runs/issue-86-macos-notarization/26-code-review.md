# Issue 86 Code Review: macOS Notarization

## Persona findings

### Correctness

- `packages/cli/src/notarization-pipeline.ts:169` — should-fix — failure ordering. `runDesktopNotarize` resolves Apple credentials before discovering artifacts, so a clean checkout without packaged artifacts returns a credentials error instead of the actionable "run package first" file error. Smallest fix: discover artifacts before resolving credentials.

### Testing

- `packages/cli/src/index.test.ts:597` — should-fix — security invariant coverage. The design says credential arguments in reports must be redacted while the runner receives real values, but the notarization tests only cover keychain-profile credentials. Smallest fix: add an Apple ID/password-env test that asserts the runner receives the secret and `notarize-report.json` stores `<redacted>`.

### Maintainability

- No additional findings. The PR keeps notarization in one deep module with an injectable command runner.

### Project standards

- Same as Testing: the review artifact names redacted credential reporting as a required check, but the test suite does not yet prove it.

### Security

- Same as Testing: the redaction invariant protects release credentials and needs a regression test.

### Previous findings

- Same as Testing: issue #85 taught that shell/env credential handling must be explicit and redacted; this PR follows the mechanism but needs direct proof.

## Posted review

- Review URL: pending at posting time.
- Summary body posted:
  - Two should-fix findings: reorder artifact discovery before credential resolution, and add Apple ID/password redaction coverage.
- Inline comments:

| File                                        | Line | Severity   | Body                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ---: | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/notarization-pipeline.ts` |  169 | should-fix | Credential resolution runs before artifact discovery, so a clean checkout with no packaged macOS artifacts reports missing Apple credentials instead of the actionable `NotarizeFileError`. Principle: failure modes should point at the first violated precondition. Smallest fix: read packaged artifacts before resolving credentials, then only require Apple credentials when there is something to submit.                                             |
| `packages/cli/src/index.test.ts`            |  597 | should-fix | The architecture and prior signing learning both require release credentials to be passed to tools but redacted from persisted reports. These tests only exercise keychain-profile credentials, so the password-env path is unprotected. Principle: security invariants need direct regression tests. Smallest fix: add an Apple ID/password-env test that asserts the runner receives the real password while `notarize-report.json` contains `<redacted>`. |

## Out-of-scope findings

None.

## Handoff

Review posted. Continue to `/address`.
