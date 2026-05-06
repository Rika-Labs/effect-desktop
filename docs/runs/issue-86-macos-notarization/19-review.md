# Issue 86 Review: macOS Notarization

## Artifact inventory

| Artifact                | Status | Evidence                                                                                                                                                           |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub issue            | pass   | #86 defines submit, staple, assess, idempotency, and rejection-log requirements.                                                                                   |
| Spec grounding          | pass   | `docs/SPEC.md` §23.3 requires `xcrun notarytool submit ... --wait`, `stapler staple`, and `spctl --assess --type execute --verbose=4`.                             |
| Official tool grounding | pass   | Apple docs describe `notarytool` and `stapler`; local `notarytool submit --help`, `stapler --help`, and `spctl` man page confirm flags and supported file formats. |
| Architecture            | pass   | `05-architect.md` names one `Notarizer` module and explicit lifecycle states.                                                                                      |

## Principle-compliance pass

| Principle                   | Status | Evidence                                                                      | Fix  |
| --------------------------- | ------ | ----------------------------------------------------------------------------- | ---- |
| First-principles derivation | pass   | The command exists to make unstapled artifacts fail loudly.                   | None |
| Minimal code                | pass   | One module and CLI adapter; no new dependency.                                | None |
| State machine               | pass   | `validate -> submit -> staple -> assess` names the only accepted transitions. | None |
| Typed errors                | pass   | Design requires command/file/config/target tagged failures.                   | None |
| Effect discipline           | pass   | Command and filesystem effects stay in Effect.                                | None |
| Security                    | pass   | Credentials are resolved explicitly and redacted from persisted reports.      | None |
| Testability                 | pass   | Command runner returns exit codes and output as values.                       | None |

## Reality-check pass

- Future contributors may treat `stapler validate` failure as fatal. The module must encode that exit as "needs submit" for this step only.
- Secret leakage risk mirrors #85. Credential arguments in reports must be redacted while the runner receives real values.
- Zip support is a trap: Apple `stapler` does not list zip as a supported format. Do not report zip as stapled.

## Required fixes before work

None.

## Permitted as-is

The first slice supports `.app` and `.dmg` macOS artifacts because those are the Phase 21 outputs Apple `stapler` can attach tickets to directly.

## Issue candidates captured

None.

## Verdict

locked

## Handoff

Design locked. Continue to `/work`.
