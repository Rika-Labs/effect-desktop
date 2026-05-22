import {
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  makeHostProtocolInternalError,
  rpcCapability,
  rpcEndpointKind,
  rpcEndpointName,
  rpcSupport,
  type HostProtocolError,
  type WithRpcEndpointKind
} from "@orika/bridge"
import {
  bindRendererEndpoints,
  type DesktopEndpointSupport
} from "@orika/core/runtime/renderer-endpoint-binder"
import {
  getGlobalDesktopRendererRpcTransport,
  makeDesktopRendererRpcLayer,
  RendererRpcClients,
  type DesktopRendererRpcClient,
  type DesktopRendererRpcClientMap,
  type DesktopRendererRpcClientMethod,
  type DesktopRendererRpcTransport
} from "@orika/core/runtime/renderer-rpc-client"
import {
  makeDuplicateDesktopRpcNameError,
  makeMissingDesktopContextError,
  makeMissingDesktopRpcsError,
  type MissingDesktopRpcClientError
} from "@orika/core/runtime/desktop-errors"
import { makeFrameworkRuntime, type FrameworkRuntime } from "@orika/core/runtime/renderer-stream"
import type {
  DesktopAppManifest,
  DesktopRpcRegistrationGroup as RpcGroupWithRequests,
  DesktopRpcsLayer,
  RendererRpcEndpointDescriptor
} from "@orika/core/runtime/renderer-types"
import type { WindowCreateOptions, WindowHandle } from "@orika/native/contracts/window"
import { WindowResource } from "@orika/native/contracts/window"
import { Effect, Exit, ManagedRuntime, Schema, Stream } from "effect"
import { Rpc, RpcGroup, RpcSchema } from "effect/unstable/rpc"
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react"

import {
  mutation,
  query,
  stream,
  type MutationEndpoint,
  type QueryEndpoint,
  type ReactEndpoint,
  type StreamEndpoint
} from "./endpoints.js"
import { createUnavailableDesktopClient, DesktopProvider, type DesktopClient } from "./provider.js"

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

interface RpcWithSchemas extends Rpc.Any {
  readonly payloadSchema: Schema.Top
  readonly successSchema: Schema.Top
}

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
} from "@orika/core/runtime/desktop-errors"

interface ReactDesktopContextValue {
  readonly clients: ReactDesktopClientMap
  readonly runtime: FrameworkRuntime<RendererRpcClients, MissingDesktopRpcClientError>
}

interface ReactDesktopRuntime {
  readonly clients: ReactDesktopClientMap
  readonly desktopClient: DesktopClient
  readonly runtime: FrameworkRuntime<RendererRpcClients, MissingDesktopRpcClientError>
  readonly disposeEffect: Effect.Effect<void, never, never>
}

const ReactDesktopContext = createContext<ReactDesktopContextValue | undefined>(undefined)

