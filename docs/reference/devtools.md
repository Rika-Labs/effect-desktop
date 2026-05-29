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
development, or in production when all three production gates align:
`devtoolsFlag: true`, `securityDevtoolsInProd: true`, and
`inspectorCapture: "safe"`. Any other production combination either disables
the shell or fails with `DevtoolsUnsafeProductionCaptureError`.

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

`shell.start` mints a 32-byte loopback token, writes it to
`<stateDir>/<tokenName>` (default `devtools-token`, mode 0600), starts a
loopback HTTP listener on `127.0.0.1`, and returns a `DevtoolsHandle` whose
`disable` effect closes the listener and removes the token. Errors are tagged:
`InvalidInput`, `TokenError`, `BindError`, `CleanupError`, `ShellOpenError`,
`UnsafeProductionCapture`.

When `openShell` is not `false`, provide a `DevtoolsShellWindow` port through
`DevtoolsShellLive({ shellWindow })`; the default `UnavailableDevtoolsShellWindow`
fails closed with `DevtoolsShellOpenError`. `DevtoolsShellLive` also accepts
a custom `transport` (defaults to `BunLoopbackDevtoolsTransport`) and
`tokenName`.

## `DevtoolsSnapshotClient`

The client that exports one redacted runtime snapshot from the live panel
services. The returned `DevtoolsSnapshot` aggregates `liveRuntime`,
`diagnostics`, `performance`, `eventLog`, `workflows`, `reactivity`,
`persistence`, `logs`, `cluster`, `layerGraph`, and the `safety` summary from
`InspectorSafetyPolicy`. If the safety policy rejects the payload outright,
`exportSnapshot` fails with `DevtoolsSnapshotSafetyError`.

```ts
const client = yield * DevtoolsSnapshotClient
const snapshot = yield * client.exportSnapshot()
const resources = snapshot.liveRuntime.resources
const layers = snapshot.layerGraph.layerGraph
```

`DevtoolsSnapshotClientLive` requires every live panel service plus
`InspectorSafetyPolicy`.

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

## Adjacent services

| Service                | Source            | Purpose                                                                                                                             |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CommandsDevtools`     | `@orika/devtools` | Lists registered commands, streams `CommandInvocationRecord`s                                                                       |
| `WorkersDevtools`      | `@orika/devtools` | Lists `Worker` snapshots, sanitized through `InspectorSafetyPolicy`                                                                 |
| `DesktopDevtools`      | `@orika/core`     | Unified stream of `DesktopRuntimeEvent` (inspector + telemetry)                                                                     |
| `DesktopObservability` | `@orika/core`     | Mode router (`off` / `embedded-devtools` / `standalone-inspector`) and Effect Logger/Tracer wiring via `EffectTelemetryRuntimeLive` |

## Embedded inspector

`DesktopInspector.layer({ mode: "embedded-devtools" })` (alias of
`DesktopInspectorLive`) composes `DesktopObservability` with
`EmbeddedInspectorPanel`. The panel gates on profile: `production` returns a
disabled snapshot (`reason: "production-disabled"`) even when embedded mode is
requested. Pass `profile`, `frameInterval`, or a pre-built `snapshotClient`
through `DesktopInspectorLayerOptions`. Standalone mode (`mode:
"standalone-inspector"`) requires an explicit `webSocketUrl` and merges in
Effect's upstream `DevTools.layer(webSocketUrl)`.

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
