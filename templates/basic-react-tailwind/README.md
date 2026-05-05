# Basic React Tailwind

Minimal Effect Desktop renderer template using React 19, Tailwind 4, Vite, and public `@effect-desktop/*` APIs only.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## What It Shows

- `DesktopProvider` and `useDesktop` from `@effect-desktop/react`.
- One typed `Window.create` call represented as an Effect value.
- Tailwind styling through the Vite plugin.
- A valid `desktop.config.ts` shape for the template app.

## Dependency Note

The template pins all `@effect-desktop/*` packages to `workspace:*` so local public API changes and template changes stay atomic inside the monorepo.
