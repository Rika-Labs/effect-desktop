# @effect-desktop/docs

Deployable documentation web app for Effect Desktop.

## Commands

```bash
bun run dev        # next dev on 127.0.0.1:3001
bun run build      # next build
bun run typecheck  # fumadocs-mdx + tsc --noEmit
bun run lint       # oxlint
```

## Dependency note

This app uses the same documentation stack already present in `apps/playground`: Next.js 16, React 19, Tailwind CSS 4, Fumadocs UI, Fumadocs core, and Fumadocs MDX. No new dependency family is introduced; the docs app separates the deployable web surface from the desktop playground renderer.

