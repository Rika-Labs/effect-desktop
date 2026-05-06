# Issue 86 Address: macOS Notarization

## Triage table

| # | Comment | Verdict | Reason / fix |
| --- | --- | --- | --- |
| 1 | Credentials are resolved before artifact discovery | Address | Reordered artifact discovery before credential resolution so a missing package output returns `NotarizeFileError` first. |
| 2 | Password-env redaction is not tested | Address | Added an Apple ID/password-env regression test proving the runner receives the real password and `notarize-report.json` persists `<redacted>`. |

## Commits made

- Pending at artifact creation time.

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
- PR CI pending after push.

## Open threads

Review threads pending silent GraphQL resolution after the address commit is pushed.

## Handoff

Address fixes are implemented locally. Push, resolve threads, watch CI, then continue to `/learn`.
