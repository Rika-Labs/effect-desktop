import {
  decodeHostProtocolEnvelope,
  makeDesktopClientProtocol,
  type DesktopProtocolOptions,
  type HostProtocolEnvelope,
  type DesktopTransportRun,
  type DesktopTransportSend
} from "@orika/bridge"
import { Clock, Context, Effect, Exit, Layer, Queue, Scope, Stream } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcTest } from "effect/unstable/rpc"

import type {
  AnyDesktopRpcRegistrationGroup,
  AnyDesktopRpcRegistration,
  DesktopAppManifest,
  DesktopRpcsLayer
} from "./renderer-types.js"
import {
  makeMissingDesktopRpcClientError,
  RendererRpcError,
  type DesktopFramework,
  type MissingDesktopRpcClientError
} from "./desktop-errors.js"
import {
  disabledRendererInspectorCollector,
  RendererInspectorEvent,
  type RendererInspectorCollectorApi
} from "./inspector-events.js"

export type DesktopRendererRpcTransport = DesktopTransportSend & DesktopTransportRun

export type DesktopRendererRpcClientMethod = (
  input: unknown
) =>
  | Effect.Effect<unknown, RendererRpcError, never>
  | Stream.Stream<unknown, RendererRpcError, never>

export type DesktopRendererRpcClient = Readonly<Record<string, DesktopRendererRpcClientMethod>>

export type DesktopRendererRpcClientMap = ReadonlyMap<RpcGroup.Any, DesktopRendererRpcClient>

type DesktopRendererRpcFlatClient = RpcClient.RpcClient.Flat<Rpc.AnyWithProps, unknown>
type DesktopRendererRpcScopedResult =
  | Effect.Effect<unknown, RendererRpcError, Scope.Scope>
  | Stream.Stream<unknown, RendererRpcError, Scope.Scope>

export interface RendererRpcClientsApi {
  readonly clients: DesktopRendererRpcClientMap
}

export class RendererRpcClients extends Context.Service<
  RendererRpcClients,
  RendererRpcClientsApi
>()("@orika/core/runtime/renderer-rpc-client/RendererRpcClients") {}

export class RendererRpcTransport extends Context.Service<
  RendererRpcTransport,
  DesktopRendererRpcTransport
>()("@orika/core/runtime/renderer-rpc-client/RendererRpcTransport") {}

export interface DesktopRendererRpcClientLayerOptions extends DesktopProtocolOptions {
  readonly framework: DesktopFramework
  readonly inspector?: RendererInspectorCollectorApi | undefined
}

export interface DesktopRendererRpcLayerOptions extends DesktopRendererRpcClientLayerOptions {
  readonly transport?: DesktopRendererRpcTransport | undefined
  readonly rpcs?: DesktopRpcsLayer<never, unknown, never> | undefined
}

const GlobalTransportKey = "__EFFECT_DESKTOP_RPC_TRANSPORT__"
const HostInstalledTransportKey = "__ORIKA_HOST_RPC_TRANSPORT__"

interface HostInstalledRendererRpcTransport {
  readonly send: (envelope: HostProtocolEnvelope) => void
  readonly subscribe: (listener: (envelope: unknown) => void) => () => void
}

export const makeDesktopRendererRpcLayer = (
  app: DesktopAppManifest,
  options: DesktopRendererRpcLayerOptions
): Layer.Layer<RendererRpcClients, MissingDesktopRpcClientError, never> => {
  if (options.rpcs !== undefined) {
    return makeDesktopRendererRpcTestLayer(options.rpcs, {
      framework: options.framework,
      inspector: options.inspector
    })
  }

  if (app.rpcGroups.length === 0) {
    return Layer.succeed(RendererRpcClients)({
      clients: new Map<RpcGroup.Any, DesktopRendererRpcClient>()
    })
  }

  const transport = options.transport
  const transportLayer =
    transport === undefined
      ? missingRendererRpcTransportLayer(options.framework)
      : Layer.succeed(RendererRpcTransport)(transport)

  return Layer.provide(makeDesktopRendererRpcClientLayer(app, options), transportLayer)
}

