import { expect, test } from "bun:test"
import { type BridgeClientExchange } from "@effect-desktop/bridge"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  makeWebRequestBridgeClientLayer,
  makeWebRequestMemoryClient,
  makeWebRequestServiceLayer,
  makeWebRequestUnsupportedClient,
  WebRequest,
  WebRequestCapabilityFacts,
  WebRequestClient,
  WebRequestRpcs,
  WebRequestSurface
} from "./web-request.js"

const UnsupportedMethods = ["onBeforeRequest", "onHeadersReceived", "removeListener"] as const

test("WebRequest exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(WebRequestRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["WebRequest.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`WebRequest.${method}`)
  }
})

test("WebRequest declares onBeforeRequest/onHeadersReceived/removeListener as non-callable capability facts", () => {
  const factTags = WebRequestCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `WebRequest.${method}`).toSorted())
  for (const fact of WebRequestCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("WebRequest capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: WebRequestSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`WebRequest.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = WebRequestSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableTags).toEqual(["WebRequest.isSupported"])

      const nonCallableTags = WebRequestSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `WebRequest.${method}`).toSorted()
      )
    })
  ))

test("WebRequest isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeWebRequestMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* WebRequest
          return yield* service.isSupported()
        }),
        makeWebRequestServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("WebRequest unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeWebRequestUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* WebRequest
          return yield* service.isSupported()
        }),
        makeWebRequestServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-web-request-unavailable")
    })
  ))

test("WebRequest unsupported client fails the event stream as unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeWebRequestUnsupportedClient()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* WebRequest
          return yield* Effect.exit(service.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        makeWebRequestServiceLayer(client)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-web-request-unavailable",
          operation: "WebRequest.Event"
        })
      })
    })
  ))

test("WebRequest bridge client subscribes to the host event channel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const collected = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WebRequestClient
          return yield* client.events().pipe(Stream.runCollect)
        }),
        makeWebRequestBridgeClientLayer(exchange)
      )

      expect(Array.from(collected)).toEqual([])
      expect(subscriptions).toEqual(["WebRequest.Event"])
    })
  ))

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
