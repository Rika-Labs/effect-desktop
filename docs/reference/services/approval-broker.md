---
title: ApprovalBroker
description: Coalesces approval requests and routes prompts through a substitutable host port.
kind: reference
audience: app-developers
effect_version: 4
---

# `ApprovalBroker`

Owns runtime approval coalescing, per-actor queueing, denied-for-scope caching, and audit emission. Renderer code never constructs authoritative approval prompts; the broker does, behind an `ApprovalPromptPort`.

## Import

```ts
import {
  ApprovalBroker,
  makeApprovalBroker,
  ApprovalRequest,
  ApprovalOutcome,
  ApprovalBrokerInvalidArgumentError,
  ApprovalBrokerQueueOverflowError,
  ApprovalBrokerAuditFailedError,
  ApprovalBrokerPromptFailedError,
  type ApprovalBrokerApi,
  type ApprovalBrokerError,
  type ApprovalBrokerOptions,
  type ApprovalPromptPort,
  type ApprovalOutcomeKind,
  type ApprovalRisk
} from "@orika/core"
```

## Service

`ApprovalBroker: Context.Service<ApprovalBroker, ApprovalBrokerApi>`

The default `make` fails with `InvalidArgument` because the broker requires an explicit `ApprovalPromptPort`. Production code provides a layer built from `makeApprovalBroker({ prompt, ... })`.

## API

| Method     | Signature                                                            | Description                                                                     |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ask`      | `(request: unknown) => Effect<ApprovalOutcome, ApprovalBrokerError>` | Decodes the request, coalesces duplicates, queues per actor, routes the prompt. |
| `shutdown` | `Effect<void>`                                                       | Closes the internal scope; in-flight prompts fail with `ApprovalPromptFailed`.  |

There is no public `observe` or `cancel` method. Live observation of approval events flows through `AuditEvents.observe()` (see [`AuditEvents`](audit-events.md)).

## Request shape

```ts
class ApprovalRequest {
  id: string // metadata text (non-empty, no control chars)
  operation: string
  actor: string // actor identifier; coalescing keys off (operation, actor, resource)
  resource?: string
  risk: "low" | "medium" | "high" | "critical"
  summary: string
  details: unknown
  expiresAt?: number
  traceId?: string // generated if absent
}
```

`ApprovalOutcome` carries `requestId`, `outcome` (`"approved-once" | "approved-for-scope" | "denied-once" | "denied-for-scope" | "timed-out" | "canceled" | "revoked"`), `traceId`, `decidedAt`, `source`.

## Behavior

- **Coalescing.** Identical `(operation, actor, resource)` requests share one prompt and resolve together.
- **At most one active prompt per actor.** Distinct requests queue behind it up to `maxQueueDepthPerActor` (default `8`).
- **Denied-for-scope cache.** An outcome of `denied-for-scope` is cached per `(operation, actor, resource)`; future identical requests resolve immediately with the cached `denied-for-scope` outcome from `source: "scope-cache"`.
- **`devApproveAll` bypass.** Resolves every request as `approved-once` without touching the port; emits `approval-requested` then `approval-granted` audit events with `source: "dev-bypass"`.

## `ApprovalPromptPort`

```ts
interface ApprovalPromptPort {
  prompt: (request: ApprovalRequest) => Effect<ApprovalOutcome, ApprovalBrokerPromptFailedError>
}
```

Production: a host-rendered native modal. Tests: a deterministic resolver. The renderer's `PermissionApprovalQueue` consumes its own approval-resolver port; it does not call this port directly.

## Errors

- `ApprovalBrokerInvalidArgumentError` (`_tag: "InvalidArgument"`) — request/outcome/`maxQueueDepthPerActor` failed Schema decode.
- `ApprovalBrokerQueueOverflowError` (`_tag: "QueueOverflow"`) — per-actor queue full.
- `ApprovalBrokerAuditFailedError` (`_tag: "ApprovalAuditFailed"`) — audit emission failed.
- `ApprovalBrokerPromptFailedError` (`_tag: "ApprovalPromptFailed"`) — port failed or broker shut down mid-flight.

## Options

`makeApprovalBroker({ prompt, audit?, devApproveAll?, maxQueueDepthPerActor?, now?, traceId? })` returns an `Effect<ApprovalBrokerApi, ApprovalBrokerInvalidArgumentError>`.

## Example

```ts
import { Effect } from "effect"
import { ApprovalBroker, type ApprovalRequest } from "@orika/core"

const request: ApprovalRequest = new ApprovalRequest({
  id: crypto.randomUUID(),
  operation: "filesystem.write",
  actor: "window:main",
  resource: "/Users/me/Downloads/file.md",
  risk: "medium",
  summary: "Save export",
  details: { bytes: 4096 }
})

const program = Effect.gen(function* () {
  const broker = yield* ApprovalBroker
  const outcome = yield* broker.ask(request)
  if (outcome.outcome === "approved-once" || outcome.outcome === "approved-for-scope") {
    // proceed
  }
})
```

## Related

- Explanation: [Permissions model](../../explanation/permissions-model.md)
- Reference: [`PermissionRegistry`](permission-registry.md), [`AuditEvents`](audit-events.md)
- How-to: [Handle an approval prompt](../../how-to/handle-an-approval-prompt.md)
- Source: [`packages/core/src/runtime/approval-broker.ts`](../../../packages/core/src/runtime/approval-broker.ts)
