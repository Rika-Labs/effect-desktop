import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolInternalError,
  HostProtocolInvalidOutputError,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  type NormalizedCapability,
  P
} from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import {
  DistributionParity,
  DistributionParityClient,
  type DistributionParityClientApi,
  DistributionParityMethodNames,
  DistributionParityRpcs,
  makeDistributionParityMemoryClient,
  makeDistributionParityServiceLayer,
  makeDistributionParityUnsupportedClient,
  DistributionParitySurface
} from "./distribution-parity.js"
import {
  DistributionParityEvidence,
  DistributionParityEvent,
  DistributionParityVerifyRequest
} from "./contracts/distribution-parity.js"

const expectedDistributionParityMethods: Array<(typeof DistributionParityMethodNames)[number]> = [
  "verify",
  "isSupported"
]

test("DistributionParity event schema is owned by the RPC stream contract", async () => {
  const distributionParityModule = await import("./distribution-parity.js")
  const rootModule = await import("./index.js")
  const eventRpc = DistributionParityRpcs.requests.get("DistributionParity.events.Event")

  expect("DistributionParityRpcEvents" in distributionParityModule).toBe(false)
  expect("DistributionParityRpcEvents" in rootModule).toBe(false)
  expect(Array.from(DistributionParityRpcs.requests.keys())).toEqual([
    ...expectedDistributionParityMethods.map((method) => `DistributionParity.${method}`),
    "DistributionParity.events.Event"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(Object.is(eventRpc.successSchema.success, DistributionParityEvent)).toBe(true)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }
})

test("DistributionParity direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
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
                      timestamp: 1_710_000_000_100,
                      traceId: envelope.traceId,
                      payload: distributionEventPayload()
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolResponseEnvelope({
                      kind: "response",
                      id: envelope.id,
                      timestamp: 1_710_000_000_101,
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
            nextRequestId: () => "distribution-parity-event-rpc",
            nextTraceId: () => "trace-distribution-parity-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParityClient
          return yield* parity.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(DistributionParitySurface.clientLayer, protocolLayer)
      )

      expect(event.packageId).toBe("extension-1")
      expect(event.version).toBe("1.0.0")
      expect(event.phase).toBe("verified")
      expect(requests.map((request) => request.method)).toEqual(["DistributionParity.events.Event"])
    })
  ))

test("DistributionParity verifies package, plugin, template, and docs evidence", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions()
      const client = yield* makeDistributionParityMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          const verified = yield* parity.verify(verifyRequest())
          const event = yield* parity.events().pipe(Stream.runHead)
          return { event, verified }
        }),
        makeDistributionParityServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows)
        })
      )

      expect(result.verified).toMatchObject({
        packageId: "extension-1",
        version: "1.0.0",
        capabilityCount: 1,
        evidenceCount: 4
      })
      expect(result.event._tag).toBe("Some")
      expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
    })
  ))

test("DistributionParity contracts reject inconsistent event phase payloads", () => {
  for (const payload of [
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "verified",
      packageId: "extension-1"
    },
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "verified",
      packageId: "extension-1",
      version: "1.0.0",
      reason: "host failed"
    },
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      packageId: "extension-1",
      version: "1.0.0"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(DistributionParityEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "verified",
      packageId: "extension-1",
      version: "1.0.0"
    },
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      packageId: "extension-1",
      version: "1.0.0",
      reason: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(DistributionParityEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("DistributionParity bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("DistributionParity event test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "distribution-parity-event-trace",
              payload: {
                type: "distribution-parity-event",
                timestamp: 1_710_000_000_000,
                phase: "verified",
                packageId: "extension-1",
                reason: "bad shape"
              }
            })
          )
      }
      const permissions = yield* configuredPermissions()
      const client = yield* runScoped(
        Effect.gen(function* () {
          return yield* DistributionParityClient
        }),
        DistributionParitySurface.bridgeClientLayer(exchange)
      )

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(
            parity.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        makeDistributionParityServiceLayer(client, { permissions })
      )

      expectInvalidOutput(exit)
    })
  ))

test("DistributionParity bridge client subscribes to the host event channel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const methods: string[] = []
      const exchange: BridgeClientExchange = {
        request: () =>
          Effect.die("DistributionParity bridge event channel test does not issue requests"),
        subscribe: (method) => {
          methods.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "distribution-parity-event-trace",
              payload: distributionEventPayload()
            })
          )
        }
      }
      const client = yield* runScoped(
        Effect.gen(function* () {
          return yield* DistributionParityClient
        }),
        DistributionParitySurface.bridgeClientLayer(exchange)
      )
      const event = yield* client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))

      expect(event.phase).toBe("verified")
      expect(methods).toEqual(["DistributionParity.Event"])
    })
  ))

