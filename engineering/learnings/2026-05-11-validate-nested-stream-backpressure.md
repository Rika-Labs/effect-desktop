# Validate Nested Stream Backpressure

## Planned

Reject malformed backpressure policies declared inside `Api.Stream` outputs during contract registration.

## Shipped

`validateMethodSpec` now validates `spec.output.backpressure` for stream outputs with the same `validateBackpressureSpec` used by method and event policies. The regression proves a fractional nested stream size and invalid overflow fail as `InvalidApiContractSpec`.

## Lesson

Validation should follow the data shape, not just the top-level method shape. If one policy can appear in multiple places, every location must call the same validator.
