# Report Migrated Secret Keys

## Planned

Make the Secrets migration report truthful when callers provide explicit legacy key lists that include absent keys.

## Shipped

Per-key migration now returns `Option<string>`. Absent source settings return `None`, while keys that are read, written, verified, audited, and deleted return `Some(key)` and enter the report.

## Review Surface

The complete flag still writes after scanning all candidates, so idempotent empty migrations remain complete. Only the evidence list changed.

## Lesson

Migration reports are operator evidence, not loop counters. A skipped absent source is successful idempotency, but it is not a migrated record.
