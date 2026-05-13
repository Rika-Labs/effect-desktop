import {
  describeRpcs,
  getGlobalDesktopRendererRpcTransport,
  makeDesktopRendererRpcLayer,
  type AnyDesktopRpcLayer,
  makeMissingDesktopContextError,
  makeMissingDesktopRpcClientError,
  makeMissingDesktopRpcsError,
  RendererRpcClients,
  type DesktopAppManifest,
  type DesktopRendererRpcClient,
  type DesktopRendererRpcClientMap,
  type DesktopRendererRpcClientMethod,
  type DesktopRendererRpcTransport,
  type RpcGroupWithRequests
} from "@effect-desktop/core/renderer"
import type { RpcSupportMetadata, WithRpcEndpointKind } from "@effect-desktop/bridge"
import { Cause, Effect, Exit, Fiber, ManagedRuntime, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import {
  createApp as createVueApp,
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  type App as VueApp,
  type Component,
  type InjectionKey,
  type Ref
} from "vue"

export {
  defaultRegistry as desktopAtomDefaultRegistry,
  injectRegistry as injectDesktopAtomRegistry,
  registryKey as desktopAtomRegistryKey,
  useAtom,
  useAtomRef,
  useAtomSet,
  useAtomValue
} from "@effect/atom-vue"

type EndpointName<Tag extends string> = Tag extends `${string}.${infer Rest}`
  ? EndpointName<Rest>
  : Uncapitalize<Tag>

type VueRpcEndpoint<R extends Rpc.Any> = WithSupport<
  Rpc.Success<R> extends Stream.Stream<infer A, infer E, infer _R>
    ? VueStreamEndpoint<Rpc.PayloadConstructor<R>, A, E | Rpc.Error<R>>
    : R extends WithRpcEndpointKind<R, "query">
      ? VueQueryEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
      : VueMutationEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
>

export type VueDesktopRpcs<Group extends RpcGroup.Any> = {
  readonly [Current in RpcGroup.Rpcs<Group> as EndpointName<
    Current["_tag"]
  >]: VueRpcEndpoint<Current>
}

export type VueAsyncState<A, E> =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "success"; readonly value: A }
  | { readonly status: "failure"; readonly cause: Cause.Cause<E> }

export interface VueStreamState<A, E> {
  readonly status: "idle" | "running" | "closed" | "failure"
  readonly data: readonly A[]
  readonly cause: Cause.Cause<E> | undefined
}

export type VueComposable<I, A> = [I] extends [void]
  ? () => A
  : undefined extends I
    ? (input?: I) => A
    : (input: I) => A

export interface VueMutation<I, A, E> {
  readonly state: Readonly<Ref<VueAsyncState<A, E>>>
  readonly run: VueComposable<I, void>
  readonly runPromise: VueComposable<I, Promise<Exit.Exit<A, E>>>
  readonly reset: () => void
}

export interface VueMutationEndpoint<I, A, E> {
  readonly useMutation: () => VueMutation<I, A, E>
}

export interface VueQueryEndpoint<I, A, E> {
  readonly useQuery: VueComposable<I, Readonly<Ref<VueAsyncState<A, E>>>>
}

export interface VueStreamEndpoint<I, A, E> {
  readonly useStream: VueComposable<I, Readonly<Ref<VueStreamState<A, E>>>>
}

type VueEndpoint =
  | VueMutationEndpoint<unknown, unknown, unknown>
  | VueQueryEndpoint<unknown, unknown, unknown>
  | VueStreamEndpoint<unknown, unknown, unknown>

export interface VueDesktopSupport {
  readonly support: RpcSupportMetadata
  readonly isSupported: boolean
}

type WithSupport<Endpoint> = Endpoint & VueDesktopSupport
type SupportedVueEndpoint<Endpoint extends VueEndpoint> = Endpoint & VueDesktopSupport

export interface VueDesktopOptions {
  readonly transport?: DesktopRendererRpcTransport | undefined
  readonly rpcLayers?: ReadonlyArray<AnyDesktopRpcLayer<never, never>> | undefined
}

