# Validate Bridge Envelope Outcomes

## Planned

Issues #399, #401, and #419 targeted bridge identities and response outcomes: generated request IDs, client response discriminants, and response payload/error exclusivity.

## Shipped

The client request builder now validates generated request IDs before transport. Client response handling rejects unknown response `kind` values as `InvalidOutput`. The host protocol decoder rejects response envelopes containing both `payload` and `error`, while preserving payload-only and error-only responses.

## Review Surface

The changes sit at the shared bridge protocol/client boundaries, so one regression covers every generated client method and every decoded host response envelope.

## Lesson

Protocol state must be explicit at the boundary. Optional fields are not enough when two fields represent mutually exclusive outcomes.

## AGENTS Amendment Candidate

None.
