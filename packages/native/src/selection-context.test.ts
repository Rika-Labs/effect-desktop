import { expect, test } from "bun:test"
import { type BridgeClientExchange } from "@orika/bridge"
import { Effect, type Layer, ManagedRuntime, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  makeSelectionContextBridgeClientLayer,
  makeSelectionContextMemoryClient,
  makeSelectionContextServiceLayer,
  makeSelectionContextUnsupportedClient,
  SelectionContext,
  SelectionContextCapabilityFacts,
  SelectionContextClient,
  SelectionContextRpcs,
  SelectionContextSurface
} from "./selection-context.js"

const UnsupportedMethods = [
  "readSelection",
  "readDocumentContext",
  "watchFocus",
  "stopWatching"
] as const

test("SelectionContext exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(SelectionContextRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["SelectionContext.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`SelectionContext.${method}`)
  }
})

test("SelectionContext declares the demoted methods as non-callable capability facts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const factTags = SelectionContextCapabilityFacts.map((fact) => fact.tag).toSorted()
      expect(factTags).toEqual(
        UnsupportedMethods.map((method) => `SelectionContext.${method}`).toSorted()
      )
      for (const fact of SelectionContextCapabilityFacts) {
        expect(fact.support.status).toBe("unsupported")
        expect(fact.capability.kind).toBe("native.invoke")
      }

      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: SelectionContextSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))
      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`SelectionContext.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = SelectionContextSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableTags).toEqual(["SelectionContext.isSupported"])

      const nonCallableTags = SelectionContextSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `SelectionContext.${method}`).toSorted()
      )
    })
  ))

test("SelectionContext isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeSelectionContextMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* SelectionContext
          return yield* context.isSupported()
        }),
        makeSelectionContextServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("SelectionContext unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSelectionContextUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* SelectionContext
          return yield* context.isSupported()
        }),
        makeSelectionContextServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
    })
  ))

test("SelectionContext bridge client fails event stream as unsupported before subscribing", () =>
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

      const runtime = ManagedRuntime.make(makeSelectionContextBridgeClientLayer(exchange))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* SelectionContextClient
            return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(exit._tag).toBe("Failure")
      expect(subscriptions).toEqual([])
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
