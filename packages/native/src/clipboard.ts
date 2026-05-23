import {
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import {
  ClipboardCapabilityMethods,
  ClipboardRpcEvents as ClipboardRpcEventsValue,
  ClipboardRpcs
} from "./clipboard-rpc.js"
import {
  type ClipboardCapability,
  ClipboardHtml,
  ClipboardImage,
  type ClipboardImageOptions,
  ClipboardIsSupportedInput,
  ClipboardSupportedResult,
  ClipboardText
} from "./contracts/clipboard.js"
import { isSupportedImageHeader } from "./contracts/image.js"

export {
  ClipboardClear,
  ClipboardIsSupported,
  ClipboardMethodNames,
  ClipboardReadHtml,
  ClipboardReadImage,
  ClipboardReadText,
  ClipboardRpcs,
  ClipboardWriteHtml,
  ClipboardWriteImage,
  ClipboardWriteText
} from "./clipboard-rpc.js"

export const ClipboardRpcEvents = ClipboardRpcEventsValue
export type ClipboardRpcEvents = typeof ClipboardRpcEvents

export type ClipboardError = HostProtocolError

const ClipboardRpcGroup = ClipboardRpcs
export type ClipboardRpc = RpcGroup.Rpcs<typeof ClipboardRpcGroup>

export interface ClipboardClientApi {
  readonly readText: () => Effect.Effect<ClipboardText, ClipboardError, never>
  readonly writeText: (input: string) => Effect.Effect<void, ClipboardError, never>
  readonly readHtml: () => Effect.Effect<ClipboardHtml, ClipboardError, never>
  readonly writeHtml: (input: string) => Effect.Effect<void, ClipboardError, never>
  readonly readImage: () => Effect.Effect<ClipboardImage, ClipboardError, never>
  readonly writeImage: (input: ClipboardImageOptions) => Effect.Effect<void, ClipboardError, never>
  readonly clear: () => Effect.Effect<void, ClipboardError, never>
  readonly isSupported: (
    capability: ClipboardCapability
  ) => Effect.Effect<ClipboardSupportedResult, ClipboardError, never>
}

export class ClipboardClient extends Context.Service<ClipboardClient, ClipboardClientApi>()(
  "@orika/native/ClipboardClient"
) {}

export interface ClipboardServiceApi {
  readonly readText: () => Effect.Effect<string, ClipboardError, never>
  readonly writeText: (text: string) => Effect.Effect<void, ClipboardError, never>
  readonly readHtml: () => Effect.Effect<string, ClipboardError, never>
  readonly writeHtml: (html: string) => Effect.Effect<void, ClipboardError, never>
  readonly readImage: () => Effect.Effect<ClipboardImage, ClipboardError, never>
  readonly writeImage: (input: ClipboardImageOptions) => Effect.Effect<void, ClipboardError, never>
  readonly clear: () => Effect.Effect<void, ClipboardError, never>
  readonly isSupported: (
    capability: ClipboardCapability
  ) => Effect.Effect<ClipboardSupportedResult, ClipboardError, never>
}

export class Clipboard extends Context.Service<Clipboard, ClipboardServiceApi>()(
  "@orika/native/Clipboard"
) {
  static readonly layer = Layer.effect(Clipboard)(
    Effect.gen(function* () {
      const client = yield* ClipboardClient
      return Clipboard.of(makeClipboardService(client))
    })
  )
}

export const ClipboardLive = Clipboard.layer

export type ClipboardRpcHandlers<R = never> = NativeRpcHandlers<typeof ClipboardRpcGroup, R>

export const ClipboardHandlersLive = ClipboardRpcGroup.toLayer({
  "Clipboard.readText": () =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      const text = yield* clipboard.readText()
      return new ClipboardText({ text })
    }),
  "Clipboard.writeText": (input) =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeText(input.text)
    }),
  "Clipboard.readHtml": () =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      const html = yield* clipboard.readHtml()
      return new ClipboardHtml({ html })
    }),
  "Clipboard.writeHtml": (input) =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeHtml(input.html)
    }),
  "Clipboard.readImage": () =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      return yield* clipboard.readImage()
    }),
  "Clipboard.writeImage": (input) =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeImage(input)
    }),
  "Clipboard.clear": () =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.clear()
    }),
  "Clipboard.isSupported": (input) =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      return yield* clipboard.isSupported(input.capability)
    })
})

