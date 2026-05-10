# @effect-desktop/astro

Astro integration metadata for app-scoped Effect Desktop RPC groups.

## Purpose

Astro owns routing, pages, and hydration directives. It does not own a hook
lifecycle in `.astro` files. `@effect-desktop/astro` records which hydrated
framework island receives a desktop manifest and validates that the requested
hydration directive can install that renderer adapter.

## Public API

- `AstroDesktop.from(manifest)` creates metadata helpers for one desktop app
  manifest.
- `island(adapter, options)` records a hydrated React, Vue, or Solid adapter.
- `options.directive` records the Astro hydration mode.
- `options.renderer` records the concrete island renderer.

## Non-goals

- This package does not expose hooks or composables in `.astro` files.
- This package does not define desktop APIs. Use `Rpc.make`, `RpcGroup.make`, and
  `Desktop.Rpcs.layer(...)` in app code.
- This package does not open startup windows. Startup windows belong to
  `Desktop.make({ windows })` and the host runtime.
- This package does not own Astro's renderer integrations or dependency version.

## Usage

```astro
---
import NotesIsland from "../components/NotesIsland.tsx"
---

<NotesIsland client:only="react" />
```

```ts
import { Desktop } from "@effect-desktop/core"
import { AstroDesktop } from "@effect-desktop/astro"
import { ReactDesktop } from "@effect-desktop/react"
import { App } from "../desktop/app"

const Manifest = Desktop.manifest(App)

export const NotesAstro = AstroDesktop.from(Manifest).island(ReactDesktop.from(Manifest), {
  directive: "only",
  renderer: "react"
})
```

The island component uses its framework adapter directly:

```tsx
import { NotesRpcs } from "../desktop/app"
import { NotesReact } from "./desktop"

export function NotesIsland() {
  const notes = NotesReact.useDesktop(NotesRpcs)
  return null
}
```

## Testing

```bash
bun test packages/astro/src/index.test.ts
bun run typecheck
```

## Platform notes

The package has no runtime dependency on `astro`. Apps own Astro and the
framework renderer integrations they hydrate.

## Internal architecture

The adapter stores plain metadata: manifest, renderer, directive, and nested
framework adapter identity. Runtime RPC execution still happens in the hydrated
React, Vue, or Solid island through that adapter's renderer transport.
