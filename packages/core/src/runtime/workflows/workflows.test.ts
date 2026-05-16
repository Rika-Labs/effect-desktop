import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BunFileSystem } from "@effect/platform-bun"
import { layer as sqliteLayer } from "@effect/sql-sqlite-bun/SqliteClient"
import { expect, test } from "bun:test"
import { Clock, Effect, Exit, Layer, Schema } from "effect"
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

const provideEngine = <A, E, R>(
  effect: Effect.Effect<A, E, R | WorkflowEngine.WorkflowEngine>
): Effect.Effect<A, E, Exclude<R, WorkflowEngine.WorkflowEngine>> =>
  effect.pipe(Effect.provide(WorkflowEngine.layerMemory))

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), "effect-desktop-workflows-"))

const makeBackupLayer = (options: {
  readonly userDataDir: string
  readonly outputDir: string
  readonly dbPath: string
}) =>
  BackupWorkflowLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(BackupConfigService, {
          userDataDir: options.userDataDir,
          outputDir: options.outputDir
        }),
        sqliteLayer({ filename: options.dbPath }),
        BunFileSystem.layer
      )
    )
  )

const makeRestoreLayer = (options: {
  readonly userDataDir: string
  readonly dbPath: string
  readonly quiesce: WriterQuiesceService["Service"]
}) =>
  RestoreWorkflowLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RestoreConfigService, {
          userDataDir: options.userDataDir,
          dbPath: options.dbPath
        }),
        Layer.succeed(WriterQuiesceService, options.quiesce),
        BunFileSystem.layer
      )
    )
  )

test("Backup: produces archive directory with manifest, db.sqlite, and files/", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const outputDir = join(base, "backups")

  await mkdir(userDataDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(userDataDir, "notes.txt"), "hello world")

  const layers = makeBackupLayer({
    userDataDir,
    outputDir,
    dbPath: join(base, "app.sqlite")
  })

  const result = await Effect.runPromise(
    BackupWorkflow.execute({ label: "test-backup" }).pipe(
      Effect.provide(layers),
      provideEngine,
      Effect.provideService(Clock.Clock, fixedClock(now))
    )
  )

  expect(result.dbBytes).toBeGreaterThan(0)

  const archivePath = result.archivePath
  const manifestRaw = await Bun.file(join(archivePath, "manifest.json")).text()
  const manifest = decodeBackupManifestJson(manifestRaw)
  expect(manifest.label).toBe("test-backup")
  expect(manifest.createdAt).toBe(now)
  expect(manifest.format).toBe("effect-desktop-backup-v1")

  const dbContent = await Bun.file(join(archivePath, "db.sqlite")).bytes()
  expect(dbContent.byteLength).toBe(result.dbBytes)

  await rm(base, { recursive: true, force: true })
})

test("Backup: rejects labels that escape the output directory", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const outputDir = join(base, "backups")

  await mkdir(userDataDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })

  const layers = makeBackupLayer({
    userDataDir,
    outputDir,
    dbPath: join(base, "app.sqlite")
  })

  const exit = await Effect.runPromiseExit(
    BackupWorkflow.execute({ label: "../escape" }).pipe(Effect.provide(layers), provideEngine)
  )

  expect(Exit.isFailure(exit)).toBe(true)
  expect(await Bun.file(join(base, "escape.backup")).exists()).toBe(false)

  await rm(base, { recursive: true, force: true })
})

test("Restore: round-trip restores files and database", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const archivePath = join(base, "my-backup.backup")
  const dbPath = join(base, "app.sqlite")

  await mkdir(join(archivePath, "files"), { recursive: true })
  await writeFile(
    join(archivePath, "manifest.json"),
    JSON.stringify({
      label: "restore-test",
      format: "effect-desktop-backup-v1",
      createdAt: now
    })
  )
  const dbBytes = new TextEncoder().encode("RestoredSQLiteDB")
  await writeFile(join(archivePath, "db.sqlite"), dbBytes)
  await writeFile(join(archivePath, "files", "document.txt"), "restored content")

  await mkdir(userDataDir, { recursive: true })
  await writeFile(join(userDataDir, "old.txt"), "old content")
  await writeFile(dbPath, "old db")

  const layers = makeRestoreLayer({
    userDataDir,
    dbPath,
    quiesce: {
      stop: () => Effect.void,
      resume: () => Effect.void
    }
  })

  await Effect.runPromise(
    RestoreWorkflow.execute({ archivePath }).pipe(Effect.provide(layers), provideEngine)
  )

  const restoredDoc = await Bun.file(join(userDataDir, "document.txt")).text()
  expect(restoredDoc).toBe("restored content")

  const restoredDb = await Bun.file(dbPath).bytes()
  expect(restoredDb).toEqual(dbBytes)

  await rm(base, { recursive: true, force: true })
})

