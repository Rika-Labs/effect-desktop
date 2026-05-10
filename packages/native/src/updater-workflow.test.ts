import { expect, test } from "bun:test"
import { Effect, Exit, Layer, Stream } from "effect"
import { HttpClient } from "effect/unstable/http"
import { WorkflowEngine } from "effect/unstable/workflow"

import { UpdaterStatusResult } from "./contracts/updater.js"
import { makeUpdaterServiceLayer } from "./updater.js"
import {
  UpdateError,
  UpdatePayload,
  UpdateWorkflow,
  UpdateWorkflowLayer
} from "./updater-workflow.js"

const provideEngine = <A, E, R>(
  effect: Effect.Effect<A, E, R | WorkflowEngine.WorkflowEngine>
): Effect.Effect<A, E, Exclude<R, WorkflowEngine.WorkflowEngine>> =>
  effect.pipe(Effect.provide(WorkflowEngine.layerMemory))

test("UpdateWorkflow fails signature verification as a typed workflow error", async () => {
  const calls: string[] = []
  const manifest = {
    version: "2.0.0",
    url: "https://updates.example/app.bin",
    signature: "sig"
  }

  const httpLayer = Layer.succeed(HttpClient.HttpClient, {
    get: (url: string) => {
      calls.push(url)
      if (url === "https://updates.example/manifest.json") {
        return Effect.succeed({
          json: Effect.succeed(manifest)
        })
      }
      return Effect.succeed({
        arrayBuffer: Effect.succeed(new TextEncoder().encode("bundle").buffer)
      })
    }
  } as never)

  let installCalled = false
  const updaterLayer = makeUpdaterServiceLayer({
    check: () => Effect.succeed({ available: false, version: "2.0.0" }),
    download: () => Effect.die("unexpected download"),
    install: () => Effect.die("unexpected install"),
    installAndRestart: () =>
      Effect.sync(() => {
        installCalled = true
        return new UpdaterStatusResult({ state: "idle" })
      }),
    getStatus: () => Effect.succeed(new UpdaterStatusResult({ state: "idle" })),
    readyForRestart: () => Effect.void,
    onPreparingRestart: () => Stream.empty
  })

  const layers = Layer.mergeAll(UpdateWorkflowLayer as never, httpLayer, updaterLayer) as never
  const exit = await Effect.runPromiseExit(
    UpdateWorkflow.execute(
      new UpdatePayload({ version: "2.0.0", manifestUrl: "https://updates.example/manifest.json" })
    ).pipe(Effect.provide(layers), provideEngine)
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail).toBeDefined()
    if (fail?._tag === "Fail") {
      expect(fail.error).toBeInstanceOf(UpdateError)
      const error = fail.error as UpdateError
      expect(error.stage).toBe("verify")
    }
  }
  expect(calls).toEqual([
    "https://updates.example/manifest.json",
    "https://updates.example/app.bin"
  ])
  expect(installCalled).toBe(false)
})

test("UpdateWorkflow rejects manifest versions that are not safe filename segments", async () => {
  const manifest = {
    version: "../escape",
    url: "https://updates.example/app.bin",
    signature: "sig"
  }

  const httpLayer = Layer.succeed(HttpClient.HttpClient, {
    get: (url: string) => {
      if (url === "https://updates.example/manifest.json") {
        return Effect.succeed({
          json: Effect.succeed(manifest)
        })
      }
      return Effect.succeed({
        arrayBuffer: Effect.succeed(new TextEncoder().encode("bundle").buffer)
      })
    }
  } as never)

  const updaterLayer = makeUpdaterServiceLayer({
    check: () => Effect.succeed({ available: true, version: "../escape" }),
    download: () => Effect.die("unexpected download"),
    install: () => Effect.die("unexpected install"),
    installAndRestart: () => Effect.die("unexpected installAndRestart"),
    getStatus: () => Effect.succeed(new UpdaterStatusResult({ state: "idle" })),
    readyForRestart: () => Effect.void,
    onPreparingRestart: () => Stream.empty
  })

  const layers = Layer.mergeAll(UpdateWorkflowLayer as never, httpLayer, updaterLayer) as never
  const exit = await Effect.runPromiseExit(
    UpdateWorkflow.execute(
      new UpdatePayload({
        version: "../escape",
        manifestUrl: "https://updates.example/manifest.json"
      })
    ).pipe(Effect.provide(layers), provideEngine)
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail).toBeDefined()
    if (fail?._tag === "Fail") {
      expect(fail.error).toBeInstanceOf(UpdateError)
      const error = fail.error as UpdateError
      expect(error.stage).toBe("stage")
    }
  }
})
