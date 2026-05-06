# Issue 87 Address: Update Manifest Format and Signature Verification

## Triage table

| #   | Comment                                         | Verdict | Reason / fix                                                                                                                                                            |
| --- | ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Publish trusts artifact metadata digest/size    | Address | Recomputed size/SHA-256 from the same artifact payload used for signing, rejected mismatches as typed `PublishConfigError`, and added a stale-metadata regression test. |
| 2   | Publish must handle `.app` directory artifacts  | Address | Added deterministic directory payload hashing in the publish path and a macOS app bundle regression test.                                                               |
| 3   | Native verifier accepts unknown schema versions | Address | Added an explicit `schemaVersion === 1` guard and a verifier failure test.                                                                                              |

## Commits made

- `f394051` — `Address update manifest digest review (#87)`
- `ca488d1` — `Address update manifest verifier review (#87)`

## Escalations

None.

## Pushbacks

None.

## Follow-up issues

None.

## CI status

- Local address loop passed:
  - `bun run typecheck`
  - `bun test packages/cli/src/index.test.ts -t 'desktop publish'` — 5 tests passed, 16 assertions.
  - `cargo test -p native-updater` — 5 tests passed.
  - `bun run lint`
  - `bun run lint:types`
  - `bun run format:check`
  - `cargo fmt --check`
- PR CI pending after push.
- PR CI passed after the second address commit:
  - `validate (blacksmith-2vcpu-ubuntu-2404)` — passed in 2m13s.
  - `validate (blacksmith-2vcpu-windows-2025)` — passed in 1m34s.
  - `validate (blacksmith-6vcpu-macos-latest)` — passed in 57s.

## Open threads

None. All three review threads were resolved silently via GraphQL.

## Handoff

Address fixes are pushed and CI is green. Continue to `/learn`.
