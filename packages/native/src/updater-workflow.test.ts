import { expect, test } from "bun:test"
import { Effect, Exit, type Layer as LayerType, Layer, ManagedRuntime, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { WorkflowEngine } from "effect/unstable/workflow"

import { Updater, UpdaterClient } from "./updater.js"
import {
  UpdateError,
  UpdatePayload,
  UpdateWorkflow,
  UpdateWorkflowLayer
} from "./updater-workflow.js"

const makeHttpLayer = (respond: (url: string) => Response): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => HttpClientResponse.fromWeb(request, respond(url.href)))
    )
  )

const makeUpdateLayer = (
  httpLayer: Layer.Layer<HttpClient.HttpClient>,
  updaterLayer: Layer.Layer<Updater>
) =>
  UpdateWorkflowLayer.pipe(
    Layer.provide(Layer.mergeAll(httpLayer, updaterLayer)),
    Layer.provideMerge(WorkflowEngine.layerMemory)
  )

const runScopedExit = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: LayerType.Layer<R, never, never>
): Effect.Effect<Exit.Exit<A, E>, never, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

test("UpdateWorkflow fails when host update availability is not confirmed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const manifest = {
        version: "2.0.0",
        url: "https://updates.example/app.bin",
        signature: "sig",
        hostManifestJson: '{"schemaVersion":1}',
        trustAnchors: [{ keyVersion: 7, publicKey: "ed25519:public-key" }]
      }

      const httpLayer = makeHttpLayer((url) => {
        calls.push(url)
        if (url === "https://updates.example/manifest.json") {
          return Response.json(manifest)
        }
        return new Response(new TextEncoder().encode("bundle"))
      })

      let installCalled = false
      const updaterLayer = Layer.provide(
        Updater.layer,
        Layer.succeed(UpdaterClient)({
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
      )

      const layers = makeUpdateLayer(httpLayer, updaterLayer)
      const exit = yield* runScopedExit(
        UpdateWorkflow.execute(
          new UpdatePayload({
            version: "2.0.0",
            manifestUrl: "https://updates.example/manifest.json"
          })
        ),
        layers
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
  ))

test("UpdateWorkflow rejects manifest versions that are not safe filename segments", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = {
        version: "../escape",
        url: "https://updates.example/app.bin",
        signature: "sig",
        hostManifestJson: '{"schemaVersion":1}',
        trustAnchors: [{ keyVersion: 7, publicKey: "ed25519:public-key" }]
      }

      const httpLayer = makeHttpLayer((url) => {
        if (url === "https://updates.example/manifest.json") {
          return Response.json(manifest)
        }
        return new Response(new TextEncoder().encode("bundle"))
      })

      const updaterLayer = Layer.provide(
        Updater.layer,
        Layer.succeed(UpdaterClient)({
          check: () => Effect.succeed({ available: true, version: "../escape" }),
          download: () => Effect.die("unexpected download"),
          install: () => Effect.die("unexpected install"),
          installAndRestart: () => Effect.die("unexpected installAndRestart"),
          getStatus: () => Effect.succeed({ state: "idle" }),
          readyForRestart: () => Effect.void,
          onPreparingRestart: () => Stream.empty
        })
      )

      const layers = makeUpdateLayer(httpLayer, updaterLayer)
      const exit = yield* runScopedExit(
        UpdateWorkflow.execute(
          new UpdatePayload({
            version: "../escape",
            manifestUrl: "https://updates.example/manifest.json"
          })
        ),
        layers
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
  ))
