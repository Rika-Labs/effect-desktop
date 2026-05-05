import type { HostProtocolError } from "@effect-desktop/bridge"
import type { WindowCreateOptions, WindowError, WindowHandle } from "@effect-desktop/native"
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type DependencyList,
  type ReactNode
} from "react"

export interface DesktopWindowClient {
  readonly create: (input?: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
  readonly setTitle: (
    window: WindowHandle,
    title: string
  ) => Effect.Effect<void, WindowError, never>
  readonly close: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
}

export interface DesktopClient {
  readonly Window: DesktopWindowClient
}

export interface DesktopRuntimeContext {
  readonly client: DesktopClient
  readonly currentWindow?: WindowHandle
}

export interface DesktopProviderProps {
  readonly client: DesktopClient
  readonly currentWindow?: WindowHandle
  readonly children?: ReactNode
}

export type DesktopStreamStatus = "idle" | "running" | "closed" | "failure"

export interface DesktopStreamState<A, E> {
  readonly status: DesktopStreamStatus
  readonly data: readonly A[]
  readonly error: Option.Option<Cause.Cause<E>>
}

export interface PermissionState {
  readonly status: "deferred"
  readonly permission: string
}

const DesktopContext = createContext<Option.Option<DesktopRuntimeContext>>(Option.none())

export const DesktopProvider = ({ client, currentWindow, children }: DesktopProviderProps) =>
  createElement(
    DesktopContext.Provider,
    { value: Option.some(contextValue(client, currentWindow)) },
    children
  )

export const useDesktop = (): Option.Option<DesktopClient> =>
  Option.map(useContext(DesktopContext), (context) => context.client)

export const useWindow = (): Option.Option<WindowHandle> =>
  Option.flatMap(useContext(DesktopContext), (context) =>
    Option.fromUndefinedOr(context.currentWindow)
  )

export const useDesktopStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  deps: DependencyList = []
): DesktopStreamState<A, E> => {
  const [state, setState] = useState<DesktopStreamState<A, E>>(idleStreamState<A, E>())

  useEffect(() => {
    let mounted = true
    setState(runningStreamState())

    const fiber = Effect.runFork(
      Stream.runForEach(stream, (item) =>
        Effect.sync(() => {
          if (mounted) {
            setState((current) => ({
              ...current,
              data: [...current.data, item]
            }))
          }
        })
      )
    )

    void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
      if (!mounted) {
        return
      }

      if (Exit.isSuccess(exit)) {
        setState((current) => ({
          ...current,
          status: "closed",
          error: Option.none()
        }))
        return
      }

      setState((current) => ({
        ...current,
        status: "failure",
        error: Option.some(exit.cause)
      }))
    })

    return () => {
      mounted = false
      void Effect.runPromiseExit(Fiber.interrupt(fiber))
    }
  }, [stream, ...deps])

  return state
}

export const useResource = <
  Handle extends { readonly dispose: () => Effect.Effect<void, never, never> }
>(
  handle: Option.Option<Handle> | Handle
): Option.Option<Handle> => {
  const resource = useMemo(() => (Option.isOption(handle) ? handle : Option.some(handle)), [handle])

  useEffect(() => {
    return () => {
      if (Option.isSome(resource)) {
        void Effect.runPromiseExit(resource.value.dispose())
      }
    }
  }, [resource])

  return resource
}

export const usePermission = (permission: string): PermissionState => ({
  status: "deferred",
  permission
})

export type DesktopFailure = HostProtocolError

const contextValue = (
  client: DesktopClient,
  currentWindow: WindowHandle | undefined
): DesktopRuntimeContext =>
  currentWindow === undefined
    ? { client }
    : {
        client,
        currentWindow
      }

const idleStreamState = <A, E>(): DesktopStreamState<A, E> => ({
  status: "idle",
  data: [],
  error: Option.none()
})

const runningStreamState = <A, E>(): DesktopStreamState<A, E> => ({
  status: "running",
  data: [],
  error: Option.none()
})
