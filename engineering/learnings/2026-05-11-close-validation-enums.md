# Close Validation Enums

## Planned

Reject invalid boundary values that previously flowed into runtime behavior as ambiguous strings or contradictory metadata.

## Shipped

PTY budget validation now rejects unsupported output overflow policies before adapter open. Host protocol error decoding now enforces the recoverability policy assigned by each error tag. API contract registration now rejects resource specs with blank or whitespace-only kind/state names.

## Lesson

Closed vocabularies should be enforced where the value first becomes part of system state. Letting unknown strings pass through makes metrics, retries, and generated contracts describe behavior the runtime never intentionally supported.
