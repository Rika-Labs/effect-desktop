import { BunFileSystem, BunPath } from "@effect/platform-bun"
import { layer as sqliteLayer } from "@effect/sql-sqlite-bun/SqliteClient"
import { expect, test } from "bun:test"
import { Clock, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { WorkflowEngine } from "effect/unstable/workflow"

import {
  BackupConfigService,
  BackupManifest,
  BackupManifestJson,
  BackupWorkflow,
  BackupWorkflowLayer
} from "./backup.js"
import {
  RestoreConfigService,
  RestoreWorkflow,
  RestoreWorkflowLayer,
  WriterQuiesceService
} from "./restore.js"

const now = 1_715_000_000_000
const decodeBackupManifestJson = Schema.decodeUnknownSync(BackupManifestJson)
const encodeBackupManifestJson = Schema.encodeSync(BackupManifestJson)
const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

const tempDir = (): Effect.Effect<string, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    return yield* fs.makeTempDirectory({ prefix: "effect-desktop-workflows-" }).pipe(Effect.orDie)
  })

const makeBackupLayer = (options: {
  readonly userDataDir: string
  readonly outputDir: string
  readonly dbPath: string
}) =>
  Layer.mergeAll(
    BackupWorkflowLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(BackupConfigService, {
            userDataDir: options.userDataDir,
            outputDir: options.outputDir
          }),
          sqliteLayer({ filename: options.dbPath }),
          BunFileSystem.layer,
          WorkflowEngine.layerMemory
        )
      )
    ),
    WorkflowEngine.layerMemory
  )

const makeRestoreLayer = (options: {
  readonly userDataDir: string
  readonly dbPath: string
  readonly quiesce: WriterQuiesceService["Service"]
}) =>
  Layer.mergeAll(
    RestoreWorkflowLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(RestoreConfigService, {
            userDataDir: options.userDataDir,
            dbPath: options.dbPath
          }),
          Layer.succeed(WriterQuiesceService, options.quiesce),
          BunFileSystem.layer,
          WorkflowEngine.layerMemory
        )
      )
    ),
    WorkflowEngine.layerMemory
  )

const baseLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

test("Backup: produces archive directory with manifest, db.sqlite, and files/", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const path = yield* Path
        const base = yield* tempDir()
        const userDataDir = path.join(base, "userdata")
        const outputDir = path.join(base, "backups")

        yield* fs.makeDirectory(userDataDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs.makeDirectory(outputDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs
          .writeFileString(path.join(userDataDir, "notes.txt"), "hello world")
          .pipe(Effect.orDie)

        const layers = makeBackupLayer({
          userDataDir,
          outputDir,
          dbPath: path.join(base, "app.sqlite")
        })

        const result = yield* runScoped(
          BackupWorkflow.execute({ label: "test-backup" }).pipe(
            Effect.provideService(Clock.Clock, fixedClock(now))
          ),
          layers
        )

        expect(result.dbBytes).toBeGreaterThan(0)

        const archivePath = result.archivePath
        const manifestRaw = yield* fs
          .readFileString(path.join(archivePath, "manifest.json"))
          .pipe(Effect.orDie)
        const manifest = decodeBackupManifestJson(manifestRaw)
        expect(manifest.label).toBe("test-backup")
        expect(manifest.createdAt).toBe(now)
        expect(manifest.format).toBe("effect-desktop-backup-v1")

        const dbContent = yield* fs.readFile(path.join(archivePath, "db.sqlite")).pipe(Effect.orDie)
        expect(dbContent.byteLength).toBe(result.dbBytes)

        yield* fs.remove(base, { recursive: true, force: true }).pipe(Effect.orDie)
      }),
      baseLayer
    )
  ))

test("Backup: rejects labels that escape the output directory", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const path = yield* Path
        const base = yield* tempDir()
        const userDataDir = path.join(base, "userdata")
        const outputDir = path.join(base, "backups")

        yield* fs.makeDirectory(userDataDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs.makeDirectory(outputDir, { recursive: true }).pipe(Effect.orDie)

        const layers = makeBackupLayer({
          userDataDir,
          outputDir,
          dbPath: path.join(base, "app.sqlite")
        })

        const exit = yield* runScopedExit(BackupWorkflow.execute({ label: "../escape" }), layers)

        expect(Exit.isFailure(exit)).toBe(true)
        const escapedExists = yield* fs.exists(path.join(base, "escape.backup")).pipe(Effect.orDie)
        expect(escapedExists).toBe(false)

        yield* fs.remove(base, { recursive: true, force: true }).pipe(Effect.orDie)
      }),
      baseLayer
    )
  ))

