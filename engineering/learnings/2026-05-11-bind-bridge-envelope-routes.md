# Bind bridge envelope routes

## Planned

Close issues #528 and #529 by binding client-side decoded envelopes to the request or event operation that created the stream.

## Shipped

The bridge client now rejects event envelopes whose `method` differs from the subscribed event operation before decoding payloads. It also rejects request stream envelopes whose `id` differs from the request that opened the stream before decoding terminal frames or data chunks.

## Review surfaced

Schema-valid payloads are not enough for isolation. A wrong event method or stream request id can carry a compatible payload and still be invalid for the caller that receives it.

## Lesson

Protocol decoders must validate route identity before payload shape. Shape proves a message is well-formed; route identity proves it belongs to this caller.

## AGENTS.md amendment candidate

None.
