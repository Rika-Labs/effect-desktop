#!/usr/bin/env bun
import { join } from "node:path"

import { scaffold, type RendererStorage, type TemplateName } from "./index.js"

const TEMPLATES: readonly TemplateName[] = ["basic-react-tailwind", "todo-sqlite", "multi-window"]
const STORAGES: readonly RendererStorage[] = ["none", "indexeddb", "sqlite-wasm", "pglite"]

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  printUsage()
  process.exit(0)
}

const name = args.find((a) => !a.startsWith("--")) ?? "my-effect-desktop-app"
const template = flagValue(args, "--template") ?? "basic-react-tailwind"
const rendererStorage = flagValue(args, "--renderer-storage") ?? "none"
const includeWorkflows = args.includes("--include-workflows")
const includeCluster = args.includes("--include-cluster")

if (!TEMPLATES.includes(template as TemplateName)) {
  console.error(
    `create-effect-desktop: unknown template '${template}'. Valid: ${TEMPLATES.join(", ")}`
  )
  process.exit(1)
}

if (!STORAGES.includes(rendererStorage as RendererStorage)) {
  console.error(
    `create-effect-desktop: unknown renderer-storage '${rendererStorage}'. Valid: ${STORAGES.join(", ")}`
  )
  process.exit(1)
}

const outDir = join(process.cwd(), name)

console.log(`Scaffolding ${name} from template ${template}...`)

let result
try {
  result = scaffold({
    name,
    template: template as TemplateName,
    rendererStorage: rendererStorage as RendererStorage,
    includeWorkflows,
    includeCluster,
    outDir
  })
} catch (err) {
  console.error(`create-effect-desktop: ${String(err)}`)
  process.exit(1)
}

console.log(`\nCreated ${result.path}`)

if (result.stubs.length > 0) {
  console.log("\nStubs (not production-ready):")
  for (const stub of result.stubs) {
    console.log(`  - ${stub}`)
  }
}

console.log(`\nNext steps:
  cd ${name}
  bun install
  bun run dev
`)

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag)
  if (idx === -1) return undefined
  const next = argv[idx + 1]
  if (next === undefined || next.startsWith("--")) return undefined
  return next
}

function printUsage(): void {
  console.log(`Usage: bun create effect-desktop [name] [options]

Options:
  --template <name>            Template to use (default: basic-react-tailwind)
                               Choices: basic-react-tailwind | todo-sqlite | multi-window
  --renderer-storage <kind>    Add renderer-side storage adapter (default: none)
                               Choices: none | indexeddb | sqlite-wasm | pglite
  --include-workflows          Register workflow support in the spine
  --include-cluster            Register cluster entities (requires T29)
  -h, --help                   Show this help

Examples:
  bun create effect-desktop my-app
  bun create effect-desktop my-app --template todo-sqlite --renderer-storage sqlite-wasm
  bun create effect-desktop my-app --template basic-react-tailwind --include-workflows
`)
}
