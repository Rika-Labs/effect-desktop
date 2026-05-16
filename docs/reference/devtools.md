---
title: Devtools
description: Inspector shell, panels, and snapshot client.
kind: reference
audience: app-developers
effect_version: 4
---

# Devtools

`@effect-desktop/devtools` exposes the runtime inspector — a panel-based UI that observes resources, events, telemetry, layer graph, workflows, and persistence without granting raw authority.

## Import

```ts
import { DevtoolsShell, DevtoolsSnapshotClient } from "@effect-desktop/devtools"
```

## `DevtoolsShell`

The top-level React-rendered devtools shell. Mount it inside the inspector renderer (or any privileged renderer):

```tsx
<DevtoolsShell snapshotClient={client} />
```

## `DevtoolsSnapshotClient`

The client that pulls runtime snapshots from `Telemetry`, `ResourceRegistry`, `EventLog`, and the layer graph.

```ts
const client = yield * DevtoolsSnapshotClient
const resources = yield * client.resourceSnapshot()
const layers = yield * client.layerGraphSnapshot()
```

## Panels

The shell ships with these live panels:

| Panel              | Source                                  |
| ------------------ | --------------------------------------- |
| Diagnostics        | `Telemetry` summaries, runtime liveness |
| Event log          | `EventLog` recent rows                  |
| Workflows          | Active workflow executions              |
| Reactivity         | Atom subscriptions                      |
| Persistence        | Settings, Secrets store keys            |
| Logs               | Structured logs from `Telemetry`        |
| Cluster            | Sharding state                          |
| Layer graph        | Runtime layer dependency snapshot       |
| Embedded inspector | Recursive inspector view                |

## Test variants

Each panel has a corresponding test layer (under `@effect-desktop/devtools/testing`) that runs the panel's render logic against deterministic snapshots — useful for snapshot tests of devtools UI.

## Safety

Inspector payloads pass through `RedactionFilter` before reaching the renderer. Secret-shaped fields appear as `<redacted>`. Devtools is observability, not a privilege bypass.

A production build must not include the devtools layer — `desktop check` enforces this via the `devtools-in-prod` rule.

## Related

- Source: [`packages/devtools/src/index.ts`](../../packages/devtools/src/index.ts)
- Reference: [`Telemetry`](services/telemetry.md), [`AuditEvents`](services/audit-events.md), [`ResourceRegistry`](services/resource-registry.md)
- Explanation: [Audit and redaction](../explanation/audit-and-redaction.md)
