import {
  makeDesktopClientProtocol,
  type DesktopProtocolOptions,
  type DesktopTransportRun,
  type DesktopTransportSend
} from "@effect-desktop/bridge"
import { Clock, Context, Effect, Exit, Layer, Scope, Stream } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcTest } from "effect/unstable/rpc"

import type {
  AnyDesktopRpcRegistration,
  DesktopAppManifest,
  DesktopRpcRegistrationGroup,
  DesktopRpcsLayer
} from "./desktop-app.js"
import {
  makeMissingDesktopRpcClientError,
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
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

export type DesktopRendererRpcClient = Readonly<Record<string, DesktopRendererRpcClientMethod>>

export type DesktopRendererRpcClientMap = ReadonlyMap<RpcGroup.Any, DesktopRendererRpcClient>

type DesktopRendererRpcFlatClient = RpcClient.RpcClient.Flat<Rpc.Any, unknown>
type DesktopRendererRpcScopedResult =
  | Effect.Effect<unknown, unknown, Scope.Scope>
  | Stream.Stream<unknown, unknown, Scope.Scope>

export interface RendererRpcClientsApi {
  readonly clients: DesktopRendererRpcClientMap
}

export class RendererRpcClients extends Context.Service<
  RendererRpcClients,
  RendererRpcClientsApi
>()("@effect-desktop/core/RendererRpcClients") {}

export class RendererRpcTransport extends Context.Service<
  RendererRpcTransport,
  DesktopRendererRpcTransport
>()("@effect-desktop/core/RendererRpcTransport") {}

export interface DesktopRendererRpcClientLayerOptions extends DesktopProtocolOptions {
  readonly framework: DesktopFramework
  readonly inspector?: RendererInspectorCollectorApi | undefined
}

export interface DesktopRendererRpcLayerOptions extends DesktopRendererRpcClientLayerOptions {
  readonly transport?: DesktopRendererRpcTransport | undefined
  readonly rpcs?: DesktopRpcsLayer<never, never> | undefined
}

const GlobalTransportKey = "__EFFECT_DESKTOP_RPC_TRANSPORT__"

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

export const getGlobalDesktopRendererRpcTransport = (): DesktopRendererRpcTransport | undefined =>
  (
    globalThis as typeof globalThis & {
      [GlobalTransportKey]?: DesktopRendererRpcTransport | undefined
    }
  )[GlobalTransportKey]

export const makeDesktopRendererRpcTransportLayer = (
  transport: DesktopRendererRpcTransport
): Layer.Layer<RendererRpcTransport, never, never> => Layer.succeed(RendererRpcTransport)(transport)

export const makeDesktopRendererRpcTestLayer = (
  rpcs: DesktopRpcsLayer<never, never>,
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
  rpcs: DesktopRpcsLayer<never, never>,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi | undefined
): Effect.Effect<RendererRpcClientsApi, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const registrations = yield* snapshotRegistrations(rpcs)
    const clients = new Map<RpcGroup.Any, DesktopRendererRpcClient>()
    for (const registration of registrations) {
      const group = registration.group
      const rpcClient = yield* RpcTest.makeClient(group as RpcGroup.RpcGroup<Rpc.Any>, {
        flatten: true
      }).pipe(Effect.provide(registration.handlers))
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
  rpcs: DesktopRpcsLayer<never, never>
): Effect.Effect<ReadonlyArray<AnyDesktopRpcRegistration<never, never>>, never, never> =>
  Effect.succeed(rpcs)

const makeGroupClient = (
  group: DesktopRpcRegistrationGroup,
  protocol: RpcClient.Protocol["Service"],
  options: DesktopRendererRpcClientLayerOptions
): Effect.Effect<DesktopRendererRpcClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const rpcClient = yield* Effect.provideService(
      RpcClient.make(group as RpcGroup.RpcGroup<Rpc.Any>, { flatten: true }),
      RpcClient.Protocol,
      protocol
    )
    const client: Record<string, DesktopRendererRpcClientMethod> = {}
    for (const tag of group.requests.keys()) {
      client[tag] = (input: unknown): ReturnType<DesktopRendererRpcClientMethod> =>
        instrumentRendererRpcMethod(
          provideRendererRpcMethodScope(callRendererRpcFlatClient(rpcClient, tag, input), scope),
          tag,
          options.framework,
          options.inspector ?? disabledRendererInspectorCollector,
          options.now
        )
    }
    return Object.freeze(client)
  })

const makeRpcTestGroupClient = (
  group: DesktopRpcRegistrationGroup,
  rpcClient: DesktopRendererRpcFlatClient,
  scope: Scope.Scope,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi
): DesktopRendererRpcClient => {
  const client: Record<string, DesktopRendererRpcClientMethod> = {}
  for (const tag of group.requests.keys()) {
    client[tag] = (input: unknown): ReturnType<DesktopRendererRpcClientMethod> =>
      instrumentRendererRpcMethod(
        provideRendererRpcMethodScope(callRendererRpcFlatClient(rpcClient, tag, input), scope),
        tag,
        framework,
        inspector
      )
  }
  return Object.freeze(client)
}

const callRendererRpcFlatClient = (
  rpcClient: DesktopRendererRpcFlatClient,
  tag: string,
  input: unknown
): DesktopRendererRpcScopedResult =>
  rpcClient(tag, input as never) as DesktopRendererRpcScopedResult

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
  effect: Effect.Effect<unknown, unknown, never>,
  operation: string,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi,
  now: (() => number) | undefined
): Effect.Effect<unknown, unknown, never> =>
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
  stream: Stream.Stream<unknown, unknown, never>,
  operation: string,
  framework: DesktopFramework,
  inspector: RendererInspectorCollectorApi,
  now: (() => number) | undefined
): Stream.Stream<unknown, unknown, never> =>
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
