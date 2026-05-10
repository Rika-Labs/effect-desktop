import type { WindowCreateOptions, WindowError, WindowHandle } from "@effect-desktop/native"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { AtomRegistry, Reactivity } from "effect/unstable/reactivity"
import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from "react"

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
  readonly runtime: ManagedRuntime.ManagedRuntime<Reactivity.Reactivity, never>
}

export interface DesktopProviderProps {
  readonly client: DesktopClient
  readonly currentWindow?: WindowHandle | undefined
  readonly children?: ReactNode | undefined
}

const DesktopContext = createContext<Option.Option<DesktopRuntimeContext>>(Option.none())

const makeContext = (
  client: DesktopClient,
  currentWindow: WindowHandle | undefined
): DesktopRuntimeContext => {
  const registry = AtomRegistry.make()
  const runtime = ManagedRuntime.make(Layer.provide(Reactivity.layer, AtomRegistry.layer))
  return currentWindow === undefined
    ? { client, registry, runtime }
    : { client, currentWindow, registry, runtime }
}

export const DesktopProvider = ({
  client,
  currentWindow,
  children
}: DesktopProviderProps): ReactNode => {
  const ctx = useMemo(() => makeContext(client, currentWindow), [client, currentWindow])

  useEffect(() => {
    return () => {
      ctx.registry.dispose()
      void ctx.runtime.dispose()
    }
  }, [ctx])

  const value = Option.some(ctx)
  return createElement(DesktopContext.Provider, { value }, children)
}

export const useDesktopContext = (): Option.Option<DesktopRuntimeContext> =>
  useContext(DesktopContext)

export const useDesktop = (): Option.Option<DesktopClient> =>
  Option.map(useContext(DesktopContext), (ctx) => ctx.client)

export const useWindow = (): Option.Option<WindowHandle> =>
  Option.flatMap(useContext(DesktopContext), (ctx) => Option.fromUndefinedOr(ctx.currentWindow))
