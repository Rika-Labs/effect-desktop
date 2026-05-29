---
title: Desktop API
description: Desktop.make, Desktop.manifest, Desktop.layer, runtime graph.
kind: reference
audience: app-developers
effect_version: 4
---

# `Desktop` API

The `Desktop` namespace is the application entry point exported by `@orika/core`. It composes runtime services, declares windows, registers RPC groups, and produces the manifest the renderer reads.

## Import

```ts
import { Desktop } from "@orika/core"
```

## `Desktop.make(config)`

Creates a desktop app descriptor.

```ts
function make<RIn = never, E = never, RpcHandlerR = unknown>(
  config: DesktopMakeConfig<RIn, E, RpcHandlerR>
): DesktopAppDescriptor<RIn, E, RpcHandlerR>
```

`id` defaults to `"app"` when omitted. All declaration fields default to empty arrays.

| Field         | Type                            | Description                                                                                                                  |
| ------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string` (optional)             | Reverse-DNS app id (e.g. `dev.example.notes`). Defaults to `"app"`.                                                          |
| `windows`     | `DesktopWindowsLayer<RIn>`      | Immutable window declarations. Build via `Desktop.window(id, spec, services?)`; compose multiple via `Desktop.windows(...)`. |
| `rpcs`        | `DesktopRpcsLayer<E, RIn, …>`   | Immutable RPC declarations. Build via `Desktop.rpc(group, handlers)`; compose multiple via `Desktop.rpcs(...)`.              |
| `native`      | `DesktopNativeLayer<E, RIn, …>` | Immutable native surface declarations. Build via `Desktop.native(Native.<Surface>)` or `Desktop.native(Native.all)`.         |
| `providers`   | `DesktopProvidersLayer`         | Immutable provider declarations. Build via `Desktop.provider(...)`; compose multiple via `Desktop.providers(...)`.           |
| `permissions` | `DesktopPermissionsLayer`       | Immutable capability declarations. Build via `Desktop.permissions(Desktop.permission(capability), ...)`.                     |
| `workflows`   | `DesktopWorkflowsLayer<RIn, E>` | Immutable workflow layer declarations. Build via `Desktop.workflow(layer)`; compose multiple via `Desktop.workflows(...)`.   |

`WindowSpec` is `{ title, width?, height?, renderer? }`. The window id is the first argument to `Desktop.window(id, spec)` — there is no `id` field on the spec itself.

The `windows`, `rpcs`, `native`, `providers`, `permissions`, and `workflows` fields are plain declaration data. Runtime dependencies stay inside the declared window services, RPC handlers, workflow layers, or provider implementations and are applied when `Desktop.layer(app)` builds the runtime.

## `Desktop.manifest(app)`

Produces the manifest the renderer adapter consumes:

```ts
function manifest<RIn, E>(app: DesktopAppDescriptor<RIn, E>): DesktopAppManifest
```

The manifest is JSON-serializable. The renderer uses it to know which contracts to expose and how to dispatch.

## `Desktop.layer(app)`

Builds the runtime layer for the app descriptor.

```ts
Desktop.layer(app): Layer.Layer<DesktopRuntimeServices, DesktopConfigError | E, ...>
```

Use `Desktop.layer(App)` in your runtime entry to materialize the dependency graph. Use `Desktop.workflowEngine(...)` for standalone workflow-engine composition.

## `Desktop.window(id, spec, services?)`

Returns an immutable window declaration; compose multiple windows with `Desktop.windows(...)` and pass the result as the `windows:` field of `Desktop.make`.

```ts
function window<RIn = never>(
  id: string,
  spec: WindowSpec,
  services?: Layer.Layer<never, never, RIn | Scope.Scope>
): DesktopWindowsLayer<RIn>

interface WindowSpec {
  readonly title: string
  readonly width?: number
  readonly height?: number
  readonly renderer?: string
}
```

The optional `services` Layer is built **inside** the per-window scope at open time. Anything it acquires (a `Settings` store, a watcher, a stream subscription) is released when the window closes. This is the framework's typed answer to per-window resource lifetime.

```ts
windows: Desktop.windows(
  Desktop.window("main", { title: "App", width: 1024, height: 720 }),
  Desktop.window("preferences", { title: "Preferences", width: 480, height: 360 })
)
```

Reserved ids — `__proto__`, `constructor`, `prototype`, and the empty string — throw a `TypeError` synchronously from the call site. Duplicate ids surface as a `DesktopConfigError` at `Desktop.make` time.

## `Desktop.native(...declarations)`

Composes native availability declarations for `Desktop.make`. `Native.<Surface>` registers availability only. Grant authority separately through `Desktop.permission(Native.Permissions.<surface>.<method>)`.

```ts
import { Native } from "@orika/native"

