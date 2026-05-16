# Issue 812 Review: Validate CrashReporter.flush Output Counts

## Locked Decision

Use `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))` for `CrashReporterFlushResult.flushed`.

## Pressure Test

- Correctness: `Schema.Int` rejects `NaN`, infinities, and fractions; the lower-bound check rejects negative values.
- Scope: the change is limited to the output contract and bridge tests.
- Compatibility: valid integer counts still decode, including zero.
- Failure mode: malformed host output becomes `InvalidOutput` through the existing bridge decoder.

## Tradeoff

This treats safe integer counts as the portable boundary. If a future host can flush more than JavaScript's safe integer range in one call, the API should change shape rather than widening this count to an unsafe number.

Handoff: `/work`
