import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { BunServices } from "@effect/platform-bun"
import {
  Cause,
  Config,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  ManagedRuntime,
  Path,
  Schema
} from "effect"

import {
  BrowserHttpClient,
  BrowserKeyValueStore,
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbQueryBuilder,
  IndexedDbTable,
  IndexedDbVersion,
  RendererPgliteLive,
  RendererSqliteMemoryLive,
  RendererSqliteWorkerLive
} from "./index.js"

const PlatformBrowserPackageExportTarget = Schema.Union([
  Schema.String,
  Schema.Struct({
    types: Schema.optionalKey(Schema.String),
    default: Schema.optionalKey(Schema.String)
  })
])

const PlatformBrowserPackageJson = Schema.Struct({
  exports: Schema.Record(Schema.String, PlatformBrowserPackageExportTarget)
})

const decodePlatformBrowserPackageJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(PlatformBrowserPackageJson)
)

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url))
const packageRootPath = fileURLToPath(new URL("../", import.meta.url))
const storageKvPath = fileURLToPath(new URL("storage/kv.ts", import.meta.url))
const storageIdbPath = fileURLToPath(new URL("storage/idb.ts", import.meta.url))
const browserContextPath = fileURLToPath(new URL("context.ts", import.meta.url))
const indexPath = fileURLToPath(new URL("index.ts", import.meta.url))

const PlatformRuntime = ManagedRuntime.make(BunServices.layer)

test("platform-browser package exports point at checked-in source files", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const packageJson = decodePlatformBrowserPackageJson(
        yield* fs.readFileString(packageJsonPath)
      )
      const missing: string[] = []

      for (const [subpath, target] of Object.entries(packageJson.exports)) {
        if (typeof target === "string") {
          if (!(yield* fs.exists(path.join(packageRootPath, target)))) {
            missing.push(`${subpath}:default:${target}`)
          }
          continue
        }

        for (const condition of ["types", "default"] as const) {
          const relativePath = target[condition]
          if (relativePath === undefined) {
            missing.push(`${subpath}:${condition}:<missing condition>`)
          } else if (!(yield* fs.exists(path.join(packageRootPath, relativePath)))) {
            missing.push(`${subpath}:${condition}:${relativePath}`)
          }
        }
      }

      expect(missing).toEqual([])
    })
  ))

test("platform-browser package does not expose zero-policy key-value storage aliases", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const packageJson = decodePlatformBrowserPackageJson(
        yield* fs.readFileString(packageJsonPath)
      )

      expect(Object.keys(packageJson.exports)).not.toContain("./storage/kv")
      expect(yield* fs.exists(storageKvPath)).toBe(false)
    })
  ))

test("platform-browser package does not expose zero-policy IndexedDB constructor aliases", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const packageJson = decodePlatformBrowserPackageJson(
        yield* fs.readFileString(packageJsonPath)
      )

      expect(Object.keys(packageJson.exports)).not.toContain("./storage/idb")
      expect(yield* fs.exists(storageIdbPath)).toBe(false)
    })
  ))

test("platform-browser package does not expose a zero-policy browser context wrapper", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const packageJson = decodePlatformBrowserPackageJson(
        yield* fs.readFileString(packageJsonPath)
      )
      const source = yield* fs.readFileString(indexPath)

      expect(Object.keys(packageJson.exports)).not.toContain("./context")
      expect(yield* fs.exists(browserContextPath)).toBe(false)
      expect(source).not.toContain("BrowserContext")
    })
  ))

test("IndexedDbTable.make produces a typed table descriptor", () => {
  const DraftTable = IndexedDbTable.make({
    name: "drafts",
    schema: Schema.Struct({
      id: Schema.Number,
      body: Schema.String
    }),
    keyPath: "id",
    autoIncrement: true
  })

  expect(DraftTable.tableName).toBe("drafts")
  expect(DraftTable.autoIncrement).toBe(true)
  expect(DraftTable.keyPath).toBe("id")
})

