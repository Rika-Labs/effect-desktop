---
date: 2026-05-17
type: in-flight-feature
topic: Clarify EgressPolicy host support
issue: https://github.com/Rika-Labs/effect-desktop/issues/1400
pr: none
---

# Clarify EgressPolicy host support

## Decision

Host-supported policy primitives need a receipt boundary: the trusted service decides, and the host records only validated issued decision identities.

## What changed

The issue proposed a split contract where `EgressPolicy` owns trusted allow and deny rule evaluation while the host owns durable recording and lifecycle events. That shape shipped, but review tightened the lifecycle mechanics around it. The lower native and Rust `record` call now accepts `decisionId`, actor, destination, and optional trace ID instead of caller-supplied rules, outcomes, or reasons. The host mints receipts during `decide`, validates matching receipt metadata during `record`, persists the receipt, and emits a real host event.

The platform review changed the transport and service internals. Host event subscription now starts lazily, runs under a scoped reader, routes fatal reader failures to subscribers, and exposes a close hook. `EgressPolicy.record` now treats the service state transition and host record as one uninterruptible critical section, with typed host failures rolling back local state.

## Why it mattered

The invariant is that a supported native security primitive must not let the least-trusted caller choose the policy result being recorded. The hidden failure mode was not the rule evaluator; it was the receipt lifecycle around the evaluator. A correct boundary can still lose correctness if event readers leak, fatal streams hang, or interruption leaves a decision neither issued nor recorded.

## Example

```ts
const recordIssuedDecision = (input: EgressPolicyRecordInput) =>
  claimIssued(input.decisionId).pipe(
    Effect.flatMap((decision) =>
      client.record({
        actor: decision.actor,
        decisionId: decision.id,
        destination: decision.destination,
        traceId: decision.traceId
      })
    ),
    Effect.uninterruptible
  )
```

## Rule candidate

When a host method records a service decision, accept a host-issued receipt identity rather than decision contents. Why: this preserves one trusted policy source and prevents forged or replayed outcomes from becoming durable host facts.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
