# Reject Filesystem NUL Paths

## Planned

Stop invalid native path bytes before filesystem authorization or adapter calls.

## Shipped

Filesystem path schemas now reject NUL bytes for read, realpath, write, writeAtomic, stat, mkdir, remove, and watch. The regression uses a recording adapter and proves rejected paths produce no adapter calls.

## Review Surface

The guard lives in the shared path schema, before canonicalization. Watch owner scopes remain ordinary non-empty strings because they are resource ownership labels, not filesystem paths.

## Lesson

Path containment checks assume the path is representable by native filesystem APIs. Reject invalid path bytes before canonicalization so adapter behavior cannot become the security boundary.
