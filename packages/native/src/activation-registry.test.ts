import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolInternalError,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  RpcCapability,
  rpcSupport
} from "@orika/bridge"
import {
  AuditEvents,
  type AuditEvent,
  type AuditEventsApi,
  CommandRegistry,
  makeCommandRegistry,
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  type NormalizedCapability,
  P,
  PermissionRegistry,
  type PermissionRegistryApi,
  ResourceRegistry,
  type ResourceRegistryApi
} from "@orika/core"
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Schema,
  Stream
} from "effect"
import { Rpc, RpcClient, RpcGroup, RpcSchema } from "effect/unstable/rpc"

import {
  ActivationRegistry,
  ActivationRegistryClient,
  type ActivationRegistryClientApi,
  ActivationRegistryMethodNames,
  ActivationRegistryRpcs,
  ActivationRegistrySurface,
  makeActivationRegistryMemoryClient,
  makeActivationRegistryUnsupportedClient
} from "./activation-registry.js"
import {
  ActivationEvent,
  ActivationActor,
  ActivationPermissionContext,
  ActivationRouteRequest,
  ActivationSurfaceRegistration
} from "./contracts/activation-registry.js"

class ActivationCommandInput extends Schema.Class<ActivationCommandInput>("ActivationCommandInput")(
  {
    opened: Schema.Boolean
  }
) {}

class ActivationCommandOutput extends Schema.Class<ActivationCommandOutput>(
  "ActivationCommandOutput"
)({
  ok: Schema.Boolean
}) {}

const commandCapability: NormalizedCapability = P.nativeInvoke({
  primitive: "ActivationCommand",
  methods: ["open"]
})

const activationCommand = Rpc.make("activation.open", {
  payload: ActivationCommandInput,
  success: ActivationCommandOutput,
  error: Schema.Unknown
}).pipe(RpcCapability(commandCapability))
const activationCommandGroup = RpcGroup.make(activationCommand)

test("ActivationRegistry public surface omits shallow client and bridge layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("activation-registry.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      expect(source).not.toContain("makeActivationRegistryClientLayer")
      expect(source).not.toContain("makeActivationRegistryBridgeClientLayer")
      expect(source).not.toContain("makeActivationRegistryServiceLayer")
      expect(source).not.toContain("ActivationRegistryLive")
      expect(source).not.toContain("ActivationRegistryRpcEvents")
      expect(indexSource).not.toContain("makeActivationRegistryClientLayer")
      expect(indexSource).not.toContain("makeActivationRegistryBridgeClientLayer")
      expect(indexSource).not.toContain("makeActivationRegistryServiceLayer")
      expect(indexSource).not.toContain("ActivationRegistryLive")
      expect(indexSource).not.toContain("ActivationRegistryRpcEvents")
    })
  ))

test("ActivationRegistry event schema is owned by the RPC stream contract", async () => {
  const activationRegistryModule = await import("./activation-registry.js")
  const rootModule = await import("./index.js")
  const callableTags = Array.from(ActivationRegistryRpcs.requests.keys()).toSorted()
  const eventRpc = ActivationRegistryRpcs.requests.get("ActivationRegistry.events.Event")

  expect("ActivationRegistryRpcEvents" in activationRegistryModule).toBe(false)
  expect("ActivationRegistryRpcEvents" in rootModule).toBe(false)
  expect([...ActivationRegistryMethodNames]).toEqual([
    "registerSurface",
    "unregisterSurface",
    "listSurfaces",
    "isSupported"
  ])
  expect(callableTags).toEqual([
    "ActivationRegistry.events.Event",
    "ActivationRegistry.isSupported",
    "ActivationRegistry.listSurfaces",
    "ActivationRegistry.registerSurface",
    "ActivationRegistry.unregisterSurface"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(ActivationEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }

  const eventDoc = ActivationRegistrySurface.schemaDocs.find(
    (doc) => doc.tag === "ActivationRegistry.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual({ status: "supported" })
})

test("ActivationRegistry direct client consumes the canonical RPC event stream", () =>
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
                      timestamp: 1_710_000_000_001,
                      traceId: envelope.traceId,
                      payload: activationEventPayload()
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
            nextRequestId: () => "activation-registry-event-rpc",
            nextTraceId: () => "trace-activation-registry-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const activation = yield* ActivationRegistryClient
          return yield* activation.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(ActivationRegistrySurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(expectedActivationEvent())
      expect(requests.map((request) => request.method)).toEqual(["ActivationRegistry.events.Event"])
    })
  ))

test("ActivationRegistry registers surfaces as scoped resources", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const fixture = yield* configuredRuntime(rows)
      const client = yield* makeActivationRegistryMemoryClient()

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            const handle = yield* registry.registerSurface(surfaceRegistration())
            const listed = yield* registry.listSurfaces()
            const resources = yield* fixture.resources.list()
            return { handle, listed, resources }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.handle).toMatchObject({
        kind: "activation-surface",
        id: "palette",
        generation: 0,
        ownerScope: "workspace:workspace-1",
        state: "registered"
      })
      expect(result.listed.surfaces.map((entry) => entry.surfaceId)).toEqual(["palette"])
      expect(result.resources.entries).toHaveLength(1)
      expect(rows.some((row) => row.outcome === "registered")).toBe(true)
    })
  ))

