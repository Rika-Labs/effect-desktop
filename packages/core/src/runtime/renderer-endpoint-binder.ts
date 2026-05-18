import { Effect, Stream } from "effect"

import { makeMissingDesktopRpcClientError, type DesktopFramework } from "./desktop-errors.js"
import type {
  DesktopRendererRpcClient,
  DesktopRendererRpcClientMethod
} from "./renderer-rpc-client.js"
import type { RpcEndpointDescriptor } from "./rpc-descriptors.js"

export interface DesktopEndpointSupport {
  readonly support: RpcEndpointDescriptor["support"]
  readonly isSupported: boolean
}

export interface RendererEndpointBinders<Endpoint extends object> {
  readonly query: (run: (input: unknown) => Effect.Effect<unknown, unknown, never>) => Endpoint
  readonly mutation: (run: (input: unknown) => Effect.Effect<unknown, unknown, never>) => Endpoint
  readonly stream: (
    run: (input: unknown) => Stream.Stream<unknown, unknown, never>,
    descriptor: RpcEndpointDescriptor
  ) => Endpoint
}

export const bindRendererEndpoints = <Endpoint extends object>(
  descriptors: readonly RpcEndpointDescriptor[],
  client: DesktopRendererRpcClient,
  framework: DesktopFramework,
  binders: RendererEndpointBinders<Endpoint>
): Readonly<Record<string, Endpoint & DesktopEndpointSupport>> => {
  const endpoints = Object.create(null) as Record<string, Endpoint & DesktopEndpointSupport>

  for (const descriptor of descriptors) {
    const invoke = requiredClientMethod(client, descriptor.tag, framework)
    const endpoint =
      descriptor.kind === "stream"
        ? binders.stream((input) => asStream(invoke(input), descriptor.tag, framework), descriptor)
        : descriptor.kind === "query"
          ? binders.query((input) => asEffect(invoke(input), descriptor.tag, framework))
          : binders.mutation((input) => asEffect(invoke(input), descriptor.tag, framework))

    endpoints[descriptor.name] = attachEndpointSupport(endpoint, descriptor.support)
  }

  return Object.freeze(endpoints)
}

const requiredClientMethod =
  (
    client: DesktopRendererRpcClient,
    tag: string,
    framework: DesktopFramework
  ): DesktopRendererRpcClientMethod =>
  (input: unknown): ReturnType<DesktopRendererRpcClientMethod> => {
    const method = client[tag]
    if (method === undefined) {
      throw makeMissingDesktopRpcClientError(
        framework,
        tag,
        `No renderer RPC client method is installed for ${tag}`
      )
    }
    return method(input)
  }

const attachEndpointSupport = <Endpoint extends object>(
  endpoint: Endpoint,
  support: RpcEndpointDescriptor["support"]
): Endpoint & DesktopEndpointSupport =>
  Object.freeze({
    ...endpoint,
    support,
    isSupported: support.status !== "unsupported"
  })

const asEffect = (
  value: ReturnType<DesktopRendererRpcClientMethod>,
  tag: string,
  framework: DesktopFramework
): Effect.Effect<unknown, unknown, never> => {
  if (Effect.isEffect(value)) {
    return value
  }
  throw makeMissingDesktopRpcClientError(
    framework,
    tag,
    `Renderer RPC client method ${tag} returned a Stream where an Effect was expected`
  )
}

const asStream = (
  value: ReturnType<DesktopRendererRpcClientMethod>,
  tag: string,
  framework: DesktopFramework
): Stream.Stream<unknown, unknown, never> => {
  if (Stream.isStream(value)) {
    return value
  }
  throw makeMissingDesktopRpcClientError(
    framework,
    tag,
    `Renderer RPC client method ${tag} returned an Effect where a Stream was expected`
  )
}
