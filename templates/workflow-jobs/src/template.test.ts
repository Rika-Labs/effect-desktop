import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, relative } from "node:path"

import { resolveTemplateLocale } from "./messages.js"
import { AppTest, OpenTemplateWindow } from "./spine.js"

const templateRoot = fileURLToPath(new URL("..", import.meta.url))

interface TemplatePackageJson {
  readonly scripts?: Record<string, string>
  readonly dependencies?: Record<string, string>
}

test("template program opens a window through a host-free layer graph", async () => {
  const handle = await Effect.runPromise(OpenTemplateWindow.pipe(Effect.provide(AppTest)))

  expect(handle.kind).toBe("window")
  expect(String(handle.id)).toBe("template-window-001")
  expect(handle.generation).toBe(0)
  expect(handle.ownerScope).toBe("template-test")
  expect(handle.state).toBe("open")
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

test("template contract uses Rpc.make + RpcGroup.make", async () => {
  const { AppRpc, GreetRpc } = await import("./contract.js")

  expect(GreetRpc._tag).toBe("Greet")
  expect(AppRpc.requests.has("Greet")).toBe(true)
})

test("template spine assembles app metadata and layer graphs", async () => {
  const { AppRpc } = await import("./contract.js")
  const { AppLive, AppTest, OpenTemplateWindow, TemplateApp, makeTemplateProductionLayer } =
    await import("./spine.js")

  expect(TemplateApp.windows["main"]?.renderer).toBe("/")
  expect(TemplateApp.rpcs[0]?.group).toBe(AppRpc)
  expect(Layer.isLayer(AppLive)).toBe(true)
  expect(await Effect.runPromise(OpenTemplateWindow.pipe(Effect.provide(AppTest)))).toMatchObject({
    id: "template-window-001"
  })
  expect(typeof makeTemplateProductionLayer).toBe("function")
})

test("renderer uses desktop action hooks instead of manual Effect runners", () => {
  const app = readFileSync(join(templateRoot, "src", "App.tsx"), "utf8")
  const main = readFileSync(join(templateRoot, "src", "main.tsx"), "utf8")

  expect(app).toContain("windows.create.useMutation")
  expect(app).not.toContain("runPromiseExit")
  expect(main).not.toContain("unavailableWindow")
  expect(main).not.toContain("desktopClient")
})

test("template resolves Arabic RTL locale state", () => {
  const rtl = resolveTemplateLocale("ar")

  expect(rtl.locale).toBe("ar")
  expect(rtl.direction).toBe("rtl")
  expect(rtl.copy.openWindow).toContain("افتح")
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
