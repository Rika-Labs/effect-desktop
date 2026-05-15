import { Context, Layer } from "effect"

export interface DesktopWindowContextApi {
  readonly registrationId: string
  readonly hostWindowId: string
  readonly ownerScope: string
}

export class DesktopWindowContext extends Context.Service<
  DesktopWindowContext,
  DesktopWindowContextApi
>()("@effect-desktop/core/DesktopWindowContext") {}

export const windowOwnerScope = (hostWindowId: string): string => `window:${hostWindowId}`

export const makeDesktopWindowContext = (input: {
  readonly registrationId: string
  readonly hostWindowId: string
}): DesktopWindowContextApi =>
  Object.freeze({
    registrationId: input.registrationId,
    hostWindowId: input.hostWindowId,
    ownerScope: windowOwnerScope(input.hostWindowId)
  })

export const desktopWindowContextLayer = (
  context: DesktopWindowContextApi
): Layer.Layer<DesktopWindowContext> => Layer.succeed(DesktopWindowContext)(context)
