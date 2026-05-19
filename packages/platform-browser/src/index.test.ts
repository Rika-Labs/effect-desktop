import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Path, Schema } from "effect"

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

test("platform-browser package exports point at checked-in source files", () =>
  Effect.runPromise(
    Effect.provide(
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
      }),
      BunServices.layer
    )
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
