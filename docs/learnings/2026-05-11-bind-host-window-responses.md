# Bind Host Window Responses

## Planned

Prevent the host window client from accepting a response envelope that belongs to a different in-flight request.

## Shipped

`makeHostWindowClient` now keeps each request envelope in scope and checks response `id` and `traceId` before decoding success or host errors. Mismatches fail as `InvalidOutput`, so stale or cross-wired host responses cannot be delivered to the wrong `Window.create` or `Window.destroy` call.

## Lesson

Any helper that consumes raw multiplexed envelopes owns request/response correlation. Decode payloads only after the envelope proves it belongs to the request being completed.
