import type { WindowCreateOptions, WindowError, WindowHandle } from "@effect-desktop/native"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { AtomRegistry, Reactivity } from "effect/unstable/reactivity"
import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from "react"

import { BrowserContext, type IndexedDb } from "./platform-browser.js"

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
  readonly currentWindow?: WindowHandle | undefined
  readonly registry: AtomRegistry.AtomRegistry
  readonly runtime: ManagedRuntime.ManagedRuntime<
    Reactivity.Reactivity | IndexedDb.IndexedDb,
    never
  >
}

export type CleanupErrorHandler = (error: unknown, context: string) => void

export const disposeRuntime = (
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<Reactivity.Reactivity | IndexedDb.IndexedDb, never>,
    "dispose"
  >,
  onCleanupError?: CleanupErrorHandler
): void => {
  void Promise.resolve(runtime.dispose()).then(undefined, (cause) => {
    if (cause !== undefined) {
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
  readonly client: DesktopClient
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

export const DesktopProvider = ({
  client,
  currentWindow,
  children,
  onCleanupError
}: DesktopProviderProps): ReactNode => {
  const ctx = useMemo(() => makeContext(client, currentWindow), [client, currentWindow])

  useEffect(() => {
    return () => {
      ctx.registry.dispose()
      disposeRuntime(ctx.runtime, onCleanupError)
    }
  }, [ctx, onCleanupError])

  const value = Option.some(ctx)
  return createElement(DesktopContext.Provider, { value }, children)
}

export const useDesktopContext = (): Option.Option<DesktopRuntimeContext> =>
  useContext(DesktopContext)

export const useDesktop = (): Option.Option<DesktopClient> =>
  Option.map(useContext(DesktopContext), (ctx) => ctx.client)

export const useWindow = (): Option.Option<WindowHandle> =>
  Option.flatMap(useContext(DesktopContext), (ctx) => Option.fromUndefinedOr(ctx.currentWindow))