test("ActivationRegistry routes activation through CommandRegistry with permission context", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const fixture = yield* configuredRuntime(rows)
      const client = yield* makeActivationRegistryMemoryClient()
      const invocations: ActivationCommandInput[] = []

      yield* fixture.commands.registerGroup(
        commandRegistration((input) =>
          Effect.sync(() => {
            invocations.push(input)
            return new ActivationCommandOutput({ ok: true })
          })
        )
      )

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            yield* registry.registerSurface(surfaceRegistration())
            const observedFiber = yield* registry.events().pipe(
              Stream.filter((event) => event.phase === "routed"),
              Stream.take(1),
              Stream.runHead,
              Effect.forkChild({ startImmediately: true })
            )
            const routed = yield* registry.routeActivation(routeRequest())
            const observed = yield* Fiber.join(observedFiber)
            return { routed, observed }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.routed).toEqual({
        surfaceId: "palette",
        commandId: "activation.open",
        routed: true
      })
      expect(invocations).toEqual([new ActivationCommandInput({ opened: true })])
      expect(result.observed._tag).toBe("Some")
      if (result.observed._tag === "Some") {
        expect(result.observed.value).toMatchObject({
          phase: "routed",
          source: "global-shortcut",
          payload: { opened: true },
          actor: { kind: "window", id: "window-1" },
          traceId: "route-1",
          permissionContext: {
            actor: { kind: "window", id: "window-1" },
            traceId: "route-1"
          }
        })
      }
      expect(rows.some((row) => row.kind === "command-invoked")).toBe(true)
    })
  ))

test("ActivationRegistry events reject inconsistent failure reasons", () => {
  for (const payload of [
    {
      ...eventBase(),
      phase: "registered",
      reason: "host failed"
    },
    {
      ...eventBase(),
      phase: "routed",
      reason: "host failed"
    },
    {
      ...eventBase(),
      phase: "unregistered",
      reason: "host failed"
    },
    {
      ...eventBase(),
      phase: "failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(ActivationEvent)(payload))
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const payload of [
    {
      ...eventBase(),
      phase: "registered"
    },
    {
      ...eventBase(),
      phase: "routed"
    },
    {
      ...eventBase(),
      phase: "unregistered"
    },
    {
      ...eventBase(),
      phase: "failed",
      reason: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(ActivationEvent)(payload))
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("ActivationRegistry rejects malformed registration before client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* configuredRuntime([])
      const baseClient = yield* makeActivationRegistryMemoryClient()
      let calls = 0
      const client: ActivationRegistryClientApi = {
        ...baseClient,
        registerSurface: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.registerSurface(input)))
      }

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            return yield* Effect.exit(
              registry.registerSurface({
                surfaceId: "",
                source: "global-shortcut",
                commandId: "activation.open",
                actor: actor()
              })
            )
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ActivationRegistry.registerSurface"
        })
      })
    })
  ))

test("ActivationRegistry denies before resource registration and client calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const fixture = yield* configuredRuntime(rows, { declareActivation: false })
      const baseClient = yield* makeActivationRegistryMemoryClient()
      let calls = 0
      const client: ActivationRegistryClientApi = {
        ...baseClient,
        registerSurface: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.registerSurface(input)))
      }

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            return yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      const resources = yield* fixture.resources.list()
      expect(calls).toBe(0)
      expect(resources.entries).toHaveLength(0)
      expect(rows.some((row) => row.kind === "permission-denied")).toBe(true)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "ActivationRegistry.registerSurface"
        })
      })
    })
  ))

test("ActivationRegistry unsupported client returns typed unsupported failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* configuredRuntime([])
      const runtime = ManagedRuntime.make(
        activationRegistryLayer(makeActivationRegistryUnsupportedClient(), fixture)
      )
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            const register = yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
            const unregister = yield* Effect.exit(
              registry.unregisterSurface({ surfaceId: "palette", traceId: "trace-unregister" })
            )
            const list = yield* Effect.exit(registry.listSurfaces())
            const event = yield* Effect.exit(registry.events().pipe(Stream.runHead))
            return { event, list, register, unregister }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expectExitFailure(result.register, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "ActivationRegistry.registerSurface"
        })
      })
      expectExitFailure(result.unregister, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "ActivationRegistry.unregisterSurface"
        })
      })
      expectExitFailure(result.list, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "ActivationRegistry.listSurfaces"
        })
      })
      expectExitFailure(result.event, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "ActivationRegistry.events.Event"
        })
      })
    })
  ))