export const ClipboardSurface = NativeSurface.make("Clipboard", ClipboardRpcGroup, {
  service: ClipboardClient,
  capabilities: ClipboardCapabilityMethods,
  handlers: ClipboardHandlersLive,
  client: (client) => clipboardClientFromRpcClient(client)
})

const makeClipboardService = (client: ClipboardClientApi): ClipboardServiceApi => {
  const service: ClipboardServiceApi = {
    readText: () => client.readText().pipe(Effect.map((result) => result.text)),
    writeText: (text) => client.writeText(text),
    readHtml: () => client.readHtml().pipe(Effect.map((result) => result.html)),
    writeHtml: (html) => client.writeHtml(html),
    readImage: () => client.readImage(),
    writeImage: (input) => client.writeImage(input),
    clear: () => client.clear(),
    isSupported: (capability) => client.isSupported(capability)
  }

  return Object.freeze(service)
}

const clipboardClientFromRpcClient = (
  client: DesktopRpcClient<ClipboardRpc>
): ClipboardClientApi => {
  const clipboardClient: ClipboardClientApi = {
    readText: () => runClipboardRpc(client["Clipboard.readText"](undefined), "Clipboard.readText"),
    writeText: (text) =>
      decodeClipboardText({ text }).pipe(
        Effect.flatMap((decoded) =>
          runClipboardRpc(client["Clipboard.writeText"](decoded), "Clipboard.writeText")
        )
      ),
    readHtml: () => runClipboardRpc(client["Clipboard.readHtml"](undefined), "Clipboard.readHtml"),
    writeHtml: (html) =>
      decodeClipboardHtml({ html }).pipe(
        Effect.flatMap((decoded) =>
          runClipboardRpc(client["Clipboard.writeHtml"](decoded), "Clipboard.writeHtml")
        )
      ),
    readImage: () =>
      runClipboardRpc(client["Clipboard.readImage"](undefined), "Clipboard.readImage").pipe(
        Effect.flatMap(validateClipboardImageOutput)
      ),
    writeImage: (input) =>
      decodeClipboardImage(input)
        .pipe(Effect.flatMap(validateClipboardImageInput))
        .pipe(
          Effect.flatMap((decoded) =>
            runClipboardRpc(client["Clipboard.writeImage"](decoded), "Clipboard.writeImage")
          )
        ),
    clear: () => runClipboardRpc(client["Clipboard.clear"](undefined), "Clipboard.clear"),
    isSupported: (capability) =>
      runClipboardRpc(
        client["Clipboard.isSupported"](new ClipboardIsSupportedInput({ capability })),
        "Clipboard.isSupported"
      )
  }

  return Object.freeze(clipboardClient)
}

const validateClipboardImageInput = (
  image: ClipboardImage
): Effect.Effect<ClipboardImage, ClipboardError, never> =>
  isSupportedImageHeader(image.mime, image.bytes)
    ? Effect.succeed(image)
    : Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "payload.bytes",
          `declared ${image.mime} does not match image header`,
          "Clipboard.writeImage"
        )
      )

const validateClipboardImageOutput = (
  image: ClipboardImage
): Effect.Effect<ClipboardImage, ClipboardError, never> =>
  isSupportedImageHeader(image.mime, image.bytes)
    ? Effect.succeed(image)
    : Effect.fail(
        makeHostProtocolInvalidOutputError(
          "Clipboard.readImage",
          `declared ${image.mime} does not match image header`
        )
      )

const decodeClipboardText = (input: unknown): Effect.Effect<ClipboardText, ClipboardError, never> =>
  decodeNativeInput(ClipboardText, input, "Clipboard.writeText")

const decodeClipboardHtml = (input: unknown): Effect.Effect<ClipboardHtml, ClipboardError, never> =>
  decodeNativeInput(ClipboardHtml, input, "Clipboard.writeHtml")

const decodeClipboardImage = (
  input: unknown
): Effect.Effect<ClipboardImage, ClipboardError, never> =>
  decodeNativeInput(ClipboardImage, input, "Clipboard.writeImage")

const runClipboardRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ClipboardError, never> => runNativeRpc(effect, operation, "Clipboard")
