import { makeHostProtocolInvalidStateError, type HostProtocolError } from "@effect-desktop/bridge"
import type { WindowError } from "@effect-desktop/native"
import type { WindowHandle } from "@effect-desktop/native/contracts"
import { Effect, Option } from "effect"

import { useMutation, type MutationResult } from "./mutation.js"
import { useDesktopContext, type DesktopRuntimeContext } from "./provider.js"

export type CurrentWindowCloseMutation = MutationResult<void, void, WindowError>

export const useCurrentWindow = (): Option.Option<WindowHandle> =>
  Option.flatMap(useDesktopContext(), (ctx) => Option.fromUndefinedOr(ctx.currentWindow))

export const useCurrentWindowId = (): Option.Option<string> =>
  Option.map(useCurrentWindow(), (window) => window.id)

export const useCloseCurrentWindowMutation = (): CurrentWindowCloseMutation => {
  const context = useDesktopContext()
  return useMutation(() =>
    currentWindowEffect(context, "window.close", (ctx, window) => ctx.client.window.close(window))
  )
}

export const currentWindow = Object.freeze({
  handle: Object.freeze({
    useQuery: useCurrentWindow
  }),
  id: Object.freeze({
    useQuery: useCurrentWindowId
  }),
  close: Object.freeze({
    useMutation: useCloseCurrentWindowMutation
  })
})

const currentWindowEffect = <A>(
  context: Option.Option<DesktopRuntimeContext>,
  operation: string,
  run: (
    context: DesktopRuntimeContext,
    window: WindowHandle
  ) => Effect.Effect<A, WindowError, never>
): Effect.Effect<A, WindowError, never> =>
  Effect.gen(function* () {
    const ctx = yield* optionOrInvalidState(context, operation, "missing DesktopProvider")
    const window = yield* optionOrInvalidState(
      Option.fromUndefinedOr(ctx.currentWindow),
      operation,
      "missing current window"
    )
    return yield* run(ctx, window)
  })

const optionOrInvalidState = <A>(
  option: Option.Option<A>,
  operation: string,
  current: string
): Effect.Effect<A, HostProtocolError, never> =>
  Option.match(option, {
    onNone: () => Effect.fail(makeHostProtocolInvalidStateError(current, "call", operation)),
    onSome: Effect.succeed
  })
