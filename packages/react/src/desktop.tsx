import {
  describeRpcs,
  MissingDesktopRpcsError,
  type DesktopAppDefinition
} from "@rikalabs/effect-desktop/core"
import type { RpcGroupWithRequests } from "@rikalabs/effect-desktop/core"
import type { WithRpcEndpointKind } from "@rikalabs/effect-desktop/bridge"
import { Data, Effect, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react"

import {
  mutation,
  query,
  stream,
  type MutationEndpoint,
  type QueryEndpoint,
  type ReactApiEndpoint,
  type StreamEndpoint
} from "./api.js"

type EndpointName<Tag extends string> = Tag extends `${string}.${infer Rest}`
  ? EndpointName<Rest>
  : Uncapitalize<Tag>

type ReactRpcEndpoint<R extends Rpc.Any> =
  Rpc.Success<R> extends Stream.Stream<infer A, infer E, infer _R>
    ? StreamEndpoint<Rpc.PayloadConstructor<R>, A, E | Rpc.Error<R>>
    : R extends WithRpcEndpointKind<R, "query">
      ? QueryEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
      : MutationEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>

export type ReactDesktopRpcs<Group extends RpcGroup.Any> = {
  readonly [Current in RpcGroup.Rpcs<Group> as EndpointName<Current["_tag"]>]: ReactRpcEndpoint<Current>
}

export type ReactDesktopRpcClientMethod = (
  input: unknown
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

export type ReactDesktopRpcClient = Readonly<Record<string, ReactDesktopRpcClientMethod>>
export type ReactDesktopClientMap = ReadonlyMap<RpcGroup.Any, ReactDesktopRpcClient>

export interface ReactDesktopRootProps {
  readonly clients?: ReactDesktopClientMap | readonly (readonly [RpcGroup.Any, ReactDesktopRpcClient])[]
  readonly children?: ReactNode | undefined
}

export interface ReactDesktopAdapter<App extends DesktopAppDefinition<unknown, unknown>> {
  readonly app: App
  readonly DesktopRoot: (props: ReactDesktopRootProps) => ReactNode
  readonly createRoot: (
    children: ReactNode,
    props?: Omit<ReactDesktopRootProps, "children">
  ) => ReactNode
  readonly useDesktop: <Group extends RpcGroupWithRequests>(
    group: Group
  ) => ReactDesktopRpcs<Group>
}

export class MissingDesktopContextError extends Data.TaggedError("MissingDesktopContextError")<{
  readonly message: string
}> {}

export class MissingDesktopRpcClientError extends Data.TaggedError("MissingDesktopRpcClientError")<{
  readonly message: string
  readonly tag: string
}> {}

interface ReactDesktopContextValue {
  readonly clients: ReactDesktopClientMap
}

const ReactDesktopContext = createContext<ReactDesktopContextValue | undefined>(undefined)

export const ReactDesktop = Object.freeze({
  from: <App extends DesktopAppDefinition<unknown, unknown>>(
    app: App
  ): ReactDesktopAdapter<App> => {
    const DesktopRoot = ({ clients, children }: ReactDesktopRootProps): ReactNode => {
      const value = useMemo<ReactDesktopContextValue>(
        () => ({ clients: normalizeClients(clients) }),
        [clients]
      )
      return createElement(ReactDesktopContext.Provider, { value }, children)
    }

    const useDesktop = <Group extends RpcGroupWithRequests>(
      group: Group
    ): ReactDesktopRpcs<Group> => {
      const context = useContext(ReactDesktopContext)
      if (context === undefined) {
        throw new MissingDesktopContextError({
          message: "ReactDesktopRoot is required before useDesktop(group)"
        })
      }

      const client = context.clients.get(group)
      if (client === undefined) {
        throw new MissingDesktopRpcsError({
          message: "No renderer RPC client is installed for this group",
          tags: Array.from(group.requests.keys())
        })
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

const normalizeClients = (
  clients: ReactDesktopRootProps["clients"] | undefined
): ReactDesktopClientMap => {
  if (clients === undefined) {
    return new Map()
  }
  return new Map(clients)
}

const makeEndpoints = (
  descriptors: ReturnType<typeof describeRpcs>,
  client: ReactDesktopRpcClient
): Readonly<Record<string, ReactApiEndpoint>> => {
  const endpoints: Record<string, ReactApiEndpoint> = {}

  for (const descriptor of descriptors) {
    const invoke = (input: unknown): ReturnType<ReactDesktopRpcClientMethod> => {
      const method = client[descriptor.tag]
      if (method === undefined) {
        throw new MissingDesktopRpcClientError({
          message: `No renderer RPC client method is installed for ${descriptor.tag}`,
          tag: descriptor.tag
        })
      }
      return method(input)
    }

    endpoints[descriptor.name] =
      descriptor.kind === "stream"
        ? stream((input) => asStream(invoke(input), descriptor.tag))
        : descriptor.kind === "query"
          ? query((input) => asEffect(invoke(input), descriptor.tag))
          : mutation((input) => asEffect(invoke(input), descriptor.tag))
  }

  return Object.freeze(endpoints)
}

const asEffect = (
  value: ReturnType<ReactDesktopRpcClientMethod>,
  tag: string
): Effect.Effect<unknown, unknown, never> => {
  if (Effect.isEffect(value)) {
    return value as Effect.Effect<unknown, unknown, never>
  }
  throw new MissingDesktopRpcClientError({
    message: `Renderer RPC client method ${tag} returned a Stream where an Effect was expected`,
    tag
  })
}

const asStream = (
  value: ReturnType<ReactDesktopRpcClientMethod>,
  tag: string
): Stream.Stream<unknown, unknown, never> => {
  if (Stream.isStream(value)) {
    return value as Stream.Stream<unknown, unknown, never>
  }
  throw new MissingDesktopRpcClientError({
    message: `Renderer RPC client method ${tag} returned an Effect where a Stream was expected`,
    tag
  })
}
