# Verify Release Artifact Checksums

## Planned

Make signing and notarization prove that package artifacts still match `artifact.json` before using release credentials or Apple submission commands.

## Shipped

Signing and notarization now read package metadata `sizeBytes` and `sha256`, recompute deterministic artifact digests, and fail with typed file errors before command runners execute when bytes drift. Directory digest verification now matches package output semantics for file content, directory entries, modes, and symlink targets. Publish digest verification was aligned with the same directory metadata for non-symlink artifacts while keeping publish-time symlink rejection intact.

## Review Surface

The fixture digest helper had been using an older content-only directory hash. Tightening signing/notarization against package metadata exposed that mismatch, so the test helper now mirrors package metadata rather than the old publish-only digest.

## Lesson

Release steps are attestation steps, not repair steps. Every step that spends release authority must bind the current artifact bytes to the package metadata before it calls external tooling.
