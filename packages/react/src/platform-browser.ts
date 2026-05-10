import * as BrowserIndexedDb from "@effect/platform-browser"
import * as Layer from "effect/Layer"

export {
  BrowserHttpClient,
  BrowserKeyValueStore,
  BrowserPersistence,
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbQueryBuilder,
  IndexedDbTable,
  IndexedDbVersion
} from "@effect/platform-browser"

type IndexedDbService = BrowserIndexedDb.IndexedDb.IndexedDb

const browserIndexedDbLayer = (): Layer.Layer<IndexedDbService, never, never> =>
  typeof globalThis.window !== "undefined" &&
  globalThis.window.indexedDB !== undefined &&
  globalThis.window.IDBKeyRange !== undefined
    ? Layer.succeed(
        BrowserIndexedDb.IndexedDb.IndexedDb,
        BrowserIndexedDb.IndexedDb.make({
          indexedDB: globalThis.window.indexedDB,
          IDBKeyRange: globalThis.window.IDBKeyRange
        })
      )
    : (Layer.empty as Layer.Layer<IndexedDbService, never, never>)

export const BrowserContext = Object.freeze({
  layer: browserIndexedDbLayer()
})
