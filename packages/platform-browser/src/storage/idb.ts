import * as PlatformBrowser from "../index.js"

export {
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbQueryBuilder,
  IndexedDbTable,
  IndexedDbVersion
} from "../index.js"

type MigrationBuilder = typeof PlatformBrowser.IndexedDbDatabase.make
const platformBrowserMigration = (
  PlatformBrowser as { readonly IndexedDbMigration?: { readonly make: MigrationBuilder } }
).IndexedDbMigration?.make

export const makeMigration: MigrationBuilder =
  platformBrowserMigration ?? PlatformBrowser.IndexedDbDatabase.make
export const makeTable = PlatformBrowser.IndexedDbTable.make

export const makeVersion = PlatformBrowser.IndexedDbVersion.make

export const makeDatabase = PlatformBrowser.IndexedDbDatabase.make