export interface VueDesktopAdapter<App extends DesktopAppManifest> {
  readonly app: App
  readonly createApp: (rootComponent: Component, options?: VueDesktopOptions) => VueApp
  readonly provideDesktop: (options?: VueDesktopOptions) => void
  readonly useDesktop: <Group extends RpcGroupWithRequests>(group: Group) => VueDesktopRpcs<Group>
}

export {
  MissingDesktopContextError,
  MissingDesktopRpcClientError
} from "@effect-desktop/core/renderer"

interface VueDesktopContext {
  readonly clients: DesktopRendererRpcClientMap
}

interface VueDesktopRuntime {
  readonly clients: DesktopRendererRpcClientMap
  readonly dispose: () => Promise<void>
}

const VueDesktopKey: InjectionKey<VueDesktopContext> = Symbol("VueDesktop")
const MissingVueDesktopContext = Symbol("MissingVueDesktopContext")

export const VueDesktop = Object.freeze({
  from: <App extends DesktopAppManifest>(app: App): VueDesktopAdapter<App> => {
    const provideDesktop = (options?: VueDesktopOptions): void => {
      const runtime = makeVueDesktopRuntime(app, options?.transport, options?.rpcLayers)
      provide(VueDesktopKey, { clients: runtime.clients })
      onScopeDispose(() => {
        void runtime.dispose()
      })
    }

    const useDesktop = <Group extends RpcGroupWithRequests>(
      group: Group
    ): VueDesktopRpcs<Group> => {
      const context = inject<VueDesktopContext | typeof MissingVueDesktopContext>(
        VueDesktopKey as InjectionKey<VueDesktopContext | typeof MissingVueDesktopContext>,
        MissingVueDesktopContext
      )
      if (context === MissingVueDesktopContext) {
        throw makeMissingDesktopContextError(
          "vue",
          "VueDesktop.provideDesktop() or VueDesktop.createApp() is required before useDesktop(group)"
        )
      }

      const client = context.clients.get(group)
      if (client === undefined) {
        throw makeMissingDesktopRpcsError(
          Array.from(group.requests.keys()),
          "No renderer RPC client is installed for this group"
        )
      }

      return makeEndpoints(describeRpcs(app, group), client) as VueDesktopRpcs<Group>
    }

    return Object.freeze({
      app,
      createApp: (rootComponent: Component, options?: VueDesktopOptions) => {
        const vueApp = createVueApp(rootComponent)
        const runtime = makeVueDesktopRuntime(app, options?.transport, options?.rpcLayers)
        vueApp.provide(VueDesktopKey, { clients: runtime.clients })
        const unmount = vueApp.unmount.bind(vueApp)
        vueApp.unmount = () => {
          unmount()
          void runtime.dispose()
        }
        return vueApp
      },
      provideDesktop,
      useDesktop
    })
  }
})

const makeVueDesktopRuntime = (
  app: DesktopAppManifest,
  transport: DesktopRendererRpcTransport | undefined,
  rpcLayers: ReadonlyArray<AnyDesktopRpcLayer<never, never>> | undefined
): VueDesktopRuntime => {
  const runtime = ManagedRuntime.make(
    makeDesktopRendererRpcLayer(app, {
      framework: "vue",
      transport: transport ?? getGlobalDesktopRendererRpcTransport(),
      rpcLayers
    })
  )
  let clients: DesktopRendererRpcClientMap
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
  client: DesktopRendererRpcClient
): Readonly<Record<string, VueEndpoint>> => {
  const endpoints = Object.create(null) as Record<string, VueEndpoint>

  for (const descriptor of descriptors) {
    const invoke = (input: unknown): ReturnType<DesktopRendererRpcClientMethod> => {
      const method = client[descriptor.tag]
      if (method === undefined) {
        throw makeMissingDesktopRpcClientError(
          "vue",
          descriptor.tag,
          `No renderer RPC client method is installed for ${descriptor.tag}`
        )
      }
      return method(input)
    }

    const endpoint =
      descriptor.kind === "stream"
        ? {
            useStream: ((input?: unknown) =>
              runStream(asStream(invoke(input), descriptor.tag))) as VueComposable<
              unknown,
              Readonly<Ref<VueStreamState<unknown, unknown>>>
            >
          }
        : descriptor.kind === "query"
          ? {
              useQuery: ((input?: unknown) =>
                runQuery(asEffect(invoke(input), descriptor.tag))) as VueComposable<
                unknown,
                Readonly<Ref<VueAsyncState<unknown, unknown>>>
              >
            }
          : {
              useMutation: () => useMutation((input) => asEffect(invoke(input), descriptor.tag))
            }

    endpoints[descriptor.name] = withSupport(endpoint, descriptor.support)
  }

  return Object.freeze(endpoints)
}

