---
date: 2026-05-11
topic: Bridge stream terminal frames
issues: [673]
---

# Bridge stream terminal frames

The bridge client decoded each stream envelope independently. A `complete`
frame produced no element, but the outer stream kept reading later envelopes, so
a malformed host or replay path could deliver data after completion.

The fix moves terminal handling to the envelope stream boundary. Before
flattening frames into user chunks, the client now stops the exchange stream at
the first terminal envelope: protocol error, stream error, complete, or closed.
The one-frame decoder still owns schema validation, but stream-level lifecycle
state decides how long the client consumes the host stream.

The lesson is that terminal protocol messages are not empty data messages. They
are state transitions. If terminality is handled only inside a per-frame mapper,
the next frame can still run through the pipeline and violate the public stream
contract.
