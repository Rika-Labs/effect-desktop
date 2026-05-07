# Timeout Errors Own Recovery Breadcrumbs

## Observation

The restart readiness API returned `RestartDeadlineExceeded` while leaving breadcrumb persistence to a separate call. Review exposed that this made the observable recovery record optional even though the timeout error and breadcrumb describe the same missed deadline.

## Evidence

- PR: https://github.com/Rika-Labs/effect-desktop/pull/277
- Issue: https://github.com/Rika-Labs/effect-desktop/issues/89
- Review finding: `ready_for_restart` could return `RestartDeadlineExceeded` without persisting the recovery breadcrumb required by the graceful-restart contract.
- Fix commit: `f85eada`.
- Verification:
  - `cargo test -p native-updater` passed with 21 tests.
  - `cargo clippy -p native-updater --all-targets -- -D warnings` passed locally.
  - `cargo check --workspace` passed locally.

## General principle

When a typed operational failure requires a durable recovery record, the primitive that detects the failure should write that record before returning the typed value. Splitting detection from recording makes observability depend on caller discipline.

## Trigger condition

Apply this when an API returns a typed timeout, cancellation, force-close, rollback, recovery, or degraded-mode value that the next launch or operator view must observe.

## Limits / counterexamples

Do not force persistence into pure validators. This applies when the function already represents an effectful runtime transition and has enough context to write the required record.

## Codification target

- docs/learnings

## Proposed amendment or issue

No new issue. The readiness API now receives install paths and writes the restart breadcrumb before returning `RestartDeadlineExceeded`.
