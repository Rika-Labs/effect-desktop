import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"

import { AutoSaveService, AutoSaveWorkflow, AutoSaveWorkflowLayer } from "./auto-save.js"
import { BackupConfigService, BackupWorkflow, BackupWorkflowLayer } from "./backup.js"
import {
  RestoreConfigService,
  RestoreWorkflow,
  RestoreWorkflowLayer,
  WriterQuiesceService
} from "./restore.js"

const provideEngine = <A, E, R>(
  effect: Effect.Effect<A, E, R | WorkflowEngine.WorkflowEngine>
): Effect.Effect<A, E, Exclude<R, WorkflowEngine.WorkflowEngine>> =>
  effect.pipe(Effect.provide(WorkflowEngine.layerMemory))

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), "effect-desktop-workflows-"))

test("AutoSave: discard returns an executionId and accepts a flush port", async () => {
  const calls: string[] = []

  const autoSaveSvcLayer = Layer.succeed(AutoSaveService, {
    flush: (target) =>
      Effect.sync(() => {
        calls.push(target)
      })
  })

  const layers = Layer.provide(AutoSaveWorkflowLayer, autoSaveSvcLayer)

  const executionId = await Effect.runPromise(
    AutoSaveWorkflow.execute({ target: "session-1" }, { discard: true }).pipe(
      Effect.provide(layers),
      provideEngine
    )
  )

  expect(typeof executionId).toBe("string")
  expect(executionId.length).toBeGreaterThan(0)
})

test("AutoSave: idempotency key is derived from target name", async () => {
  const executionIdA = await Effect.runPromise(AutoSaveWorkflow.executionId({ target: "doc-1" }))
  const executionIdB = await Effect.runPromise(AutoSaveWorkflow.executionId({ target: "doc-1" }))
  const executionIdC = await Effect.runPromise(AutoSaveWorkflow.executionId({ target: "doc-2" }))

  expect(executionIdA).toBe(executionIdB)
  expect(executionIdA).not.toBe(executionIdC)
})

test("Backup: produces archive directory with manifest, db.sqlite, and files/", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const outputDir = join(base, "backups")

  await mkdir(userDataDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(userDataDir, "notes.txt"), "hello world")

  let dbExportCalled = false
  const fakeDbBytes = new TextEncoder().encode("SQLiteDB")

  const SqliteClientStub = {
    export: Effect.sync(() => {
      dbExportCalled = true
      return fakeDbBytes
    })
  }

  const configLayer = Layer.succeed(BackupConfigService, { userDataDir, outputDir })
  const sqliteLayer = Layer.succeed(
    (await import("@effect/sql-sqlite-bun/SqliteClient")).SqliteClient,
    SqliteClientStub as never
  )

  const { BunFileSystem } = await import("@effect/platform-bun")

  const layers = Layer.mergeAll(
    BackupWorkflowLayer as never,
    configLayer,
    sqliteLayer,
    BunFileSystem.layer
  ) as never

  const result = await Effect.runPromise(
    BackupWorkflow.execute({ label: "test-backup" }).pipe(
      Effect.provide(layers as never),
      provideEngine
    )
  )

  expect(dbExportCalled).toBe(true)
  expect(result.dbBytes).toBe(fakeDbBytes.byteLength)

  const archivePath = result.archivePath
  const manifestRaw = await Bun.file(join(archivePath, "manifest.json")).text()
  const manifest = JSON.parse(manifestRaw) as { label: string; format: string }
  expect(manifest.label).toBe("test-backup")
  expect(manifest.format).toBe("effect-desktop-backup-v1")

  const dbContent = await Bun.file(join(archivePath, "db.sqlite")).bytes()
  expect(dbContent).toEqual(fakeDbBytes)

  await rm(base, { recursive: true, force: true })
})

