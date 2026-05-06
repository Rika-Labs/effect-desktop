# Issue 88 Address

## Triage Table

| #   | Comment                                          | Verdict | Reason / fix                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Add app-id match check before accepting manifest | Address | `verify_manifest` proves bytes were signed, but `evaluate_update` also needs to bind metadata to the configured app. Added `UpdatePolicy.app_id`, `UpdateCheckError::AppIdMismatch`, `UpdateAuditEvent::AppIdMismatch`, and a failure-path test. |
| 2   | Fix malformed `25-pr.md` fenced PR body          | Address | The `/pr` artifact must preserve the posted body accurately. Moved `Closes #88` inside the outer fence and removed the stray trailing fence.                                                                                                     |

## Commits Made

- `1ccd071` — `Address updater routing review comments (#88)`.

## Escalations

None.

## Pushbacks

None.

## Follow-Up Issues

None.

## CI Status

Focused local verification before push:

- `cargo test -p native-updater` — passed, 13 tests.
- `cargo clippy -p native-updater --all-targets -- -D warnings` — passed.

- `validate (blacksmith-2vcpu-ubuntu-2404)` — pass, 1m55s.
- `validate (blacksmith-6vcpu-macos-latest)` — pass, 56s.
- `validate (blacksmith-2vcpu-windows-2025)` — pass, 1m40s.

Final status: all-green after address push.

## Open Threads

None. Both addressed review threads were resolved silently.

## Handoff

Comments addressed. Continue to `/learn`.
