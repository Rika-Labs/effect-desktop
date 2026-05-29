import { BunFileSystem, BunPath } from "@effect/platform-bun"
import { expect, test } from "bun:test"
import { Context, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { WorkflowEngine } from "effect/unstable/workflow"

import { BackupManifest, BackupManifestJson } from "./backup.js"
import {
  RestoreConfigService,
  RestoreWorkflow,
  RestoreWorkflowLayer,
  WriterQuiesceService
} from "./restore.js"

const now = 1_715_000_000_000
const encodeBackupManifestJson = Schema.encodeSync(BackupManifestJson)

const baseLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const tempDir = (): Effect.Effect<string, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    return yield* fs.makeTempDirectory({ prefix: "effect-desktop-restore-" }).pipe(Effect.orDie)
  })

const noopQuiesce: WriterQuiesceService["Service"] = {
  stop: () => Effect.void,
  resume: () => Effect.void
}

const makeRestoreLayer = (
  options: {
    readonly userDataDir: string
    readonly dbPath: string
    readonly quiesce: WriterQuiesceService["Service"]
  },
  engineLayer: Layer.Layer<WorkflowEngine.WorkflowEngine> = WorkflowEngine.layerMemory
) =>
  RestoreWorkflowLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RestoreConfigService, {
          userDataDir: options.userDataDir,
          dbPath: options.dbPath
        }),
        Layer.succeed(WriterQuiesceService, options.quiesce),
        BunFileSystem.layer,
        BunPath.layer
      )
    ),
    Layer.provideMerge(engineLayer)
  )

const spyEngineLayer = (recorded: Array<string>): Layer.Layer<WorkflowEngine.WorkflowEngine> =>
  Layer.effect(WorkflowEngine.WorkflowEngine)(
    Effect.gen(function* () {
      const context = yield* Layer.build(WorkflowEngine.layerMemory)
      const base = Context.get(context, WorkflowEngine.WorkflowEngine)
      const activityExecute: WorkflowEngine.WorkflowEngine["Service"]["activityExecute"] = (
        activity,
        attempt
      ) =>
        Effect.sync(() => {
          recorded.push(activity.name)
        }).pipe(Effect.andThen(base.activityExecute(activity, attempt)))
      let self: WorkflowEngine.WorkflowEngine["Service"]
      self = WorkflowEngine.WorkflowEngine.of({
        ...base,
        register: (workflow, execute) =>
          base.register(workflow, (payload, executionId) =>
            execute(payload, executionId).pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, self)
            )
          ),
        activityExecute
      })
      return self
    })
  )

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

const writeValidArchive = (
  archivePath: string,
  options: { readonly files: ReadonlyArray<readonly [path: string, content: string]> }
): Effect.Effect<void, never, FileSystem | Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.makeDirectory(path.join(archivePath, "files"), { recursive: true }).pipe(Effect.orDie)
    yield* fs
      .writeFileString(
        path.join(archivePath, "manifest.json"),
        encodeBackupManifestJson({
          label: "restore-test",
          format: "effect-desktop-backup-v1",
          createdAt: now
        } satisfies BackupManifest)
      )
      .pipe(Effect.orDie)
    yield* fs.writeFileString(path.join(archivePath, "db.sqlite"), "restored db").pipe(Effect.orDie)
    for (const [rel, content] of options.files) {
      const dest = path.join(archivePath, "files", rel)
      yield* fs.makeDirectory(path.dirname(dest), { recursive: true }).pipe(Effect.orDie)
      yield* fs.writeFileString(dest, content).pipe(Effect.orDie)
    }
  })

test("Restore: snapshot/database/files steps run as journaled durable activities", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const path = yield* Path
        const base = yield* tempDir()
        const userDataDir = path.join(base, "userdata")
        const archivePath = path.join(base, "journaled.backup")
        const dbPath = path.join(base, "app.sqlite")

        yield* writeValidArchive(archivePath, { files: [["document.txt", "restored content"]] })
        yield* fs.makeDirectory(userDataDir, { recursive: true }).pipe(Effect.orDie)
        yield* fs.writeFileString(dbPath, "original db").pipe(Effect.orDie)

        const recorded: Array<string> = []
        const layers = makeRestoreLayer(
          { userDataDir, dbPath, quiesce: noopQuiesce },
          spyEngineLayer(recorded)
        )

        const exit = yield* runScopedExit(RestoreWorkflow.execute({ archivePath }), layers)
        expect(Exit.isSuccess(exit)).toBe(true)

        expect(recorded).toContain("snapshot-current")
        expect(recorded).toContain("restoreDatabase")
        expect(recorded).toContain("restoreFiles")

        const restoredDoc = yield* fs
          .readFileString(path.join(userDataDir, "document.txt"))
          .pipe(Effect.orDie)
        expect(restoredDoc).toBe("restored content")

        yield* fs.remove(base, { recursive: true, force: true }).pipe(Effect.orDie)
      }),
      baseLayer
    )
  ))
