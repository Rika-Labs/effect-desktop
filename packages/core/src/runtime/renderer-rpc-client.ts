import {
  makeDesktopClientProtocol,
  type DesktopProtocolOptions,
  type DesktopTransportRun,
  type DesktopTransportSend
} from "@effect-desktop/bridge"
import { Effect, Exit, Scope, Stream } from "effect"
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc"

import type { DesktopAppManifest } from "./desktop-app.js"
import { makeMissingDesktopRpcClientError, type DesktopFramework } from "./desktop-errors.js"
import { servedRpcGroup, type RpcGroupWithRequests } from "./rpc-group-metadata.js"

export type DesktopRendererRpcTransport = DesktopTransportSend & DesktopTransportRun

export type DesktopRendererRpcClientMethod = (
  input: unknown
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

export type DesktopRendererRpcClient = Readonly<Record<string, DesktopRendererRpcClientMethod>>

export type DesktopRendererRpcClientMap = ReadonlyMap<RpcGroup.Any, DesktopRendererRpcClient>

export interface DesktopRendererRpcRuntime {
  readonly clients: DesktopRendererRpcClientMap
  readonly dispose: () => Effect.Effect<void, never, never>
}

export interface DesktopRendererRpcRuntimeOptions extends DesktopProtocolOptions {
  readonly framework: DesktopFramework
  readonly transport?: DesktopRendererRpcTransport | undefined
}

const GlobalTransportKey = "__EFFECT_DESKTOP_RPC_TRANSPORT__"

export const makeDesktopRendererRpcRuntime = (
  app: DesktopAppManifest,
  options: DesktopRendererRpcRuntimeOptions
): DesktopRendererRpcRuntime => {
  if (app.rpcGroups.length === 0) {
    return Object.freeze({
      clients: new Map<RpcGroup.Any, DesktopRendererRpcClient>(),
      dispose: () => Effect.void
    })
  }

  const transport = options.transport ?? globalRendererRpcTransport()
  if (transport === undefined) {
    throw makeMissingDesktopRpcClientError(
      options.framework,
      "desktop.rpc",
      "No desktop RPC transport is installed for this renderer"
    )
  }

  const scope = Scope.makeUnsafe("sequential")
  const protocol = Effect.runSync(
    Scope.provide(
      makeDesktopClientProtocol(transport, {
        ...(options.windowId === undefined ? {} : { windowId: options.windowId }),
        ...(options.originToken === undefined ? {} : { originToken: options.originToken }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.nextTraceId === undefined ? {} : { nextTraceId: options.nextTraceId })
      }),
      scope
    )
  )
  const clients = new Map<RpcGroup.Any, DesktopRendererRpcClient>()
  for (const descriptor of app.rpcGroups) {
    const servedGroup = servedRpcGroup(descriptor)
    const client = makeGroupClient(servedGroup, protocol, scope, options.framework)
    clients.set(descriptor.group, client)
    if (servedGroup !== descriptor.group) {
      clients.set(servedGroup, client)
    }
  }

  return Object.freeze({
    clients,
    dispose: () => Scope.close(scope, Exit.void)
  })
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

const globalRendererRpcTransport = (): DesktopRendererRpcTransport | undefined =>
  (
    globalThis as typeof globalThis & {
      [GlobalTransportKey]?: DesktopRendererRpcTransport | undefined
    }
  )[GlobalTransportKey]

const makeGroupClient = (
  group: RpcGroupWithRequests,
  protocol: RpcClient.Protocol["Service"],
  scope: Scope.Scope,
  framework: DesktopFramework
): DesktopRendererRpcClient => {
  const rpcClient = Effect.runSync(
    Scope.provide(
      Effect.provideService(
        RpcClient.make(group as RpcGroup.RpcGroup<Rpc.Any>),
        RpcClient.Protocol,
        protocol
      ) as unknown as Effect.Effect<
        Readonly<Record<string, DesktopRendererRpcClientMethod>>,
        never,
        Scope.Scope
      >,
      scope
    )
  )
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
      const result = method(input)
      return Effect.isEffect(result)
        ? Scope.provide(result as Effect.Effect<unknown, unknown, Scope.Scope>, scope)
        : Stream.provideService(
            result as Stream.Stream<unknown, unknown, Scope.Scope>,
            Scope.Scope,
            scope
          )
    }
  ])
  return Object.freeze(Object.fromEntries(entries))
}
