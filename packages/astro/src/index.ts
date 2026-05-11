import type { DesktopAppManifest } from "@effect-desktop/core/renderer"
import { Data } from "effect"

export type AstroHydrationDirective = "load" | "idle" | "visible" | "media" | "only"
export type AstroClientOnlyRenderer = "react" | "vue" | "solid-js"

export interface AstroIslandOptions {
  readonly directive?: AstroHydrationDirective
  readonly renderer?: AstroClientOnlyRenderer
}

export interface AstroDesktopIsland<App extends DesktopAppManifest, Adapter> {
  readonly app: App
  readonly adapter: Adapter
  readonly directive: AstroHydrationDirective
  readonly renderer: AstroClientOnlyRenderer | undefined
}

export interface AstroDesktopAdapter<App extends DesktopAppManifest> {
  readonly app: App
  readonly island: <Adapter>(
    adapter: Adapter,
    options?: AstroIslandOptions
  ) => AstroDesktopIsland<App, Adapter>
}

export class MissingAstroClientOnlyRendererError extends Data.TaggedError(
  "MissingAstroClientOnlyRendererError"
)<{
  readonly message: string
}> {}

export const AstroDesktop = Object.freeze({
  from: <App extends DesktopAppManifest>(app: App): AstroDesktopAdapter<App> =>
    Object.freeze({
      app,
      island: <Adapter>(adapter: Adapter, options?: AstroIslandOptions) =>
        makeIsland(app, adapter, options)
    }),
  island: <App extends DesktopAppManifest, Adapter>(
    app: App,
    adapter: Adapter,
    options?: AstroIslandOptions
  ): AstroDesktopIsland<App, Adapter> => makeIsland(app, adapter, options)
})

const makeIsland = <App extends DesktopAppManifest, Adapter>(
  app: App,
  adapter: Adapter,
  options?: AstroIslandOptions
): AstroDesktopIsland<App, Adapter> => {
  const directive = options?.directive ?? "load"
  if (directive === "only" && options?.renderer === undefined) {
    throw new MissingAstroClientOnlyRendererError({
      message:
        'Astro client:only islands must declare a renderer such as "react", "vue", or "solid-js"'
    })
  }

  return Object.freeze({
    app,
    adapter,
    directive,
    renderer: options?.renderer
  })
}
