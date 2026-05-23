import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { Effect } from "effect"

test("AppMetadata public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("app-metadata.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "AppMetadataServiceApi",
        "class AppMetadataClient",
        "AppMetadataLive",
        "makeAppMetadataClientLayer",
        "makeAppMetadataServiceLayer",
        "makeAppMetadataBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))
