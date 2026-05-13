import type { WithRpcEndpointKind } from "@effect-desktop/bridge"
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
import { Cause, Effect, Exit, Fiber, ManagedRuntime, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import {
  createContext,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type JSX
} from "solid-js"
import { createComponent, render as solidRender } from "solid-js/web"

export {
  RegistryContext as DesktopAtomRegistryContext,
  RegistryProvider as DesktopAtomRegistryProvider,
  useAtom,
  useAtomInitialValues,
  useAtomMount,
  useAtomRef,
  useAtomRefProp,
  useAtomRefPropValue,
  useAtomRefresh,
  useAtomResource,
  useAtomSet,
  useAtomSubscribe,
  useAtomValue
} from "@effect/atom-solid"

type EndpointName<Tag extends string> = Tag extends `${string}.${infer Rest}`
  ? EndpointName<Rest>
  : Uncapitalize<Tag>

type SolidRpcEndpoint<R extends Rpc.Any> = WithSupport<
  Rpc.Success<R> extends Stream.Stream<infer A, infer E, infer _R>
    ? SolidStreamEndpoint<Rpc.PayloadConstructor<R>, A, E | Rpc.Error<R>>
    : R extends WithRpcEndpointKind<R, "query">
      ? SolidQueryEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
      : SolidMutationEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
>

export type SolidDesktopRpcs<Group extends RpcGroup.Any> = Readonly<
  Record<string, SolidEndpoint & SolidDesktopSupport>
> & {
  readonly [Current in RpcGroup.Rpcs<Group> as EndpointName<
    Current["_tag"]
  >]: SolidRpcEndpoint<Current>
}

export type SolidAsyncState<A, E> =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "success"; readonly value: A }
  | { readonly status: "failure"; readonly cause: Cause.Cause<E> }

export interface SolidStreamState<A, E> {
  readonly status: "idle" | "running" | "closed" | "failure"
  readonly data: readonly A[]
  readonly cause: Cause.Cause<E> | undefined
}

export type SolidPrimitive<I, A> = [I] extends [void]
  ? () => A
  : undefined extends I
    ? (input?: I) => A
    : (input: I) => A

export type SolidStreamPrimitive<I, A, E> = [I] extends [void]
  ? (options?: DesktopStreamOptions<A>) => Accessor<SolidStreamState<A, E>>
  : undefined extends I
    ? (input?: I, options?: DesktopStreamOptions<A>) => Accessor<SolidStreamState<A, E>>
    : (input: I, options?: DesktopStreamOptions<A>) => Accessor<SolidStreamState<A, E>>

export interface SolidMutation<I, A, E> {
  readonly state: Accessor<SolidAsyncState<A, E>>
  readonly run: SolidPrimitive<I, void>
  readonly runPromise: SolidPrimitive<I, Promise<Exit.Exit<A, E>>>
  readonly reset: () => void
}

export interface SolidMutationEndpoint<I, A, E> {
  readonly createMutation: () => SolidMutation<I, A, E>
}

export interface SolidQueryEndpoint<I, A, E> {
  readonly createQuery: SolidPrimitive<I, Accessor<SolidAsyncState<A, E>>>
}

export interface SolidStreamEndpoint<I, A, E> {
  readonly createStream: SolidStreamPrimitive<I, A, E>
}

export interface SolidDesktopSupport extends DesktopEndpointSupport {}

type WithSupport<Endpoint> = Endpoint & SolidDesktopSupport

type SolidEndpoint =
  | SolidMutationEndpoint<unknown, unknown, unknown>
  | SolidQueryEndpoint<unknown, unknown, unknown>
  | SolidStreamEndpoint<unknown, unknown, unknown>

export interface SolidDesktopRootProps {
  readonly transport?: DesktopRendererRpcTransport | undefined
  readonly rpcLayers?: ReadonlyArray<AnyDesktopRpcLayer<never, never>> | undefined
  readonly children?: JSX.Element
}

export interface SolidDesktopRenderOptions {
  readonly transport?: SolidDesktopRootProps["transport"]
  readonly rpcLayers?: SolidDesktopRootProps["rpcLayers"]
}

export interface SolidDesktopAdapter<App extends DesktopAppManifest> {
  readonly app: App
  readonly DesktopRoot: (props: SolidDesktopRootProps) => JSX.Element
  readonly render: (
    children: () => JSX.Element,
    mount: HTMLElement,
    options?: SolidDesktopRenderOptions
  ) => () => void
  readonly useDesktop: <Group extends RpcGroupWithRequests>(group: Group) => SolidDesktopRpcs<Group>
}

export {
  MissingDesktopContextError,
  MissingDesktopRpcClientError
} from "@effect-desktop/core/renderer"

interface SolidDesktopContextValue {
  readonly clients: DesktopRendererRpcClientMap
}

interface SolidDesktopRuntime {
  readonly clients: DesktopRendererRpcClientMap
  readonly dispose: () => Promise<void>
}

const SolidDesktopContext = createContext<SolidDesktopContextValue>()

