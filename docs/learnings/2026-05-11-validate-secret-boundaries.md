# Validate Secret Boundaries

## Planned

Keep malformed secret bytes and blank audit trace IDs from becoming redacted or persisted secret operations.

## Shipped

Core and native `SecretValue.fromBytes` now reject non-`Uint8Array` runtime input before copying. The core `Secrets` service now validates generated audit trace IDs before authorization, safe-storage calls, or audit writes.

## Lesson

Redaction can hide construction bugs. Secret values and secret audit metadata need validation before side effects so failures stay visible instead of becoming redacted empty data or uncorrelatable audit rows.
