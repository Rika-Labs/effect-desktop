import { makeHostProtocolInvalidStateError, type HostProtocolError } from "@effect-desktop/bridge"
import type { WindowError } from "@effect-desktop/native"
import type { WindowCreateOptions, WindowHandle } from "@effect-desktop/native/contracts"
import { Effect, Option } from "effect"

import { useMutation, type MutationResult } from "./mutation.js"
import { useDesktopContext, type DesktopRuntimeContext } from "./provider.js"

export interface WindowCloseInput {
  readonly window: WindowHandle
}

export type WindowCreateMutation = MutationResult<
  WindowCreateOptions | undefined,
  WindowHandle,
  WindowError
>
export type WindowCloseMutation = MutationResult<WindowCloseInput, void, WindowError>

export const useCreateWindowMutation = (): WindowCreateMutation => {
  const context = useDesktopContext()
  return useMutation((input) =>
    desktopContextEffect(context, "window.create", (ctx) => ctx.client.window.create(input))
  )
}

export const useCloseWindowMutation = (): WindowCloseMutation => {
  const context = useDesktopContext()
  return useMutation((input) =>
    desktopContextEffect(context, "window.close", (ctx) => ctx.client.window.close(input.window))
  )
}

export const windows = Object.freeze({
  create: Object.freeze({
    useMutation: useCreateWindowMutation
  }),
  close: Object.freeze({
    useMutation: useCloseWindowMutation
  })
})

const desktopContextEffect = <A>(
  context: Option.Option<DesktopRuntimeContext>,
  operation: string,
  run: (context: DesktopRuntimeContext) => Effect.Effect<A, WindowError, never>
): Effect.Effect<A, WindowError, never> =>
  Option.match(context, {
    onNone: () => Effect.fail(missingProvider(operation)),
    onSome: run
  })

const missingProvider = (operation: string): HostProtocolError =>
  makeHostProtocolInvalidStateError("missing DesktopProvider", "call", operation)
