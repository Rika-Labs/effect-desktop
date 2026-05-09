import { expect, test } from "bun:test"
import { WINDOW_CREATE_METHOD, WINDOW_DESTROY_METHOD } from "@effect-desktop/bridge"
import { runHeadless } from "@effect-desktop/test"
import { Effect } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, relative } from "node:path"

import { TEMPLATE_WINDOW_TITLE } from "./App.js"

const templateRoot = fileURLToPath(new URL("..", import.meta.url))

interface TemplatePackageJson {
  readonly scripts?: Record<string, string>
  readonly dependencies?: Record<string, string>
}

test("template smoke exercises one typed window call", async () => {
  const calls = await Effect.runPromise(
    runHeadless((runtime) =>
      Effect.gen(function* () {
        const created = yield* runtime.window.create({ title: TEMPLATE_WINDOW_TITLE })
        yield* runtime.window.destroy(created.windowId)

        return runtime.calls().map((call) => call.method)
      })
    )
  )

  expect(calls).toEqual([WINDOW_CREATE_METHOD, WINDOW_DESTROY_METHOD])
})

test("template source imports only public package surfaces", () => {
  const violations = sourceFiles(join(templateRoot, "src")).flatMap((file) => {
    const text = readFileSync(file, "utf8")

    return privateImportViolations(text, relative(templateRoot, file))
  })

  expect(violations).toEqual([])
})

test("template import guard catches side-effect private imports", () => {
  const privateSpecifier = "@effect-desktop/native" + "/src/internal.js"

  expect(privateImportViolations(`import "${privateSpecifier}"`, "src/example.ts")).toEqual([
    `src/example.ts imports ${privateSpecifier}`
  ])
})

test("template package exposes the documented desktop command", () => {
  const pkg = JSON.parse(
    readFileSync(join(templateRoot, "package.json"), "utf8")
  ) as TemplatePackageJson

  expect(pkg.scripts?.["desktop"]).toBe("desktop")
  expect(pkg.dependencies?.["@effect-desktop/cli"]).toBe("workspace:*")
})

function privateImportViolations(text: string, file: string): readonly string[] {
  return importSpecifiers(text)
    .filter((specifier) => specifier.includes("/src/") || specifier.includes("/_internal"))
    .map((specifier) => `${file} imports ${specifier}`)
}

function importSpecifiers(text: string): readonly string[] {
  const fromImports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1])
  const sideEffectImports = [...text.matchAll(/import\s+["']([^"']+)["']/g)].map(
    (match) => match[1]
  )

  return [...fromImports, ...sideEffectImports].filter(
    (specifier): specifier is string => specifier !== undefined
  )
}

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(path)
    }

    if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      return [path]
    }

    return []
  })
}
