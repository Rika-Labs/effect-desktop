import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { Effect } from "effect"

test("RecentDocuments public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("recent-documents.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "class RecentDocumentsClient",
        "RecentDocumentsLive",
        "RecentDocumentsServiceApi",
        "makeRecentDocumentsClientLayer",
        "makeRecentDocumentsServiceLayer",
        "makeRecentDocumentsBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))
