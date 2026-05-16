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

| Field         | Type                           | Description                                                                                                                                    |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string`                       | Reverse-DNS app id (e.g. `dev.example.notes`).                                                                                                 |
| `windows`     | `DesktopWindowsLayer<RIn>`     | A single composed Layer of window registrations. Build via `Desktop.window(id, spec, services?)`; compose multiple via `Desktop.windows(...)`. |
| `rpcs`        | `DesktopRpcsLayer<E, RIn>`     | A single composed Layer of RPC registrations. Build via `Desktop.rpc(group, handlers)`; compose multiple via `Desktop.rpcs(...)`.              |
| `native`      | `DesktopNativeLayer`           | A single composed Layer of native selections. Build via `Native.capabilities(...)` or `Native.available(...)`.                                 |
| `providers`   | `DesktopProvidersLayer`        | A single composed Layer of provider registrations. Build via `Desktop.provider(...)`; compose multiple via `Desktop.providers(...)`.           |
| `permissions` | `DesktopPermissionsLayer`      | A single composed Layer of permission declarations. Build via `Desktop.permissions(Desktop.permission(capability), ...)`.                      |
| `workflows`   | `DesktopWorkflowsLayer<RIn,E>` | A single composed Layer of workflow registrations. Build via `Desktop.workflow(layer)`; compose multiple via `Desktop.workflows(...)`.         |

`WindowSpec` is `{ title, width?, height?, renderer? }`. The window id is the first argument to `Desktop.window(id, spec)` — there is no `id` field on the spec itself.

The `windows`, `rpcs`, `native`, `providers`, `permissions`, and `workflows` fields are declaration layers: they build synchronously to register facts with the app spine. Runtime dependencies stay inside the declared window services, RPC handlers, workflow layers, or provider implementations and are applied when `Desktop.app(config)` builds the runtime.

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

// With permissions and workflow registrations
Desktop.app({ permissions?, workflows? }):
  Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn | PermissionRegistry>

// From a config descriptor
Desktop.app(config): Layer.Layer<DesktopApp, DesktopConfigError | E, ...>
```

Use `Desktop.app(config)` in your runtime entry to materialize the dependency graph.

## `Desktop.window(id, spec, services?)`

Registers a window with the surrounding `DesktopWindowRegistry`. Returns a `Layer` that self-registers when built; compose multiple windows with `Desktop.windows(...)` and pass the result as the `windows:` field of `Desktop.make`.

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

## `Desktop.native(...layers)`

Composes lower-level native declaration layers for `Desktop.make`. App code should prefer `Native.capabilities(...)`, which registers the required native surfaces and authority together.

```ts
import { Native } from "@effect-desktop/native"

native: Native.capabilities(Native.Clipboard.readText, Native.Dialog.openFile)
```

Availability without authority stays explicit.

```ts
native: Native.available(Native.Clipboard)
```

Duplicate native surfaces and duplicate RPC method names fail as typed `DesktopConfigError` values during graph assembly.

## `Desktop.permission(capability)`, `Desktop.permissions(...layers)`

Registers one permission declaration with the surrounding `DesktopPermissionRegistry`. Compose multiple declarations with `Desktop.permissions(...)` and pass the result as `permissions:`.

```ts
permissions: Desktop.permissions(
  Desktop.permission(Permission.filesystemRead({ roots: ["/tmp/app"] })),
  Desktop.permission(Permission.networkConnect({ hosts: ["api.example.com"] }))
)
```

## `Desktop.workflow(layer)`

Registers one workflow layer with the surrounding `DesktopWorkflowRegistry`. Compose multiple workflow registrations with `Desktop.workflows(...)` and pass the result as `workflows:`.

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

These come from `@effect-desktop/bridge` and are exposed here so a runtime entry doesn't need a second import.

## Workflow engine

`Desktop.WorkflowEngineMemory` and `Desktop.WorkflowEngineDurable` are the two workflow engine layers. Memory is the default for development; durable persists workflow state across restarts. Compose the durable layer in `workflows` or around `Desktop.app(...)`.

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
import { Desktop } from "@effect-desktop/core"
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
- Tutorial: [Build a notes app](../tutorials/01-build-a-notes-app.md)
- Source: [`packages/core/src/index.ts`](../../packages/core/src/index.ts)
