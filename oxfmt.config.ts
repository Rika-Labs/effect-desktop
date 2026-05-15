import { defineConfig } from "oxfmt"
import ultracite from "ultracite/oxfmt"

export default defineConfig({
  ...ultracite,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: false,
  trailingComma: "none",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
  sortImports: false,
  sortPackageJson: false,
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "build/",
    "target/",
    ".turbo/",
    "coverage/",
    ".context/",
    ".agents/",
    "apps/docs/out/",
    "docs/SPEC.md",
    "repos/",
    "vendor/effect/",
    "crates/host-protocol/fixtures/*.json",
    "bun.lock",
    "*.lockb",
    "bunfig.toml",
    ".next/",
    ".astro/",
    ".source/",
    "next-env.d.ts"
  ]
})
