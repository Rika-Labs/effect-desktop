# Validate Devtools And Reconnect Options

## Planned

Issues #462, #463, and #464 targeted numeric options that JavaScript otherwise accepts with surprising semantics: devtools row caps, devtools refresh intervals, and renderer reconnect backfill counts.

## Shipped

Devtools panels now share one positive row-limit validator and one positive millisecond interval validator. Renderer resume now denies non-finite, negative, or fractional backfill counts and caps through the existing backfill-exhausted path.

## Review Surface

The devtools validators throw `DevtoolsInvalidOptionError` during panel construction, before `slice` or `Effect.sleep` receives invalid values. Reconnect remains a pure decision function and maps invalid numeric evidence to the existing denial reason.

## Lesson

Plain numbers are not configuration contracts. Decode numeric options at the boundary so JavaScript coercion cannot become runtime policy.

## AGENTS Amendment Candidate

None.
