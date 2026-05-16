# Validate Telemetry Metric Timestamps

## Planned

Make `maxMetrics` a hard telemetry bound even when metric clocks or explicit metric timestamps are malformed.

## Shipped

Metric recording now validates the resolved timestamp before mutating the metric map. Invalid clock or input timestamps fail as `TelemetryInvalidArgumentError` and leave the bounded metric store unchanged.

## Review Surface

The key invariant is mutation order: validate metadata and timestamp first, then upsert and evict. Eviction should never have to order `NaN`.

## Lesson

Capacity guards are only reliable when malformed ordering keys are rejected before insertion. Do not ask eviction code to recover from values that should never have entered the store.