export const ReactDesktop = Object.freeze({
  from: <App extends DesktopAppManifest>(app: App): ReactDesktopAdapter<App> => {
    const DesktopRoot = ({ transport, rpcs, children }: ReactDesktopRootProps): ReactNode => {
      const runtime = useMemo(
        () => makeReactDesktopRuntime(app, transport, rpcs),
        [app, transport, rpcs]
      )
      const [currentWindow, setCurrentWindow] = useState<WindowHandle | undefined>()
      useEffect(
        () => () => {
          void Effect.runCallback(runtime.disposeEffect)
        },
        [runtime]
      )
      useEffect(() => {
        const getCurrent = runtime.desktopClient.window.getCurrent
        if (getCurrent === undefined) {
          setCurrentWindow(undefined)
          return
        }

        let mounted = true
        const interrupt = Effect.runCallback(getCurrent(), {
          onExit: (exit) => {
            if (mounted && Exit.isSuccess(exit)) {
              setCurrentWindow(exit.value)
            }
          }
        })
        return () => {
          mounted = false
          interrupt()
        }
      }, [runtime])
      const value = useMemo<ReactDesktopContextValue>(
        () => ({ clients: runtime.clients, runtime: runtime.runtime }),
        [runtime]
      )
      return createElement(
        ReactDesktopContext.Provider,
        { value },
        createElement(DesktopProvider, { client: runtime.desktopClient, currentWindow }, children)
      )
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
          bindRendererEndpoints<ReactEndpoint>(describeManifestRpcs(app, group), client, "react", {
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

const describeManifestRpcs = <Group extends RpcGroupWithRequests>(
  app: DesktopAppManifest,
  group: Group
): readonly RendererRpcEndpointDescriptor[] => {
  const provided = app.rpcGroups.find((descriptor) => descriptor.group === group)
  if (provided === undefined) {
    throw makeMissingDesktopRpcsError(
      groupTags(group),
      `RpcGroup is not provided to this Desktop app: ${groupTags(group).join(", ")}`
    )
  }

  const descriptors = Array.from(provided.group.requests.values()).map((rpc) =>
    Object.freeze({
      name: rpcEndpointName(rpc._tag),
      tag: rpc._tag,
      kind: endpointKind(rpc),
      hasPayload: payloadSchema(rpc) !== Schema.Void,
      rpc,
      capability: rpcCapability(rpc),
      support: rpcSupport(rpc)
    })
  )

  assertUniqueEndpointNames(descriptors)

  return Object.freeze(descriptors)
}

const assertUniqueEndpointNames = (descriptors: readonly RendererRpcEndpointDescriptor[]): void => {
  const seen = new Map<string, string>()

  for (const descriptor of descriptors) {
    const previous = seen.get(descriptor.name)
    if (previous !== undefined) {
      throw makeDuplicateDesktopRpcNameError(
        descriptor.name,
        Object.freeze([previous, descriptor.tag]),
        `Rpc endpoint name "${descriptor.name}" is produced by both "${previous}" and "${descriptor.tag}"`
      )
    }

    seen.set(descriptor.name, descriptor.tag)
  }
}

const endpointKind = (rpc: Rpc.Any): RendererRpcEndpointDescriptor["kind"] =>
  RpcSchema.isStreamSchema(successSchema(rpc)) ? "stream" : rpcEndpointKind(rpc)

const payloadSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSchemas).payloadSchema

const successSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSchemas).successSchema

const groupTags = (group: RpcGroupWithRequests): readonly string[] =>
  Array.from(group.requests.keys())

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
    void Effect.runCallback(runtime.disposeEffect)
    throw error
  }
  const frameworkRuntime = makeFrameworkRuntime(runtime)
  return Object.freeze({
    clients,
    desktopClient: makeReactDesktopClient(clients),
    runtime: frameworkRuntime,
    disposeEffect: frameworkRuntime.disposeEffect.pipe(Effect.andThen(runtime.disposeEffect))
  })
}

const makeReactDesktopClient = (clients: ReactDesktopClientMap): DesktopClient => {
  const windowClient = findWindowClient(clients)
  if (windowClient === undefined) {
    return createUnavailableDesktopClient("Native.Window is not declared for this app")
  }

  return Object.freeze({
    window: Object.freeze({
      create: (input?: WindowCreateOptions) =>
        runWindowEffect(windowClient, "Window.create", input ?? {}).pipe(
          Effect.flatMap(decodeWindowHandle("Window.create"))
        ),
      close: (window: WindowHandle) =>
        runWindowEffect(windowClient, "Window.close", { window }).pipe(Effect.asVoid),
      destroy: (window: WindowHandle) =>
        runWindowEffect(windowClient, "Window.destroy", { window }).pipe(Effect.asVoid),
      getCurrent: () =>
        runWindowEffect(windowClient, "Window.getCurrent", undefined).pipe(
          Effect.flatMap(decodeWindowHandle("Window.getCurrent"))
        )
    })
  })
}

const RequiredWindowRpcTags = Object.freeze([
  "Window.create",
  "Window.close",
  "Window.destroy",
  "Window.getCurrent"
] as const)

const findWindowClient = (clients: ReactDesktopClientMap): DesktopRendererRpcClient | undefined => {
  for (const [group, client] of clients) {
    if (hasRequiredWindowRpcs(group)) {
      return client
    }
  }
  return undefined
}

const hasRequiredWindowRpcs = (group: RpcGroup.Any): boolean => {
  if (!("requests" in group)) {
    return false
  }
  const requests = group.requests
  if (!(requests instanceof Map)) {
    return false
  }
  return RequiredWindowRpcTags.every((tag) => requests.has(tag))
}

const runWindowEffect = (
  client: DesktopRendererRpcClient,
  operation: string,
  input: unknown
): Effect.Effect<unknown, HostProtocolError, never> => {
  const method = client[operation]
  if (method === undefined) {
    return Effect.fail(
      makeHostProtocolInvalidStateError(
        `missing renderer RPC client method ${operation}`,
        "call",
        operation
      )
    )
  }

  const result = method(input)
  return Effect.isEffect(result)
    ? Effect.mapError(result, (error) => rendererRpcErrorToHostProtocolError(error, operation))
    : Effect.fail(makeHostProtocolInvalidStateError("received Stream", "call", operation))
}

const decodeWindowHandle =
  (operation: string) =>
  (value: unknown): Effect.Effect<WindowHandle, HostProtocolError, never> =>
    Schema.decodeUnknownEffect(WindowResource)(value).pipe(
      Effect.mapError((error) =>
        makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
      )
    )

const formatUnknownError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const rendererRpcErrorToHostProtocolError = (
  error: unknown,
  operation: string
): HostProtocolError => makeHostProtocolInternalError(formatUnknownError(error), operation)
