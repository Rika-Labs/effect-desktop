import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { Cause, Effect, Exit } from "effect"

import {
  formatLayerFirstError,
  runLayerFirstCheck,
  type LayerFirstCheckError,
  type LayerFirstCheckOptions,
  type LayerFirstCheckReport,
  type LayerFirstViolationKind,
  LayerFirstFileError,
  LayerFirstViolationError
} from "./layer-first-check.js"

const tempRoots: string[] = []

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

const makeFixture = async (
  files: Record<string, string>,
  options?: Partial<LayerFirstCheckOptions>
): Promise<LayerFirstCheckOptions> => {
  const root = await mkdtemp(join(tmpdir(), "effect-desktop-layer-first-"))
  tempRoots.push(root)
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, contents)
  }
  return {
    cwd: root,
    sourceRoots: ["packages"],
    allowedEdges: [],
    publicPromiseAllowlist: [],
    publicBoundaryAllowlist: [],
    ...options
  }
}

const packageFiles = (source: string): Record<string, string> => ({
  "packages/fixture/package.json": JSON.stringify(
    {
      name: "@effect-desktop/fixture",
      type: "module",
      exports: { ".": { types: "./src/index.ts", default: "./src/index.ts" } }
    },
    null,
    2
  ),
  "packages/fixture/src/index.ts": source
})

const runExit = async (options: LayerFirstCheckOptions) =>
  Effect.runPromiseExit(runLayerFirstCheck(options))

const expectViolation = (
  exit: Exit.Exit<LayerFirstCheckReport, LayerFirstCheckError>,
  kind: LayerFirstViolationKind
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    const error = failure?.error
    expect(error).toBeInstanceOf(LayerFirstViolationError)
    if (error instanceof LayerFirstViolationError) {
      expect(JSON.stringify(formatLayerFirstError(error))).toContain(kind)
    }
  }
}

const expectFileError = (
  exit: Exit.Exit<LayerFirstCheckReport, LayerFirstCheckError>,
  operation: string
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    const error = failure?.error
    expect(error).toBeInstanceOf(LayerFirstFileError)
    if (error instanceof LayerFirstFileError) {
      expect(error.operation).toBe(operation)
    }
  }
}

