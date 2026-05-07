# @effect-desktop/playground

Renderer playground used by the Rust host smoke path. A Next.js 16 + Fumadocs UI documentation site exported as static HTML and embedded into `crates/host`.

## Commands

```bash
bun run dev        # next dev on 127.0.0.1:3000
bun run build      # next build → dist/, then inject __APP_NONCE__ into every script/style
bun run typecheck  # tsc --noEmit
bun run lint       # oxlint
```

## Pipeline

1. `next build` writes a static export to `dist/` (Next 16 `output: "export"`, `distDir: "dist"`, `trailingSlash: true`).
2. `scripts/inject-nonce.mjs` walks `dist/**/*.html` and adds `nonce="__APP_NONCE__"` to every `<script>` and inline `<style>`. The host's CSP forbids `unsafe-inline`, so the placeholder is required for Next's prerender bootstrap to execute.
3. `crates/host/build.rs` walks `dist/` recursively and embeds every file via `include_bytes!`.
4. The host serves embedded bytes at `app://localhost/<path>` and substitutes the placeholder with a freshly minted nonce per response.

## Authoring docs

- Pages live in `content/docs/*.mdx` with `title` / `description` frontmatter.
- Page order and section dividers are declared in `content/docs/meta.json`.
- Interactive blocks are added by wrapping a fenced code block in `<Example title="…" successOutput="…" accent="emerald|amber|blue|slate">`. The component is registered in `mdx-components.tsx`.

## Dev pointing the host at this app

```bash
EFFECT_DESKTOP_DEV_URL=http://127.0.0.1:3000/ cargo run -p host
```
