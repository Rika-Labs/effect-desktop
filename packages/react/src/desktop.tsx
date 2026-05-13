import {
  describeRpcs,
  getGlobalDesktopRendererRpcTransport,
  makeDesktopRendererRpcLayer,
  makeMissingDesktopContextError,
  makeMissingDesktopRpcClientError,
  makeMissingDesktopRpcsError,
  RendererRpcClients,
  type DesktopAppManifest,
  type AnyDesktopRpcLayer,
  type DesktopRendererRpcClient,
  type DesktopRendererRpcClientMap,
  type DesktopRendererRpcClientMethod,
  type DesktopRendererRpcTransport,
  type RpcGroupWithRequests
} from "@effect-desktop/core/renderer"
import type { RpcSupportMetadata, WithRpcEndpointKind } from "@effect-desktop/bridge"
import { Effect, ManagedRuntime, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from "react"

import {
  mutation,
  query,
  stream,
  type MutationEndpoint,
  type QueryEndpoint,
  type ReactEndpoint,
  type StreamEndpoint
} from "./endpoints.js"

type EndpointName<Tag extends string> = Tag extends `${string}.${infer Rest}`
  ? EndpointName<Rest>
  : Uncapitalize<Tag>

type ReactRpcEndpoint<R extends Rpc.Any> = WithSupport<
  Rpc.Success<R> extends Stream.Stream<infer A, infer E, infer _R>
    ? StreamEndpoint<Rpc.PayloadConstructor<R>, A, E | Rpc.Error<R>>
    : R extends WithRpcEndpointKind<R, "query">
      ? QueryEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
      : MutationEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
>

export type ReactDesktopRpcs<Group extends RpcGroup.Any> = {
  readonly [Current in RpcGroup.Rpcs<Group> as EndpointName<
    Current["_tag"]
  >]: ReactRpcEndpoint<Current>
}

export interface ReactDesktopSupport {
  readonly support: RpcSupportMetadata
  readonly isSupported: boolean
}

type WithSupport<Endpoint> = Endpoint & ReactDesktopSupport
type SupportedReactEndpoint<Endpoint extends ReactEndpoint> = Endpoint & ReactDesktopSupport

export type ReactDesktopRpcClientMethod = DesktopRendererRpcClientMethod
export type ReactDesktopRpcClient = DesktopRendererRpcClient
export type ReactDesktopClientMap = DesktopRendererRpcClientMap

export interface ReactDesktopRootProps {
  readonly transport?: DesktopRendererRpcTransport | undefined
  readonly rpcLayers?: ReadonlyArray<AnyDesktopRpcLayer<never, never>> | undefined
  readonly children?: ReactNode | undefined
}

export interface ReactDesktopAdapter<App extends DesktopAppManifest> {
  readonly app: App
  readonly DesktopRoot: (props: ReactDesktopRootProps) => ReactNode
  readonly createRoot: (
    children: ReactNode,
    props?: Omit<ReactDesktopRootProps, "children">
  ) => ReactNode
  readonly useDesktop: <Group extends RpcGroupWithRequests>(group: Group) => ReactDesktopRpcs<Group>
}

export {
  MissingDesktopContextError,
  MissingDesktopRpcClientError
} from "@effect-desktop/core/renderer"

interface ReactDesktopContextValue {
  readonly clients: ReactDesktopClientMap
}

interface ReactDesktopRuntime {
  readonly clients: ReactDesktopClientMap
  readonly dispose: () => Promise<void>
}

const ReactDesktopContext = createContext<ReactDesktopContextValue | undefined>(undefined)

export const ReactDesktop = Object.freeze({
  from: <App extends DesktopAppManifest>(app: App): ReactDesktopAdapter<App> => {
    const DesktopRoot = ({ transport, rpcLayers, children }: ReactDesktopRootProps): ReactNode => {
      const runtime = useMemo(
        () => makeReactDesktopRuntime(app, transport, rpcLayers),
        [app, transport, rpcLayers]
      )
      useEffect(
        () => () => {
          void runtime.dispose()
        },
        [runtime]
      )
      const value = useMemo<ReactDesktopContextValue>(
        () => ({ clients: runtime.clients }),
        [runtime]
      )
      return createElement(ReactDesktopContext.Provider, { value }, children)
    }

    const useDesktop = <Group extends RpcGroupWithRequests>(
      group: Group
    ): ReactDesktopRpcs<Group> => {
      const context = useContext(ReactDesktopContext)
      if (context === undefined) {
        throw makeMissingDesktopContextError(
          "react",
          "ReactDesktopRoot is required before useDesktop(group)"
        )
      }

      const client = context.clients.get(group)
      if (client === undefined) {
        throw makeMissingDesktopRpcsError(
          Array.from(group.requests.keys()),
          "No renderer RPC client is installed for this group"
        )
      }

      return useMemo(
        () => makeEndpoints(describeRpcs(app, group), client) as ReactDesktopRpcs<Group>,
        [client, group]
      )
    }

    return Object.freeze({
      app,
      DesktopRoot,
      createRoot: (children: ReactNode, props?: Omit<ReactDesktopRootProps, "children">) =>
        createElement(DesktopRoot, props, children),
      useDesktop
    })
  }
})

const makeReactDesktopRuntime = (
  app: DesktopAppManifest,
  transport: DesktopRendererRpcTransport | undefined,
  rpcLayers: ReadonlyArray<AnyDesktopRpcLayer<never, never>> | undefined
): ReactDesktopRuntime => {
  const runtime = ManagedRuntime.make(
    makeDesktopRendererRpcLayer(app, {
      framework: "react",
      transport: transport ?? getGlobalDesktopRendererRpcTransport(),
      rpcLayers
    })
  )
  let clients: ReactDesktopClientMap
  try {
    clients = runtime.runSync(Effect.service(RendererRpcClients)).clients
  } catch (error) {
    void runtime.dispose()
    throw error
  }
  return Object.freeze({
    clients,
    dispose: runtime.dispose
  })
}

const makeEndpoints = (
  descriptors: ReturnType<typeof describeRpcs>,
  client: ReactDesktopRpcClient
): Readonly<Record<string, ReactEndpoint>> => {
  const endpoints = Object.create(null) as Record<string, ReactEndpoint>

  for (const descriptor of descriptors) {
    const invoke = (input: unknown): ReturnType<ReactDesktopRpcClientMethod> => {
      const method = client[descriptor.tag]
      if (method === undefined) {
        throw makeMissingDesktopRpcClientError(
          "react",
          descriptor.tag,
          `No renderer RPC client method is installed for ${descriptor.tag}`
        )
      }
      return method(input)
    }

    const endpoint =
      descriptor.kind === "stream"
        ? stream((input) => asStream(invoke(input), descriptor.tag))
        : descriptor.kind === "query"
          ? query((input) => asEffect(invoke(input), descriptor.tag))
          : mutation((input) => asEffect(invoke(input), descriptor.tag))

    endpoints[descriptor.name] = withSupport(endpoint, descriptor.support)
  }

  return Object.freeze(endpoints)
}

const withSupport = <Endpoint extends ReactEndpoint>(
  endpoint: Endpoint,
  support: RpcSupportMetadata
): SupportedReactEndpoint<Endpoint> => {
  const supportedEndpoint = {
    ...endpoint,
    support,
    isSupported: support.status === "supported"
  } satisfies SupportedReactEndpoint<Endpoint>

  return Object.freeze(supportedEndpoint)
}

const asEffect = (
  value: ReturnType<ReactDesktopRpcClientMethod>,
  tag: string
): Effect.Effect<unknown, unknown, never> => {
  if (Effect.isEffect(value)) {
    return value as Effect.Effect<unknown, unknown, never>
  }
  throw makeMissingDesktopRpcClientError(
    "react",
    tag,
    `Renderer RPC client method ${tag} returned a Stream where an Effect was expected`
  )
}

const asStream = (
  value: ReturnType<ReactDesktopRpcClientMethod>,
  tag: string
): Stream.Stream<unknown, unknown, never> => {
  if (Stream.isStream(value)) {
    return value as Stream.Stream<unknown, unknown, never>
  }
  throw makeMissingDesktopRpcClientError(
    "react",
    tag,
    `Renderer RPC client method ${tag} returned an Effect where a Stream was expected`
  )
}