export const makeDesktopRendererRpcClientLayer = (
  app: DesktopAppManifest,
  options: DesktopRendererRpcClientLayerOptions
): Layer.Layer<RendererRpcClients, never, RendererRpcTransport> => {
  if (app.rpcGroups.length === 0) {
    return Layer.succeed(RendererRpcClients)({
      clients: new Map<RpcGroup.Any, DesktopRendererRpcClient>()
    })
  }

  return Layer.effect(RendererRpcClients)(acquireDesktopRendererRpcClients(app, options))
}

export const setGlobalDesktopRendererRpcTransport = (
  transport: DesktopRendererRpcTransport | undefined
): void => {
  const target = globalThis as typeof globalThis & {
    [GlobalTransportKey]?: DesktopRendererRpcTransport | undefined
  }
  if (transport === undefined) {
    delete target[GlobalTransportKey]
    return
  }
  target[GlobalTransportKey] = transport
}

export const getGlobalDesktopRendererRpcTransport = (): DesktopRendererRpcTransport | undefined => {
  const explicitTransport = (
    globalThis as typeof globalThis & {
      [GlobalTransportKey]?: DesktopRendererRpcTransport | undefined
    }
  )[GlobalTransportKey]
  if (explicitTransport !== undefined) {
    return explicitTransport
  }

  const hostInstalledTransport = (
    globalThis as typeof globalThis & {
      [HostInstalledTransportKey]?: HostInstalledRendererRpcTransport | undefined
    }
  )[HostInstalledTransportKey]
  return makeHostInstalledRendererRpcTransport(hostInstalledTransport)
}

export const makeDesktopRendererRpcTransportLayer = (
  transport: DesktopRendererRpcTransport
): Layer.Layer<RendererRpcTransport, never, never> => Layer.succeed(RendererRpcTransport)(transport)

export const makeDesktopRendererRpcTestLayer = (
  rpcs: DesktopRpcsLayer<never, unknown, never>,
  options: {
    readonly framework?: DesktopFramework | undefined
    readonly inspector?: RendererInspectorCollectorApi | undefined
  } = {}
): Layer.Layer<RendererRpcClients, never, never> =>
  Layer.effect(RendererRpcClients)(
    acquireDesktopRendererRpcTestClients(rpcs, options.framework ?? "unknown", options.inspector)
  )

const missingRendererRpcTransportLayer = (
  framework: DesktopFramework
): Layer.Layer<RendererRpcTransport, MissingDesktopRpcClientError, never> =>
  Layer.effect(RendererRpcTransport)(
    Effect.fail(
      makeMissingDesktopRpcClientError(
        framework,
        "desktop.rpc",
        "No desktop RPC transport is installed for this renderer"
      )
    )
  )

const makeHostInstalledRendererRpcTransport = (
  transport: HostInstalledRendererRpcTransport | undefined
): DesktopRendererRpcTransport | undefined => {
  if (!isHostInstalledRendererRpcTransport(transport)) {
    return undefined
  }

  return Object.freeze({
    send: (envelope) => Effect.sync(() => transport.send(envelope)),
    run: (onEnvelope) =>
      Stream.callback<HostProtocolEnvelope>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            transport.subscribe((input) => {
              Queue.offerUnsafe(queue, decodeHostProtocolEnvelope(input))
            })
          ),
          (unsubscribe) => Effect.sync(unsubscribe)
        )
      ).pipe(Stream.runForEach(onEnvelope), Effect.andThen(Effect.never))
  } satisfies DesktopRendererRpcTransport)
}

