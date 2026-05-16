---
title: EgressPolicy (native)
description: Product-neutral network egress decision service with auditable denials.
kind: reference
audience: app-developers
effect_version: 4
---

# `EgressPolicy`

Product-neutral network egress decision service. Callers submit an actor and destination before performing host-side network, file, process, or secret work that would cause outbound access. Trusted service configuration supplies the ordered policy rules; callers do not choose their own policy.

The public service is Layer-first and test-substitutable. `decide` checks `network.connect` permission before crossing the native bridge, then asks the host adapter to evaluate the trusted policy payload. Denied decisions are recorded as audit rows with actor, destination, and rule details.

## Methods

| Method        | Payload                            | Success                                                     |
| ------------- | ---------------------------------- | ----------------------------------------------------------- |
| `decide`      | `{ actor, destination, traceId? }` | `{ decisionId, outcome, actor, destination, rule, reason }` |
| `record`      | `{ decisionId, traceId? }`         | `{ decisionId, recorded }`                                  |
| `isSupported` | `void`                             | `{ supported, reason? }`                                    |
| `events`      | `void`                             | stream of `decision-recorded` events                        |

## Rules

Rules are evaluated in order. The first matching rule wins. A rule may match by actor, host pattern, protocol, and port. If no rule matches, the service returns a `default-deny` decision.

Rules belong to the trusted service layer through `makeEgressPolicyServiceLayer(..., { rules })`. The lower host-client contract carries those rules to the adapter, but the application-facing `EgressPolicy` service accepts only actor, destination, and optional trace id.

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

## Errors

`EgressPolicyError` is the canonical host protocol error union. Permission denial, unsupported platforms, invalid input, and host failures are typed tagged failures.

## Support

| Platform | Status      |
| -------- | ----------- |
| macOS    | `supported` |
| Windows  | `supported` |
| Linux    | `supported` |

## Testing

Use `makeEgressPolicyMemoryClient()` for deterministic policy decisions and decision events. Use `makeEgressPolicyUnsupportedClient()` when a test needs a typed unsupported failure.

## Related

- Source: [`packages/native/src/egress-policy.ts`](../../../packages/native/src/egress-policy.ts)
- Contract: [`packages/native/src/contracts/egress-policy.ts`](../../../packages/native/src/contracts/egress-policy.ts)
