import { expect, test } from "bun:test"
import { Effect, Exit, Layer, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { WorkflowEngine } from "effect/unstable/workflow"

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

const makeHttpLayer = (respond: (url: string) => Response): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => HttpClientResponse.fromWeb(request, respond(url.href)))
    )
  )

const makeUpdateLayer = (
  httpLayer: Layer.Layer<HttpClient.HttpClient>,
  updaterLayer: ReturnType<typeof makeUpdaterServiceLayer>
) => UpdateWorkflowLayer.pipe(Layer.provide(Layer.mergeAll(httpLayer, updaterLayer)))

test("UpdateWorkflow fails signature verification as a typed workflow error", async () => {
  const calls: string[] = []
  const manifest = {
    version: "2.0.0",
    url: "https://updates.example/app.bin",
    signature: "sig"
  }

  const httpLayer = makeHttpLayer((url) => {
    calls.push(url)
    if (url === "https://updates.example/manifest.json") {
      return Response.json(manifest)
    }
    return new Response(new TextEncoder().encode("bundle"))
  })

  let installCalled = false
  const updaterLayer = makeUpdaterServiceLayer({
    check: () => Effect.succeed({ available: false, version: "2.0.0" }),
    download: () => Effect.die("unexpected download"),
    install: () => Effect.die("unexpected install"),
    installAndRestart: () =>
      Effect.sync(() => {
        installCalled = true
        return { state: "idle" }
      }),
    getStatus: () => Effect.succeed({ state: "idle" }),
    readyForRestart: () => Effect.void,
    onPreparingRestart: () => Stream.empty
  })

  const layers = makeUpdateLayer(httpLayer, updaterLayer)
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
      const error = fail.error
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

  const httpLayer = makeHttpLayer((url) => {
    if (url === "https://updates.example/manifest.json") {
      return Response.json(manifest)
    }
    return new Response(new TextEncoder().encode("bundle"))
  })

  const updaterLayer = makeUpdaterServiceLayer({
    check: () => Effect.succeed({ available: true, version: "../escape" }),
    download: () => Effect.die("unexpected download"),
    install: () => Effect.die("unexpected install"),
    installAndRestart: () => Effect.die("unexpected installAndRestart"),
    getStatus: () => Effect.succeed({ state: "idle" }),
    readyForRestart: () => Effect.void,
    onPreparingRestart: () => Stream.empty
  })

  const layers = makeUpdateLayer(httpLayer, updaterLayer)
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
      const error = fail.error
      expect(error.stage).toBe("stage")
    }
  }
})