test("DistributionParity denies before host verification", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* makePermissionRegistry()
      const baseClient = yield* makeDistributionParityMemoryClient()
      let calls = 0
      const client: DistributionParityClientApi = {
        ...baseClient,
        verify: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.verify(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(parity.verify(verifyRequest()))
        }),
        makeDistributionParityServiceLayer(client, { permissions, audit: memoryAudit(rows) })
      )

      expect(calls).toBe(0)
      expect(rows.some((row) => row.kind === "permission-denied")).toBe(true)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "DistributionParity.verify"
        })
      })
    })
  ))

test("DistributionParity rejects mismatched capability evidence before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: {
              packageId: "extension-1",
              version: "1.0.0",
              capabilityCount: 1,
              evidenceCount: 4
            }
          })
        },
        subscribe: () => Stream.empty
      }

      const permissions = yield* configuredPermissions()
      const client = yield* runScoped(
        Effect.gen(function* () {
          const c = yield* DistributionParityClient
          return c
        }),
        DistributionParitySurface.bridgeClientLayer(exchange)
      )

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(
            parity.verify(
              verifyRequest({
                evidence: [
                  evidence("package-artifact"),
                  evidence("plugin-registration"),
                  evidence("template", [P.filesystemWrite({ roots: ["/tmp/extensions"] })]),
                  evidence("docs")
                ]
              })
            )
          )
        }),
        makeDistributionParityServiceLayer(client, { permissions, audit: memoryAudit(rows) })
      )

      expect(requests).toEqual([])
      expect(rows.some((row) => row.kind === "permission-used" && row.outcome === "failed")).toBe(
        true
      )
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "DistributionParity.verify"
        })
      })
    })
  ))

test("DistributionParity returns typed unsupported and host failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const unsupported = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(parity.verify(verifyRequest()))
        }),
        makeDistributionParityServiceLayer(makeDistributionParityUnsupportedClient(), {
          permissions
        })
      )
      expectExitFailure(unsupported, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "DistributionParity.verify" })
      })
      const unsupportedEvent = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(parity.events().pipe(Stream.runHead))
        }),
        makeDistributionParityServiceLayer(makeDistributionParityUnsupportedClient(), {
          permissions
        })
      )
      expectExitFailure(unsupportedEvent, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "DistributionParity.events.Event"
        })
      })

      const rows: AuditEvent[] = []
      const failure = new HostProtocolInternalError({
        tag: "Internal",
        operation: "DistributionParity.verify",
        message: "host failed",
        recoverable: false
      })
      const failing = yield* makeDistributionParityMemoryClient({ failure: { verify: failure } })
      const failed = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(parity.verify(verifyRequest()))
        }),
        makeDistributionParityServiceLayer(failing, { permissions, audit: memoryAudit(rows) })
      )
      expect(rows.some((row) => row.kind === "permission-used" && row.outcome === "failed")).toBe(
        true
      )
      expectExitFailure(failed, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "DistributionParity.verify" })
      })
    })
  ))

const configuredPermissions = () =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* permissions.declare(
      P.nativeInvoke({ primitive: "DistributionParity", methods: ["verify"] })
    )
    return permissions
  })

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const capability = (): NormalizedCapability => P.filesystemRead({ roots: ["/tmp/extensions"] })

const evidence = (kind: DistributionParityEvidence["kind"], capabilities = [capability()]) =>
  new DistributionParityEvidence({
    kind,
    id: kind,
    path: `docs/${kind}.md`,
    sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    capabilities
  })

const verifyRequest = (input: Partial<DistributionParityVerifyRequest> = {}) =>
  new DistributionParityVerifyRequest({
    packageId: "extension-1",
    version: "1.0.0",
    capabilities: [capability()],
    evidence: [
      evidence("package-artifact"),
      evidence("plugin-registration"),
      evidence("template"),
      evidence("docs")
    ],
    traceId: "trace-distribution",
    ...input
  })

const distributionEventPayload = () => ({
  type: "distribution-parity-event" as const,
  timestamp: 1_710_000_000_000,
  phase: "verified" as const,
  packageId: "extension-1",
  version: "1.0.0"
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

const expectExitFailure = <A>(exit: Exit.Exit<A, unknown>, assert: (error: unknown) => void) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
