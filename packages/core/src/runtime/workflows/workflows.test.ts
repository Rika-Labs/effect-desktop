import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BunFileSystem } from "@effect/platform-bun"
import { layer as sqliteLayer } from "@effect/sql-sqlite-bun/SqliteClient"
import { expect, test } from "bun:test"
import { Clock, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"

import {
  BackupConfigService,
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

const tempDir = (): Effect.Effect<string> =>
  Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-workflows-")))

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

test("Backup: produces archive directory with manifest, db.sqlite, and files/", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const base = yield* tempDir()
      const userDataDir = join(base, "userdata")
      const outputDir = join(base, "backups")

      yield* Effect.promise(() => mkdir(userDataDir, { recursive: true }))
      yield* Effect.promise(() => mkdir(outputDir, { recursive: true }))
      yield* Effect.promise(() => writeFile(join(userDataDir, "notes.txt"), "hello world"))

      const layers = makeBackupLayer({
        userDataDir,
        outputDir,
        dbPath: join(base, "app.sqlite")
      })

      const result = yield* runScoped(
        BackupWorkflow.execute({ label: "test-backup" }).pipe(
          Effect.provideService(Clock.Clock, fixedClock(now))
        ),
        layers
      )

      expect(result.dbBytes).toBeGreaterThan(0)

      const archivePath = result.archivePath
      const manifestRaw = yield* Effect.promise(() =>
        Bun.file(join(archivePath, "manifest.json")).text()
      )
      const manifest = decodeBackupManifestJson(manifestRaw)
      expect(manifest.label).toBe("test-backup")
      expect(manifest.createdAt).toBe(now)
      expect(manifest.format).toBe("effect-desktop-backup-v1")

      const dbContent = yield* Effect.promise(() =>
        Bun.file(join(archivePath, "db.sqlite")).bytes()
      )
      expect(dbContent.byteLength).toBe(result.dbBytes)

      yield* Effect.promise(() => rm(base, { recursive: true, force: true }))
    })
  ))

test("Backup: rejects labels that escape the output directory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const base = yield* tempDir()
      const userDataDir = join(base, "userdata")
      const outputDir = join(base, "backups")

      yield* Effect.promise(() => mkdir(userDataDir, { recursive: true }))
      yield* Effect.promise(() => mkdir(outputDir, { recursive: true }))

      const layers = makeBackupLayer({
        userDataDir,
        outputDir,
        dbPath: join(base, "app.sqlite")
      })

      const exit = yield* runScopedExit(BackupWorkflow.execute({ label: "../escape" }), layers)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(join(base, "escape.backup")).exists())).toBe(
        false
      )

      yield* Effect.promise(() => rm(base, { recursive: true, force: true }))
    })
  ))

test("Restore: round-trip restores files and database", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const base = yield* tempDir()
      const userDataDir = join(base, "userdata")
      const archivePath = join(base, "my-backup.backup")
      const dbPath = join(base, "app.sqlite")

      yield* Effect.promise(() => mkdir(join(archivePath, "files"), { recursive: true }))
      yield* Effect.promise(() =>
        writeFile(
          join(archivePath, "manifest.json"),
          JSON.stringify({
            label: "restore-test",
            format: "effect-desktop-backup-v1",
            createdAt: now
          })
        )
      )
      const dbBytes = new TextEncoder().encode("RestoredSQLiteDB")
      yield* Effect.promise(() => writeFile(join(archivePath, "db.sqlite"), dbBytes))
      yield* Effect.promise(() =>
        writeFile(join(archivePath, "files", "document.txt"), "restored content")
      )

      yield* Effect.promise(() => mkdir(userDataDir, { recursive: true }))
      yield* Effect.promise(() => writeFile(join(userDataDir, "old.txt"), "old content"))
      yield* Effect.promise(() => writeFile(dbPath, "old db"))

      const layers = makeRestoreLayer({
        userDataDir,
        dbPath,
        quiesce: {
          stop: () => Effect.void,
          resume: () => Effect.void
        }
      })

      yield* runScoped(RestoreWorkflow.execute({ archivePath }), layers)

      const restoredDoc = yield* Effect.promise(() =>
        Bun.file(join(userDataDir, "document.txt")).text()
      )
      expect(restoredDoc).toBe("restored content")

      const restoredDb = yield* Effect.promise(() => Bun.file(dbPath).bytes())
      expect(restoredDb).toEqual(dbBytes)

      yield* Effect.promise(() => rm(base, { recursive: true, force: true }))
    })
  ))

