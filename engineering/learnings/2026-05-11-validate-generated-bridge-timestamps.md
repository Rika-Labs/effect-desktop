---
date: 2026-05-11
topic: Generated bridge protocol timestamps
issues: [641, 642, 643]
---

# Generated bridge protocol timestamps

Strict protocol schema constructors are a decode boundary, not a recovery strategy for local
metadata. `Client`, `EventHub`, and `Streams` each generated protocol timestamps with `now()` and
then constructed host protocol envelopes directly. A bad clock value turned into a defect at the
constructor instead of a typed `HostProtocolError`.

The fix makes timestamp validity a protocol helper and calls it before constructing request,
cancel, event, and stream envelopes. Stream producer failures are delivered through the stream
queue so consumers observe typed failures instead of hanging on a producer defect.

The durable rule: validate locally generated protocol metadata before strict schema construction.
Constructors should prove the invariant, not be the first place it can fail.
