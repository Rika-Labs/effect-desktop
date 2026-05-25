import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import type {
  BridgeClientExchange,
  HostProtocolEnvelope,
  HostProtocolError,
  HostProtocolRequestEnvelope
} from "@orika/bridge"
import {
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol
} from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  ExecutionSandbox,
  type ExecutionSandboxClientApi,
  ExecutionSandboxRpcs,
  ExecutionSandboxSurface,
  makeExecutionSandboxMemoryClient,
  makeExecutionSandboxUnsupportedClient
} from "./execution-sandbox.js"
import {
  ExecutionSandboxEvent,
  ExecutionSandboxSupportedResult
} from "./contracts/execution-sandbox.js"

const UnsupportedMethods = ["create", "run", "destroy"] as const

test("ExecutionSandbox public surface omits shallow service and side exports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("execution-sandbox.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "ExecutionSandbox" + "CapabilityFacts",
        "class ExecutionSandboxClient",
        "ExecutionSandboxLive",
        "ExecutionSandboxServiceApi",
        "makeExecutionSandboxService",
        "ExecutionSandboxRpcEvents"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("ExecutionSandbox event schema is owned by the RPC stream contract", () => {
  const callableTags = Array.from(ExecutionSandboxRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["ExecutionSandbox.events.Event", "ExecutionSandbox.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`ExecutionSandbox.${method}`)
  }

  const eventRpc = ExecutionSandboxRpcs.requests.get("ExecutionSandbox.events.Event")
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(ExecutionSandboxEvent)
  }
})

test("ExecutionSandbox declares create, run, destroy as non-callable capability facts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const facts = executionSandboxCapabilityFacts()
      const factTags = facts.map((fact) => fact.tag).toSorted()
      expect(factTags).toEqual(
        UnsupportedMethods.map((method) => `ExecutionSandbox.${method}`).toSorted()
      )
      for (const fact of facts) {
        expect(fact.support.status).toBe("unsupported")
      }

      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: ExecutionSandboxSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))
      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`ExecutionSandbox.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
        expect(fact?.capability.kind).toBe("native.invoke")
      }

      const callableTags = ExecutionSandboxSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableTags).toEqual([
        "ExecutionSandbox.events.Event",
        "ExecutionSandbox.isSupported"
      ])

      const eventDoc = ExecutionSandboxSurface.schemaDocs.find(
        (doc) => doc.tag === "ExecutionSandbox.events.Event"
      )
      expect(eventDoc?.kind).toBe("stream")
      expect(eventDoc?.callable).toBe(true)
    })
  ))

test("ExecutionSandbox contracts reject event phases with inconsistent payloads", () => {
  const baseEvent = {
    type: "sandbox-event",
    timestamp: 1_710_000_000_000,
    sandboxId: "sandbox-1"
  } as const

  for (const event of [
    { ...baseEvent, phase: "run-started" },
    { ...baseEvent, phase: "run-started", runId: "run-1", status: "completed" },
    { ...baseEvent, phase: "run-completed" },
    { ...baseEvent, phase: "created", status: "completed" },
    { ...baseEvent, phase: "destroyed", runId: "run-1", status: "failed" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(ExecutionSandboxEvent)(event))
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const event of [
    { ...baseEvent, phase: "created" },
    { ...baseEvent, phase: "run-started", runId: "run-1" },
    { ...baseEvent, phase: "run-completed", runId: "run-1", status: "completed" },
    { ...baseEvent, phase: "destroyed" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(ExecutionSandboxEvent)(event))
    expect(Exit.isSuccess(exit)).toBe(true)
  }
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
        executionSandboxLayer(client)
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
        executionSandboxLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
    })
  ))

test("ExecutionSandbox direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* directExecutionSandboxEvent(eventPayload())

      expect(result.event).toMatchObject(eventPayload())
      expect(result.methods).toEqual(["ExecutionSandbox.events.Event"])
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

      const runtime = ManagedRuntime.make(ExecutionSandboxSurface.bridgeClientLayer(exchange))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const sandbox = yield* ExecutionSandbox
            return yield* Effect.exit(sandbox.events().pipe(Stream.take(1), Stream.runCollect))
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

      const runtime = ManagedRuntime.make(ExecutionSandboxSurface.bridgeClientLayer(exchange))
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const sandbox = yield* ExecutionSandbox
            return yield* sandbox.isSupported()
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(requests.map((request) => request.method)).toEqual(["ExecutionSandbox.isSupported"])
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
    })
  ))

const directExecutionSandboxEvent = (payload: unknown) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
    const requests: HostProtocolRequestEnvelope[] = []
    const protocolLayer = Layer.effect(RpcClient.Protocol)(
      makeDesktopClientProtocol(
        {
          send: (envelope) => {
            if (envelope.kind !== "request") {
              return Effect.void
            }
            requests.push(envelope)
            return Effect.all(
              [
                Queue.offer(
                  queue,
                  new HostProtocolStreamByRequestEnvelope({
                    kind: "stream",
                    id: envelope.id,
                    timestamp: 1_710_000_000_001,
                    traceId: envelope.traceId,
                    payload
                  })
                ),
                Queue.offer(
                  queue,
                  new HostProtocolResponseEnvelope({
                    kind: "response",
                    id: envelope.id,
                    timestamp: 1_710_000_000_002,
                    traceId: envelope.traceId
                  })
                )
              ],
              { discard: true }
            )
          },
          run: (onEnvelope) =>
            Stream.fromQueue(queue).pipe(
              Stream.runForEach(onEnvelope),
              Effect.andThen(Effect.never)
            )
        },
        {
          nextRequestId: () => "execution-sandbox-event-request",
          nextTraceId: () => "execution-sandbox-event-trace"
        }
      )
    )

    const event = yield* runScoped(
      Effect.gen(function* () {
        const sandbox = yield* ExecutionSandbox
        return yield* sandbox.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      }),
      Layer.provide(ExecutionSandboxSurface.clientLayer, protocolLayer)
    )

    return {
      event,
      methods: requests.map((request) => request.method)
    }
  })

const eventPayload = () => ({
  type: "sandbox-event",
  timestamp: 1_710_000_000_000,
  sandboxId: "sandbox-1",
  phase: "created"
})

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

const executionSandboxLayer = (client: ExecutionSandboxClientApi): Layer.Layer<ExecutionSandbox> =>
  Layer.succeed(ExecutionSandbox)(client)

const executionSandboxCapabilityFacts = () =>
  ExecutionSandboxSurface.schemaDocs.filter((doc) => !doc.callable)

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}