test("IndexedDbVersion.make accepts a table descriptor", () => {
  const DraftTable = IndexedDbTable.make({
    name: "drafts",
    schema: Schema.Struct({
      id: Schema.Number,
      body: Schema.String
    }),
    keyPath: "id",
    autoIncrement: true
  })

  const v1 = IndexedDbVersion.make(DraftTable)

  expect(v1.tables.has("drafts")).toBe(true)
  expect(v1.tables.size).toBe(1)
})

test("IndexedDbDatabase.make produces a schema builder", () => {
  const DraftTable = IndexedDbTable.make({
    name: "drafts",
    schema: Schema.Struct({
      id: Schema.Number,
      body: Schema.String
    }),
    keyPath: "id",
    autoIncrement: true
  })

  const v1 = IndexedDbVersion.make(DraftTable)

  const schema = IndexedDbDatabase.make(v1, (tx) =>
    tx.createObjectStore("drafts").pipe(Effect.asVoid)
  )

  expect(typeof schema.layer).toBe("function")
  expect(schema.version).toBe(v1)
})

test("BrowserKeyValueStore exports storage layers", () => {
  expect(typeof BrowserKeyValueStore.layerLocalStorage).toBe("object")
  expect(typeof BrowserKeyValueStore.layerSessionStorage).toBe("object")
})

test("BrowserHttpClient exports browser HTTP layers", () => {
  expect(typeof BrowserHttpClient.layerFetch).toBe("object")
  expect(typeof BrowserHttpClient.layerXMLHttpRequest).toBe("object")
})

test("IndexedDb exports layerWindow", () => {
  expect(typeof IndexedDb.layerWindow).toBe("object")
})

test("IndexedDb.layerWindow reads IndexedDB globals when the layer builds", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
      const indexedDB = {} as IDBFactory
      class FakeIDBKeyRange implements IDBKeyRange {
        readonly lower = undefined
        readonly lowerOpen = false
        readonly upper = undefined
        readonly upperOpen = false

        includes(_key: IDBValidKey): boolean {
          return true
        }

        static bound(): IDBKeyRange {
          return new FakeIDBKeyRange()
        }

        static lowerBound(): IDBKeyRange {
          return new FakeIDBKeyRange()
        }

        static only(): IDBKeyRange {
          return new FakeIDBKeyRange()
        }

        static upperBound(): IDBKeyRange {
          return new FakeIDBKeyRange()
        }
      }

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          indexedDB,
          IDBKeyRange: FakeIDBKeyRange
        }
      })

      try {
        const context = yield* Effect.scoped(Layer.build(IndexedDb.layerWindow))
        const service = Context.get(context, IndexedDb.IndexedDb)

        expect(service.indexedDB).toBe(indexedDB)
        expect(service.IDBKeyRange).toBe(FakeIDBKeyRange)
      } finally {
        if (originalWindow === undefined) {
          Reflect.deleteProperty(globalThis, "window")
        } else {
          Object.defineProperty(globalThis, "window", originalWindow)
        }
      }
    })
  ))

test("IndexedDb.layerWindow fails explicitly when IndexedDB globals are absent", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {}
      })

      try {
        const exit = yield* Effect.scoped(Layer.build(IndexedDb.layerWindow)).pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
        expect(failure).toBeInstanceOf(Config.ConfigError)
      } finally {
        if (originalWindow === undefined) {
          Reflect.deleteProperty(globalThis, "window")
        } else {
          Object.defineProperty(globalThis, "window", originalWindow)
        }
      }
    })
  ))

test("IndexedDbQueryBuilder exports make", () => {
  expect(typeof IndexedDbQueryBuilder.make).toBe("function")
})

test("root exports renderer SQL layer constructors", () => {
  expect(typeof RendererSqliteMemoryLive).toBe("function")
  expect(typeof RendererSqliteWorkerLive).toBe("function")
  expect(typeof RendererPgliteLive).toBe("function")
})
