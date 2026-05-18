import { expect, test } from "bun:test"
import { HostProtocolInternalError, RpcCapability } from "@effect-desktop/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makeCommandRegistry,
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  type NormalizedCapability,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Fiber, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import {
  ActivationRegistry,
  makeActivationRegistryMemoryClient,
  makeActivationRegistryServiceLayer,
  makeActivationRegistryUnsupportedClient,
  type ActivationRegistryClientApi
} from "./activation-registry.js"
import {
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

test("ActivationRegistry registers surfaces as scoped resources", async () => {
  const rows: AuditEvent[] = []
  const runtime = await configuredRuntime(rows)
  const client = await Effect.runPromise(makeActivationRegistryMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActivationRegistry
      const handle = yield* registry.registerSurface(surfaceRegistration())
      const listed = yield* registry.listSurfaces()
      const resources = yield* runtime.resources.list()
      return { handle, listed, resources }
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

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

test("ActivationRegistry routes activation through CommandRegistry with permission context", async () => {
  const rows: AuditEvent[] = []
  const runtime = await configuredRuntime(rows)
  const client = await Effect.runPromise(makeActivationRegistryMemoryClient())
  const invocations: ActivationCommandInput[] = []

  await Effect.runPromise(
    runtime.commands.registerGroup(
      commandRegistration((input) =>
        Effect.sync(() => {
          invocations.push(input)
          return new ActivationCommandOutput({ ok: true })
        })
      )
    )
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActivationRegistry
      yield* registry.registerSurface(surfaceRegistration())
      const observedFiber = yield* registry
        .events()
        .pipe(
          Stream.filter((event) => event.phase === "routed"),
          Stream.take(1),
          Stream.runHead
        )
        .pipe(Effect.forkChild({ startImmediately: true }))
      const routed = yield* registry.routeActivation(routeRequest())
      const observed = yield* Fiber.join(observedFiber)
      return { routed, observed }
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

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

test("ActivationRegistry rejects malformed registration before client side effects", async () => {
  const runtime = await configuredRuntime([])
  const baseClient = await Effect.runPromise(makeActivationRegistryMemoryClient())
  let calls = 0
  const client: ActivationRegistryClientApi = {
    ...baseClient,
    registerSurface: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.registerSurface(input)))
  }

  const exit = await Effect.runPromise(
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
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "ActivationRegistry.registerSurface"
    })
  })
})

test("ActivationRegistry denies before resource registration and client calls", async () => {
  const rows: AuditEvent[] = []
  const runtime = await configuredRuntime(rows, { declareActivation: false })
  const baseClient = await Effect.runPromise(makeActivationRegistryMemoryClient())
  let calls = 0
  const client: ActivationRegistryClientApi = {
    ...baseClient,
    registerSurface: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.registerSurface(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActivationRegistry
      return yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

  const resources = await Effect.runPromise(runtime.resources.list())
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

test("ActivationRegistry unsupported client returns typed unsupported failures", async () => {
  const runtime = await configuredRuntime([])
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActivationRegistry
      const register = yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
      const unregister = yield* Effect.exit(
        registry.unregisterSurface({ surfaceId: "palette", traceId: "trace-unregister" })
      )
      const list = yield* Effect.exit(registry.listSurfaces())
      return { register, unregister, list }
    }).pipe(
      Effect.provide(
        makeActivationRegistryServiceLayer(makeActivationRegistryUnsupportedClient(), runtime)
      )
    )
  )

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
})

test("ActivationRegistry rejects unknown unregister without supported host side effects", async () => {
  const runtime = await configuredRuntime([])
  const baseClient = await Effect.runPromise(makeActivationRegistryMemoryClient())
  let calls = 0
  const client: ActivationRegistryClientApi = {
    ...baseClient,
    unregisterSurface: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.unregisterSurface(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActivationRegistry
      return yield* Effect.exit(
        registry.unregisterSurface({ surfaceId: "palette", traceId: "trace-unregister" })
      )
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "ActivationRegistry.unregisterSurface"
    })
  })
})

test("ActivationRegistry cleans resource when host registration fails", async () => {
  const runtime = await configuredRuntime([])
  const failure = new HostProtocolInternalError({
    tag: "Internal",
    message: "host failed",
    operation: "ActivationRegistry.registerSurface",
    recoverable: false
  })
  const client = await Effect.runPromise(
    makeActivationRegistryMemoryClient({ failure: { registerSurface: failure } })
  )

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActivationRegistry
      return yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

  const resources = await Effect.runPromise(runtime.resources.list())
  expect(resources.entries).toHaveLength(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Internal",
      operation: "ActivationRegistry.registerSurface"
    })
  })
})

test("ActivationRegistry unregisters host when committed registration output is invalid", async () => {
  const runtime = await configuredRuntime([])
  const baseClient = await Effect.runPromise(makeActivationRegistryMemoryClient())
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

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActivationRegistry
      return yield* Effect.exit(registry.registerSurface(surfaceRegistration()))
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

  const resources = await Effect.runPromise(runtime.resources.list())
  expect(unregisterCalls).toBe(1)
  expect(resources.entries).toHaveLength(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Internal",
      operation: "ActivationRegistry.registerSurface"
    })
  })
})

test("ActivationRegistry resource disposal removes the surface and unregisters the host", async () => {
  const runtime = await configuredRuntime([])
  const baseClient = await Effect.runPromise(makeActivationRegistryMemoryClient())
  let unregisterCalls = 0
  const client: ActivationRegistryClientApi = {
    ...baseClient,
    unregisterSurface: (input) =>
      Effect.sync(() => {
        unregisterCalls += 1
      }).pipe(Effect.andThen(baseClient.unregisterSurface(input)))
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActivationRegistry
      const handle = yield* registry.registerSurface(surfaceRegistration())
      yield* runtime.resources.dispose(handle.id)
      const listed = yield* registry.listSurfaces()
      const resources = yield* runtime.resources.list()
      return { listed, resources }
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

  expect(unregisterCalls).toBe(1)
  expect(result.listed.surfaces).toHaveLength(0)
  expect(result.resources.entries).toHaveLength(0)
})

test("ActivationRegistry rejects actor and permission context mismatches before command side effects", async () => {
  const runtime = await configuredRuntime([])
  const client = await Effect.runPromise(makeActivationRegistryMemoryClient())
  let calls = 0

  await Effect.runPromise(
    runtime.commands.registerGroup(
      commandRegistration((input) =>
        Effect.sync(() => {
          calls += 1
          return new ActivationCommandOutput({ ok: input.opened })
        })
      )
    )
  )

  const exit = await Effect.runPromise(
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
    }).pipe(Effect.provide(makeActivationRegistryServiceLayer(client, runtime)))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "ActivationRegistry.routeActivation"
    })
  })
})

const configuredRuntime = async (
  rows: AuditEvent[],
  options: { readonly declareActivation?: boolean } = {}
) => {
  const audit = memoryAudit(rows)
  const permissions = await Effect.runPromise(makePermissionRegistry({ audit }))
  const resources = await Effect.runPromise(makeResourceRegistry())
  const commands = await Effect.runPromise(makeCommandRegistry(resources, permissions, { audit }))
  const declareActivation = options.declareActivation ?? true
  await Effect.runPromise(
    Effect.all([
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
  )
  rows.length = 0
  return { permissions, resources, commands, audit }
}

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

const expectExitFailure = <A>(exit: Exit.Exit<A, unknown>, assert: (error: unknown) => void) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