const withSupport = <
  Endpoint extends VueEndpoint
>(
  endpoint: Endpoint,
  support: RpcSupportMetadata
): SupportedVueEndpoint<Endpoint> => {
  const supportedEndpoint = {
    ...endpoint,
    support,
    isSupported: support.status === "supported"
  } satisfies SupportedVueEndpoint<Endpoint>

  return Object.freeze(supportedEndpoint)
}

const useMutation = <I, A, E>(
  makeEffect: (input: I) => Effect.Effect<A, E, never>
): VueMutation<I, A, E> => {
  const state = shallowRef<VueAsyncState<A, E>>({ status: "idle" })
  let runId = 0
  let active = true

  onScopeDispose(() => {
    active = false
    runId += 1
  })

  const runPromiseImpl = async (input?: I): Promise<Exit.Exit<A, E>> => {
    const currentRun = runId + 1
    runId = currentRun
    state.value = { status: "running" }

    const exit = await Effect.runPromiseExit(makeEffect(input as I))
    if (!active || runId !== currentRun) {
      return exit
    }

    state.value = Exit.isSuccess(exit)
      ? { status: "success", value: exit.value }
      : { status: "failure", cause: exit.cause }
    return exit
  }

  return {
    state,
    run: ((input?: I) => {
      void runPromiseImpl(input)
    }) as VueComposable<I, void>,
    runPromise: runPromiseImpl as VueComposable<I, Promise<Exit.Exit<A, E>>>,
    reset: () => {
      runId += 1
      state.value = { status: "idle" }
    }
  }
}

const runQuery = <A, E>(effect: Effect.Effect<A, E, never>): Readonly<Ref<VueAsyncState<A, E>>> => {
  const state = shallowRef<VueAsyncState<A, E>>({ status: "running" })
  let active = true

  const fiber = Effect.runFork(effect)

  void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
    if (!active) {
      return
    }
    state.value = Exit.isSuccess(exit)
      ? { status: "success", value: exit.value }
      : { status: "failure", cause: exit.cause }
  })

  onScopeDispose(() => {
    active = false
    void Effect.runPromiseExit(Fiber.interrupt(fiber))
  })

  return state
}

const runStream = <A, E>(
  stream: Stream.Stream<A, E, never>
): Readonly<Ref<VueStreamState<A, E>>> => {
  const state = shallowRef<VueStreamState<A, E>>({
    status: "running",
    data: [],
    cause: undefined
  })
  let active = true
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (item) =>
      Effect.sync(() => {
        if (active) {
          state.value = { ...state.value, data: [...state.value.data, item] }
        }
      })
    )
  )

  void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
    if (!active) {
      return
    }
    state.value = Exit.isSuccess(exit)
      ? { ...state.value, status: "closed", cause: undefined }
      : { ...state.value, status: "failure", cause: exit.cause }
  })

  onScopeDispose(() => {
    active = false
    void Effect.runPromiseExit(Fiber.interrupt(fiber))
  })

  return state
}

const asEffect = (
  value: ReturnType<DesktopRendererRpcClientMethod>,
  tag: string
): Effect.Effect<unknown, unknown, never> => {
  if (Effect.isEffect(value)) {
    return value as Effect.Effect<unknown, unknown, never>
  }
  throw makeMissingDesktopRpcClientError(
    "vue",
    tag,
    `Renderer RPC client method ${tag} returned a Stream where an Effect was expected`
  )
}

const asStream = (
  value: ReturnType<DesktopRendererRpcClientMethod>,
  tag: string
): Stream.Stream<unknown, unknown, never> => {
  if (Stream.isStream(value)) {
    return value as Stream.Stream<unknown, unknown, never>
  }
  throw makeMissingDesktopRpcClientError(
    "vue",
    tag,
    `Renderer RPC client method ${tag} returned an Effect where a Stream was expected`
  )
}
