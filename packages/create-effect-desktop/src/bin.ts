#!/usr/bin/env bun
import { basename, join } from "node:path"

import {
  RENDERER_STORAGE_KINDS,
  scaffold,
  TEMPLATE_NAMES,
  type RendererStorage,
  type TemplateName
} from "./index.js"

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  printUsage()
  process.exit(0)
}

const parseResult = parseArgs(args)
const name = parseResult.name
const template = parseResult.template
const rendererStorage = parseResult.rendererStorage
const includeWorkflows = args.includes("--include-workflows")
const includeCluster = args.includes("--include-cluster")

if (parseResult.error !== undefined) {
  console.error(`create-effect-desktop: ${parseResult.error}`)
  process.exit(1)
}

if (!isTemplateName(template)) {
  console.error(
    `create-effect-desktop: unknown template '${template}'. Valid: ${TEMPLATE_NAMES.join(", ")}`
  )
  process.exit(1)
}

if (!isRendererStorage(rendererStorage)) {
  console.error(
    `create-effect-desktop: unknown renderer-storage '${rendererStorage}'. Valid: ${RENDERER_STORAGE_KINDS.join(", ")}`
  )
  process.exit(1)
}

const outDir = join(process.cwd(), name)

console.log(`Scaffolding ${name} from template ${template}...`)

let result
try {
  result = scaffold({
    name,
    template,
    rendererStorage,
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

interface ParseResult {
  readonly name: string
  readonly template: TemplateName | string
  readonly rendererStorage: RendererStorage | string
  readonly error?: string
}

function parseArgs(argv: readonly string[]): ParseResult {
  let name: string | undefined
  let template: TemplateName | string = "basic-react-tailwind"
  let rendererStorage: RendererStorage | string = "none"

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) {
      continue
    }
    if (token === "--template") {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) {
        return {
          name: defaultName(name),
          template,
          rendererStorage,
          error: "--template requires a value"
        }
      }
      template = value
      index += 1
      continue
    }
    if (token === "--renderer-storage") {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) {
        return {
          name: defaultName(name),
          template,
          rendererStorage,
          error: "--renderer-storage requires a value"
        }
      }
      rendererStorage = value
      index += 1
      continue
    }
    if (token === "--include-workflows" || token === "--include-cluster") {
      continue
    }
    if (token.startsWith("--")) {
      return {
        name: defaultName(name),
        template,
        rendererStorage,
        error: `unknown option '${token}'`
      }
    }
    if (name !== undefined) {
      return {
        name,
        template,
        rendererStorage,
        error: `unexpected positional argument '${token}'`
      }
    }
    if (token !== basename(token) || token === "." || token === "..") {
      return {
        name: defaultName(name),
        template,
        rendererStorage,
        error: `project name must be a single directory name`
      }
    }
    name = token
  }

  return { name: defaultName(name), template, rendererStorage }
}

function defaultName(name: string | undefined): string {
  return name ?? "my-effect-desktop-app"
}

function isTemplateName(value: string): value is TemplateName {
  return TEMPLATE_NAMES.some((template) => template === value)
}

function isRendererStorage(value: string): value is RendererStorage {
  return RENDERER_STORAGE_KINDS.some((storage) => storage === value)
}

function printUsage(): void {
  console.log(`Usage: bun create effect-desktop [name] [options]

Options:
  --template <name>            Template to use (default: basic-react-tailwind)
                               Choices: basic-react-tailwind | todo-sqlite | multi-window
  --renderer-storage <kind>    Add renderer-side storage adapter (default: none)
                               Choices: none | indexeddb | sqlite-wasm | pglite
  --include-workflows          Add workflow companion dependencies
  --include-cluster            Add cluster dependencies (requires T29)
  -h, --help                   Show this help

Examples:
  bun create effect-desktop my-app
  bun create effect-desktop my-app --template todo-sqlite --renderer-storage sqlite-wasm
  bun create effect-desktop my-app --template basic-react-tailwind --include-workflows
`)
}
