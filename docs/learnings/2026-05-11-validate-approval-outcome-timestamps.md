# Validate Approval Outcome Timestamps

## Planned

Close #477 by rejecting invalid `ApprovalOutcome.decidedAt` values returned by host prompts before the broker audits a grant or deny decision.

## Shipped

`ApprovalOutcome.decidedAt` now uses the same non-negative integer boundary as other runtime timestamps. The broker already decoded prompt output before decision audit and waiter completion, so tightening the schema fixed the boundary without adding a second validation path.

## Review

The regression test bypasses the schema constructor with plain data because hostile or buggy prompt ports can return structurally invalid values. It asserts those outcomes fail as `ApprovalBrokerInvalidArgumentError` and only the request audit row is emitted.

## Lesson

For security-relevant host output, put the invariant on the shared schema and make the broker decode returned data before side effects. That keeps constructor-time and boundary-time validation aligned.