const isHostInstalledRendererRpcTransport = (
  value: unknown
): value is HostInstalledRendererRpcTransport =>
  typeof value === "object" &&
  value !== null &&
  "send" in value &&
  "subscribe" in value &&
  typeof value.send === "function" &&
  typeof value.subscribe === "function"

const acquireDesktopRendererRpcClients = (
  app: DesktopAppManifest,
  options: DesktopRendererRpcClientLayerOptions
): Effect.Effect<RendererRpcClientsApi, never, RendererRpcTransport | Scope.Scope> =>
  Effect.gen(function* () {
    const transport = yield* Effect.service(RendererRpcTransport)
    const protocol = yield* makeDesktopClientProtocol(transport, {
      ...(options.windowId === undefined ? {} : { windowId: options.windowId }),
      ...(options.originToken === undefined ? {} : { originToken: options.originToken }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.nextTraceId === undefined ? {} : { nextTraceId: options.nextTraceId })
    })
    const clients = new Map<RpcGroup.Any, DesktopRendererRpcClient>()
    for (const descriptor of app.rpcGroups) {
      const client = yield* makeGroupClient(descriptor.group, protocol, options)
      clients.set(descriptor.group, client)
    }
    return { clients }
  })

const acquireDesktopRendererRpcTestClients = (
  rpcs: DesktopRpcsLayer<never, unknown, never>,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi | undefined
): Effect.Effect<RendererRpcClientsApi, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const registrations = yield* snapshotRegistrations(rpcs)
    const clients = new Map<RpcGroup.Any, DesktopRendererRpcClient>()
    for (const registration of registrations) {
      const group = registration.group
      const handlerContext = yield* Layer.build(registration.handlers)
      const rpcClient = yield* Effect.provide(
        RpcTest.makeClient(effectRpcGroup(group), { flatten: true }),
        handlerContext
      )
      const client = makeRpcTestGroupClient(
        group,
        rpcClient,
        scope,
        framework,
        inspector ?? disabledRendererInspectorCollector
      )
      clients.set(group, client)
    }
    return { clients }
  })

const snapshotRegistrations = (
  rpcs: DesktopRpcsLayer<never, unknown, never>
): Effect.Effect<ReadonlyArray<AnyDesktopRpcRegistration<never, unknown, never>>, never, never> =>
  Effect.succeed(rpcs)

const makeGroupClient = (
  group: AnyDesktopRpcRegistrationGroup,
  protocol: RpcClient.Protocol["Service"],
  options: DesktopRendererRpcClientLayerOptions
): Effect.Effect<DesktopRendererRpcClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const rpcClient = yield* Effect.provideService(
      RpcClient.make(effectRpcGroup(group), { flatten: true }),
      RpcClient.Protocol,
      protocol
    )
    const client: Record<string, DesktopRendererRpcClientMethod> = {}
    for (const tag of group.requests.keys()) {
      client[tag] = (input: unknown): ReturnType<DesktopRendererRpcClientMethod> =>
        instrumentRendererRpcMethod(
          provideRendererRpcMethodScope(
            callRendererRpcFlatClient(rpcClient, tag, input, options.framework),
            scope
          ),
          tag,
          options.framework,
          options.inspector ?? disabledRendererInspectorCollector,
          options.now
        )
    }
    return Object.freeze(client)
  })

const makeRpcTestGroupClient = (
  group: AnyDesktopRpcRegistrationGroup,
  rpcClient: DesktopRendererRpcFlatClient,
  scope: Scope.Scope,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi
): DesktopRendererRpcClient => {
  const client: Record<string, DesktopRendererRpcClientMethod> = {}
  for (const tag of group.requests.keys()) {
    client[tag] = (input: unknown): ReturnType<DesktopRendererRpcClientMethod> =>
      instrumentRendererRpcMethod(
        provideRendererRpcMethodScope(
          callRendererRpcFlatClient(rpcClient, tag, input, framework),
          scope
        ),
        tag,
        framework,
        inspector
      )
  }
  return Object.freeze(client)
}

