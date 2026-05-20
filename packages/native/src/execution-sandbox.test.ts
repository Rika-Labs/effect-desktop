import { expect, test } from "bun:test"
import type {
  BridgeClientExchange,
  HostProtocolError,
  HostProtocolRequestEnvelope
} from "@effect-desktop/bridge"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Stream } from "effect"

import {
  ExecutionSandbox,
  ExecutionSandboxCapabilityFacts,
  ExecutionSandboxClient,
  ExecutionSandboxRpcs,
  ExecutionSandboxSurface,
  makeExecutionSandboxBridgeClientLayer,
  makeExecutionSandboxMemoryClient,
  makeExecutionSandboxServiceLayer,
  makeExecutionSandboxUnsupportedClient
} from "./execution-sandbox.js"
import { ExecutionSandboxSupportedResult } from "./contracts/execution-sandbox.js"

const UnsupportedMethods = ["create", "run", "destroy"] as const

test("ExecutionSandbox exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(ExecutionSandboxRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["ExecutionSandbox.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`ExecutionSandbox.${method}`)
  }
})

test("ExecutionSandbox declares create, run, destroy as non-callable capability facts", () => {
  const factTags = ExecutionSandboxCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `ExecutionSandbox.${method}`).toSorted()
  )
  for (const fact of ExecutionSandboxCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }

  const callableTags = ExecutionSandboxSurface.schemaDocs
    .filter((doc) => doc.callable)
    .map((doc) => doc.tag)
  expect(callableTags).toEqual(["ExecutionSandbox.isSupported"])

  const nonCallableTags = ExecutionSandboxSurface.schemaDocs
    .filter((doc) => !doc.callable)
    .map((doc) => doc.tag)
    .toSorted()
  expect(nonCallableTags).toEqual(
    UnsupportedMethods.map((method) => `ExecutionSandbox.${method}`).toSorted()
  )
})

test("ExecutionSandbox isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeExecutionSandboxMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const sandbox = yield* ExecutionSandbox
          return yield* sandbox.isSupported()
        }),
        makeExecutionSandboxServiceLayer(client)
      )
      expect(result).toEqual(new ExecutionSandboxSupportedResult({ supported: true }))
    })
  ))

test("ExecutionSandbox unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeExecutionSandboxUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const sandbox = yield* ExecutionSandbox
          return yield* sandbox.isSupported()
        }),
        makeExecutionSandboxServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
    })
  ))

test("ExecutionSandbox bridge client fails event stream as unsupported before subscribing", () =>
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

      const runtime = ManagedRuntime.make(makeExecutionSandboxBridgeClientLayer(exchange))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* ExecutionSandboxClient
            return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "ExecutionSandbox.Event"
        })
      })
      expect(subscriptions).toEqual([])
    })
  ))

test("ExecutionSandbox bridge client sends a typed isSupported envelope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: { supported: false, reason: "host-adapter-unimplemented" }
          })
        },
        subscribe: () => Stream.empty
      }

      const runtime = ManagedRuntime.make(makeExecutionSandboxBridgeClientLayer(exchange))
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* ExecutionSandboxClient
            return yield* client.isSupported()
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(requests.map((request) => request.method)).toEqual(["ExecutionSandbox.isSupported"])
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
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

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}
