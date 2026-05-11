# Validate Process Boundary Inputs

## Planned

Keep malformed process metadata, stdin chunks, and observability caps from crossing into adapter behavior.

## Shipped

`makeProcess` now rejects invalid `maxSnapshots` values before runtime construction. Process stdin writes now verify each chunk is a `Uint8Array` before calling `writeStdin`, and process spawn tests explicitly prove empty environment variable names fail before adapter activity.

## Lesson

TypeScript types do not protect host boundaries at runtime. Decode byte streams and configuration knobs where the service receives them, so adapters only implement host I/O rather than becoming the fallback validator.
