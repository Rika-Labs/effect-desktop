---
date: 2026-05-16
type: in-flight-feature
topic: Add egress policy service
issue: https://github.com/Rika-Labs/effect-desktop/issues/1389
pr: none
---

# Add egress policy service

## Decision

Egress policy rules must be trusted service configuration, not caller-supplied request data, even when the same Schema machinery could encode both shapes.

## What changed

The issue asked for a product-neutral Effect service that decides and records outbound access with typed failures, audit rows, a substitutable test layer, bridge wiring, Rust protocol support, docs, and API snapshots. The shipped service validates caller input, checks `PermissionRegistry` before any host or client side effect, evaluates trusted rules from the service layer, records issued decisions locally, emits decision events, and audits the actor, destination, and policy rule.

The review changed the contract. The first shape let callers provide policy rules through the exported client/RPC/host payload. That made the policy source untrusted. The final shape removes rules from the caller boundary and leaves the Rust host boundary fail-closed with a default deny result unless trusted local policy is added later.

## Why it mattered

The invariant is that egress authorization depends on policy owned by the runtime, not policy carried by the request being authorized. The hidden incentive was interface symmetry: it is easy to make a `decide` payload include everything needed to compute a result. For security policy, that symmetry is wrong because it lets the least-trusted side choose the rule set.

## Example

```ts
export const makeEgressPolicyServiceLayer = (
  client: EgressPolicyClientApi,
  options: {
    readonly permissions: PermissionRegistryApi
    readonly rules?: readonly EgressPolicyRule[]
  }
) => Layer.effect(EgressPolicy)(makeEgressPolicyService(client, options))
```

## Rule candidate

Do not put authorization policy rules on request payloads crossing an untrusted boundary. Why: the boundary may be Schema-typed and still let the caller choose the policy being enforced.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