export const SolidDesktop = Object.freeze({
  from: <App extends DesktopAppManifest>(app: App): SolidDesktopAdapter<App> => {
    const DesktopRoot = (props: SolidDesktopRootProps): JSX.Element => {
      const runtime = makeSolidDesktopRuntime(app, props.transport, props.rpcLayers)
      onCleanup(() => {
        void runtime.dispose()
      })
      return createComponent(SolidDesktopContext.Provider, {
        value: { clients: runtime.clients },
        get children() {
          return props.children
        }
      })
    }

    const useDesktop = <Group extends RpcGroupWithRequests>(
      group: Group
    ): SolidDesktopRpcs<Group> => {
      const context = useContext(SolidDesktopContext)
      if (context === undefined) {
        throw makeMissingDesktopContextError(
          "solid",
          "SolidDesktop.DesktopRoot or SolidDesktop.render() is required before useDesktop(group)"
        )
      }

      const client = context.clients.get(group)
      if (client === undefined) {
        throw makeMissingDesktopRpcsError(
          Array.from(group.requests.keys()),
          "No renderer RPC client is installed for this group"
        )
      }

      return bindRendererEndpoints<SolidEndpoint>(describeRpcs(app, group), client, "solid", {
        query: (run) => ({
          createQuery: ((input?: unknown) => createQueryState(run(input))) as SolidPrimitive<
            unknown,
            Accessor<SolidAsyncState<unknown, unknown>>
          >
        }),
        mutation: (run) => ({
          createMutation: () => createMutationState((input) => run(input))
        }),
        stream: (run, descriptor) => ({
          createStream: ((
            inputOrOptions?: unknown,
            streamOptions?: DesktopStreamOptions<unknown>
          ) => {
            const input = descriptor.hasPayload ? inputOrOptions : undefined
            const options = descriptor.hasPayload
              ? streamOptions
              : isDesktopStreamOptions(inputOrOptions)
                ? inputOrOptions
                : streamOptions
            return createStreamState(run(input), options)
          }) as SolidStreamPrimitive<unknown, unknown, unknown>
        })
      }) as SolidDesktopRpcs<Group>
    }

    return Object.freeze({
      app,
      DesktopRoot,
      render: (
        children: () => JSX.Element,
        mount: HTMLElement,
        options?: SolidDesktopRenderOptions
      ) => {
        const rootProps =
          options?.transport === undefined && options?.rpcLayers === undefined
            ? {
                get children() {
                  return children()
                }
              }
            : {
                transport: options.transport,
                rpcLayers: options.rpcLayers,
                get children() {
                  return children()
                }
              }
        return solidRender(() => createComponent(DesktopRoot, rootProps), mount)
      },
      useDesktop
    })
  }
})

const makeSolidDesktopRuntime = (
  app: DesktopAppManifest,
  transport: DesktopRendererRpcTransport | undefined,
  rpcLayers: ReadonlyArray<AnyDesktopRpcLayer<never, never>> | undefined
): SolidDesktopRuntime => {
  const runtime = ManagedRuntime.make(
    makeDesktopRendererRpcLayer(app, {
      framework: "solid",
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

const createMutationState = <I, A, E>(
  makeEffect: (input: I) => Effect.Effect<A, E, never>
): SolidMutation<I, A, E> => {
  const [state, setState] = createSignal<SolidAsyncState<A, E>>({ status: "idle" })
  let runId = 0
  let active = true

  onCleanup(() => {
    active = false
    runId += 1
  })

  const runPromiseImpl = async (input?: I): Promise<Exit.Exit<A, E>> => {
    const currentRun = runId + 1
    runId = currentRun
    setState({ status: "running" })

    const exit = await Effect.runPromiseExit(makeEffect(input as I))
    if (!active || runId !== currentRun) {
      return exit
    }

    setState(
      Exit.isSuccess(exit)
        ? { status: "success", value: exit.value }
        : { status: "failure", cause: exit.cause }
    )
    return exit
  }

  return {
    state,
    run: ((input?: I) => {
      void runPromiseImpl(input)
    }) as SolidPrimitive<I, void>,
    runPromise: runPromiseImpl as SolidPrimitive<I, Promise<Exit.Exit<A, E>>>,
    reset: () => {
      runId += 1
      setState({ status: "idle" })
    }
  }
}

const createQueryState = <A, E>(
  effect: Effect.Effect<A, E, never>
): Accessor<SolidAsyncState<A, E>> => {
  const [state, setState] = createSignal<SolidAsyncState<A, E>>({ status: "running" })
  let active = true

  const fiber = Effect.runFork(effect)

  void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
    if (!active) {
      return
    }
    setState(
      Exit.isSuccess(exit)
        ? { status: "success", value: exit.value }
        : { status: "failure", cause: exit.cause }
    )
  })

  onCleanup(() => {
    active = false
    void Effect.runPromiseExit(Fiber.interrupt(fiber))
  })

  return state
}

const createStreamState = <A, E>(
  stream: Stream.Stream<A, E, never>,
  options: DesktopStreamOptions<A> = {}
): Accessor<SolidStreamState<A, E>> => {
  const capacity = normalizeDesktopStreamCapacity(options.capacity)
  const [state, setState] = createSignal<SolidStreamState<A, E>>({
    status: "running",
    data: [],
    cause: undefined
  })
  const dispose = runRendererStream(
    stream,
    options,
    (item) => {
      setState((current) => ({ ...current, data: appendBounded(current.data, item, capacity) }))
    },
    (exit) => {
      setState((current) =>
        Exit.isSuccess(exit)
          ? { ...current, status: "closed", cause: undefined }
          : { ...current, status: "failure", cause: exit.cause }
      )
    }
  )

  onCleanup(() => {
    dispose()
  })

  return state
}
