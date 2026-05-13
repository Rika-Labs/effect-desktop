import {
  makeDesktopClientProtocol,
  type DesktopProtocolOptions,
  type DesktopTransportRun,
  type DesktopTransportSend
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Scope, Stream } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcTest } from "effect/unstable/rpc"

import type { AnyDesktopRpcLayer, DesktopAppManifest } from "./desktop-app.js"
import {
  makeMissingDesktopRpcClientError,
  type DesktopFramework,
  type MissingDesktopRpcClientError
} from "./desktop-errors.js"
import { servedRpcGroup, type RpcGroupWithRequests } from "./rpc-group-metadata.js"

export type DesktopRendererRpcTransport = DesktopTransportSend & DesktopTransportRun

export type DesktopRendererRpcClientMethod = (
  input: unknown
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

export type DesktopRendererRpcClient = Readonly<Record<string, DesktopRendererRpcClientMethod>>

export type DesktopRendererRpcClientMap = ReadonlyMap<RpcGroup.Any, DesktopRendererRpcClient>

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
}

export interface DesktopRendererRpcLayerOptions extends DesktopRendererRpcClientLayerOptions {
  readonly transport?: DesktopRendererRpcTransport | undefined
  readonly rpcLayers?: ReadonlyArray<AnyDesktopRpcLayer<never, never>> | undefined
}

const GlobalTransportKey = "__EFFECT_DESKTOP_RPC_TRANSPORT__"

export const makeDesktopRendererRpcLayer = (
  app: DesktopAppManifest,
  options: DesktopRendererRpcLayerOptions
): Layer.Layer<RendererRpcClients, MissingDesktopRpcClientError, never> => {
  if (options.rpcLayers !== undefined) {
    return makeDesktopRendererRpcTestLayer(options.rpcLayers, { framework: options.framework })
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
  rpcLayers: ReadonlyArray<AnyDesktopRpcLayer<never, never>>,
  options: { readonly framework?: DesktopFramework | undefined } = {}
): Layer.Layer<RendererRpcClients, never, never> =>
  Layer.effect(RendererRpcClients)(
    acquireDesktopRendererRpcTestClients(rpcLayers, options.framework ?? "unknown")
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
      const servedGroup = servedRpcGroup(descriptor)
      const client = yield* makeGroupClient(servedGroup, protocol, options.framework)
      clients.set(descriptor.group, client)
      if (servedGroup !== descriptor.group) {
        clients.set(servedGroup, client)
      }
    }
    return { clients }
  })

const acquireDesktopRendererRpcTestClients = (
  rpcLayers: ReadonlyArray<AnyDesktopRpcLayer<never, never>>,
  framework: DesktopFramework
): Effect.Effect<RendererRpcClientsApi, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const clients = new Map<RpcGroup.Any, DesktopRendererRpcClient>()
    for (const rpcLayer of rpcLayers) {
      const group = servedRpcGroup(rpcLayer)
      const rpcClient = yield* RpcTest.makeClient(group as RpcGroup.RpcGroup<Rpc.Any>).pipe(
        Effect.provide(rpcLayer.layer)
      )
      const client = makeRpcTestGroupClient(
        group,
        rpcClient as unknown as Readonly<
          Record<string, DesktopRendererRpcClientMethod | undefined>
        >,
        scope,
        framework
      )
      clients.set(rpcLayer.group, client)
      if (group !== rpcLayer.group) {
        clients.set(group, client)
      }
    }
    return { clients }
  })

const makeGroupClient = (
  group: RpcGroupWithRequests,
  protocol: RpcClient.Protocol["Service"],
  framework: DesktopFramework
): Effect.Effect<DesktopRendererRpcClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const rpcClient = yield* Effect.provideService(
      RpcClient.make(group as RpcGroup.RpcGroup<Rpc.Any>),
      RpcClient.Protocol,
      protocol
    ) as unknown as Effect.Effect<
      Readonly<Record<string, DesktopRendererRpcClientMethod>>,
      never,
      Scope.Scope
    >
    const entries = Array.from(group.requests.keys()).map((tag) => [
      tag,
      (input: unknown): ReturnType<DesktopRendererRpcClientMethod> => {
        const method = rpcClient[tag]
        if (method === undefined) {
          throw makeMissingDesktopRpcClientError(
            framework,
            tag,
            `No renderer RPC client method is installed for ${tag}`
          )
        }
        return provideRendererRpcMethodScope(method(input), scope)
      }
    ])
    return Object.freeze(Object.fromEntries(entries))
  })

const makeRpcTestGroupClient = (
  group: RpcGroupWithRequests,
  rpcClient: Readonly<Record<string, DesktopRendererRpcClientMethod | undefined>>,
  scope: Scope.Scope,
  framework: DesktopFramework
): DesktopRendererRpcClient => {
  const entries = Array.from(group.requests.keys()).map((tag) => [
    tag,
    (input: unknown): ReturnType<DesktopRendererRpcClientMethod> => {
      const method = rpcClient[tag]
      if (method === undefined) {
        throw makeMissingDesktopRpcClientError(
          framework,
          tag,
          `No renderer RPC test client method is installed for ${tag}`
        )
      }
      return provideRendererRpcMethodScope(method(input), scope)
    }
  ])
  return Object.freeze(Object.fromEntries(entries))
}

const provideRendererRpcMethodScope = (
  result: ReturnType<DesktopRendererRpcClientMethod>,
  scope: Scope.Scope
): ReturnType<DesktopRendererRpcClientMethod> =>
  Effect.isEffect(result)
    ? Scope.provide(result as Effect.Effect<unknown, unknown, Scope.Scope>, scope)
    : Stream.provideService(
        result as Stream.Stream<unknown, unknown, Scope.Scope>,
        Scope.Scope,
        scope
      )
