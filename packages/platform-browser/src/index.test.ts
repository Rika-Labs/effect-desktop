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
  BrowserContext,
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbQueryBuilder,
  IndexedDbTable,
  IndexedDbVersion,
  RendererPgliteLive,
  RendererSqliteMemoryLive,
  RendererSqliteWorkerLive
} from "./index.js"
import { makeDatabase, makeMigration, makeTable, makeVersion } from "./storage/idb.js"
import { layerLocalStorage, layerSessionStorage } from "./storage/kv.js"

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

test("BrowserContext.layer reads IndexedDB globals when the layer builds", () =>
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
        const context = yield* Effect.scoped(Layer.build(BrowserContext.layer))
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

test("BrowserContext.layer fails explicitly when IndexedDB globals are absent", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

      Reflect.deleteProperty(globalThis, "window")

      try {
        const exit = yield* Effect.scoped(Layer.build(BrowserContext.layer)).pipe(Effect.exit)

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

test("storage/kv exposes key-value layers", () => {
  expect(typeof layerLocalStorage).toBe("object")
  expect(typeof layerSessionStorage).toBe("object")
})

test("storage/idb exposes schema constructor helpers", () => {
  expect(typeof makeMigration).toBe("function")
  expect(typeof makeTable).toBe("function")
  expect(typeof makeVersion).toBe("function")
  expect(typeof makeDatabase).toBe("function")
})

test("root exports renderer SQL layer constructors", () => {
  expect(typeof RendererSqliteMemoryLive).toBe("function")
  expect(typeof RendererSqliteWorkerLive).toBe("function")
  expect(typeof RendererPgliteLive).toBe("function")
})
