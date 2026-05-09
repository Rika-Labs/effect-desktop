# Address

Triaged PR #941 review comments.

| Row | Source    | Verdict | Location                                    | Reason                                                                                                                                 |
| --- | --------- | ------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Codex bot | Address | `packages/cli/src/index.test.ts`            | Valid cross-platform test failure; the assertion encoded POSIX separators.                                                             |
| 2   | Codex bot | Address | `packages/cli/src/notarization-pipeline.ts` | Valid package compatibility issue; package metadata can contain basename dots, and containment already rejects path-segment traversal. |

Changes:

- Made the metadata-path assertion separator-neutral.
- Removed the overbroad `fileName.includes("..")` rejection.
- Added a regression proving contained basenames with consecutive dots still notarize.

Verification:

- `bun test packages/cli/src/index.test.ts -t "desktop notarize"`
- `bun run typecheck --filter=@effect-desktop/cli`
- `bun run lint --filter=@effect-desktop/cli`
- `bun prettier --check packages/cli/src/notarization-pipeline.ts packages/cli/src/index.test.ts docs/runs/issue-819-contain-notarization-artifact-file-names/20-review.md docs/runs/issue-819-contain-notarization-artifact-file-names/21-work.md`
