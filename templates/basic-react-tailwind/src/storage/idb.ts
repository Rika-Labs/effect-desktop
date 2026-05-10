import { Effect, Schema } from "effect"
import { indexedDbStorage } from "@effect-desktop/react"

const Draft = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  body: Schema.String
})

export const DraftTable = indexedDbStorage.makeTable({
  name: "drafts",
  schema: Draft,
  keyPath: "id",
  autoIncrement: true
})

export const DraftVersion = indexedDbStorage.makeVersion(DraftTable)

export const DraftMigration = indexedDbStorage.makeMigration(DraftVersion, (tx) =>
  tx.createObjectStore("drafts").pipe(Effect.asVoid)
)

export const DraftLayer = DraftMigration.layer