test("Restore: validates manifest format before touching data", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const base = yield* tempDir()
      const userDataDir = join(base, "userdata")
      const archivePath = join(base, "bad.backup")
      const dbPath = join(base, "app.sqlite")

      yield* Effect.promise(() => mkdir(join(archivePath, "files"), { recursive: true }))
      yield* Effect.promise(() =>
        writeFile(
          join(archivePath, "manifest.json"),
          JSON.stringify({
            label: "test",
            format: "unknown-format-v99",
            createdAt: now
          })
        )
      )
      yield* Effect.promise(() => writeFile(join(archivePath, "db.sqlite"), "bytes"))

      yield* Effect.promise(() => mkdir(userDataDir, { recursive: true }))
      yield* Effect.promise(() => writeFile(dbPath, "original"))

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

      const originalDb = yield* Effect.promise(() => Bun.file(dbPath).text())
      expect(originalDb).toBe("original")

      yield* Effect.promise(() => rm(base, { recursive: true, force: true }))
    })
  ))

test("Restore: rejects malformed manifest JSON before touching data", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const base = yield* tempDir()
      const userDataDir = join(base, "userdata")
      const archivePath = join(base, "malformed.backup")
      const dbPath = join(base, "app.sqlite")

      yield* Effect.promise(() => mkdir(join(archivePath, "files"), { recursive: true }))
      yield* Effect.promise(() => writeFile(join(archivePath, "manifest.json"), "{not-json"))
      yield* Effect.promise(() => writeFile(join(archivePath, "db.sqlite"), "bytes"))

      yield* Effect.promise(() => mkdir(userDataDir, { recursive: true }))
      yield* Effect.promise(() => writeFile(dbPath, "original"))

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

      const originalDb = yield* Effect.promise(() => Bun.file(dbPath).text())
      expect(originalDb).toBe("original")

      yield* Effect.promise(() => rm(base, { recursive: true, force: true }))
    })
  ))

test("Restore: rejects partial manifest shape before touching data", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const base = yield* tempDir()
      const userDataDir = join(base, "userdata")
      const archivePath = join(base, "partial-manifest.backup")
      const dbPath = join(base, "app.sqlite")

      yield* Effect.promise(() => mkdir(join(archivePath, "files"), { recursive: true }))
      yield* Effect.promise(() =>
        writeFile(
          join(archivePath, "manifest.json"),
          JSON.stringify({
            label: "partial",
            format: "effect-desktop-backup-v1"
          })
        )
      )
      yield* Effect.promise(() => writeFile(join(archivePath, "db.sqlite"), "bytes"))

      yield* Effect.promise(() => mkdir(userDataDir, { recursive: true }))
      yield* Effect.promise(() => writeFile(dbPath, "original"))

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
      expect(yield* Effect.promise(() => Bun.file(dbPath).text())).toBe("original")

      yield* Effect.promise(() => rm(base, { recursive: true, force: true }))
    })
  ))

test("Restore: rolls back database and resumes writers after file restore failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const base = yield* tempDir()
      const userDataDir = join(base, "userdata")
      const archivePath = join(base, "partial.backup")
      const dbPath = join(base, "app.sqlite")

      yield* Effect.promise(() => mkdir(archivePath, { recursive: true }))
      yield* Effect.promise(() =>
        writeFile(
          join(archivePath, "manifest.json"),
          JSON.stringify({
            label: "partial-restore",
            format: "effect-desktop-backup-v1",
            createdAt: now
          })
        )
      )
      yield* Effect.promise(() => writeFile(join(archivePath, "db.sqlite"), "restored db"))

      yield* Effect.promise(() => mkdir(userDataDir, { recursive: true }))
      yield* Effect.promise(() => writeFile(join(userDataDir, "old.txt"), "old content"))
      yield* Effect.promise(() => writeFile(dbPath, "original db"))

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

      const db = yield* Effect.promise(() => Bun.file(dbPath).text())
      expect(db).toBe("original db")
      const oldFile = yield* Effect.promise(() => Bun.file(join(userDataDir, "old.txt")).text())
      expect(oldFile).toBe("old content")

      yield* Effect.promise(() => rm(base, { recursive: true, force: true }))
    })
  ))

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const runScopedExit = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<Exit.Exit<A, E | LE>, never, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    try {
      return yield* Effect.promise(() => runtime.runPromiseExit(effect))
    } finally {
      yield* Effect.promise(() => runtime.dispose())
    }
  })
