# Validate Bridge Envelope Identity

## Planned

Reject empty bridge envelope trace and routing fields at the shared protocol boundary.

## Shipped

Host protocol envelopes now require non-empty trace IDs, request/event methods, stream/cancel resource IDs, and present renderer origin fields. The bridge client validates generated trace IDs and optional renderer origin fields as typed `InvalidArgument` failures before transport.

## Lesson

Correlation and routing fields are protocol coordinates, not payload details. Keeping the invariant in the envelope schema makes malformed wire data fail before dispatch, while client-side validation preserves typed failures for bad local generators.
