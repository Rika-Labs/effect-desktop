import { Context, Layer } from "effect"

export interface WindowContextApi {
  readonly registrationId: string
  readonly hostWindowId: string
}

export class WindowContext extends Context.Service<WindowContext, WindowContextApi>()(
  "@orika/core/runtime/window-context/WindowContext"
) {}

export const makeWindowContext = (input: {
  readonly registrationId: string
  readonly hostWindowId: string
}): WindowContextApi =>
  Object.freeze({
    registrationId: input.registrationId,
    hostWindowId: input.hostWindowId
  })

export const windowContextLayer = (context: WindowContextApi): Layer.Layer<WindowContext> =>
  Layer.succeed(WindowContext)(context)
