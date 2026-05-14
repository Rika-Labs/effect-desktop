import {
  bindRendererEndpoints,
  describeRpcs,
  getGlobalDesktopRendererRpcTransport,
  makeFrameworkRuntime,
  makeDesktopRendererRpcLayer,
  makeMissingDesktopContextError,
  makeMissingDesktopRpcsError,
  RendererRpcClients,
  type MissingDesktopRpcClientError,
  type DesktopAppManifest,
  type DesktopRpcsLayer,
  type DesktopEndpointSupport,
  type DesktopRendererRpcClient,
  type DesktopRendererRpcClientMap,
  type DesktopRendererRpcClientMethod,
  type DesktopRendererRpcTransport,
  type FrameworkRuntime,
  type DesktopRpcRegistrationGroup as RpcGroupWithRequests
} from "@effect-desktop/core/renderer"
import type { WithRpcEndpointKind } from "@effect-desktop/bridge"
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

export type ReactDesktopRpcs<Group extends RpcGroup.Any> = Readonly<
  Record<string, ReactEndpoint & ReactDesktopSupport>
> & {
  readonly [Current in RpcGroup.Rpcs<Group> as EndpointName<
    Current["_tag"]
  >]: ReactRpcEndpoint<Current>
}

export interface ReactDesktopSupport extends DesktopEndpointSupport {}

type WithSupport<Endpoint> = Endpoint & ReactDesktopSupport

export type ReactDesktopRpcClientMethod = DesktopRendererRpcClientMethod
export type ReactDesktopRpcClient = DesktopRendererRpcClient
export type ReactDesktopClientMap = DesktopRendererRpcClientMap

export interface ReactDesktopRootProps {
  readonly transport?: DesktopRendererRpcTransport | undefined
  readonly rpcs?: DesktopRpcsLayer<never, never> | undefined
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
  readonly runtime: FrameworkRuntime<RendererRpcClients, MissingDesktopRpcClientError>
}

interface ReactDesktopRuntime {
  readonly clients: ReactDesktopClientMap
  readonly runtime: FrameworkRuntime<RendererRpcClients, MissingDesktopRpcClientError>
  readonly dispose: () => Promise<void>
}

const ReactDesktopContext = createContext<ReactDesktopContextValue | undefined>(undefined)

export const ReactDesktop = Object.freeze({
  from: <App extends DesktopAppManifest>(app: App): ReactDesktopAdapter<App> => {
    const DesktopRoot = ({ transport, rpcs, children }: ReactDesktopRootProps): ReactNode => {
      const runtime = useMemo(
        () => makeReactDesktopRuntime(app, transport, rpcs),
        [app, transport, rpcs]
      )
      useEffect(
        () => () => {
          void runtime.dispose()
        },
        [runtime]
      )
      const value = useMemo<ReactDesktopContextValue>(
        () => ({ clients: runtime.clients, runtime: runtime.runtime }),
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
        () =>
          bindRendererEndpoints<ReactEndpoint>(describeRpcs(app, group), client, "react", {
            query: (run) => query(context.runtime, run),
            mutation: (run) => mutation(context.runtime, run),
            stream: (run, descriptor) =>
              stream(context.runtime, run, { hasInput: descriptor.hasPayload })
          }) as ReactDesktopRpcs<Group>,
        [client, context.runtime, group]
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
  rpcs: DesktopRpcsLayer<never, never> | undefined
): ReactDesktopRuntime => {
  const runtime = ManagedRuntime.make(
    makeDesktopRendererRpcLayer(app, {
      framework: "react",
      transport: transport ?? getGlobalDesktopRendererRpcTransport(),
      rpcs
    })
  )
  let clients: ReactDesktopClientMap
  try {
    clients = runtime.runSync(Effect.service(RendererRpcClients)).clients
  } catch (error) {
    void runtime.dispose()
    throw error
  }
  const frameworkRuntime = makeFrameworkRuntime(runtime)
  return Object.freeze({
    clients,
    runtime: frameworkRuntime,
    dispose: async () => {
      await frameworkRuntime.dispose()
      await runtime.dispose()
    }
  })
}
