---
title: CommandRegistry
description: Logical app actions registered as Effect RPC commands for menus, shortcuts, devtools, or app UI.
kind: reference
audience: app-developers
effect_version: 4
---

# `CommandRegistry`

Commands are logical app actions registered from an Effect `RpcGroup`. Menus,
context menus, shortcut contracts, devtools, and app UI bind to command ids
instead of duplicating handler implementations.

Current host status: the registry and TypeScript command-binding lifecycle are
available with substitutable clients. Host-backed menu/context-menu activation
events and global shortcut registration/pressed events are not implemented yet.

## Import

```ts
import {
  CommandInvocationRecord,
  CommandRegistry,
  CommandRegistryCommandNotFoundError,
  CommandSnapshot,
  DesktopCommands,
  PermissionActor,
  PermissionContext,
  RpcCapability,
  type CommandGroupRegistration,
  type CommandRegistryApi,
  type CommandRegistryError
} from "@orika/core"
```

## API

```ts
const registry = yield * CommandRegistry
```

| Method               | Signature                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerGroup`      | `(registration: CommandGroupRegistration<Rpcs, E, R>) => Effect<ResourceHandle<"command-group", "registered">, CommandRegistryError \| E, R>` |
| `unregister`         | `(id: string) => Effect<void, CommandRegistryError>`                                                                                          |
| `invoke`             | `(id: string, input: unknown, context: PermissionContext) => Effect<unknown, CommandRegistryError>`                                           |
| `list`               | `() => Effect<readonly CommandSnapshot[]>`                                                                                                    |
| `observeInvocations` | `() => Stream<CommandInvocationRecord>`                                                                                                       |

The registry wraps every group in the `PermissionInterceptor` middleware before binding handlers, so the capability check runs inside the same RPC dispatch as the handler. Internally it uses a flat `RpcTest.makeClient` as the per-command dispatcher.

`DesktopCommands.layer(group, handlers, { ownerScope })` is the app-facing layer
helper for scoped registration. It registers every RPC in the group as a command
and disposes the command group when the owning scope closes (`ownerScope` defaults to `"app"`).

## Registration shape

Each command is an Effect RPC endpoint with a `RpcCapability` annotation. The capability is decoded against `NormalizedCapability` — `{ kind: "none" }` and missing capabilities fail registration with `CommandRegistryInvalidInputError`.

```ts
import { Effect, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { DesktopCommands, RpcCapability } from "@orika/core"

class OpenInput extends Schema.Class<OpenInput>("OpenInput")({
  path: Schema.String
}) {}

class OpenOutput extends Schema.Class<OpenOutput>("OpenOutput")({
  opened: Schema.Boolean
}) {}

const OpenProject = Rpc.make("openProject", {
  payload: OpenInput,
  success: OpenOutput,
  error: Schema.Unknown
}).pipe(
  RpcCapability({
    kind: "native.invoke",
    primitive: "Command",
    methods: ["openProject"],
    audit: "always"
  })
)

const ProjectCommands = RpcGroup.make(OpenProject)

export const ProjectCommandsLive = DesktopCommands.layer(
  ProjectCommands,
  ProjectCommands.toLayer(
    Effect.succeed({
      openProject: (input) => Effect.succeed(new OpenOutput({ opened: input.path.length > 0 }))
    })
  ),
  { ownerScope: "app" }
)
```

## Invocation

Invocation requires a `PermissionContext`. The registry validates the command id,
checks the RPC capability through the permission registry, runs the handler, and
records invocation state for devtools.

```ts
const actor = new PermissionActor({ kind: "window", id: "main" })
const context = new PermissionContext({ actor, traceId: "trace-main-open" })

const output = yield * registry.invoke("openProject", { path: "/tmp/project" }, context)
```

## Errors

`CommandRegistryError` includes:

- `CommandRegistryInvalidInputError`
- `CommandRegistryCommandNotFoundError`
- `CommandRegistryCommandAlreadyRegisteredError`
- `CommandRegistryRegistrationLostError`
- `CommandRegistryHandlerFailureError`
- `CommandRegistryAuditFailedError`
- `CommandRegistryCommittedAuditFailedError`
- `PermissionDenied`

Handler failures, thrown exceptions, defects, invalid payloads, permission
denials, and post-handler audit failures are reported as typed failures.

## Snapshots And Events

`list()` returns `CommandSnapshot` rows with the command id, capability,
owner scope, invocation count, last invocation, and last error.

`observeInvocations()` streams `CommandInvocationRecord` rows. Devtools consume
the same stream; app code can use it for command diagnostics.

## Why A Registry

Menu, context-menu, shortcut, activation, and UI bindings should all invoke the
same command id. Updating the command handler updates every binding, and the
registry keeps the permission/audit path consistent.

## Devtools

`CommandsDevtools` and `CommandsDevtoolsLive` from `@orika/devtools` render the
registry and observe invocations live.

## Related

- Reference: [`Menu`](../native/menu.md), [`GlobalShortcut`](../native/global-shortcut.md), [`ContextMenu`](../native/context-menu.md)
- Source: [`packages/core/src/runtime/commands.ts`](../../../packages/core/src/runtime/commands.ts)
