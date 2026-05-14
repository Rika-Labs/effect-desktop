# Replace Worker Adapter With Effect Workers

## Context

Issue #1160 targeted the default worker adapter. The old adapter directly constructed Bun workers, registered event listeners, mutated Effect queues from callbacks through detached `Effect.runFork`, and owned shutdown cleanup manually.

## What Changed

The default adapter now builds a small `WorkerPlatform` with `effect/unstable/workers/Worker.makePlatform`. Worker startup runs through `Worker.run`, listener cleanup is attached to the worker scope, and `Worker.send` goes through Effect's worker primitive.

The adapter still preserves Effect Desktop's current raw app-worker protocol. Effect worker outbound frames are unwrapped before `postMessage`, and raw worker `message` events are emitted as Effect worker data frames.

The worker channel contract now accepts pure `Schema.Decoder<_, never>` values. That removed the local decode casts that were recovering erased Schema service requirements in `Worker.send` and `Worker.messages`.

## What Worked

The useful split was to let Effect own the run loop while keeping the protocol shim local. That avoided a broad app-worker protocol migration while still removing the detached callback fibers from the default adapter.

## Friction

Effect's worker primitive models a worker runner protocol with ready/data envelopes. Existing Effect Desktop workers send raw values. The adapter therefore needs a tiny translation layer until the public worker script contract is intentionally migrated.

## Durable Rule

When adopting an Effect primitive that has its own internal protocol, keep compatibility translation at the boundary and make the internal runtime path canonical. Do not reimplement the primitive's lifecycle just to avoid a small protocol shim.

When an API stores schemas for later boundary decoding, preserve the pure decoder type in the public contract instead of accepting `Schema.Schema` and recasting the resulting Effect.
