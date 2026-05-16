import { tmpdir } from "node:os"
import { join } from "node:path"
import { unlink } from "node:fs/promises"

import { DesktopDurations, DesktopSchedules } from "@effect-desktop/core"
import { Cause, Effect, Schema } from "effect"
import { HttpClient as HttpClientNs } from "effect/unstable/http"
import { Activity, DurableClock, DurableDeferred, Workflow } from "effect/unstable/workflow"

import { Updater } from "./updater.js"

const HttpClientTag = HttpClientNs.HttpClient

export class UpdateError extends Schema.TaggedErrorClass<UpdateError>()("UpdateError", {
  stage: Schema.Literals(["check", "download", "verify", "stage", "apply"]),
  message: Schema.String
}) {}

export class UpdateManifest extends Schema.Class<UpdateManifest>("UpdateManifest")({
  version: Schema.String,
  url: Schema.String,
  signature: Schema.String,
  notes: Schema.optionalKey(Schema.String)
}) {}

export class UpdatePayload extends Schema.Class<UpdatePayload>("UpdatePayload")({
  version: Schema.String,
  manifestUrl: Schema.String
}) {}

export const UpdateWorkflow = Workflow.make({
  name: "Update",
  payload: UpdatePayload,
  success: Schema.Void,
  error: UpdateError,
  idempotencyKey: ({ version }) => version
})

const userPrompt = DurableDeferred.make<typeof Schema.Boolean>("user-install-prompt", {
  success: Schema.Boolean
})

const checkUpdate = (manifestUrl: string) =>
  Activity.make({
    name: "check-update",
    success: UpdateManifest,
    error: UpdateError,
    execute: Effect.gen(function* () {
      const client = yield* HttpClientTag
      const response = yield* client
        .get(manifestUrl)
        .pipe(Effect.mapError((e) => new UpdateError({ stage: "check", message: formatCause(e) })))
      const json = yield* response.json.pipe(
        Effect.mapError((e) => new UpdateError({ stage: "check", message: formatCause(e) }))
      )
      return yield* Schema.decodeUnknownEffect(UpdateManifest)(json).pipe(
        Effect.mapError((e) => new UpdateError({ stage: "check", message: formatCause(e) }))
      )
    })
  })

const STAGED_VERSION_PATTERN = /^[A-Za-z0-9._-]+$/

const downloadBundle = (url: string) =>
  Activity.make({
    name: "download-bundle",
    success: Schema.Uint8Array,
    error: UpdateError,
    execute: Effect.gen(function* () {
      const client = yield* HttpClientTag
      const buf = yield* client.get(url).pipe(
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.retry(DesktopSchedules.updateBundleDownload),
        Effect.mapError((e) => new UpdateError({ stage: "download", message: formatCause(e) }))
      )
      return new Uint8Array(buf)
    })
  })

const verifySignature = (bytes: Uint8Array, manifest: UpdateManifest) =>
  Activity.make({
    name: "verify-signature",
    success: Schema.Void,
    error: UpdateError,
    execute: Effect.gen(function* () {
      void bytes
      const updater = yield* Updater
      const result = yield* updater
        .check({ currentVersion: manifest.version })
        .pipe(Effect.mapError((e) => new UpdateError({ stage: "verify", message: formatCause(e) })))
      if (!result.available) {
        return yield* Effect.fail(
          new UpdateError({
            stage: "verify",
            message: `signature verification failed for ${manifest.version}`
          })
        )
      }
    })
  })

const stageBundle = (bytes: Uint8Array, version: string) =>
  Activity.make({
    name: "stage-bundle",
    success: Schema.String,
    error: UpdateError,
    execute: Effect.gen(function* () {
      if (!STAGED_VERSION_PATTERN.test(version) || version === "." || version === "..") {
        return yield* Effect.fail(
          new UpdateError({
            stage: "stage",
            message: "update version must be a safe filename segment"
          })
        )
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const tmpPath = join(tmpdir(), `effect-desktop-update-${version}`)
          await Bun.write(tmpPath, bytes)
          return tmpPath
        },
        catch: (e) => new UpdateError({ stage: "stage", message: formatCause(e) })
      })
    })
  })

const deleteStaged = (path: string): Effect.Effect<void> =>
  Effect.tryPromise({
    try: async () => {
      const f = Bun.file(path)
      if (await f.exists()) {
        await unlink(path)
      }
    },
    catch: () => undefined
  }).pipe(Effect.orDie)

const applyUpdate = Activity.make({
  name: "apply-update",
  success: Schema.Void,
  error: UpdateError,
  execute: Effect.gen(function* () {
    const updater = yield* Updater
    yield* updater
      .installAndRestart({})
      .pipe(Effect.mapError((e) => new UpdateError({ stage: "apply", message: formatCause(e) })))
  })
})

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === "string") {
    return cause
  }
  const json = JSON.stringify(cause)
  return json ?? "undefined"
}

export const UpdateWorkflowLayer = UpdateWorkflow.toLayer((payload: UpdatePayload) =>
  Effect.gen(function* () {
    const manifest = yield* checkUpdate(payload.manifestUrl)

    const bytes = yield* Workflow.withCompensation(
      downloadBundle(manifest.url),
      (_value, _cause) => Effect.void
    )

    const stagedPath = yield* Workflow.withCompensation(
      Effect.gen(function* () {
        yield* verifySignature(bytes, manifest)
        return yield* stageBundle(bytes, manifest.version)
      }),
      (path, cause) => (Cause.hasFails(cause) ? deleteStaged(path) : Effect.void)
    )

    const accepted = yield* DurableDeferred.await(userPrompt)

    if (!accepted) {
      yield* DurableClock.sleep({
        name: "defer-until-next-check",
        duration: "7 days"
      })
      return
    }

    yield* applyUpdate
    void stagedPath
  })
)

export const scheduleUpdateChecks = (manifestUrl: string) =>
  Effect.forever(
    Effect.gen(function* () {
      const checkResult = yield* Effect.gen(function* () {
        const client = yield* HttpClientTag
        const response = yield* client.get(manifestUrl)
        const json = yield* response.json
        return yield* Schema.decodeUnknownEffect(UpdateManifest)(json)
      }).pipe(Effect.option)

      if (checkResult._tag === "Some") {
        const manifest = checkResult.value
        yield* UpdateWorkflow.execute(
          new UpdatePayload({ version: manifest.version, manifestUrl }),
          { discard: true }
        )
      }

      yield* DurableClock.sleep({ name: "weekly-poll", duration: DesktopDurations.updateCheckPoll })
    })
  )

export const resolveUserPrompt = (token: DurableDeferred.Token, accepted: boolean) =>
  DurableDeferred.succeed(userPrompt, { token, value: accepted })

export type { DurableDeferred }
