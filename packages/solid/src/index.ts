import type { WithRpcEndpointKind } from "@effect-desktop/bridge"
import {
  describeRpcs,
  MissingDesktopContextError,
  MissingDesktopRpcClientError,
  MissingDesktopRpcsError,
  type DesktopAppDefinition,
  type RpcGroupWithRequests
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"
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

type EndpointName<Tag extends string> = Tag extends `${string}.${infer Rest}`
  ? EndpointName<Rest>
  : Uncapitalize<Tag>

type SolidRpcEndpoint<R extends Rpc.Any> =
  Rpc.Success<R> extends Stream.Stream<infer A, infer E, infer _R>
    ? SolidStreamEndpoint<Rpc.PayloadConstructor<R>, A, E | Rpc.Error<R>>
    : R extends WithRpcEndpointKind<R, "query">
      ? SolidQueryEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>
      : SolidMutationEndpoint<Rpc.PayloadConstructor<R>, Rpc.Success<R>, Rpc.Error<R>>

export type SolidDesktopRpcs<Group extends RpcGroup.Any> = {
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
  readonly createStream: SolidPrimitive<I, Accessor<SolidStreamState<A, E>>>
}

export type SolidDesktopRpcClientMethod = (
  input: unknown
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

export type SolidDesktopRpcClient = Readonly<Record<string, SolidDesktopRpcClientMethod>>
export type SolidDesktopClientMap = ReadonlyMap<RpcGroup.Any, SolidDesktopRpcClient>

export interface SolidDesktopRootProps {
  readonly clients?:
    | SolidDesktopClientMap
    | readonly (readonly [RpcGroup.Any, SolidDesktopRpcClient])[]
  readonly children?: JSX.Element
}

export interface SolidDesktopRenderOptions {
  readonly clients?: SolidDesktopRootProps["clients"]
}

export interface SolidDesktopAdapter<App extends DesktopAppDefinition<unknown, unknown>> {
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
} from "@effect-desktop/core"

interface SolidDesktopContextValue {
  readonly clients: SolidDesktopClientMap
}

const SolidDesktopContext = createContext<SolidDesktopContextValue>()

export const SolidDesktop = Object.freeze({
  from: <App extends DesktopAppDefinition<unknown, unknown>>(
    app: App
  ): SolidDesktopAdapter<App> => {
    const DesktopRoot = (props: SolidDesktopRootProps): JSX.Element =>
      createComponent(SolidDesktopContext.Provider, {
        value: { clients: normalizeClients(props.clients) },
        get children() {
          return props.children
        }
      })

    const useDesktop = <Group extends RpcGroupWithRequests>(
      group: Group
    ): SolidDesktopRpcs<Group> => {
      const context = useContext(SolidDesktopContext)
      if (context === undefined) {
        throw new MissingDesktopContextError({
          framework: "solid",
          message:
            "SolidDesktop.DesktopRoot or SolidDesktop.render() is required before useDesktop(group)"
        })
      }

      const client = context.clients.get(group)
      if (client === undefined) {
        throw new MissingDesktopRpcsError({
          message: "No renderer RPC client is installed for this group",
          tags: Array.from(group.requests.keys())
        })
      }

      return makeEndpoints(describeRpcs(app, group), client) as SolidDesktopRpcs<Group>
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
          options?.clients === undefined
            ? {
                get children() {
                  return children()
                }
              }
            : {
                clients: options.clients,
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

const normalizeClients = (
  clients: SolidDesktopRootProps["clients"] | undefined
): SolidDesktopClientMap => (clients === undefined ? new Map() : new Map(clients))

const makeEndpoints = (
  descriptors: ReturnType<typeof describeRpcs>,
  client: SolidDesktopRpcClient
): Readonly<
  Record<
    string,
    | SolidMutationEndpoint<unknown, unknown, unknown>
    | SolidQueryEndpoint<unknown, unknown, unknown>
    | SolidStreamEndpoint<unknown, unknown, unknown>
  >
> => {
  const endpoints: Record<
    string,
    | SolidMutationEndpoint<unknown, unknown, unknown>
    | SolidQueryEndpoint<unknown, unknown, unknown>
    | SolidStreamEndpoint<unknown, unknown, unknown>
  > = {}

  for (const descriptor of descriptors) {
    const invoke = (input: unknown): ReturnType<SolidDesktopRpcClientMethod> => {
      const method = client[descriptor.tag]
      if (method === undefined) {
        throw new MissingDesktopRpcClientError({
          framework: "solid",
          message: `No renderer RPC client method is installed for ${descriptor.tag}`,
          tag: descriptor.tag
        })
      }
      return method(input)
    }

    endpoints[descriptor.name] =
      descriptor.kind === "stream"
        ? {
            createStream: ((input?: unknown) =>
              createStreamState(asStream(invoke(input), descriptor.tag))) as SolidPrimitive<
              unknown,
              Accessor<SolidStreamState<unknown, unknown>>
            >
          }
        : descriptor.kind === "query"
          ? {
              createQuery: ((input?: unknown) =>
                createQueryState(asEffect(invoke(input), descriptor.tag))) as SolidPrimitive<
                unknown,
                Accessor<SolidAsyncState<unknown, unknown>>
              >
            }
          : {
              createMutation: () =>
                createMutationState((input) => asEffect(invoke(input), descriptor.tag))
            }
  }

  return Object.freeze(endpoints)
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

  onCleanup(() => {
    active = false
  })

  void Effect.runPromiseExit(effect).then((exit) => {
    if (!active) {
      return
    }
    setState(
      Exit.isSuccess(exit)
        ? { status: "success", value: exit.value }
        : { status: "failure", cause: exit.cause }
    )
  })

  return state
}

const createStreamState = <A, E>(
  stream: Stream.Stream<A, E, never>
): Accessor<SolidStreamState<A, E>> => {
  const [state, setState] = createSignal<SolidStreamState<A, E>>({
    status: "running",
    data: [],
    cause: undefined
  })
  let active = true
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (item) =>
      Effect.sync(() => {
        if (active) {
          setState((current) => ({ ...current, data: [...current.data, item] }))
        }
      })
    )
  )

  void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
    if (!active) {
      return
    }
    setState((current) =>
      Exit.isSuccess(exit)
        ? { ...current, status: "closed", cause: undefined }
        : { ...current, status: "failure", cause: exit.cause }
    )
  })

  onCleanup(() => {
    active = false
    void Effect.runPromiseExit(Fiber.interrupt(fiber))
  })

  return state
}

const asEffect = (
  value: ReturnType<SolidDesktopRpcClientMethod>,
  tag: string
): Effect.Effect<unknown, unknown, never> => {
  if (Effect.isEffect(value)) {
    return value as Effect.Effect<unknown, unknown, never>
  }
  throw new MissingDesktopRpcClientError({
    framework: "solid",
    message: `Renderer RPC client method ${tag} returned a Stream where an Effect was expected`,
    tag
  })
}

const asStream = (
  value: ReturnType<SolidDesktopRpcClientMethod>,
  tag: string
): Stream.Stream<unknown, unknown, never> => {
  if (Stream.isStream(value)) {
    return value as Stream.Stream<unknown, unknown, never>
  }
  throw new MissingDesktopRpcClientError({
    framework: "solid",
    message: `Renderer RPC client method ${tag} returned an Effect where a Stream was expected`,
    tag
  })
}
