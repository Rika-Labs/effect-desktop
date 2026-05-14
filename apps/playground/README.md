# @effect-desktop/playground

Renderer playground used by the Rust host smoke path. A Next.js 16 + Fumadocs UI documentation site exported as static HTML and served by `crates/host` from the build layout.

## Commands

```bash
bun run dev        # next dev on 127.0.0.1:3000
bun run build      # next build → dist/
bun run typecheck  # tsc --noEmit
bun run lint       # oxlint
```

## Pipeline

1. `next build` writes a static export to `dist/` (Next 16 `output: "export"`, `distDir: "dist"`, `trailingSlash: true`). The renderer ships its `dist/` directory with no nonce annotation; the host attaches CSP nonces at request time.
2. The CLI copies `dist/` into `build/effect-desktop/<target>/renderer/` and records that path in `app-manifest.json`.
3. On each request the host reads the renderer asset from the packaged layout, parses `text/html` responses through `crates/host/src/html_csp.rs`, attaches a freshly minted CSP nonce to every `<script>`, `<style>`, and `<link rel="stylesheet">`, and emits the matching nonce in the CSP header. Any framework that produces a static export plugs in by pointing `dist/` at it.

## Authoring docs

- Pages live in `content/docs/*.mdx` with `title` / `description` frontmatter.
- Page order and section dividers are declared in `content/docs/meta.json`.
- Interactive blocks are added by wrapping a fenced code block in `<Example title="…" successOutput="…" accent="emerald|amber|blue|slate">`. The component is registered in `mdx-components.tsx`.

## Dev pointing the host at this app

```bash
EFFECT_DESKTOP_DEV_URL=http://127.0.0.1:3000/ cargo run -p host
```