native: Desktop.native(Native.Clipboard, Native.Dialog),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.clipboard.readText),
  Desktop.permission(Native.Permissions.dialog.openFile)
)
```

Availability without authority stays explicit.

```ts
native: Desktop.native(Native.Clipboard)
```

Duplicate native surfaces and duplicate RPC method names fail as typed `DesktopConfigError` values during graph assembly.

## `Desktop.permission(capability)`, `Desktop.permissions(...layers)`

Returns one immutable permission declaration. Compose multiple declarations with `Desktop.permissions(...)` and pass the result as `permissions:`.

```ts
permissions: Desktop.permissions(
  Desktop.permission(Permission.filesystemRead({ roots: ["/tmp/app"] })),
  Desktop.permission(Permission.networkConnect({ hosts: ["api.example.com"] }))
)
```

## `Desktop.workflow(layer)`

Returns one immutable workflow declaration. Compose multiple workflow registrations with `Desktop.workflows(...)` and pass the result as `workflows:`.

```ts
workflows: Desktop.workflows(
  Desktop.workflow(UserOnboardingWorkflow),
  Desktop.workflow(SyncWorkflow)
)
```

## `Desktop.Rpc.surface(name, group, options)`

Packages an `RpcGroup` into the layer-first artifacts: server layer, generated client layer, deterministic test client layer, schema docs, contract-law checks. See [`Desktop.Rpc`](rpc-surface.md).

## `Desktop.runtime`, `Desktop.launch`

Runtime entry helpers used by the framework's launcher. Application code rarely calls these directly.

## `Desktop.runtimeGraph()`, `Desktop.runtimeGraphSnapshot()`

Returns the assembled runtime layer graph (nodes and edges) as data — useful for devtools and `inspect` commands.

```ts
const snapshot = Desktop.runtimeGraphSnapshot()
// LayerGraphSnapshot — { providers: { runtime, webview }, nodes, providerFacts, failures }
```

## `Desktop.Rpcs`, `Desktop.describeRpcs()`

Contract registry helpers for tooling — list every registered RPC group and its descriptor.

## Re-exports for convenience

`Desktop` also re-exports the bridge primitives most apps reach for:

- `Desktop.RedactionFilter`
- `Desktop.RpcCapability`
- `Desktop.RpcEndpoint`
- `Desktop.RpcSupport`

These come from `@orika/bridge` and are exposed here so a runtime entry doesn't need a second import.

## Workflow engine

`Desktop.WorkflowEngineMemory` and `Desktop.WorkflowEngineDurable` are the two workflow engine layers. Memory is the default for development; durable persists workflow state across restarts. Compose the durable layer in `workflows` or around `Desktop.layer(...)`.

## Providers

Provider selection follows the same app-composition shape as windows, RPCs, permissions, and workflows:

```ts
providers: Desktop.providers(
  Desktop.provider(Desktop.Provider.Runtime.node),
  Desktop.provider(Desktop.Provider.WebView.chrome)
)
```

Omitting `providers` is equivalent to registering `Desktop.Provider.Runtime.bun` and `Desktop.Provider.WebView.system`.

Custom providers are descriptors:

```ts
const ChromeWebView = Desktop.Provider.webview({
  id: "chrome",
  hostEngine: "chrome",
  capabilities: ["WindowWebView", "AppProtocol", "BundledChromium"]
})
```

## Example

```ts
import { Desktop } from "@orika/core"
import { NotesRpcs } from "./contracts.js"
import { NotesHandlersLive } from "./handlers.js"

export const App = Desktop.make({
  id: "dev.example.notes",
  windows: Desktop.window("main", { title: "Notes", width: 720, height: 520 }),
  rpcs: Desktop.rpc(NotesRpcs, NotesHandlersLive)
})

export const Manifest = Desktop.manifest(App)
```

## Related

- [`Desktop.Rpc`](rpc-surface.md)
- [Configuration](config.md)
- How-to: [Define an RPC surface](../how-to/define-an-rpc-surface.md)
- Source: [`packages/core/src/index.ts`](../../packages/core/src/index.ts)
