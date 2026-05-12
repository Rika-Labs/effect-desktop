import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  Rpc,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"

import {
  type ClipboardCapability,
  ClipboardImage,
  type ClipboardImageOptions,
  ClipboardIsSupportedInput,
  ClipboardSupportedResult,
  ClipboardText
} from "./contracts/clipboard.js"
import { isSupportedImageHeader } from "./contracts/image.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type ClipboardError = HostProtocolError

export const ClipboardReadText = clipboardRpc(
  "readText",
  Schema.Void,
  ClipboardText,
  "native.invoke:Clipboard.readText"
)
export const ClipboardWriteText = clipboardRpc(
  "writeText",
  ClipboardText,
  Schema.Void,
  "native.invoke:Clipboard.writeText"
)
export const ClipboardReadImage = clipboardRpc(
  "readImage",
  Schema.Void,
  ClipboardImage,
  "native.invoke:Clipboard.readImage"
)
export const ClipboardWriteImage = clipboardRpc(
  "writeImage",
  ClipboardImage,
  Schema.Void,
  "native.invoke:Clipboard.writeImage"
)
export const ClipboardClear = clipboardRpc(
  "clear",
  Schema.Void,
  Schema.Void,
  "native.invoke:Clipboard.clear"
)
export const ClipboardIsSupported = clipboardRpc(
  "isSupported",
  ClipboardIsSupportedInput,
  ClipboardSupportedResult,
  "none"
)

export const ClipboardRpcEvents = Object.freeze({})

export type ClipboardRpcEvents = typeof ClipboardRpcEvents

const ClipboardRpcGroup = RpcGroup.make(
  ClipboardReadText,
  ClipboardWriteText,
  ClipboardReadImage,
  ClipboardWriteImage,
  ClipboardClear,
  ClipboardIsSupported
)

export const ClipboardRpcs = BridgeRpc.fromGroup("Clipboard", ClipboardRpcGroup, ClipboardRpcEvents)

export const ClipboardMethodNames = Object.freeze([
  "readText",
  "writeText",
  "readImage",
  "writeImage",
  "clear",
  "isSupported"
] as const)

export interface ClipboardClientApi {
  readonly readText: () => Effect.Effect<ClipboardText, ClipboardError, never>
  readonly writeText: (input: string) => Effect.Effect<void, ClipboardError, never>
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
  readonly readImage: () => Effect.Effect<ClipboardImage, ClipboardError, never>
  readonly writeImage: (input: ClipboardImageOptions) => Effect.Effect<void, ClipboardError, never>
  readonly clear: () => Effect.Effect<void, ClipboardError, never>
  readonly isSupported: (
    capability: ClipboardCapability
  ) => Effect.Effect<boolean, ClipboardError, never>
}

export class Clipboard extends Context.Service<Clipboard, ClipboardServiceApi>()(
  "@effect-desktop/native/Clipboard"
) {}

export const ClipboardLive = Layer.effect(Clipboard)(
  Effect.gen(function* () {
    const client = yield* ClipboardClient
    return makeClipboardService(client)
  })
)

export const makeClipboardClientLayer = (
  client: ClipboardClientApi
): Layer.Layer<ClipboardClient> => Layer.succeed(ClipboardClient)(client)

export const makeClipboardServiceLayer = (client: ClipboardClientApi): Layer.Layer<Clipboard> =>
  Layer.provide(ClipboardLive, makeClipboardClientLayer(client))

export const makeClipboardBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ClipboardClient> =>
  Layer.succeed(ClipboardClient)(makeClipboardBridgeClient(exchange, options))

export type ClipboardRpcSpec = (typeof ClipboardRpcs)["spec"]

export const makeHostClipboardBridgeRpcLayer = <
  Handlers extends BridgeRpcHandlers<ClipboardRpcSpec>
>(
  handlers: Handlers
): BridgeRpcLayer<"Clipboard", ClipboardRpcSpec, Handlers, ClipboardRpcEvents> =>
  BridgeRpc.layer(ClipboardRpcs)(handlers)

const makeClipboardService = (client: ClipboardClientApi): ClipboardServiceApi => {
  const service: ClipboardServiceApi = {
    readText: () => client.readText().pipe(Effect.map((result) => result.text)),
    writeText: (text) => client.writeText(text),
    readImage: () => client.readImage(),
    writeImage: (input) => client.writeImage(input),
    clear: () => client.clear(),
    isSupported: (capability) =>
      client.isSupported(capability).pipe(Effect.map((result) => result.supported))
  }

  return Object.freeze(service)
}

const makeClipboardBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): ClipboardClientApi => {
  const client = Client({ Clipboard: ClipboardRpcs }, exchange, options).Clipboard as unknown as {
    readonly readText: () => Effect.Effect<ClipboardText, ClipboardError, never>
    readonly writeText: (input: ClipboardText) => Effect.Effect<void, ClipboardError, never>
    readonly readImage: () => Effect.Effect<ClipboardImage, ClipboardError, never>
    readonly writeImage: (input: ClipboardImage) => Effect.Effect<void, ClipboardError, never>
    readonly clear: () => Effect.Effect<void, ClipboardError, never>
    readonly isSupported: (
      input: ClipboardIsSupportedInput
    ) => Effect.Effect<ClipboardSupportedResult, ClipboardError, never>
  }

  const clipboardClient: ClipboardClientApi = {
    readText: () => client.readText(),
    writeText: (text) => decodeClipboardText({ text }).pipe(Effect.flatMap(client.writeText)),
    readImage: () => client.readImage().pipe(Effect.flatMap(validateClipboardImageOutput)),
    writeImage: (input) =>
      decodeClipboardImage(input)
        .pipe(Effect.flatMap(validateClipboardImageInput))
        .pipe(Effect.flatMap(client.writeImage)),
    clear: () => client.clear(),
    isSupported: (capability) => client.isSupported(new ClipboardIsSupportedInput({ capability }))
  }

  return Object.freeze(clipboardClient)
}

export const makeUnsupportedClipboardClient = (): ClipboardClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, ClipboardError, never> =>
    Effect.fail(unsupportedError(method))

  const client: ClipboardClientApi = {
    readText: () => unsupportedEffect<ClipboardText>("Clipboard.readText"),
    writeText: () => unsupportedEffect<void>("Clipboard.writeText"),
    readImage: () => unsupportedEffect<ClipboardImage>("Clipboard.readImage"),
    writeImage: () => unsupportedEffect<void>("Clipboard.writeImage"),
    clear: () => unsupportedEffect<void>("Clipboard.clear"),
    isSupported: () => Effect.succeed(new ClipboardSupportedResult({ supported: false }))
  }

  return Object.freeze(client)
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

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Clipboard platform adapter is not implemented yet",
    message: `unsupported Clipboard method: ${method}`,
    operation: method,
    recoverable: false
  })

const decodeClipboardText = (input: unknown): Effect.Effect<ClipboardText, ClipboardError, never> =>
  decodeInput(ClipboardText, input, "Clipboard.writeText") as Effect.Effect<
    ClipboardText,
    ClipboardError,
    never
  >

const decodeClipboardImage = (
  input: unknown
): Effect.Effect<ClipboardImage, ClipboardError, never> =>
  decodeInput(ClipboardImage, input, "Clipboard.writeImage") as Effect.Effect<
    ClipboardImage,
    ClipboardError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, ClipboardError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function clipboardRpc<
  Payload extends Schema.Schema<unknown>,
  Success extends Schema.Schema<unknown>
>(method: string, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`Clipboard.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
