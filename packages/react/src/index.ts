import type { HostProtocolError } from "@effect-desktop/bridge"
import type { WindowCreateOptions, WindowHandle, WindowServiceApi } from "@effect-desktop/native"
import { Option } from "effect"
import { createContext, createElement, useContext, type ReactNode } from "react"

export interface DesktopWindowClient {
  readonly create: (
    input?: WindowCreateOptions
  ) => WindowServiceApi["create"] extends (input?: WindowCreateOptions) => infer Result
    ? Result
    : never
  readonly setTitle: (
    window: WindowHandle,
    title: string
  ) => WindowServiceApi["setTitle"] extends (window: WindowHandle, title: string) => infer Result
    ? Result
    : never
  readonly close: (
    window: WindowHandle
  ) => WindowServiceApi["close"] extends (window: WindowHandle) => infer Result ? Result : never
}

export interface DesktopClient {
  readonly Window: DesktopWindowClient
}

export interface DesktopProviderProps {
  readonly client: DesktopClient
  readonly children?: ReactNode
}

const DesktopContext = createContext<Option.Option<DesktopClient>>(Option.none())

export const DesktopProvider = ({ client, children }: DesktopProviderProps) =>
  createElement(DesktopContext.Provider, { value: Option.some(client) }, children)

export const useDesktop = (): Option.Option<DesktopClient> => useContext(DesktopContext)

export const useWindow = (): Option.Option<DesktopWindowClient> =>
  Option.map(useDesktop(), (desktop) => desktop.Window)

export type DesktopFailure = HostProtocolError
