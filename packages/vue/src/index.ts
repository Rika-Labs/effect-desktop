import {
  bindRendererEndpoints,
  describeRpcs,
  getGlobalDesktopRendererRpcTransport,
  appendBounded,
  isDesktopStreamOptions,
  makeDesktopRendererRpcLayer,
  type AnyDesktopRpcLayer,
  makeMissingDesktopContextError,
  makeMissingDesktopRpcsError,
  normalizeDesktopStreamCapacity,
  RendererRpcClients,
  runRendererStream,
  type DesktopAppManifest,
  type DesktopEndpointSupport,
  type DesktopStreamOptions,
  type DesktopRendererRpcClientMap,
  type DesktopRendererRpcTransport,
  type RpcGroupWithRequests
} from "@effect-desktop/core/renderer"
import type { WithRpcEndpointKind } from "@effect-desktop/bridge"
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

export type VueDesktopRpcs<Group extends RpcGroup.Any> = Readonly<
  Record<string, VueEndpoint & VueDesktopSupport>
> & {
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

export type VueStreamComposable<I, A, E> = [I] extends [void]
  ? (options?: DesktopStreamOptions<A>) => Readonly<Ref<VueStreamState<A, E>>>
  : undefined extends I
    ? (input?: I, options?: DesktopStreamOptions<A>) => Readonly<Ref<VueStreamState<A, E>>>
    : (input: I, options?: DesktopStreamOptions<A>) => Readonly<Ref<VueStreamState<A, E>>>

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
  readonly useStream: VueStreamComposable<I, A, E>
}

export interface VueDesktopSupport extends DesktopEndpointSupport {}

type WithSupport<Endpoint> = Endpoint & VueDesktopSupport

type VueEndpoint =
  | VueMutationEndpoint<unknown, unknown, unknown>
  | VueQueryEndpoint<unknown, unknown, unknown>
  | VueStreamEndpoint<unknown, unknown, unknown>

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

      return bindRendererEndpoints<VueEndpoint>(describeRpcs(app, group), client, "vue", {
        query: (run) => ({
          useQuery: ((input?: unknown) => runQuery(run(input))) as VueComposable<
            unknown,
            Readonly<Ref<VueAsyncState<unknown, unknown>>>
          >
        }),
        mutation: (run) => ({
          useMutation: () => useMutation((input) => run(input))
        }),
        stream: (run, descriptor) => ({
          useStream: ((inputOrOptions?: unknown, streamOptions?: DesktopStreamOptions<unknown>) => {
            const input = descriptor.hasPayload ? inputOrOptions : undefined
            const options = descriptor.hasPayload
              ? streamOptions
              : isDesktopStreamOptions(inputOrOptions)
                ? inputOrOptions
                : streamOptions
            return runStream(run(input), options)
          }) as VueStreamComposable<unknown, unknown, unknown>
        })
      }) as VueDesktopRpcs<Group>
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
  stream: Stream.Stream<A, E, never>,
  options: DesktopStreamOptions<A> = {}
): Readonly<Ref<VueStreamState<A, E>>> => {
  const capacity = normalizeDesktopStreamCapacity(options.capacity)
  const state = shallowRef<VueStreamState<A, E>>({
    status: "running",
    data: [],
    cause: undefined
  })
  const dispose = runRendererStream(
    stream,
    options,
    (item) => {
      state.value = {
        ...state.value,
        data: appendBounded(state.value.data, item, capacity)
      }
    },
    (exit) => {
      state.value = Exit.isSuccess(exit)
        ? { ...state.value, status: "closed", cause: undefined }
        : { ...state.value, status: "failure", cause: exit.cause }
    }
  )

  onScopeDispose(() => {
    dispose()
  })

  return state
}