test("Restore: validates manifest format before touching data", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const archivePath = join(base, "bad.backup")
  const dbPath = join(base, "app.sqlite")

  await mkdir(join(archivePath, "files"), { recursive: true })
  await writeFile(
    join(archivePath, "manifest.json"),
    JSON.stringify({
      label: "test",
      format: "unknown-format-v99",
      createdAt: now
    })
  )
  await writeFile(join(archivePath, "db.sqlite"), "bytes")

  await mkdir(userDataDir, { recursive: true })
  await writeFile(dbPath, "original")

  const layers = makeRestoreLayer({
    userDataDir,
    dbPath,
    quiesce: {
      stop: () => Effect.void,
      resume: () => Effect.void
    }
  })

  const exit = await Effect.runPromiseExit(
    RestoreWorkflow.execute({ archivePath }).pipe(Effect.provide(layers), provideEngine)
  )

  expect(Exit.isFailure(exit)).toBe(true)

  const originalDb = await Bun.file(dbPath).text()
  expect(originalDb).toBe("original")

  await rm(base, { recursive: true, force: true })
})

test("Restore: rejects malformed manifest JSON before touching data", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const archivePath = join(base, "malformed.backup")
  const dbPath = join(base, "app.sqlite")

  await mkdir(join(archivePath, "files"), { recursive: true })
  await writeFile(join(archivePath, "manifest.json"), "{not-json")
  await writeFile(join(archivePath, "db.sqlite"), "bytes")

  await mkdir(userDataDir, { recursive: true })
  await writeFile(dbPath, "original")

  const layers = makeRestoreLayer({
    userDataDir,
    dbPath,
    quiesce: {
      stop: () => Effect.void,
      resume: () => Effect.void
    }
  })

  const exit = await Effect.runPromiseExit(
    RestoreWorkflow.execute({ archivePath }).pipe(Effect.provide(layers), provideEngine)
  )

  expect(Exit.isFailure(exit)).toBe(true)

  const originalDb = await Bun.file(dbPath).text()
  expect(originalDb).toBe("original")

  await rm(base, { recursive: true, force: true })
})

test("Restore: rejects partial manifest shape before touching data", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const archivePath = join(base, "partial-manifest.backup")
  const dbPath = join(base, "app.sqlite")

  await mkdir(join(archivePath, "files"), { recursive: true })
  await writeFile(
    join(archivePath, "manifest.json"),
    JSON.stringify({
      label: "partial",
      format: "effect-desktop-backup-v1"
    })
  )
  await writeFile(join(archivePath, "db.sqlite"), "bytes")

  await mkdir(userDataDir, { recursive: true })
  await writeFile(dbPath, "original")

  const layers = makeRestoreLayer({
    userDataDir,
    dbPath,
    quiesce: {
      stop: () => Effect.void,
      resume: () => Effect.void
    }
  })

  const exit = await Effect.runPromiseExit(
    RestoreWorkflow.execute({ archivePath }).pipe(Effect.provide(layers), provideEngine)
  )

  expect(Exit.isFailure(exit)).toBe(true)
  expect(await Bun.file(dbPath).text()).toBe("original")

  await rm(base, { recursive: true, force: true })
})

test("Restore: rolls back database and resumes writers after file restore failure", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const archivePath = join(base, "partial.backup")
  const dbPath = join(base, "app.sqlite")

  await mkdir(archivePath, { recursive: true })
  await writeFile(
    join(archivePath, "manifest.json"),
    JSON.stringify({
      label: "partial-restore",
      format: "effect-desktop-backup-v1",
      createdAt: now
    })
  )
  await writeFile(join(archivePath, "db.sqlite"), "restored db")

  await mkdir(userDataDir, { recursive: true })
  await writeFile(join(userDataDir, "old.txt"), "old content")
  await writeFile(dbPath, "original db")

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

  const exit = await Effect.runPromiseExit(
    RestoreWorkflow.execute({ archivePath }).pipe(Effect.provide(layers), provideEngine)
  )

  expect(Exit.isFailure(exit)).toBe(true)
  expect(stopped).toBe(1)
  expect(resumed).toBe(1)

  const db = await Bun.file(dbPath).text()
  expect(db).toBe("original db")
  const oldFile = await Bun.file(join(userDataDir, "old.txt")).text()
  expect(oldFile).toBe("old content")

  await rm(base, { recursive: true, force: true })
})

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})
