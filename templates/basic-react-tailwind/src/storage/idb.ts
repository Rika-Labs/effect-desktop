import { Effect, Schema } from "effect"
import { makeMigration, makeTable, makeVersion } from "@effect-desktop/platform-browser/storage/idb"

const Draft = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  body: Schema.String
})

export const DraftTable = makeTable({
  name: "drafts",
  schema: Draft,
  keyPath: "id",
  autoIncrement: true
})

export const DraftVersion = makeVersion(DraftTable)

export const DraftMigration = makeMigration(DraftVersion, (tx) =>
  tx.createObjectStore("drafts").pipe(Effect.asVoid)
)

export const DraftLayer = DraftMigration.layer
