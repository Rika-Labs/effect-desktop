---
title: Architecture overview
description: Three process roles and the data flow between them.
kind: explanation
audience: app-developers
effect_version: 4
---

# Architecture overview

> The full essay lives at [`explanation/architecture.md`](explanation/architecture.md). This page is the release-gated reference summary.

ORIKA is a host/runtime/renderer framework.

## Process roles

| Role     | Owner                              | Responsibility                                                                |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Host     | Rust (`crates/host`)               | Native windows, WebViews, app protocol, OS adapters, process supervision.     |
| Runtime  | Bun + TypeScript (`packages/core`) | App services, RPC handlers, resources, permissions, jobs, storage, telemetry. |
| Renderer | React, Solid, Vue, etc.            | UI, generated RPC clients, streams, user prompts.                             |

## Data flow

Renderer code calls a generated RPC client. The bridge serializes a `HostProtocolRequestEnvelope`. The runtime handler executes an Effect program. Responses return as typed payloads or typed failures.

## Verify the Envelope and App Exports

```ts run
import { Desktop } from "../packages/core/src/index.js"
import { HostProtocolRequestEnvelope } from "../packages/bridge/src/index.js"

if (
  typeof Desktop.runtimeGraphSnapshot !== "function" ||
  HostProtocolRequestEnvelope === undefined
) {
  throw new Error("architecture exports are unavailable")
}
```

## Public architecture rule

Public effectful capabilities expose `Effect.Effect<A, E, R>` shapes, `Context.Service` tags, live/client/test layers, schema-backed boundary data, and stable tagged errors. The full layer-first contract is governed by [`engineering/architecture/layer-first-contract.md`](../engineering/architecture/layer-first-contract.md) and explained in [`explanation/layer-first-design.md`](explanation/layer-first-design.md).

## Where to go next

- [Architecture overview (full essay)](explanation/architecture.md)
- [The boundary rule](explanation/boundary-rule.md)
- [Layer-first design](explanation/layer-first-design.md)
- [`Desktop` API reference](reference/desktop-api.md)
