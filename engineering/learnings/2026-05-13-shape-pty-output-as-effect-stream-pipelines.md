# Shape PTY Output As Effect Stream Pipelines

## Context

Issue #1282 targeted PTY output because the old implementation used `Queue`, a scoped producer fiber, and manual room accounting around a `Stream` boundary. That duplicated stream buffering and interruption semantics in local service code.

## What Changed

`PtyHandle.output` is now built as a stream pipeline. Raw adapter bytes enter through `Stream.fromReadableStream`, input metrics are recorded with `Stream.mapEffect`, coalescing is a pull transform, overflow policy is applied as an effectful frame filter, and buffering is delegated to `Stream.buffer`.

The test that previously asserted internal queue eviction metrics now asserts the public stream behavior: `dropOldest` keeps the output bounded and emits the expected bytes. Hidden queue byte accounting disappeared with the queue.

## What Worked

The useful split was to treat coalescing as PTY policy and buffering as Effect infrastructure. PTY still decides when bytes become frames and how host-protocol overflow errors are raised. Effect owns buffering and sink interruption.

## Friction

Effect `Stream.buffer` intentionally does not expose dropped-byte internals for sliding buffers. Keeping the old `droppedBytes` assertion would have forced a second queue-like accounting layer back into PTY. The better invariant is the stream boundary: bounded output and typed overflow behavior.

## Durable Rule

When replacing a manual queue with `Stream.buffer`, remove tests that assert hidden queue counters. Keep tests at the public stream boundary unless the metric is still produced by durable product policy rather than by the removed queue implementation.
