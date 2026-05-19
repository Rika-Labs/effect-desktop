import { join } from "node:path"

import { Clock, Context, Data, Effect, Layer, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import { SqliteClient } from "@effect/sql-sqlite-bun/SqliteClient"

const BackupPhase = Schema.Literals(["validate", "snapshot", "database", "archive", "cleanup"])
type BackupPhase = typeof BackupPhase.Type

const BackupErrorSchema = Schema.TaggedStruct("BackupError", {
  phase: BackupPhase,
  message: Schema.String,
  cause: Schema.Unknown
})

export class BackupError extends Data.TaggedError("BackupError")<{
  readonly phase: BackupPhase
  readonly message: string
  readonly cause: unknown
}> {}

export interface BackupConfig {
  readonly userDataDir: string
  readonly outputDir: string
}

export class BackupConfigService extends Context.Service<BackupConfigService, BackupConfig>()(
  "@effect-desktop/core/runtime/workflows/backup/BackupConfigService"
) {}

const BackupResultSchema = Schema.Struct({
  archivePath: Schema.NonEmptyString,
  dbBytes: Schema.Number
})

export type BackupResult = typeof BackupResultSchema.Type

export const BackupManifest = Schema.Struct({
  label: Schema.String,
  createdAt: Schema.Number,
  format: Schema.String
})

export type BackupManifest = typeof BackupManifest.Type

export const BackupManifestJson = Schema.fromJsonString(BackupManifest)

const encodeBackupManifestJson = Schema.encodeSync(BackupManifestJson)

export const BackupWorkflow = Workflow.make({
  name: "Backup",
  payload: { label: Schema.NonEmptyString },
  idempotencyKey: (p) => `backup-${p.label}`,
  success: BackupResultSchema,
  error: BackupErrorSchema
})

const wrapError =
  (phase: BackupPhase) =>
  (e: unknown): BackupError =>
    new BackupError({ phase, message: e instanceof Error ? e.message : String(e), cause: e })

const BACKUP_LABEL_PATTERN = /^[A-Za-z0-9._-]+$/

const validateBackupLabel = (label: string): Effect.Effect<string, BackupError, never> =>
  BACKUP_LABEL_PATTERN.test(label) && label !== "." && label !== ".."
    ? Effect.succeed(label)
    : Effect.fail(
        new BackupError({
          phase: "validate",
          message: "backup label must be a safe filename segment",
          cause: label
        })
      )

export const BackupWorkflowLayer: Layer.Layer<
  never,
  never,
  WorkflowEngine.WorkflowEngine | BackupConfigService | FileSystem | SqliteClient
> = BackupWorkflow.toLayer((payload) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const config = yield* BackupConfigService
    const sqliteClient = yield* SqliteClient
    const label = yield* validateBackupLabel(payload.label)

    const snapshotDir = join(config.outputDir, `${label}-snapshot`)
    const archivePath = join(config.outputDir, `${label}.backup`)

    const snapshot = Activity.make({
      name: "snapshot",
      success: Schema.Struct({ snapshotDir: Schema.NonEmptyString }),
      error: BackupErrorSchema,
      execute: Effect.gen(function* () {
        yield* fs
          .makeDirectory(snapshotDir, { recursive: true })
          .pipe(Effect.mapError(wrapError("snapshot")))
        yield* fs
          .copy(config.userDataDir, join(snapshotDir, "files"), { overwrite: true })
          .pipe(Effect.mapError(wrapError("snapshot")))
        return { snapshotDir } as { snapshotDir: string }
      })
    })

    const backupDb = Activity.make({
      name: "backupSqlite",
      success: Schema.Struct({ dbBytes: Schema.Number }),
      error: BackupErrorSchema,
      execute: Effect.gen(function* () {
        const bytes = yield* sqliteClient.export.pipe(Effect.mapError(wrapError("database")))
        yield* fs
          .writeFile(join(snapshotDir, "db.sqlite"), bytes)
          .pipe(Effect.mapError(wrapError("database")))
        return { dbBytes: bytes.byteLength }
      })
    })

    const archiveActivity = Activity.make({
      name: "archive",
      success: Schema.Struct({ archivePath: Schema.NonEmptyString }),
      error: BackupErrorSchema,
      execute: Effect.gen(function* () {
        const createdAt = yield* Clock.currentTimeMillis
        const manifestBytes = new TextEncoder().encode(
          encodeBackupManifestJson({
            label,
            createdAt,
            format: "effect-desktop-backup-v1"
          })
        )
        yield* fs
          .writeFile(join(snapshotDir, "manifest.json"), manifestBytes)
          .pipe(Effect.mapError(wrapError("archive")))
        yield* fs
          .copy(snapshotDir, archivePath, { overwrite: true })
          .pipe(Effect.mapError(wrapError("archive")))
        return { archivePath } as { archivePath: string }
      })
    })

    yield* snapshot
    const dbResult = yield* backupDb

    const archiveResult = yield* BackupWorkflow.withCompensation(
      archiveActivity.execute,
      (_value, _cause) => Effect.ignore(fs.remove(archivePath, { recursive: true }))
    )

    yield* Effect.ignore(fs.remove(snapshotDir, { recursive: true }))

    return {
      archivePath: archiveResult.archivePath,
      dbBytes: dbResult.dbBytes
    }
  })
)
