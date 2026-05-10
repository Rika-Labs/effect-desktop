"use client"

import type { DesktopAppDefinition } from "@rikalabs/effect-desktop/core"
import {
  ReactDesktop,
  type ReactDesktopAdapter,
  type ReactDesktopRootProps
} from "@rikalabs/effect-desktop/react/desktop"
import type { ReactNode } from "react"

export interface NextDesktopAdapter<App extends DesktopAppDefinition<unknown, unknown>>
  extends ReactDesktopAdapter<App> {
  readonly app: App
  readonly DesktopRoot: (props: ReactDesktopRootProps) => ReactNode
  readonly createRoot: (
    children: ReactNode,
    props?: Omit<ReactDesktopRootProps, "children">
  ) => ReactNode
  readonly useDesktop: ReactDesktopAdapter<App>["useDesktop"]
}

export const NextDesktop = Object.freeze({
  from: <App extends DesktopAppDefinition<unknown, unknown>>(
    app: App
  ): NextDesktopAdapter<App> => {
    const react = ReactDesktop.from(app)
    return Object.freeze({
      app,
      DesktopRoot: react.DesktopRoot,
      createRoot: react.createRoot,
      useDesktop: react.useDesktop
    })
  }
})