test("ActivationRegistry bridge client subscribes to the host event channel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const methods: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("ActivationRegistry event channel test does not issue requests"),
        subscribe: (method) => {
          methods.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1_710_000_000_003,
              traceId: "activation-registry-host-event",
              method,
              payload: activationEventPayload()
            })
          )
        }
      }
      const client = yield* runScoped(
        Effect.gen(function* () {
          return yield* ActivationRegistryClient
        }),
        ActivationRegistrySurface.bridgeClientLayer(exchange)
      )
      const event = yield* client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))

      expect(event).toEqual(expectedActivationEvent())
      expect(methods).toEqual(["ActivationRegistry.Event"])
    })
  ))

test("ActivationRegistry rejects unknown unregister without supported host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* configuredRuntime([])
      const baseClient = yield* makeActivationRegistryMemoryClient()
      let calls = 0
      const client: ActivationRegistryClientApi = {
        ...baseClient,
        unregisterSurface: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.unregisterSurface(input)))
      }

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            return yield* Effect.exit(
              registry.unregisterSurface({ surfaceId: "palette", traceId: "trace-unregister" })
            )
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ActivationRegistry.unregisterSurface"
        })
      })
    })
  ))

test("ActivationRegistry cleans resource when host registration fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* configuredRuntime([])
      const failure = new HostProtocolInternalError({
        tag: "Internal",
        message: "host failed",
        operation: "ActivationRegistry.registerSurface",
        recoverable: false
      })
      const client = yield* makeActivationRegistryMemoryClient({
        failure: { registerSurface: failure }
      })

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            return yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      const resources = yield* fixture.resources.list()
      expect(resources.entries).toHaveLength(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "ActivationRegistry.registerSurface"
        })
      })
    })
  ))

test("ActivationRegistry unregisters host when committed registration output is invalid", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* configuredRuntime([])
      const baseClient = yield* makeActivationRegistryMemoryClient()
      let unregisterCalls = 0
      const client: ActivationRegistryClientApi = {
        ...baseClient,
        registerSurface: (input) =>
          baseClient.registerSurface(input).pipe(
            Effect.map((handle) => ({
              ...handle,
              id: makeResourceId("wrong-surface")
            }))
          ),
        unregisterSurface: (input) =>
          Effect.sync(() => {
            unregisterCalls += 1
          }).pipe(Effect.andThen(baseClient.unregisterSurface(input)))
      }

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            return yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      const resources = yield* fixture.resources.list()
      expect(unregisterCalls).toBe(1)
      expect(resources.entries).toHaveLength(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "ActivationRegistry.registerSurface"
        })
      })
    })
  ))

test("ActivationRegistry resource disposal removes the surface and unregisters the host", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* configuredRuntime([])
      const baseClient = yield* makeActivationRegistryMemoryClient()
      let unregisterCalls = 0
      const client: ActivationRegistryClientApi = {
        ...baseClient,
        unregisterSurface: (input) =>
          Effect.sync(() => {
            unregisterCalls += 1
          }).pipe(Effect.andThen(baseClient.unregisterSurface(input)))
      }

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            const handle = yield* registry.registerSurface(surfaceRegistration())
            yield* fixture.resources.dispose(handle.id)
            const listed = yield* registry.listSurfaces()
            const resources = yield* fixture.resources.list()
            return { listed, resources }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(unregisterCalls).toBe(1)
      expect(result.listed.surfaces).toHaveLength(0)
      expect(result.resources.entries).toHaveLength(0)
    })
  ))

test("ActivationRegistry rejects actor and permission context mismatches before command side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* configuredRuntime([])
      const client = yield* makeActivationRegistryMemoryClient()
      let calls = 0

      yield* fixture.commands.registerGroup(
        commandRegistration((input) =>
          Effect.sync(() => {
            calls += 1
            return new ActivationCommandOutput({ ok: input.opened })
          })
        )
      )

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            yield* registry.registerSurface(surfaceRegistration())
            return yield* Effect.exit(
              registry.routeActivation(
                new ActivationRouteRequest({
                  surfaceId: "palette",
                  payload: { opened: true },
                  actor: new ActivationActor({ kind: "window", id: "window-1" }),
                  traceId: "route-1",
                  permissionContext: new ActivationPermissionContext({
                    actor: new ActivationActor({ kind: "window", id: "window-2" }),
                    traceId: "route-1"
                  })
                })
              )
            )
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ActivationRegistry.routeActivation"
        })
      })
    })
  ))

