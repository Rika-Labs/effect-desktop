---
title: Devtools
description: Inspector shell, panels, and snapshot client.
kind: reference
audience: app-developers
effect_version: 4
---

# Devtools

`@orika/devtools` exposes runtime inspector services: shell lifecycle, snapshot
export, live panel projections, embedded inspector views, and test fixtures.
They observe resources, events, telemetry, layer graph, workflows, and
persistence without granting raw authority.

## Import

```ts
import { DevtoolsShell, DevtoolsSnapshotClient } from "@orika/devtools"
```

## `DevtoolsShell`

Effect service that owns the devtools listener lifecycle. It starts only in
development, or in production when both explicit production gates and safe
capture are enabled.

```ts
const shell = yield * DevtoolsShell
const handle =
  yield *
  shell.start({
    profile: "dev",
    stateDir: "/tmp/orika-state",
    openShell: false
  })

yield * handle.disable
```

When `openShell` is not `false`, provide a `DevtoolsShellWindow` port through
`DevtoolsShellLive(options)`; the default shell window fails closed with a typed
`DevtoolsShellOpenError`.

## `DevtoolsSnapshotClient`

The client that exports one redacted runtime snapshot from the live panel
services.

```ts
const client = yield * DevtoolsSnapshotClient
const snapshot = yield * client.exportSnapshot()
const resources = snapshot.liveRuntime.resources
const layers = snapshot.layerGraph.layerGraph
```

## Panels

The package ships these live panel services:

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

## Embedded inspector

`DesktopInspector.layer({ mode: "embedded-devtools" })` composes core
observability with `EmbeddedInspectorPanel`. Production profile returns a
disabled panel even when embedded mode is requested.

## Test helpers

The `@orika/devtools/testing` subpath exports `InspectorTest`,
`ReplayTransport`, fixture decoders, and collector laws for recording and
replaying inspector frames against deterministic snapshots.

## Safety

Inspector payloads pass through `RedactionFilter` before reaching the renderer. Secret-shaped fields appear as `<redacted>`. Devtools is observability, not a privilege bypass.

A production build must not include the devtools layer — `desktop check` enforces this via the `devtools-in-prod` rule.

## Related

- Source: [`packages/devtools/src/index.ts`](../../packages/devtools/src/index.ts)
- Reference: [`Telemetry`](services/telemetry.md), [`AuditEvents`](services/audit-events.md), [`ResourceRegistry`](services/resource-registry.md)
- Explanation: [Audit and redaction](../explanation/audit-and-redaction.md)