const effectRpcGroup = (
  group: AnyDesktopRpcRegistrationGroup
): RpcGroup.RpcGroup<Rpc.AnyWithProps> =>
  // Desktop manifests erase heterogeneous group type parameters, but store the original Effect RpcGroup value.
  group as RpcGroup.RpcGroup<Rpc.AnyWithProps>

type RendererRpcInvocation = (
  tag: string,
  input: unknown
) =>
  | Effect.Effect<unknown, RendererRpcError, Scope.Scope>
  | Stream.Stream<unknown, RendererRpcError, Scope.Scope>

const callRendererRpcFlatClient = (
  rpcClient: DesktopRendererRpcFlatClient,
  tag: string,
  input: unknown,
  framework: DesktopFramework
): DesktopRendererRpcScopedResult => {
  // Effect's flat RPC client is callable, but Desktop manifests erase the concrete
  // Rpc union. Keep the assertion at this boundary until manifests preserve it.
  const result = (rpcClient as RendererRpcInvocation)(tag, input)
  return Effect.isEffect(result)
    ? Effect.mapError(result, (cause) => new RendererRpcError({ framework, tag, cause }))
    : Stream.mapError(result, (cause) => new RendererRpcError({ framework, tag, cause }))
}

const provideRendererRpcMethodScope = (
  result: DesktopRendererRpcScopedResult,
  scope: Scope.Scope
): ReturnType<DesktopRendererRpcClientMethod> =>
  Effect.isEffect(result)
    ? Scope.provide(result, scope)
    : Stream.provideService(result, Scope.Scope, scope)

const instrumentRendererRpcMethod = (
  result: ReturnType<DesktopRendererRpcClientMethod>,
  operation: string,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi,
  now?: () => number
): ReturnType<DesktopRendererRpcClientMethod> =>
  Effect.isEffect(result)
    ? instrumentRendererRpcEffect(result, operation, framework, inspector, now)
    : instrumentRendererRpcStream(result, operation, framework, inspector, now)

const instrumentRendererRpcEffect = (
  effect: Effect.Effect<unknown, RendererRpcError, never>,
  operation: string,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi,
  now: (() => number) | undefined
): Effect.Effect<unknown, RendererRpcError, never> =>
  publishRendererRpcEvent(inspector, "rpc", "start", operation, framework, now).pipe(
    Effect.andThen(effect),
    Effect.onExit((exit) =>
      publishRendererRpcEvent(
        inspector,
        "rpc",
        Exit.isSuccess(exit) ? "success" : Exit.hasInterrupts(exit) ? "interruption" : "failure",
        operation,
        framework,
        now
      )
    )
  )

const instrumentRendererRpcStream = (
  stream: Stream.Stream<unknown, RendererRpcError, never>,
  operation: string,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi,
  now: (() => number) | undefined
): Stream.Stream<unknown, RendererRpcError, never> =>
  Stream.concat(
    Stream.drain(
      Stream.fromEffect(
        publishRendererRpcEvent(inspector, "stream", "start", operation, framework, now)
      )
    ),
    stream.pipe(
      Stream.onExit((exit) =>
        publishRendererRpcEvent(
          inspector,
          "stream",
          Exit.isSuccess(exit) ? "success" : Exit.hasInterrupts(exit) ? "interruption" : "failure",
          operation,
          framework,
          now
        )
      )
    )
  )

const publishRendererRpcEvent = (
  inspector: RendererInspectorCollectorApi,
  kind: "rpc" | "stream",
  status: "start" | "success" | "failure" | "interruption",
  operation: string,
  framework: DesktopFramework,
  now: (() => number) | undefined
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = now === undefined ? yield* Clock.currentTimeMillis : now()
    yield* inspector.publish(
      new RendererInspectorEvent({
        kind,
        status,
        operation,
        framework,
        timestamp
      })
    )
  })
