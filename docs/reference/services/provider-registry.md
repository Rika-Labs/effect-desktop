---
title: ProviderRegistry
description: Declared runtime and WebView provider capabilities.
kind: reference
audience: app-developers
effect_version: 4
---

# `ProviderRegistry`

Tracks provider capabilities as data so the runtime graph, devtools, build report, and host manifest agree on the selected implementation.

This is an internal registry shape used by `Desktop.runtimeGraphSnapshot()` and the CLI. Application code normally selects providers through `Desktop.make({ providers })` or `desktop.config.ts`, not by constructing a registry directly.

## Import

```ts
import {
  ProviderCapability,
  ProviderRegistryError,
  makeProviderRegistry
} from "@effect-desktop/core/runtime/provider-registry"
```

## API

| Method            | Signature                                                                 |
| ----------------- | ------------------------------------------------------------------------- |
| `get`             | `(kind, provider) => Effect<Provider, ProviderRegistryError>`             |
| `capabilitiesFor` | `(kind, provider) => Effect<ProviderCapability[], ProviderRegistryError>` |

## Provider kinds

| Kind      | Built-ins             | Owns                                                         |
| --------- | --------------------- | ------------------------------------------------------------ |
| `runtime` | `bun`, `node`, `test` | Effect platform services for the application runtime.        |
| `webview` | `system`, `chrome`    | Host WebView engine policy and build-time runtime packaging. |

Runtime providers are real Effect layers. They provide services such as `FileSystem`, `Path`, `Terminal`, `Stdio`, and `ChildProcessSpawner`.

WebView providers are host/build policy. `system` uses the operating system WebView. `chrome` selects the bundled Chromium/CEF provider, requires assets under `native/chrome/<target>` at build time, and records `webEngineRuntime: "cef"` plus `webEnginePath: "native/chrome"` in the host manifest.

## Selection

Provider selection is app composition. Register provider descriptors through layers, the same way windows and RPCs are registered:

```ts
providers: Desktop.providers(
  Desktop.provider(Desktop.Provider.Runtime.node),
  Desktop.provider(Desktop.Provider.WebView.chrome)
)
```

Omitting `providers` registers the default pair internally: `Desktop.Provider.Runtime.bun` plus `Desktop.Provider.WebView.system`.

`Desktop.runtimeGraphSnapshot(app)` reports the selected pair for tooling:

```ts
{
  providers: {
    runtime: "node",
    webview: "chrome"
  }
}
```

## Errors

`ProviderRegistryError` is tagged and typed:

- `duplicate-provider` when the same `kind:id` pair is registered twice.
- `missing-provider` when selection asks for an unavailable provider.

## Architecture-debt Sweep

The provider registry is deliberately small: it records capabilities and lookup errors. It does not wrap Layer composition, WebView lifecycle, or host spawning. Runtime providers stay as Effect layers; WebView providers stay as explicit host/build contracts.

## Related

- Reference: [`Desktop` API](../desktop-api.md)
- Source: [`packages/core/src/runtime/provider-registry.ts`](../../../packages/core/src/runtime/provider-registry.ts)
