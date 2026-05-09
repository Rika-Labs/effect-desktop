# Validate CrashReporter.flush Output Counts

## Planned

Issue #812 required `CrashReporter.flush` to reject impossible host output counts. The target was a schema-level fix so bad host payloads fail during decode rather than becoming SDK values.

## Shipped

`CrashReporterFlushResult.flushed` now uses a private non-negative integer schema. Bridge tests reject negative, fractional, `NaN`, and infinite values as `InvalidOutput`. The valid bridge path now covers zero, while the memory client tests continue to cover positive counts.

PR: https://github.com/Rika-Labs/effect-desktop/pull/835

## Review

Code review found no issues. CI passed on Ubuntu, macOS, and Windows before the learning commit.

## Lesson

Host output deserves the same tight domain schema as app input. Raw `number` is not a count; count contracts should use integer schemas so JSON-hostile values and fractional values cannot enter the SDK model.

## AGENTS.md Amendment Candidate

None.
