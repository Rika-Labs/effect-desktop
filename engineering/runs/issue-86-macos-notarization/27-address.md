# Issue 86 Address: macOS Notarization

## Triage table

| #   | Comment                                            | Verdict | Reason / fix                                                                                                                                   |
| --- | -------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Credentials are resolved before artifact discovery | Address | Reordered artifact discovery before credential resolution so a missing package output returns `NotarizeFileError` first.                       |
| 2   | Password-env redaction is not tested               | Address | Added an Apple ID/password-env regression test proving the runner receives the real password and `notarize-report.json` persists `<redacted>`. |

## Commits made

- `95082d1` — `Address notarization review findings (#86)`
- `d6ca85c` — `Format notarization review artifacts (#86)`

## Escalations

None.

## Pushbacks

None.

## Follow-up issues

None.

## CI status

- Local address loop passed:
  - `bun run typecheck`
  - `bun test packages/cli/src/index.test.ts -t 'desktop notarize'` — 6 tests passed, 19 assertions.
  - `bun run lint`
  - `bun run lint:types`
- PR CI passed after the formatting follow-up:
  - `validate (blacksmith-2vcpu-ubuntu-2404)` — passed in 2m7s.
  - `validate (blacksmith-2vcpu-windows-2025)` — passed in 1m53s.
  - `validate (blacksmith-6vcpu-macos-latest)` — passed in 56s.

## Open threads

None. Both review threads were resolved silently via GraphQL.

## Handoff

Address fixes are implemented locally. Push, resolve threads, watch CI, then continue to `/learn`.
