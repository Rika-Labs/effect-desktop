import {
  describeRpcs,
  MissingDesktopContextError,
  MissingDesktopRpcClientError,
  MissingDesktopRpcsError,
  type DesktopAppDefinition,
  type RpcGroupWithRequests
} from "@rikalabs/effect-desktop/core"
import type { WithRpcEndpointKind } from "@rikalabs/effect-desktop/bridge"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"
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

type EndpointName<Tag extends string> = Tag extends `${string}.${infer Rest}`
  ? EndpointName<Rest>
  : Uncapitalize<Tag>

type VueRpcEndpoint<R extends Rpc.Any> =
  Rpc.Success<R> extends Stream.Stream<infer A, infer E, infer _R>
    ? VueStreamEndpoint<Rpc.PayloadConstructor<R>, A, E | Rpc.Error<R>>
    : R extends WithRpcEndpointKind<R, "query">
      ? VueQueryEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
      : VueMutationEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>

export type VueDesktopRpcs<Group extends RpcGroup.Any> = {
  readonly [Current in RpcGroup.Rpcs<Group> as EndpointName<Current["_tag"]>]: VueRpcEndpoint<Current>
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

export type VueDesktopRpcClientMethod = (
  input: unknown
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

export type VueDesktopRpcClient = Readonly<Record<string, VueDesktopRpcClientMethod>>
export type VueDesktopClientMap = ReadonlyMap<RpcGroup.Any, VueDesktopRpcClient>

export interface VueDesktopOptions {
  readonly clients?: VueDesktopClientMap | readonly (readonly [RpcGroup.Any, VueDesktopRpcClient])[]
}

export interface VueDesktopAdapter<App extends DesktopAppDefinition<unknown, unknown>> {
  readonly app: App
  readonly createApp: (rootComponent: Component, options?: VueDesktopOptions) => VueApp
  readonly provideDesktop: (options?: VueDesktopOptions) => void
  readonly useDesktop: <Group extends RpcGroupWithRequests>(group: Group) => VueDesktopRpcs<Group>
}

export { MissingDesktopContextError, MissingDesktopRpcClientError } from "@rikalabs/effect-desktop/core"

interface VueDesktopContext {
  readonly clients: VueDesktopClientMap
}

const VueDesktopKey: InjectionKey<VueDesktopContext> = Symbol("VueDesktop")
const MissingVueDesktopContext = Symbol("MissingVueDesktopContext")

export const VueDesktop = Object.freeze({
  from: <App extends DesktopAppDefinition<unknown, unknown>>(app: App): VueDesktopAdapter<App> => {
    const provideDesktop = (options?: VueDesktopOptions): void => {
      provide(VueDesktopKey, { clients: normalizeClients(options?.clients) })
    }

    const useDesktop = <Group extends RpcGroupWithRequests>(group: Group): VueDesktopRpcs<Group> => {
      const context = inject<VueDesktopContext | typeof MissingVueDesktopContext>(
        VueDesktopKey as InjectionKey<VueDesktopContext | typeof MissingVueDesktopContext>,
        MissingVueDesktopContext
      )
      if (context === MissingVueDesktopContext) {
        throw new MissingDesktopContextError({
          framework: "vue",
          message: "VueDesktop.provideDesktop() or VueDesktop.createApp() is required before useDesktop(group)"
        })
      }

      const client = context.clients.get(group)
      if (client === undefined) {
        throw new MissingDesktopRpcsError({
          message: "No renderer RPC client is installed for this group",
          tags: Array.from(group.requests.keys())
        })
      }

      return makeEndpoints(describeRpcs(app, group), client) as VueDesktopRpcs<Group>
    }

    return Object.freeze({
      app,
      createApp: (rootComponent: Component, options?: VueDesktopOptions) => {
        const vueApp = createVueApp(rootComponent)
        vueApp.provide(VueDesktopKey, { clients: normalizeClients(options?.clients) })
        return vueApp
      },
      provideDesktop,
      useDesktop
    })
  }
})

const normalizeClients = (clients: VueDesktopOptions["clients"] | undefined): VueDesktopClientMap =>
  clients === undefined ? new Map() : new Map(clients)

const makeEndpoints = (
  descriptors: ReturnType<typeof describeRpcs>,
  client: VueDesktopRpcClient
): Readonly<
  Record<
    string,
    | VueMutationEndpoint<unknown, unknown, unknown>
    | VueQueryEndpoint<unknown, unknown, unknown>
    | VueStreamEndpoint<unknown, unknown, unknown>
  >
> => {
  const endpoints: Record<
    string,
    | VueMutationEndpoint<unknown, unknown, unknown>
    | VueQueryEndpoint<unknown, unknown, unknown>
    | VueStreamEndpoint<unknown, unknown, unknown>
  > = {}

  for (const descriptor of descriptors) {
    const invoke = (input: unknown): ReturnType<VueDesktopRpcClientMethod> => {
      const method = client[descriptor.tag]
      if (method === undefined) {
        throw new MissingDesktopRpcClientError({
          framework: "vue",
          message: `No renderer RPC client method is installed for ${descriptor.tag}`,
          tag: descriptor.tag
        })
      }
      return method(input)
    }

    endpoints[descriptor.name] =
      descriptor.kind === "stream"
        ? {
            useStream: ((input?: unknown) => runStream(asStream(invoke(input), descriptor.tag))) as VueComposable<
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
  }

  return Object.freeze(endpoints)
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

const runQuery = <A, E>(
  effect: Effect.Effect<A, E, never>
): Readonly<Ref<VueAsyncState<A, E>>> => {
  const state = shallowRef<VueAsyncState<A, E>>({ status: "running" })
  let active = true

  onScopeDispose(() => {
    active = false
  })

  void Effect.runPromiseExit(effect).then((exit) => {
    if (!active) {
      return
    }
    state.value = Exit.isSuccess(exit)
      ? { status: "success", value: exit.value }
      : { status: "failure", cause: exit.cause }
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
  value: ReturnType<VueDesktopRpcClientMethod>,
  tag: string
): Effect.Effect<unknown, unknown, never> => {
  if (Effect.isEffect(value)) {
    return value as Effect.Effect<unknown, unknown, never>
  }
  throw new MissingDesktopRpcClientError({
    framework: "vue",
    message: `Renderer RPC client method ${tag} returned a Stream where an Effect was expected`,
    tag
  })
}

const asStream = (
  value: ReturnType<VueDesktopRpcClientMethod>,
  tag: string
): Stream.Stream<unknown, unknown, never> => {
  if (Stream.isStream(value)) {
    return value as Stream.Stream<unknown, unknown, never>
  }
  throw new MissingDesktopRpcClientError({
    framework: "vue",
    message: `Renderer RPC client method ${tag} returned an Effect where a Stream was expected`,
    tag
  })
}