test("Restore: round-trip restores files and database", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const path = yield* Path
        const base = yield* tempDir()
        const userDataDir = path.join(base, "userdata")
        const archivePath = path.join(base, "my-backup.backup")
        const dbPath = path.join(base, "app.sqlite")

        yield* fs
          .makeDirectory(path.join(archivePath, "files"), { recursive: true })
          .pipe(Effect.orDie)
        yield* fs
          .writeFileString(
            path.join(archivePath, "manifest.json"),
            encodeBackupManifestJson({
              label: "restore-test",
              format: "effect-desktop-backup-v1",
              createdAt: now
            })
          )
          .pipe(Effect.orDie)
        const dbBytes = new TextEncoder().encode("RestoredSQLiteDB")
        yield* fs.writeFile(path.join(archivePath, "db.sqlite"), dbBytes).pipe(Effect.orDie)
        yield* fs
          .writeFileString(path.join(archivePath, "files", "document.txt"), "restored content")
          .pipe(Effect.orDie)

        yield* fs.makeDirectory(userDataDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs
          .writeFileString(path.join(userDataDir, "old.txt"), "old content")
          .pipe(Effect.orDie)
        yield* fs.writeFileString(dbPath, "old db").pipe(Effect.orDie)

        const layers = makeRestoreLayer({
          userDataDir,
          dbPath,
          quiesce: {
            stop: () => Effect.void,
            resume: () => Effect.void
          }
        })

        yield* runScoped(RestoreWorkflow.execute({ archivePath }), layers)

        const restoredDoc = yield* fs
          .readFileString(path.join(userDataDir, "document.txt"))
          .pipe(Effect.orDie)
        expect(restoredDoc).toBe("restored content")

        const restoredDb = yield* fs.readFile(dbPath).pipe(Effect.orDie)
        expect(restoredDb).toEqual(dbBytes)

        yield* fs.remove(base, { recursive: true, force: true }).pipe(Effect.orDie)
      }),
      baseLayer
    )
  ))

test("Restore: validates manifest format before touching data", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const path = yield* Path
        const base = yield* tempDir()
        const userDataDir = path.join(base, "userdata")
        const archivePath = path.join(base, "bad.backup")
        const dbPath = path.join(base, "app.sqlite")

        yield* fs
          .makeDirectory(path.join(archivePath, "files"), { recursive: true })
          .pipe(Effect.orDie)
        yield* fs
          .writeFileString(
            path.join(archivePath, "manifest.json"),
            encodeUnknownJson({
              label: "test",
              format: "unknown-format-v99",
              createdAt: now
            })
          )
          .pipe(Effect.orDie)
        yield* fs.writeFileString(path.join(archivePath, "db.sqlite"), "bytes").pipe(Effect.orDie)

        yield* fs.makeDirectory(userDataDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs.writeFileString(dbPath, "original").pipe(Effect.orDie)

        const layers = makeRestoreLayer({
          userDataDir,
          dbPath,
          quiesce: {
            stop: () => Effect.void,
            resume: () => Effect.void
          }
        })

        const exit = yield* runScopedExit(RestoreWorkflow.execute({ archivePath }), layers)

        expect(Exit.isFailure(exit)).toBe(true)

        const originalDb = yield* fs.readFileString(dbPath).pipe(Effect.orDie)
        expect(originalDb).toBe("original")

        yield* fs.remove(base, { recursive: true, force: true }).pipe(Effect.orDie)
      }),
      baseLayer
    )
  ))

test("Restore: rejects malformed manifest JSON before touching data", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const path = yield* Path
        const base = yield* tempDir()
        const userDataDir = path.join(base, "userdata")
        const archivePath = path.join(base, "malformed.backup")
        const dbPath = path.join(base, "app.sqlite")

        yield* fs
          .makeDirectory(path.join(archivePath, "files"), { recursive: true })
          .pipe(Effect.orDie)
        yield* fs
          .writeFileString(path.join(archivePath, "manifest.json"), "{not-json")
          .pipe(Effect.orDie)
        yield* fs.writeFileString(path.join(archivePath, "db.sqlite"), "bytes").pipe(Effect.orDie)

        yield* fs.makeDirectory(userDataDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs.writeFileString(dbPath, "original").pipe(Effect.orDie)

        const layers = makeRestoreLayer({
          userDataDir,
          dbPath,
          quiesce: {
            stop: () => Effect.void,
            resume: () => Effect.void
          }
        })

        const exit = yield* runScopedExit(RestoreWorkflow.execute({ archivePath }), layers)

        expect(Exit.isFailure(exit)).toBe(true)

        const originalDb = yield* fs.readFileString(dbPath).pipe(Effect.orDie)
        expect(originalDb).toBe("original")

        yield* fs.remove(base, { recursive: true, force: true }).pipe(Effect.orDie)
      }),
      baseLayer
    )
  ))

