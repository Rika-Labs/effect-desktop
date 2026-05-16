# Contain Artifact Boundaries

## Planned

Close the remaining path-boundary gaps in build, package, and publish without widening the CLI surface.

## Shipped

Build entry files now go through the same app-root containment check as renderer output paths before the CLI stats or builds them. Package app IDs already used the shared reverse-DNS filename guard, so the fix added package-specific evidence that path-shaped IDs fail before Linux sidecars are staged. Publish now uses `lstat` while digesting directory artifacts and rejects symlinks instead of following them into external bytes.

## Review Surface

The non-obvious edge was artifact metadata: a test must update `artifact.json` to the digest that the old unsafe traversal would have accepted, or the failure only proves stale metadata detection. The regression now proves the publish walker itself rejects the symlink.

## Lesson

Any path that names executable input, package identity, or publish bytes is a trust boundary. Validate the path or link type at the first owner of that boundary, then make the test prove no downstream command ran.
