# Preserve Memory Atomic Symlink Targets

## Planned

Close #683 by making memory-backed `Filesystem.writeAtomic` match real rename semantics when the destination is a symlink.

## Shipped

`Filesystem.writeAtomic` now authorizes the destination directory entry instead of canonicalizing the final path through `realpath`. The atomic rename replaces the symlink entry while leaving the symlink target unchanged. The memory filesystem regression test covers target preservation, replacement bytes at the link path, and changed link identity.

## Review

The memory adapter already renamed over the destination entry; the bug was the core write-authorization mode resolving the symlink leaf before the adapter saw it. While verifying the touched package, `@effect-desktop/test` typecheck exposed an existing `makeMockPty` error-type mismatch, so its signature now reflects `HostProtocolInvalidArgumentError`.

## Lesson

Path canonicalization is operation-specific. Reads should follow symlinks; atomic rename destinations should preserve the directory entry being replaced.
