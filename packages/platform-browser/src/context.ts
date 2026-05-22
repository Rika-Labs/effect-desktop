import * as BrowserIndexedDb from "@effect/platform-browser"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SchemaIssue from "effect/SchemaIssue"

type IndexedDbService = BrowserIndexedDb.IndexedDb.IndexedDb

const browserIndexedDbLayer = (): Layer.Layer<IndexedDbService, Config.ConfigError, never> =>
  Layer.effect(
    BrowserIndexedDb.IndexedDb.IndexedDb,
    Effect.suspend(() => {
      const win = globalThis.window
      if (win?.indexedDB !== undefined && win.IDBKeyRange !== undefined) {
        return Effect.succeed(
          BrowserIndexedDb.IndexedDb.make({
            indexedDB: win.indexedDB,
            IDBKeyRange: win.IDBKeyRange
          })
        )
      }

      return Effect.fail(missingIndexedDbConfigError())
    })
  )

const missingIndexedDbConfigError = (): Config.ConfigError =>
  new Config.ConfigError(
    new Schema.SchemaError(
      new SchemaIssue.MissingKey({
        messageMissingKey: "window.indexedDB is not available"
      })
    )
  )

export const BrowserContext = Object.freeze({
  layer: browserIndexedDbLayer()
})
