import { makeHostProtocolInvalidStateError } from "@orika/bridge"
import type { WindowError } from "@orika/native"
import type { WindowCreateOptions, WindowHandle } from "@orika/native/contracts"
import { BrowserContext, type IndexedDb } from "@orika/platform-browser"
import { RegistryContext as DesktopAtomRegistryContext } from "@effect/atom-react"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, type Config } from "effect"
import { AtomRegistry, Reactivity } from "effect/unstable/reactivity"
import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from "react"

export interface DesktopWindowClient {
  readonly create: (input?: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
  readonly close: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly destroy: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
}

export interface DesktopClient {
  readonly window: DesktopWindowClient
}

export interface DesktopRuntimeContext {
  readonly client: DesktopClient
  readonly currentWindow?: WindowHandle | undefined
  readonly registry: AtomRegistry.AtomRegistry
  readonly runtime: ManagedRuntime.ManagedRuntime<
    Reactivity.Reactivity | IndexedDb.IndexedDb,
    Config.ConfigError
  >
}

export type CleanupErrorHandler = (error: unknown, context: string) => void

export const disposeRuntime = (
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<Reactivity.Reactivity | IndexedDb.IndexedDb, Config.ConfigError>,
    "disposeEffect"
  >,
  onCleanupError?: CleanupErrorHandler
): void => {
  void Effect.runCallback(runtime.disposeEffect, {
    onExit: (exit) => {
      if (!Exit.isFailure(exit)) {
        return
      }

      const cause = Cause.squash(exit.cause)
      if (onCleanupError === undefined) {
        const reportable = cause instanceof Error ? cause : new Error("runtime cleanup failed")
        reportError(reportable)
      } else {
        onCleanupError(cause, "runtime cleanup")
      }
    }
  })
}

export interface DesktopProviderProps {
  readonly client?: DesktopClient | undefined
  readonly currentWindow?: WindowHandle | undefined
  readonly children?: ReactNode | undefined
  readonly onCleanupError?: CleanupErrorHandler
}

const DesktopContext = createContext<Option.Option<DesktopRuntimeContext>>(Option.none())

const makeContext = (
  client: DesktopClient,
  currentWindow: WindowHandle | undefined
): DesktopRuntimeContext => {
  const registry = AtomRegistry.make()
  const runtimeLayer = Layer.merge(
    Layer.provide(Reactivity.layer, AtomRegistry.layer),
    BrowserContext.layer
  )
  const runtime = ManagedRuntime.make(runtimeLayer)
  return currentWindow === undefined
    ? { client, registry, runtime }
    : { client, currentWindow, registry, runtime }
}

export const createUnavailableDesktopClient = (message = "missing host bridge"): DesktopClient => {
  const unavailable = <A,>(operation: string): Effect.Effect<A, WindowError, never> =>
    Effect.fail(makeHostProtocolInvalidStateError(message, "call", operation))

  return Object.freeze({
    window: Object.freeze({
      create: (_input?: WindowCreateOptions) => unavailable<WindowHandle>("window.create"),
      close: (_window: WindowHandle) => unavailable<void>("window.close"),
      destroy: (_window: WindowHandle) => unavailable<void>("window.destroy")
    })
  } satisfies DesktopClient)
}

const defaultUnavailableDesktopClient = createUnavailableDesktopClient()

export const DesktopProvider = ({
  client = defaultUnavailableDesktopClient,
  currentWindow,
  children,
  onCleanupError
}: DesktopProviderProps): ReactNode => {
  const ctx = useMemo(() => makeContext(client, currentWindow), [client, currentWindow])

  useEffect(
    () => () => {
      ctx.registry.dispose()
      disposeRuntime(ctx.runtime, onCleanupError)
    },
    [ctx, onCleanupError]
  )

  const value = Option.some(ctx)
  return createElement(
    DesktopContext.Provider,
    { value },
    createElement(DesktopAtomRegistryContext.Provider, { value: ctx.registry }, children)
  )
}

export const useDesktopContext = (): Option.Option<DesktopRuntimeContext> =>
  useContext(DesktopContext)

export const useDesktop = (): Option.Option<DesktopClient> =>
  Option.map(useContext(DesktopContext), (ctx) => ctx.client)

export const useOptionalDesktopClient = (): Option.Option<DesktopClient> => useDesktop()

export const useDesktopClient = (): DesktopClient => {
  const desktop = useDesktop()
  if (Option.isNone(desktop)) {
    throw new RangeError("DesktopProvider is required before calling useDesktopClient")
  }
  return desktop.value
}

export const useWindow = (): Option.Option<WindowHandle> =>
  Option.flatMap(useContext(DesktopContext), (ctx) => Option.fromUndefinedOr(ctx.currentWindow))