test("Restore: rejects partial manifest shape before touching data", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const path = yield* Path
        const base = yield* tempDir()
        const userDataDir = path.join(base, "userdata")
        const archivePath = path.join(base, "partial-manifest.backup")
        const dbPath = path.join(base, "app.sqlite")

        yield* fs
          .makeDirectory(path.join(archivePath, "files"), { recursive: true })
          .pipe(Effect.orDie)
        yield* fs
          .writeFileString(
            path.join(archivePath, "manifest.json"),
            encodeUnknownJson({
              label: "partial",
              format: "effect-desktop-backup-v1"
            })
          )
          .pipe(Effect.orDie)
        yield* fs.writeFileString(path.join(archivePath, "db.sqlite"), "bytes").pipe(Effect.orDie)

        yield* fs.makeDirectory(userDataDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs.writeFileString(dbPath, "original").pipe(Effect.orDie)

        const layers = makeRestoreLayer({
          userDataDir,
          dbPath,
          quiesce: {
            stop: () => Effect.void,
            resume: () => Effect.void
          }
        })

        const exit = yield* runScopedExit(RestoreWorkflow.execute({ archivePath }), layers)

        expect(Exit.isFailure(exit)).toBe(true)
        const finalDb = yield* fs.readFileString(dbPath).pipe(Effect.orDie)
        expect(finalDb).toBe("original")

        yield* fs.remove(base, { recursive: true, force: true }).pipe(Effect.orDie)
      }),
      baseLayer
    )
  ))

test("Restore: rolls back database and resumes writers after file restore failure", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const path = yield* Path
        const base = yield* tempDir()
        const userDataDir = path.join(base, "userdata")
        const archivePath = path.join(base, "partial.backup")
        const dbPath = path.join(base, "app.sqlite")

        yield* fs.makeDirectory(archivePath, { recursive: true }).pipe(Effect.orDie)
        yield* fs
          .writeFileString(
            path.join(archivePath, "manifest.json"),
            encodeBackupManifestJson({
              label: "partial-restore",
              format: "effect-desktop-backup-v1",
              createdAt: now
            } satisfies BackupManifest)
          )
          .pipe(Effect.orDie)
        yield* fs
          .writeFileString(path.join(archivePath, "db.sqlite"), "restored db")
          .pipe(Effect.orDie)

        yield* fs.makeDirectory(userDataDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs
          .writeFileString(path.join(userDataDir, "old.txt"), "old content")
          .pipe(Effect.orDie)
        yield* fs.writeFileString(dbPath, "original db").pipe(Effect.orDie)

        let stopped = 0
        let resumed = 0
        const layers = makeRestoreLayer({
          userDataDir,
          dbPath,
          quiesce: {
            stop: () =>
              Effect.sync(() => {
                stopped += 1
              }),
            resume: () =>
              Effect.sync(() => {
                resumed += 1
              })
          }
        })

        const exit = yield* runScopedExit(RestoreWorkflow.execute({ archivePath }), layers)

        expect(Exit.isFailure(exit)).toBe(true)
        expect(stopped).toBe(1)
        expect(resumed).toBe(1)

        const db = yield* fs.readFileString(dbPath).pipe(Effect.orDie)
        expect(db).toBe("original db")
        const oldFile = yield* fs
          .readFileString(path.join(userDataDir, "old.txt"))
          .pipe(Effect.orDie)
        expect(oldFile).toBe("old content")

        yield* fs.remove(base, { recursive: true, force: true }).pipe(Effect.orDie)
      }),
      baseLayer
    )
  ))

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})

function runScoped<A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> {
  return Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })
}

function runScopedExit<A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<Exit.Exit<A, E | LE>, never, never> {
  return Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    try {
      return yield* Effect.promise(() => runtime.runPromiseExit(effect))
    } finally {
      yield* Effect.promise(() => runtime.dispose())
    }
  })
}
