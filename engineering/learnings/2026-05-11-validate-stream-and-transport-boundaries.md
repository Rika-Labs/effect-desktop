# Validate Stream And Transport Boundaries

## Planned

Close validation gaps for generated stream IDs, ambiguous stream envelopes, and malformed streaming transport input.

## Shipped

Bridge stream runtime now rejects empty generated stream IDs before registry mutation. Host protocol decoding now rejects stream envelopes that contain both `payload` and `error`. Transport `unframeStream` now validates the `chunks` stream before constructing the producer fiber.

## Review Surface

The public protocol shape is unchanged. Invalid states that previously crossed module boundaries now fail at decode or call time with typed errors.

## Lesson

Optional fields are not state machines. If two optional fields represent different outcomes, the decoder must reject combinations that cannot mean one thing.

## AGENTS.md Amendment Candidate

None.
