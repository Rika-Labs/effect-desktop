# @effect-desktop/astro

Astro integration metadata for app-scoped Effect Desktop RPC clients.

Astro does not get a fake hook API in `.astro` files. Desktop RPC access belongs inside a hydrated React, Vue, or Solid island, and Astro owns only the hydration directive.

This package has no runtime dependency on `astro`; it records island metadata and validates `client:only` renderer hints while the app owns its Astro renderer integrations.

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
