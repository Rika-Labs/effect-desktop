# Scout

Issue #819 targets one trust boundary in `bun desktop notarize`: `artifact.json#fileName` was read from package metadata and passed through `join(rootPath, fileName)` before any Apple tooling ran.

Relevant code:

- `packages/cli/src/notarization-pipeline.ts` discovers macOS artifact metadata in `readPackagedArtifacts`.
- `packages/cli/src/index.test.ts` already has notarization command-runner tests that can prove whether `stapler`, `notarytool`, or `spctl` was invoked.
- `writePackagedArtifactFixture` writes valid basename metadata, so valid app and dmg behavior can remain unchanged.

Constraint: `artifact.json` is metadata, not a path authority. The notarization boundary should accept only a contained basename and fail with `NotarizeConfigError` before command execution.
