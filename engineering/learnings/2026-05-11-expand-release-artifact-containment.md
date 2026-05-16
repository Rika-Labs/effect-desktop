# Expand Release Artifact Containment

## Planned

Close the remaining signing and notarization filename-containment issues by proving every path-shaped metadata value is rejected before release tools run.

## Shipped

The existing containment guards already rejected escaped artifact names. The regression matrix now covers relative traversal, absolute paths, dot segments, and nested POSIX/Windows-style paths for both signing and notarization command runners.

## Review Surface

This was a test-hardening closeout, not a behavior change. The important assertion is that command runner calls stay empty for every malformed `artifact.json#fileName`.

## Lesson

Security boundary tests need representative attacker shapes, not one sample. A single `../name` case can miss absolute paths, dot segments, and platform-specific separators.
