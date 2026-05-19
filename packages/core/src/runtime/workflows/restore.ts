import { join } from "node:path"

import { Cause, Context, Data, Effect, Layer, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import { BackupManifestJson } from "./backup.js"

const RestorePhase = Schema.Literals(["validate", "quiesce", "database", "files", "rollback"])
type RestorePhase = typeof RestorePhase.Type

const RestoreErrorSchema = Schema.TaggedStruct("RestoreError", {
  phase: RestorePhase,
  message: Schema.String,
  cause: Schema.Unknown
})
type RestoreFailure = typeof RestoreErrorSchema.Type

export class RestoreError extends Data.TaggedError("RestoreError")<{
  readonly phase: RestorePhase
  readonly message: string
  readonly cause: unknown
}> {}

export interface RestoreConfig {
  readonly userDataDir: string
  readonly dbPath: string
}

export class RestoreConfigService extends Context.Service<RestoreConfigService, RestoreConfig>()(
  "@effect-desktop/core/runtime/workflows/restore/RestoreConfigService"
) {}

export interface WriterQuiescePort {
  readonly stop: () => Effect.Effect<void, never, never>
  readonly resume: () => Effect.Effect<void, never, never>
}

export class WriterQuiesceService extends Context.Service<
  WriterQuiesceService,
  WriterQuiescePort
>()("@effect-desktop/core/runtime/workflows/restore/WriterQuiesceService") {}

export const RestoreWorkflow = Workflow.make({
  name: "Restore",
  payload: { archivePath: Schema.NonEmptyString },
  idempotencyKey: (p) => `restore-${p.archivePath}`,
  error: RestoreErrorSchema
})

const wrapError =
  (phase: RestorePhase) =>
  (e: unknown): RestoreError =>
    new RestoreError({ phase, message: e instanceof Error ? e.message : String(e), cause: e })

export const RestoreWorkflowLayer: Layer.Layer<
  never,
  never,
  WorkflowEngine.WorkflowEngine | RestoreConfigService | FileSystem | WriterQuiesceService
> = RestoreWorkflow.toLayer((payload) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const config = yield* RestoreConfigService
    const quiesce = yield* WriterQuiesceService

    const preRestoreSnapshot = `${payload.archivePath}.pre-restore`
    const preRestoreDb = `${payload.archivePath}.pre-restore.db`

    const validate = Activity.make({
      name: "validate",
      success: Schema.Struct({ manifestLabel: Schema.String }),
      error: RestoreErrorSchema,
      execute: Effect.gen(function* () {
        const manifestPath = join(payload.archivePath, "manifest.json")
        const manifestBytes = yield* fs
          .readFile(manifestPath)
          .pipe(Effect.mapError(wrapError("validate")))
        const raw = new TextDecoder().decode(manifestBytes)
        const parsed = yield* Schema.decodeUnknownEffect(BackupManifestJson)(raw).pipe(
          Effect.mapError(
            (e) =>
              new RestoreError({
                phase: "validate",
                message: "manifest is not valid backup manifest JSON",
                cause: e
              })
          )
        )
        if (parsed.format !== "effect-desktop-backup-v1") {
          return yield* new RestoreError({
            phase: "validate",
            message: `unknown backup format: ${parsed.format}`,
            cause: undefined
          })
        }
        return { manifestLabel: parsed.label }
      })
    })

    const stopWriters = Activity.make({
      name: "quiesce",
      error: RestoreErrorSchema,
      execute: quiesce.stop()
    })

    const snapshotCurrent = Activity.make({
      name: "snapshot-current",
      error: RestoreErrorSchema,
      execute: Effect.all(
        [
          fs
            .copy(config.userDataDir, preRestoreSnapshot, { overwrite: true })
            .pipe(Effect.mapError(wrapError("files"))),
          fs
            .copy(config.dbPath, preRestoreDb, { overwrite: true })
            .pipe(Effect.mapError(wrapError("database")))
        ],
        { discard: true }
      )
    })

    const restoreDb = Activity.make({
      name: "restoreDatabase",
      error: RestoreErrorSchema,
      execute: Effect.gen(function* () {
        const dbBytes = yield* fs
          .readFile(join(payload.archivePath, "db.sqlite"))
          .pipe(Effect.mapError(wrapError("database")))
        yield* fs.writeFile(config.dbPath, dbBytes).pipe(Effect.mapError(wrapError("database")))
      })
    })

    const restoreFiles = Activity.make({
      name: "restoreFiles",
      error: RestoreErrorSchema,
      execute: fs
        .copy(join(payload.archivePath, "files"), config.userDataDir, { overwrite: true })
        .pipe(Effect.mapError(wrapError("files")))
    })

    yield* validate
    yield* stopWriters

    const rollback = () =>
      Effect.all(
        [
          fs.copy(preRestoreSnapshot, config.userDataDir, { overwrite: true }),
          fs.copy(preRestoreDb, config.dbPath, { overwrite: true })
        ],
        { discard: true }
      ).pipe(Effect.ignore)

    yield* Effect.gen(function* () {
      yield* snapshotCurrent.execute
      yield* restoreDb.execute
      yield* restoreFiles.execute
    }).pipe(
      Effect.catchCause((cause: Cause.Cause<RestoreFailure>) =>
        rollback().pipe(Effect.andThen(Effect.failCause(cause)))
      ),
      Effect.ensuring(quiesce.resume()),
      Effect.ensuring(
        Effect.all(
          [
            fs.remove(preRestoreSnapshot, { recursive: true }),
            fs.remove(preRestoreDb, { recursive: true })
          ],
          { discard: true }
        ).pipe(Effect.ignore)
      )
    )
  })
)
