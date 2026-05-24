---
title: Sidecar
description: Long-lived companion processes with readiness, status, retry, and scoped cleanup.
kind: reference
audience: app-developers
effect_version: 4
---

# `Sidecar`

`Sidecar` starts and tracks a long-lived companion process such as a language
server, sync daemon, or build watcher. It builds on `Process`, then adds
readiness, status events, retry for start failures, and scoped cleanup through
the `ResourceRegistry`.

Current host status: the TypeScript runtime service is available anywhere a
`Process` service and `ResourceRegistry` are provided. It does not restart a
process after a successful start exits.

## Import

```ts
import {
  Sidecar,
  SidecarCommand,
  SidecarLive,
  type SidecarApi,
  type SidecarHandle,
  type SidecarReadiness,
  type SidecarStartOptions,
  type SidecarState
} from "@orika/core"
```

## API

```ts
const sidecar = yield * Sidecar
```

| Method  | Signature                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------ |
| `start` | `(command: SidecarCommand, options: SidecarStartOptions) => Effect<SidecarHandle, SidecarError>` |

## `SidecarCommand`

```ts
new SidecarCommand({
  command: "/usr/bin/env",
  args: ["bash", "-lc", "echo ready && sleep 60"],
  ownerScope: "app",
  cwd: "/tmp",
  env: { MY_FLAG: "1" },
  shell: false
})
```

`command`, `args`, and `ownerScope` are required. `cwd`, `env`, and `shell` are
passed through to the lower-level `Process` service.

## `SidecarStartOptions`

```ts
{
  readiness: { _tag: "Line", stream: "stdout", match: "ready" },
  retry: { idempotent: true, retries: 2, delay: "100 millis" }
}
```

`readiness` is one of:

| Mode   | Meaning                                                        |
| ------ | -------------------------------------------------------------- |
| `None` | Mark ready immediately after the child process starts.         |
| `Line` | Watch stdout or stderr until a line contains the match string. |

`retry` applies only to start failures. Retries run when `idempotent` is `true`
and `retries` is greater than zero.

## `SidecarHandle`

```ts
{
  readonly close: () => Effect<void>
  readonly events: Stream<SidecarState>
  readonly process: ProcessHandle
  readonly ready: Effect<SidecarReadyPayload, SidecarError>
  readonly resource: ManagedResourceHandle<"sidecar", "running">
  readonly status: Effect<SidecarState>
}
```

- `ready` completes when the configured readiness check succeeds. It fails with
  `SidecarError` if the process exits before readiness is observed.
- `events` emits state transitions such as `Starting`, `Ready`, `Failed`,
  `Exited`, `Closing`, and `Closed`.
- `close` disposes the sidecar resource, kills the process through
  `ProcessHandle.kill`, closes internal observers, and publishes `Closed`.
- `status` reads the latest state.

## Example

```ts
const handle =
  yield *
  sidecar.start(
    new SidecarCommand({
      command: "/usr/bin/env",
      args: ["bash", "-lc", "echo service-ready && sleep 60"],
      ownerScope: "app"
    }),
    {
      readiness: { _tag: "Line", stream: "stdout", match: "service-ready" },
      retry: { idempotent: true, retries: 2 }
    }
  )

const ready = yield * handle.ready
yield * handle.close()
```

## Layer

`SidecarLive` depends on `Process` and `ResourceRegistry`.

```ts
import { Layer } from "effect"
import { ProcessLayer, ResourceRegistryLive, SidecarLive } from "@orika/core"

const RuntimeSidecarLive = SidecarLive.pipe(
  Layer.provide(
    ProcessLayer({
      permissions: {
        spawn: ["/usr/bin/env"],
        shell: true
      }
    })
  ),
  Layer.provide(ResourceRegistryLive)
)
```

`Desktop.runtime(...)` normally supplies the app `ResourceOwner`; standalone
programs provide one explicitly.

## Permissions

Sidecars use the lower-level `Process` service, so process permission policy is
the same: `process.spawn` requires an exact command allowlist entry, and shell
execution requires explicit shell permission.

## Errors

`SidecarError` wraps start and readiness failures with:

- `operation`
- `message`
- `recoverable`

Payload decoding at bridge boundaries uses `decodeSidecarCommand(...)` and
returns bridge invalid-argument errors for malformed command payloads.

## Related

- Reference: [`Process`](process.md), [`Worker`](worker.md), [`ResourceRegistry`](resource-registry.md)
- Source: [`packages/core/src/runtime/sidecar.ts`](../../../packages/core/src/runtime/sidecar.ts)
