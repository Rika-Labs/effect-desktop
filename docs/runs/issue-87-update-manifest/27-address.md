# Issue 87 Address: Update Manifest Format and Signature Verification

## Triage table

| #   | Comment                                      | Verdict | Reason / fix                                                                                                                                                            |
| --- | -------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Publish trusts artifact metadata digest/size | Address | Recomputed size/SHA-256 from the same artifact payload used for signing, rejected mismatches as typed `PublishConfigError`, and added a stale-metadata regression test. |

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
  - `bun test packages/cli/src/index.test.ts -t 'desktop publish'` — 4 tests passed, 12 assertions.
  - `cargo test -p native-updater`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run format:check`
  - `cargo fmt --check`
- PR CI pending after push.

## Open threads

Review thread pending silent GraphQL resolution after the address commit is pushed.

## Handoff

Address fixes are implemented locally. Push, resolve threads, watch CI, then continue to `/learn`.
