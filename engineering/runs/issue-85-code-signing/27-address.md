# Issue 85 Address

## Triage table

| #          | Comment                                                        | Verdict | Reason / fix                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3197830643 | Expand PFX password env var before passing `/p` to `signtool`. | Address | Fixed in `beab60b`: `windowsCredentialArgs` now reads `process.env[passwordEnv]`, returns a typed `SignConfigError` when missing, and records `<redacted>` in the sign report. |

## Commits made

- `beab60b` — `Add desktop signing pipeline (#85)` with PFX env lookup and redaction.

## Escalations

None.

## Pushbacks

None.

## Follow-up issues

None.

## CI status

- `validate (blacksmith-2vcpu-ubuntu-2404)` — pass.
- `validate (blacksmith-2vcpu-windows-2025)` — pass.
- `validate (blacksmith-6vcpu-macos-latest)` — pass.

## Open threads

None expected after resolving the addressed automated thread.

## Handoff

Comments addressed. Continue to `/learn`.
