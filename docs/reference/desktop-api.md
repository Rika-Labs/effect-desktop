---
title: Desktop API
description: Desktop.make, Desktop.manifest, Desktop.app, runtime graph.
kind: reference
audience: app-developers
effect_version: 4
---

# `Desktop` API

The `Desktop` namespace is the application entry point exported by `@effect-desktop/core`. It composes runtime services, declares windows, registers RPC groups, and produces the manifest the renderer reads.

## Import

```ts
import { Desktop } from "@effect-desktop/core"
```

## `Desktop.make(config)`

Creates a desktop app descriptor.

```ts
function make<RIn = never, E = never>(
  config: DesktopMakeConfig<RIn, E>
): DesktopAppDescriptor<RIn, E>
```

| Field         | Type                         | Description                                                                                                                    |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `string`                     | Reverse-DNS app id (e.g. `dev.example.notes`).                                                                                 |
| `windows`     | `Record<string, WindowSpec>` | Declared windows, keyed by window id.                                                                                          |
| `rpcs`        | `DesktopRpcsLayer<E, RIn>`   | A single composed Layer of RPC registrations. Build via `Desktop.rpc(group, handlers)`; compose multiple via `Layer.mergeAll`. |
| `providers`   | `DesktopProviderSelection`   | Optional provider selection (e.g. runtime engine).                                                                             |
| `permissions` | `NormalizedCapability[]`     | Default permission declarations.                                                                                               |
| `workflows`   | `DesktopWorkflowLayer[]`     | Optional workflow layers.                                                                                                      |

`WindowSpec` is `{ title, width?, height?, renderer? }`. The window id is the key in the `windows` record — there is no `id` field on the spec itself.

## `Desktop.manifest(app)`

Produces the manifest the renderer adapter consumes:

```ts
function manifest<RIn, E>(app: DesktopAppDescriptor<RIn, E>): DesktopAppManifest
```

The manifest is JSON-serializable. The renderer uses it to know which contracts to expose and how to dispatch.

## `Desktop.app(...)`

Builds the runtime layer for the app. Three overloads:

```ts
// Empty — workflow engine only
Desktop.app(): Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>

// With permissions
Desktop.app({ permissions, workflows? }):
  Layer.Layer<WorkflowEngine.WorkflowEngine, never, PermissionRegistry>

// From a config descriptor
Desktop.app(config): Layer.Layer<DesktopApp, DesktopConfigError | E, ...>
```

Use `Desktop.app(config)` in your runtime entry to materialize the dependency graph.

## `WindowSpec` shape

Windows are plain objects in the `windows` record:

```ts
interface WindowSpec {
  readonly title: string
  readonly width?: number
  readonly height?: number
  readonly renderer?: string
}
```

There is no `Desktop.window(...)` factory — declare them as record values directly:

```ts
windows: {
  main: { title: "App", width: 1024, height: 720 },
  preferences: { title: "Preferences", width: 480, height: 360 }
}
```

## `Desktop.Rpc.surface(name, group, options)`

Packages an `RpcGroup` into the layer-first artifacts: server layer, generated client layer, deterministic test client layer, schema docs, contract-law checks. See [`Desktop.Rpc`](rpc-surface.md).

## `Desktop.runtime`, `Desktop.launch`

Runtime entry helpers used by the framework's launcher. Application code rarely calls these directly.

## `Desktop.runtimeGraph()`, `Desktop.runtimeGraphSnapshot()`

Returns the assembled runtime layer graph (nodes and edges) as data — useful for devtools and `inspect` commands.

```ts
const snapshot = Desktop.runtimeGraphSnapshot()
// LayerGraphSnapshot — { nodes: LayerGraphNodeSnapshot[], failures: LayerFailurePayload[] }
```

## `Desktop.Rpcs`, `Desktop.describeRpcs()`

Contract registry helpers for tooling — list every registered RPC group and its descriptor.

## Re-exports for convenience

`Desktop` also re-exports the bridge primitives most apps reach for:

- `Desktop.RedactionFilter`
- `Desktop.RpcCapability`
- `Desktop.RpcEndpoint`
- `Desktop.RpcSupport`

These come from `@effect-desktop/bridge` and are exposed here so a runtime entry doesn't need a second import.

## Workflow engine

`Desktop.WorkflowEngineMemory` and `Desktop.WorkflowEngineDurable` are the two workflow engine layers. Memory is the default for development; durable persists workflow state across restarts. Override via the `providers` field of `Desktop.make`.

## Example

```ts
import { Desktop } from "@effect-desktop/core"
import { NotesRpcs } from "./contracts.js"
import { NotesHandlersLive } from "./handlers.js"

export const App = Desktop.make({
  id: "dev.example.notes",
  windows: {
    main: { title: "Notes", width: 720, height: 520 }
  },
  rpcs: Desktop.rpc(NotesRpcs, NotesHandlersLive)
})

export const Manifest = Desktop.manifest(App)
```

## Related

- [`Desktop.Rpc`](rpc-surface.md)
- [Configuration](config.md)
- Tutorial: [Build a notes app](../tutorials/01-build-a-notes-app.md)
- Source: [`packages/core/src/index.ts`](../../packages/core/src/index.ts)
