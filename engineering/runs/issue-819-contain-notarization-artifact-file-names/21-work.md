# Work

Implemented #819 on branch `issue-819-contain-notarization-artifact-file-names`.

Changes:

- Added `resolveArtifactPath` in `packages/cli/src/notarization-pipeline.ts`.
- Rejected non-basename `artifact.json#fileName` values containing path separators, URL/drive separators, or control bytes.
- Resolved candidate artifact paths under the metadata directory before `statPath`.
- Added `desktop notarize rejects artifact file names outside the metadata directory` covering traversal, nested POSIX paths, nested Windows paths, URL-shaped names, and control bytes.
- Added `desktop notarize accepts contained artifact file names with consecutive dots` so package-produced dotted basenames remain valid.

Verification:

- `bun test packages/cli/src/index.test.ts -t "desktop notarize rejects artifact file names outside the metadata directory"`
- `bun test packages/cli/src/index.test.ts -t "desktop notarize"`
- `bun run typecheck --filter=@orika/cli`
- `bun run lint --filter=@orika/cli`
