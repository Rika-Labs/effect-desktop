#!/usr/bin/env node
// Walk the static export and add nonce="__APP_NONCE__" to every <script> and
// inline <style> tag. The host substitutes the placeholder per request, and
// its CSP forbids unsafe-inline — so nonces are mandatory for the prerender
// bootstrap scripts Next.js emits.

import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PLACEHOLDER = "__APP_NONCE__"
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist")

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile() && full.endsWith(".html")) {
      yield full
    }
  }
}

function injectNonces(html) {
  let modified = 0

  // <script ...> (any attribute set, with or without an existing src)
  html = html.replace(/<script(\s[^>]*)?>/gi, (match, attrs = "") => {
    if (/\snonce\s*=/i.test(attrs)) return match
    modified += 1
    return `<script${attrs} nonce="${PLACEHOLDER}">`
  })

  // Inline <style ...> only — external <link rel="stylesheet"> is governed
  // by style-src 'self' and does not need a nonce attribute.
  html = html.replace(/<style(\s[^>]*)?>/gi, (match, attrs = "") => {
    if (/\snonce\s*=/i.test(attrs)) return match
    modified += 1
    return `<style${attrs} nonce="${PLACEHOLDER}">`
  })

  return { html, modified }
}

async function main() {
  try {
    await stat(ROOT)
  } catch {
    console.error(`[inject-nonce] dist directory missing at ${ROOT}`)
    process.exit(1)
  }

  let files = 0
  let injected = 0

  for await (const file of walk(ROOT)) {
    const original = await readFile(file, "utf8")
    const { html, modified } = injectNonces(original)
    if (modified > 0 && html !== original) {
      await writeFile(file, html, "utf8")
      injected += modified
      files += 1
      console.log(`[inject-nonce] ${relative(ROOT, file)} · +${modified} nonce`)
    }
  }

  console.log(`[inject-nonce] ${injected} attributes added across ${files} files`)
}

main().catch((error) => {
  console.error("[inject-nonce] failed:", error)
  process.exit(1)
})
