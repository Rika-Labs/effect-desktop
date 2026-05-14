---
title: ProviderRegistry
description: Declared provider capabilities — workflow engine, telemetry, etc.
kind: reference
audience: app-developers
effect_version: 4
---

# `ProviderRegistry`

Tracks declared provider capabilities — the workflow engine (memory or durable), telemetry backend, and other selectable runtime providers.

## Import

```ts
import {
  ProviderRegistry,
  type Provider,
  type ProviderCapability,
  ProviderRegistryError,
  makeProviderRegistry
} from "@effect-desktop/core"
```

## API

| Method | Signature |
| --- | --- |
| `register` | `(provider) => Effect<void>` |
| `select` | `(kind) => Effect<Provider, ProviderRegistryError>` |
| `list` | `() => Effect<Provider[]>` |

## Common providers

- `Desktop.WorkflowEngineMemory` — in-memory workflow engine.
- `Desktop.WorkflowEngineDurable` — persisted workflow engine.

## Errors

- `ProviderRegistryError.NotRegistered`, `Conflict`.

## Related

- Reference: [`Desktop` API](../desktop-api.md)
- Source: [`packages/core/src/runtime/provider-registry.ts`](../../../packages/core/src/runtime/provider-registry.ts)