test("ActivationRegistry rejects duplicate surface registration without destroying the original", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* configuredRuntime([])
      const client = yield* makeActivationRegistryMemoryClient()

      const runtime = ManagedRuntime.make(activationRegistryLayer(client, fixture))
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ActivationRegistry
            const first = yield* registry.registerSurface(surfaceRegistration())
            const exit = yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
            const listed = yield* registry.listSurfaces()
            const resources = yield* fixture.resources.list()
            return { first, exit, listed, resources }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.first.id).toBe(makeResourceId("palette"))
      expectExitFailure(result.exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          field: "surfaceId",
          operation: "ActivationRegistry.registerSurface"
        })
      })
      expect(result.listed.surfaces.map((entry) => entry.surfaceId)).toEqual(["palette"])
      expect(result.resources.entries).toHaveLength(1)
    })
  ))

const configuredRuntime = (
  rows: AuditEvent[],
  options: { readonly declareActivation?: boolean } = {}
) =>
  Effect.gen(function* () {
    const audit = memoryAudit(rows)
    const permissions = yield* makePermissionRegistry({ audit })
    const resources = yield* makeResourceRegistry()
    const commands = yield* makeCommandRegistry(resources, permissions, { audit })
    const declareActivation = options.declareActivation ?? true
    yield* Effect.all([
      ...(declareActivation
        ? [
            permissions.declare(
              P.nativeInvoke({ primitive: "ActivationRegistry", methods: ["registerSurface"] })
            ),
            permissions.declare(
              P.nativeInvoke({ primitive: "ActivationRegistry", methods: ["unregisterSurface"] })
            )
          ]
        : []),
      permissions.declare(commandCapability)
    ])
    rows.length = 0
    return { permissions, resources, commands, audit }
  })

interface ActivationRegistryFixture {
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
  readonly commands: CommandRegistry["Service"]
  readonly audit: AuditEventsApi
}

const activationRegistryLayer = (
  client: ActivationRegistryClientApi,
  fixture: ActivationRegistryFixture
): Layer.Layer<ActivationRegistry> =>
  Layer.provide(
    ActivationRegistry.layer,
    Layer.mergeAll(
      Layer.succeed(ActivationRegistryClient)(client),
      Layer.succeed(PermissionRegistry)(fixture.permissions),
      Layer.succeed(ResourceRegistry)(fixture.resources),
      Layer.succeed(CommandRegistry)(fixture.commands),
      Layer.succeed(AuditEvents)(fixture.audit)
    )
  )

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const commandRegistration = (
  handler: (input: ActivationCommandInput) => Effect.Effect<ActivationCommandOutput, unknown, never>
) => ({
  group: activationCommandGroup,
  ownerScope: "workspace:workspace-1",
  handlers: activationCommandGroup.toLayer(Effect.succeed({ "activation.open": handler }))
})

const actor = () => new ActivationActor({ kind: "workspace", id: "workspace-1" })

const eventBase = () => ({
  type: "activation-registry-event",
  timestamp: 1_710_000_000_000,
  surfaceId: "palette",
  source: "global-shortcut",
  payload: { surfaceId: "palette" },
  actor: { kind: "workspace", id: "workspace-1" },
  traceId: "trace-1",
  permissionContext: {
    actor: { kind: "workspace", id: "workspace-1" },
    traceId: "trace-1"
  }
})

const surfaceRegistration = () =>
  new ActivationSurfaceRegistration({
    surfaceId: "palette",
    source: "global-shortcut",
    commandId: "activation.open",
    actor: actor(),
    traceId: "register-1"
  })

const routeRequest = () =>
  new ActivationRouteRequest({
    surfaceId: "palette",
    payload: { opened: true },
    actor: new ActivationActor({ kind: "window", id: "window-1" }),
    traceId: "route-1",
    permissionContext: new ActivationPermissionContext({
      actor: new ActivationActor({ kind: "window", id: "window-1" }),
      traceId: "route-1"
    })
  })

const activationEventPayload = () => Schema.encodeSync(ActivationEvent)(expectedActivationEvent())

const expectedActivationEvent = () =>
  new ActivationEvent({
    type: "activation-registry-event",
    timestamp: 1_710_000_000_000,
    phase: "registered",
    surfaceId: "palette",
    source: "global-shortcut",
    payload: { surfaceId: "palette" },
    actor: new ActivationActor({ kind: "workspace", id: "workspace-1" }),
    traceId: "trace-1",
    permissionContext: new ActivationPermissionContext({
      actor: new ActivationActor({ kind: "workspace", id: "workspace-1" }),
      traceId: "trace-1"
    })
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
