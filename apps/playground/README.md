# @effect-desktop/playground

Renderer playground used by the Rust host smoke path.

## Commands

```bash
bun run dev
bun run build
bun run typecheck
```

## Dependency notes

This package owns the Phase 6 renderer build pipeline. `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `tailwindcss`, and `@tailwindcss/vite` are declared here because the issue requires a Vite-compatible React/Tailwind renderer with HMR and a production `dist/` artifact for host embedding.
