# Validate API Package Discovery

## Planned

Make public API snapshot discovery operate on real packages with valid package names.

## Shipped

`desktop check --api` now skips incidental directories under `packages/` when they lack `package.json`. Package names must be valid lowercase npm-style package identities before snapshots are written, so path-shaped names cannot become durable snapshot filenames.

## Lesson

Discovery and validation are separate boundaries. Discovery should ignore non-participants, while selected participants should fail loudly when their identity metadata is malformed.