test("Layer-first check rejects hidden Effect.run calls in library source", async () => {
  const options = await makeFixture(
    packageFiles(`
      import { Effect } from "effect"
      export const leak = (program: Effect.Effect<void, never, never>) =>
        Effect.runPromise(program)
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "forbidden-effect-run")
})

test("Layer-first check rejects split hidden Effect.run calls in library source", async () => {
  const options = await makeFixture(
    packageFiles(`
      import { Effect } from "effect"
      export const leak = (program: Effect.Effect<void, never, never>) =>
        Effect
          .runPromise(program)
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "forbidden-effect-run")
})

test("Layer-first check rejects direct runtime globals in library source", async () => {
  const options = await makeFixture(
    packageFiles(`
      export const configHome = process.env["XDG_CONFIG_HOME"] ?? ".config"
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "forbidden-runtime-global")
})

test("Layer-first check rejects split runtime globals in library source", async () => {
  const options = await makeFixture(
    packageFiles(`
      export const configHome = process
        .env["XDG_CONFIG_HOME"] ?? ".config"
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "forbidden-runtime-global")
})

test("Layer-first check rejects filesystem authority variants in library source", async () => {
  const options = await makeFixture(
    packageFiles(`
      import { readFile } from "fs/promises"
      export const load = (path: string) => readFile(path, "utf8")
      export const remove = (path: string) => import("node:fs/promises").then((fs) => fs.unlink(path))
      export const bytes = (path: string) => Bun.file(path)
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "forbidden-runtime-global")
})

test("Layer-first check rejects public Promise-returning API signatures", async () => {
  const options = await makeFixture(
    packageFiles(`
      export const loadUser = async (): Promise<string> => "user"
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public async function API signatures", async () => {
  const options = await makeFixture(
    packageFiles(`
      export async function loadUser() {
        return "user"
      }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public functions with inferred Promise returns", async () => {
  const options = await makeFixture(
    packageFiles(`
      export function loadUser() {
        return Promise.resolve("user")
      }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects re-exported public Promise API signatures", async () => {
  const options = await makeFixture(
    packageFiles(`
      const loadUser = async () => "user"
      export { loadUser }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public Promise APIs re-exported from local modules", async () => {
  const options = await makeFixture({
    ...packageFiles(`
      export { loadUser } from "./api"
    `),
    "packages/fixture/src/api.ts": `
      export const loadUser = async () => "user"
    `
  })

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check resolves JavaScript re-export specifiers to TypeScript source", async () => {
  const options = await makeFixture({
    ...packageFiles(`
      export { loadUser } from "./api.js"
    `),
    "packages/fixture/src/api.ts": `
      export const loadUser = async () => "user"
    `
  })

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public Promise APIs re-exported from export-star barrels", async () => {
  const options = await makeFixture({
    ...packageFiles(`
      export * from "./api"
    `),
    "packages/fixture/src/api.ts": `
      export const loadUser = async () => "user"
    `
  })

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public Promise APIs re-exported through namespaces", async () => {
  const options = await makeFixture({
    ...packageFiles(`
      export * as api from "./api"
    `),
    "packages/fixture/src/api.ts": `
      export const loadUser = async () => "user"
    `
  })

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public Promise APIs from package subpath entrypoints", async () => {
  const options = await makeFixture({
    ...packageFiles("export {}"),
    "packages/fixture/package.json": JSON.stringify(
      {
        name: "@effect-desktop/fixture",
        type: "module",
        exports: {
          ".": { types: "./src/index.ts", default: "./src/index.ts" },
          "./api": { types: "./src/api.ts", default: "./src/api.ts" }
        }
      },
      null,
      2
    ),
    "packages/fixture/src/api.ts": `
      export const loadUser = async () => "user"
    `
  })

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check resolves default Promise APIs re-exported from local modules", async () => {
  const options = await makeFixture({
    ...packageFiles(`
      export { default as loadUser } from "./api"
    `),
    "packages/fixture/src/api.ts": `
      export default async function loadUser() {
        return "user"
      }
    `
  })

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public class members with Promise API signatures", async () => {
  const options = await makeFixture(
    packageFiles(`
      export class Client {
        loadUser(): Promise<string> {
          return Promise.resolve("user")
        }
      }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public class fields with inferred Promise API signatures", async () => {
  const options = await makeFixture(
    packageFiles(`
      export class Client {
        loadUser = () => Promise.resolve("user")
      }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects Promise class members re-exported from local modules", async () => {
  const options = await makeFixture({
    ...packageFiles(`
      export { Client as PublicClient } from "./client"
    `),
    "packages/fixture/src/client.ts": `
      export class Client {
        loadUser(): Promise<string> {
          return Promise.resolve("user")
        }
      }
    `
  })

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check rejects public Promise signatures in API snapshots", async () => {
  const options = await makeFixture({
    ...packageFiles("export {}"),
    "api/snapshots/fixture.snapshot.json": JSON.stringify({
      packageName: "@effect-desktop/fixture",
      symbols: [{ name: "loadUser", signature: "() => Promise<string>" }]
    })
  })

  const exit = await runExit(options)

  expectViolation(exit, "public-promise-api")
})

test("Layer-first check allows explicit public Promise API snapshot symbols", async () => {
  const options = await makeFixture(
    {
      ...packageFiles("export {}"),
      "api/snapshots/fixture.snapshot.json": JSON.stringify({
        packageName: "@effect-desktop/fixture",
        symbols: [{ name: "loadUser", signature: "() => Promise<string>" }]
      })
    },
    {
      publicPromiseAllowlist: ["@effect-desktop/fixture:loadUser"]
    }
  )

  const report = await Effect.runPromise(runLayerFirstCheck(options))

  expect(report.passed).toBe(true)
  expect(report.violations).toEqual([])
})

test("Layer-first check allows explicit public Promise API source symbols", async () => {
  const options = await makeFixture(
    packageFiles(`
      export const loadUser = (): Promise<string> => Promise.resolve("user")
    `),
    {
      publicPromiseAllowlist: ["@effect-desktop/fixture:loadUser"]
    }
  )

  const report = await Effect.runPromise(runLayerFirstCheck(options))

  expect(report.passed).toBe(true)
  expect(report.violations).toEqual([])
})

test("Layer-first check rejects malformed API snapshot JSON", async () => {
  const options = await makeFixture({
    ...packageFiles("export {}"),
    "api/snapshots/fixture.snapshot.json": "{"
  })

  const exit = await runExit(options)

  expectFileError(exit, "parseJson")
})

test("Layer-first check rejects public boundary classes without Schema.Class", async () => {
  const options = await makeFixture(
    packageFiles(`
      export class UserInput {
        constructor(readonly name: string) {}
      }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-boundary-without-schema")
})

test("Layer-first check rejects default-exported public boundary classes without Schema.Class", async () => {
  const options = await makeFixture(
    packageFiles(`
      export default class UserInput {
        constructor(readonly name: string) {}
      }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-boundary-without-schema")
})

test("Layer-first check rejects Request and Response boundary classes without Schema.Class", async () => {
  const options = await makeFixture(
    packageFiles(`
      export class UserRequest {
        constructor(readonly name: string) {}
      }
      export class UserResponse {
        constructor(readonly name: string) {}
      }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-boundary-without-schema")
})

test("Layer-first check rejects re-exported public boundary classes without Schema.Class", async () => {
  const options = await makeFixture(
    packageFiles(`
      class UserInput {
        constructor(readonly name: string) {}
      }
      export { UserInput }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-boundary-without-schema")
})

test("Layer-first check rejects public boundary classes exported under boundary aliases", async () => {
  const options = await makeFixture(
    packageFiles(`
      class InternalModel {
        constructor(readonly name: string) {}
      }
      export { InternalModel as UserInput }
    `)
  )

  const exit = await runExit(options)

  expectViolation(exit, "public-boundary-without-schema")
})

test("Layer-first check ignores non-public boundary classes in internal modules", async () => {
  const options = await makeFixture({
    ...packageFiles("export {}"),
    "packages/fixture/src/internal.ts": `
      export class UserInput {
        constructor(readonly name: string) {}
      }
    `
  })

  const report = await Effect.runPromise(runLayerFirstCheck(options))

  expect(report.passed).toBe(true)
  expect(report.violations).toEqual([])
})

test("Layer-first check allows explicit composition edges and test files", async () => {
  const options = await makeFixture(
    {
      ...packageFiles(`
        export class UserInput {
          constructor(readonly name: string) {}
        }
      `),
      "packages/fixture/src/edge.ts": `
        import { Effect } from "effect"
        export const run = (program: Effect.Effect<void, never, never>) =>
          Effect.runPromise(program)
        export const home = process.env["HOME"]
      `,
      "packages/fixture/src/index.test.ts": `
        import { Effect } from "effect"
        test("edge", () => Effect.runPromise(Effect.void))
      `
    },
    {
      allowedEdges: ["packages/fixture/src/edge.ts"],
      publicBoundaryAllowlist: ["@effect-desktop/fixture:UserInput"]
    }
  )

  const report = await Effect.runPromise(runLayerFirstCheck(options))

  expect(report.passed).toBe(true)
  expect(report.violations).toEqual([])
})
