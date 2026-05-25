import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  makeScopedAccessGrantMemoryClient,
  makeScopedAccessGrantUnsupportedClient,
  ScopedAccessGrant,
  ScopedAccessGrantEvent,
  ScopedAccessGrantRpcs,
  ScopedAccessGrantSurface
} from "./scoped-access-grant.js"

const UnsupportedMethods = ["grant", "resolve", "revoke"] as const

test("ScopedAccessGrant public surface omits shallow service and side exports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("scoped-access-grant.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "ScopedAccessGrantCapabilityFacts",
        "class ScopedAccessGrantClient",
        "ScopedAccessGrantLive",
        "ScopedAccessGrantRpcEvents",
        "ScopedAccessGrantServiceApi",
        "makeScopedAccessGrantClientLayer",
        "makeScopedAccessGrantServiceLayer",
        "makeScopedAccessGrantBridgeClientLayer",
        "makeScopedAccessGrantService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("ScopedAccessGrant exposes isSupported and events as callable RPCs", () => {
  const callableTags = Array.from(ScopedAccessGrantRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["ScopedAccessGrant.events.Event", "ScopedAccessGrant.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`ScopedAccessGrant.${method}`)
  }
})

test("ScopedAccessGrant contract module does not export unsupported operation payload schemas", async () => {
  const contractExports = Object.keys(await import("./contracts/scoped-access-grant.js"))
  for (const exportedName of [
    "ScopedAccessGrantActorKind",
    "ScopedAccessGrantActor",
    "ScopedAccessGrantScopeKind",
    "ScopedAccessGrantScope",
    "ScopedAccessGrantAccess",
    "ScopedAccessGrantGrantRequest",
    "ScopedAccessGrantGrantInput",
    "ScopedAccessGrantGrantResult",
    "ScopedAccessGrantResolveRequest",
    "ScopedAccessGrantResolveInput",
    "ScopedAccessGrantResolveResult",
    "ScopedAccessGrantRevokeRequest",
    "ScopedAccessGrantRevokeInput",
    "ScopedAccessGrantRevokeResult"
  ]) {
    expect(contractExports).not.toContain(exportedName)
  }
})

test("ScopedAccessGrant event schema is owned by the RPC stream contract", async () => {
  const scopedAccessGrantModule = await import("./scoped-access-grant.js")
  const eventRpc = ScopedAccessGrantRpcs.requests.get("ScopedAccessGrant.events.Event")

  expect("ScopedAccessGrantRpcEvents" in scopedAccessGrantModule).toBe(false)
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(ScopedAccessGrantEvent)
    expect(eventRpc.pipe(rpcSupport)).toMatchObject({
      status: "unsupported",
      reason: "host-adapter-unimplemented"
    })
  }

  const eventDoc = ScopedAccessGrantSurface.schemaDocs.find(
    (doc) => doc.tag === "ScopedAccessGrant.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toMatchObject({
    status: "unsupported",
    reason: "host-adapter-unimplemented"
  })
})

test("ScopedAccessGrant declares grant/resolve/revoke as non-callable capability facts", () => {
  const facts = ScopedAccessGrantSurface.schemaDocs.filter((doc) => !doc.callable)
  const factTags = facts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `ScopedAccessGrant.${method}`).toSorted()
  )
  for (const fact of facts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("ScopedAccessGrant capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: ScopedAccessGrantSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`ScopedAccessGrant.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = ScopedAccessGrantSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableTags).toEqual([
        "ScopedAccessGrant.events.Event",
        "ScopedAccessGrant.isSupported"
      ])

      const nonCallableTags = ScopedAccessGrantSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `ScopedAccessGrant.${method}`).toSorted()
      )
    })
  ))

test("ScopedAccessGrant isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeScopedAccessGrantMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* ScopedAccessGrant
          return yield* service.isSupported()
        }),
        Layer.succeed(ScopedAccessGrant)(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("ScopedAccessGrant unsupported client reports the host-adapter-unimplemented reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeScopedAccessGrantUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* ScopedAccessGrant
          return yield* service.isSupported()
        }),
        Layer.succeed(ScopedAccessGrant)(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
    })
  ))

test("ScopedAccessGrant direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const requests: HostProtocolRequestEnvelope[] = []
      const eventPayload = {
        type: "scoped-access-grant-event",
        timestamp: 1_710_000_000_000,
        grantId: "grant-1",
        path: "/tmp/example.txt",
        phase: "granted",
        state: "granted"
      } as const
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
                      payload: eventPayload
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
            nextRequestId: () => "scoped-access-grant-event-rpc",
            nextTraceId: () => "trace-scoped-access-grant-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ScopedAccessGrant
          return yield* client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(ScopedAccessGrantSurface.clientLayer, protocolLayer)
      )

      expect(event).toMatchObject(eventPayload)
      expect(requests.map((request) => request.method)).toEqual(["ScopedAccessGrant.events.Event"])
    })
  ))

test("ScopedAccessGrant bridge client fails event stream as unsupported before subscribing", () =>
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

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ScopedAccessGrant
          return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        ScopedAccessGrantSurface.bridgeClientLayer(exchange)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "ScopedAccessGrant.Event"
        })
      })
      expect(subscriptions).toEqual([])
    })
  ))

test("ScopedAccessGrant rejects contradictory event phase states", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const payload of [
        {
          type: "scoped-access-grant-event",
          timestamp: 1_710_000_000_000,
          grantId: "grant-1",
          path: "/tmp/example.txt",
          phase: "granted",
          state: "revoked"
        },
        {
          type: "scoped-access-grant-event",
          timestamp: 1_710_000_000_000,
          grantId: "grant-1",
          phase: "resolved",
          state: "granted"
        },
        {
          type: "scoped-access-grant-event",
          timestamp: 1_710_000_000_000,
          grantId: "grant-1",
          phase: "revoked",
          state: "resolved"
        }
      ] as const) {
        const decoded = yield* Effect.exit(
          Schema.decodeUnknownEffect(ScopedAccessGrantEvent)(payload)
        )
        expect(Exit.isFailure(decoded)).toBe(true)
      }
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
