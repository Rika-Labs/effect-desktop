import { expect, test } from "bun:test"
import { WINDOW_CREATE_METHOD, WINDOW_DESTROY_METHOD } from "@effect-desktop/bridge"
import { runHeadless } from "@effect-desktop/test"
import { Effect } from "effect"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { TEMPLATE_WINDOW_TITLE } from "./App.js"

const templateRoot = new URL("..", import.meta.url)

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
  const violations = sourceFiles(new URL("src", templateRoot)).flatMap((file) => {
    const text = readFileSync(file, "utf8")
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1])

    return imports
      .filter((specifier): specifier is string => specifier !== undefined)
      .filter((specifier) => specifier.includes("/src/") || specifier.includes("/_internal"))
      .map((specifier) => `${relative(templateRoot.pathname, file)} imports ${specifier}`)
  })

  expect(violations).toEqual([])
})

function sourceFiles(directory: URL): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory.pathname, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(new URL(`${entry.name}/`, directory))
    }

    if (statSync(path).isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      return [path]
    }

    return []
  })
}
