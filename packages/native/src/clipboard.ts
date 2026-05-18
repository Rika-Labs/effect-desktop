import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
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

export type ClipboardError = HostProtocolError

const ClipboardUnsupportedReason = "host-adapter-unimplemented"
const ClipboardUnsupportedSupport = NativeSurface.support.unsupported(ClipboardUnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: ClipboardUnsupportedReason },
    { platform: "windows", status: "unsupported", reason: ClipboardUnsupportedReason },
    { platform: "linux", status: "unsupported", reason: ClipboardUnsupportedReason }
  ]
})

export const ClipboardReadText = clipboardRpc(
  "readText",
  Schema.Void,
  ClipboardText,
  P.nativeInvoke({ primitive: "Clipboard", methods: ["readText"] })
)
export const ClipboardWriteText = clipboardRpc(
  "writeText",
  ClipboardText,
  Schema.Void,
  P.nativeInvoke({ primitive: "Clipboard", methods: ["writeText"] })
)
export const ClipboardReadHtml = clipboardRpc(
  "readHtml",
  Schema.Void,
  ClipboardHtml,
  P.nativeInvoke({ primitive: "Clipboard", methods: ["readHtml"] })
)
export const ClipboardWriteHtml = clipboardRpc(
  "writeHtml",
  ClipboardHtml,
  Schema.Void,
  P.nativeInvoke({ primitive: "Clipboard", methods: ["writeHtml"] })
)
export const ClipboardReadImage = clipboardRpc(
  "readImage",
  Schema.Void,
  ClipboardImage,
  P.nativeInvoke({ primitive: "Clipboard", methods: ["readImage"] })
)
export const ClipboardWriteImage = clipboardRpc(
  "writeImage",
  ClipboardImage,
  Schema.Void,
  P.nativeInvoke({ primitive: "Clipboard", methods: ["writeImage"] })
)
export const ClipboardClear = clipboardRpc(
  "clear",
  Schema.Void,
  Schema.Void,
  P.nativeInvoke({ primitive: "Clipboard", methods: ["clear"] })
)
export const ClipboardIsSupported = clipboardRpc(
  "isSupported",
  ClipboardIsSupportedInput,
  ClipboardSupportedResult,
  { kind: "none" }
)

export const ClipboardRpcEvents = Object.freeze({})

export type ClipboardRpcEvents = typeof ClipboardRpcEvents

const ClipboardRpcGroup = RpcGroup.make(
  ClipboardReadText,
  ClipboardWriteText,
  ClipboardReadHtml,
  ClipboardWriteHtml,
  ClipboardReadImage,
  ClipboardWriteImage,
  ClipboardClear,
  ClipboardIsSupported
)

export const ClipboardRpcs: RpcGroup.RpcGroup<ClipboardRpc> = ClipboardRpcGroup

export type ClipboardRpc = RpcGroup.Rpcs<typeof ClipboardRpcGroup>

export const ClipboardMethodNames = Object.freeze([
  "readText",
  "writeText",
  "readHtml",
  "writeHtml",
  "readImage",
  "writeImage",
  "clear",
  "isSupported"
] as const)

const ClipboardCapabilityMethods = Object.freeze([
  "readText",
  "writeText",
  "readHtml",
  "writeHtml",
  "readImage",
  "writeImage",
  "clear"
] as const satisfies readonly (typeof ClipboardMethodNames)[number][])

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
  "@effect-desktop/native/ClipboardClient"
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
  ) => Effect.Effect<boolean, ClipboardError, never>
}

export class Clipboard extends Context.Service<Clipboard, ClipboardServiceApi>()(
  "@effect-desktop/native/Clipboard"
) {
  static readonly layer = Layer.effect(Clipboard)(
    Effect.gen(function* () {
      const client = yield* ClipboardClient
      return Clipboard.of(makeClipboardService(client))
    })
  )
}

export const ClipboardLive = Clipboard.layer

export const makeClipboardClientLayer = (
  client: ClipboardClientApi
): Layer.Layer<ClipboardClient> => Layer.succeed(ClipboardClient)(client)

export const makeClipboardServiceLayer = (client: ClipboardClientApi): Layer.Layer<Clipboard> =>
  Layer.provide(ClipboardLive, makeClipboardClientLayer(client))

export const makeClipboardBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ClipboardClient> => ClipboardSurface.bridgeClientLayer(exchange, options)

export type ClipboardRpcHandlers = RpcGroup.HandlersFrom<ClipboardRpc>

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
      const supported = yield* clipboard.isSupported(input.capability)
      return new ClipboardSupportedResult({ supported })
    })
})

export const ClipboardSurface = NativeSurface.make("Clipboard", ClipboardRpcGroup, {
  service: ClipboardClient,
  capabilities: ClipboardCapabilityMethods,
  handlers: ClipboardHandlersLive,
  client: (client) => clipboardClientFromRpcClient(client)
})

export const makeHostClipboardRpcRuntime = (
  handlers: ClipboardRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  ClipboardSurface.hostRuntime(handlers, runtimeOptions)

const makeClipboardService = (client: ClipboardClientApi): ClipboardServiceApi => {
  const service: ClipboardServiceApi = {
    readText: () => client.readText().pipe(Effect.map((result) => result.text)),
    writeText: (text) => client.writeText(text),
    readHtml: () => client.readHtml().pipe(Effect.map((result) => result.html)),
    writeHtml: (html) => client.writeHtml(html),
    readImage: () => client.readImage(),
    writeImage: (input) => client.writeImage(input),
    clear: () => client.clear(),
    isSupported: (capability) =>
      client.isSupported(capability).pipe(Effect.map((result) => result.supported))
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

function clipboardRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("Clipboard", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: method === "isSupported" || method.startsWith("read") ? "query" : "mutation",
    support:
      method === "isSupported" ? NativeSurface.support.supported : ClipboardUnsupportedSupport
  })
}
