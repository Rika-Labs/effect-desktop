---
title: EgressPolicy (native)
description: Product-neutral network egress decision service with auditable denials.
kind: reference
audience: app-developers
effect_version: 4
---

# `EgressPolicy`

Product-neutral network egress decision service. Callers submit an actor and destination before performing host-side network, file, process, or secret work that would cause outbound access. Trusted service configuration supplies the ordered policy rules; callers do not choose their own policy.

The public service is Layer-first and test-substitutable. `decide` checks `network.connect` permission, asks the host to issue a decision receipt, then evaluates trusted service-layer rules in process using that host-issued `decisionId`. The Rust host adapter does not evaluate or accept caller-supplied policy rules on `decide`; lower native `record` accepts only `decisionId`, `actor`, and `destination`, verifies them against the host-issued receipt, appends the host receipt to the decision log under an OS file lock, and emits a native `decision-recorded` event after the append succeeds. Public service events observe that host or memory-client event source and map the host receipt back to the trusted service-layer decision.

`EgressPolicy` is not a native network transport. It does not perform HTTP fetches, open WebSockets, upload data, bind localhost helpers, stream network progress, or cancel network I/O. Those operations still require a separate native network service and Rust host adapter.

It also does not configure proxies, handle HTTP auth challenges, or decide
certificate trust. Those hooks are absent; adding them would require a new
network-auth service and host adapter.

## Methods

| Method        | Payload                            | Success                                                     |
| ------------- | ---------------------------------- | ----------------------------------------------------------- |
| `decide`      | `{ actor, destination, traceId? }` | `{ decisionId, outcome, actor, destination, rule, reason }` |
| `record`      | `{ decisionId, traceId? }`         | `{ decisionId, recorded }`                                  |
| `isSupported` | `void`                             | `{ supported, reason? }`                                    |
| `events`      | `void`                             | stream of `decision-recorded` events                        |

The application-facing `record` payload is intentionally narrow: `{ decisionId, traceId? }`. The lower native bridge call carries `{ decisionId, actor, destination, traceId? }`; it never carries caller-supplied rules, outcomes, or reasons. The host rejects unknown top-level rule sets on `decide` and rejects `record` calls whose actor or destination do not match the host-issued receipt.

## Rules

Rules are evaluated in order. The first matching rule wins. A rule may match by actor, host pattern, protocol, and port. If no rule matches, the service returns a `default-deny` decision.

Rules belong to the trusted service layer through `makeEgressPolicyServiceLayer(..., { rules })`. Direct native `decide` calls reject caller-supplied rules and only issue a default-deny host receipt; trusted allow/deny evaluation stays in the TypeScript service layer.

```ts
{
  id: "allow-api",
  effect: "allow",
  hosts: ["api.example.test"],
  protocols: ["https"],
  ports: [443],
  reason: "workspace policy allows API access"
}
```

## Audit

Denied attempts are auditable. The emitted audit details include:

- `actor`
- `destination`
- `rule`

Permission-registry denials before the bridge are audited with rule id `permission-registry`.
Public `decision-recorded` events are observed only after the native record call succeeds. Native host event frames describe the host-issued receipt; the public service maps them to the trusted service-layer decision for application consumers.

## Errors

`EgressPolicyError` is the canonical host protocol error union. Permission denial, unsupported platforms, invalid input, and host failures are typed tagged failures.

## Support

| Platform | Status                                                   |
| -------- | -------------------------------------------------------- |
| macOS    | `partial`; runtime-probed decision log and event support |
| Windows  | `partial`; runtime-probed decision log and event support |
| Linux    | `partial`; runtime-probed decision log and event support |

`isSupported` returns `{ supported: true }` only when the host adapter can validate records and append them to the host decision log. The log path can be overridden with `EFFECT_DESKTOP_EGRESS_POLICY_LOG`; otherwise the host uses the platform app/state data directory. Other platforms are unsupported unless they provide an explicit log path override.

## Testing

Use `makeEgressPolicyMemoryClient()` for deterministic policy decisions, host-recording failures, and decision-recorded events. Use `makeEgressPolicyUnsupportedClient()` when a test needs a typed unsupported failure.

## Architecture Debt Sweep

No wrapper was removed. `EgressPolicy` is durable policy, audit, and decision-receipt behavior, not a removable Effect wrapper over network transport. The remaining debt for native network parity is the absent `NativeNetwork` service and Rust host transport adapter for HTTP, WebSocket, upload, localhost helper, cancellation, and progress/event streams.

## Related

- Source: [`packages/native/src/egress-policy.ts`](../../../packages/native/src/egress-policy.ts)
- Contract: [`packages/native/src/contracts/egress-policy.ts`](../../../packages/native/src/contracts/egress-policy.ts)