test("Backup: rejects labels that escape the output directory", async () => {
  const base = await tempDir()
  const userDataDir = join(base, "userdata")
  const outputDir = join(base, "backups")

  await mkdir(userDataDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })

  const SqliteClientStub = {
    export: Effect.succeed(new Uint8Array())
  }

  const configLayer = Layer.succeed(BackupConfigService, { userDataDir, outputDir })
  const sqliteLayer = Layer.succeed(
    (await import("@effect/sql-sqlite-bun/SqliteClient")).SqliteClient,
    SqliteClientStub as never
  )
  const { BunFileSystem } = await import("@effect/platform-bun")
  const layers = Layer.mergeAll(
    BackupWorkflowLayer as never,
    configLayer,
    sqliteLayer,
    BunFileSystem.layer
  ) as never

  const exit = await Effect.runPromiseExit(
    BackupWorkflow.execute({ label: "../escape" }).pipe(
      Effect.provide(layers as never),
      provideEngine
    )
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
      createdAt: Date.now()
    })
  )
  const dbBytes = new TextEncoder().encode("RestoredSQLiteDB")
  await writeFile(join(archivePath, "db.sqlite"), dbBytes)
  await writeFile(join(archivePath, "files", "document.txt"), "restored content")

  await mkdir(userDataDir, { recursive: true })
  await writeFile(join(userDataDir, "old.txt"), "old content")
  await writeFile(dbPath, "old db")

  const configLayer = Layer.succeed(RestoreConfigService, { userDataDir, dbPath })
  const quiesceLayer = Layer.succeed(WriterQuiesceService, {
    stop: () => Effect.void,
    resume: () => Effect.void
  })

  const { BunFileSystem } = await import("@effect/platform-bun")

  const layers = Layer.mergeAll(
    RestoreWorkflowLayer as never,
    configLayer,
    quiesceLayer,
    BunFileSystem.layer
  ) as never

  await Effect.runPromise(
    RestoreWorkflow.execute({ archivePath }).pipe(Effect.provide(layers as never), provideEngine)
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
      createdAt: Date.now()
    })
  )
  await writeFile(join(archivePath, "db.sqlite"), "bytes")

  await mkdir(userDataDir, { recursive: true })
  await writeFile(dbPath, "original")

  const configLayer = Layer.succeed(RestoreConfigService, { userDataDir, dbPath })
  const quiesceLayer = Layer.succeed(WriterQuiesceService, {
    stop: () => Effect.void,
    resume: () => Effect.void
  })

  const { BunFileSystem } = await import("@effect/platform-bun")

  const layers = Layer.mergeAll(
    RestoreWorkflowLayer as never,
    configLayer,
    quiesceLayer,
    BunFileSystem.layer
  ) as never

  const exit = await Effect.runPromiseExit(
    RestoreWorkflow.execute({ archivePath }).pipe(Effect.provide(layers as never), provideEngine)
  )

  expect(Exit.isFailure(exit)).toBe(true)

  const originalDb = await Bun.file(dbPath).text()
  expect(originalDb).toBe("original")

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
      createdAt: Date.now()
    })
  )
  await writeFile(join(archivePath, "db.sqlite"), "restored db")

  await mkdir(userDataDir, { recursive: true })
  await writeFile(join(userDataDir, "old.txt"), "old content")
  await writeFile(dbPath, "original db")

  let stopped = 0
  let resumed = 0
  const configLayer = Layer.succeed(RestoreConfigService, { userDataDir, dbPath })
  const quiesceLayer = Layer.succeed(WriterQuiesceService, {
    stop: () =>
      Effect.sync(() => {
        stopped += 1
      }),
    resume: () =>
      Effect.sync(() => {
        resumed += 1
      })
  })

  const { BunFileSystem } = await import("@effect/platform-bun")

  const layers = Layer.mergeAll(
    RestoreWorkflowLayer as never,
    configLayer,
    quiesceLayer,
    BunFileSystem.layer
  ) as never

  const exit = await Effect.runPromiseExit(
    RestoreWorkflow.execute({ archivePath }).pipe(Effect.provide(layers as never), provideEngine)
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
