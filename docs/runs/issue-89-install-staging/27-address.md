# Issue 89 Address

## Triage Table

| #   | Comment                                                                                                                  | Verdict | Reason / fix                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `std::fs::rename` does not replace an existing destination on Windows; commit test did not cover existing current bundle | Address | Added `atomic_replace`, using Windows replace-existing and write-through flags, and updated the commit test to replace an existing current bundle.                    |
| 2   | Guard restart deadline math against `u64` overflow                                                                       | Address | Changed deadline math to `saturating_add` and added `restart_deadline_saturates_instead_of_wrapping`.                                                                 |
| 3   | Return truncation error even if stale-temp cleanup fails                                                                 | Address | Removed cleanup attempts before truncation, size, and digest typed returns; added `truncated_download_error_is_not_masked_by_stale_temp_cleanup_failure`.             |
| 4   | Handle cross-filesystem commit when renaming staged bundle                                                               | Address | `commit_staged_install` now copies staged bytes into a destination-local commit temp file, then atomically replaces `current_bundle` from the destination filesystem. |

## Commits Made

- Pending commit: address install staging review.

## Escalations

None.

## Pushbacks

None.

## Follow-Up Issues

None.

## CI Status

Focused local verification before push:

- `cargo test -p native-updater` — passed, 20 tests.
- `cargo clippy -p native-updater --all-targets -- -D warnings` — passed.
- `cargo check --workspace` — passed.

Final CI status will be updated after push and `gh pr checks --watch --fail-fast`.

## Open Threads

The addressed threads will be resolved silently after the fix commit is pushed.

## Handoff

Comments addressed. Continue to `/learn`.
