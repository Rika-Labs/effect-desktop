import { makeHostProtocolInvalidStateError, type HostProtocolError } from "@effect-desktop/bridge"
import type { WindowCreateOptions, WindowError, WindowHandle } from "@effect-desktop/native"
import { Effect, Option } from "effect"

import { useMutation, type MutationResult } from "./mutation.js"
import { useDesktopContext, type DesktopRuntimeContext } from "./provider.js"

export interface WindowSetTitleInput {
  readonly window: WindowHandle
  readonly title: string
}

export interface WindowCloseInput {
  readonly window: WindowHandle
}

export type WindowCreateMutation = MutationResult<
  WindowCreateOptions | undefined,
  WindowHandle,
  WindowError
>
export type WindowSetTitleMutation = MutationResult<WindowSetTitleInput, void, WindowError>
export type WindowCloseMutation = MutationResult<WindowCloseInput, void, WindowError>

export const useCreateWindowMutation = (): WindowCreateMutation => {
  const context = useDesktopContext()
  return useMutation((input) =>
    desktopContextEffect(context, "Window.create", (ctx) => ctx.client.Window.create(input))
  )
}

export const useSetWindowTitleMutation = (): WindowSetTitleMutation => {
  const context = useDesktopContext()
  return useMutation((input) =>
    desktopContextEffect(context, "Window.setTitle", (ctx) =>
      ctx.client.Window.setTitle(input.window, input.title)
    )
  )
}

export const useCloseWindowMutation = (): WindowCloseMutation => {
  const context = useDesktopContext()
  return useMutation((input) =>
    desktopContextEffect(context, "Window.close", (ctx) => ctx.client.Window.close(input.window))
  )
}

export const windows = Object.freeze({
  create: Object.freeze({
    useMutation: useCreateWindowMutation
  }),
  setTitle: Object.freeze({
    useMutation: useSetWindowTitleMutation
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
