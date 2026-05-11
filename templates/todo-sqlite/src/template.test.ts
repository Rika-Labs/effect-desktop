import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const templateRoot = fileURLToPath(new URL("..", import.meta.url))

interface TemplatePackageJson {
  readonly scripts?: Record<string, string>
  readonly dependencies?: Record<string, string>
}

test("template package exposes the documented desktop command", () => {
  const pkg = JSON.parse(
    readFileSync(join(templateRoot, "package.json"), "utf8")
  ) as TemplatePackageJson

  expect(pkg.scripts?.["desktop"]).toBe("desktop")
  expect(pkg.dependencies?.["@effect-desktop/cli"]).toBe("workspace:*")
})

test("contract defines four RPCs in AppRpc group", async () => {
  const { AppRpc, TODO_REACTIVITY_KEY } = await import("./contract.js")

  expect(AppRpc.requests.has("CreateTodo")).toBe(true)
  expect(AppRpc.requests.has("ListTodos")).toBe(true)
  expect(AppRpc.requests.has("CompleteTodo")).toBe(true)
  expect(AppRpc.requests.has("DeleteTodo")).toBe(true)
  expect(TODO_REACTIVITY_KEY).toBe("todos")
})

test("template spine declares startup windows and provided RPCs", async () => {
  const { AppRpc } = await import("./contract.js")
  const { TodoApp } = await import("./spine.js")

  expect(TodoApp.windows["main"]?.title).toBe("Todos")
  expect(TodoApp.rpcLayers[0]?.group).toBe(AppRpc)
})

test("renderer provider owns unavailable host state", () => {
  const main = readFileSync(join(templateRoot, "src", "main.tsx"), "utf8")

  expect(main).toContain("<DesktopProvider>")
  expect(main).not.toContain("unavailableWindow")
  expect(main).not.toContain("desktopClient")
})
