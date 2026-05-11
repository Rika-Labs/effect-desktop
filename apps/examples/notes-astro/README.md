# Notes Astro

Astro renderer example for the shared Notes desktop app.

```astro
---
import NotesIsland from "../components/NotesIsland"
---

<NotesIsland client:only="react" />
```

Astro owns the page shell. The desktop RPC hooks live inside the hydrated React island because `.astro` files do not have React-style hooks.

## Dependency Note

This example adds Astro, `@astrojs/react`, and `@astrojs/check` only for the first-party example application. The framework package `@effect-desktop/astro` stays free of a runtime Astro dependency.

```bash
bun --cwd apps/examples/notes-astro run dev
```
