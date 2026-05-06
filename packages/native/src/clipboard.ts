import {
  Api,
  Client,
  type ApiClientExchange,
  type ApiClientOptions,
  type ApiContractClass,
  type ApiContractError,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema } from "effect"

import {
  ClipboardImage,
  type ClipboardImageMime,
  type ClipboardImageOptions,
  ClipboardText
} from "./contracts/clipboard.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type ClipboardError = HostProtocolError

export const ClipboardApiSpec = Object.freeze({
  readText: {
    input: Schema.Void,
    output: ClipboardText,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Clipboard.readText"
  },
  writeText: {
    input: ClipboardText,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Clipboard.writeText"
  },
  readImage: {
    input: Schema.Void,
    output: ClipboardImage,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Clipboard.readImage"
  },
  writeImage: {
    input: ClipboardImage,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Clipboard.writeImage"
  },
  clear: {
    input: Schema.Void,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Clipboard.clear"
  }
}) satisfies ApiContractSpec

export type ClipboardApiSpec = typeof ClipboardApiSpec

export const ClipboardApiEvents = Object.freeze({})

export type ClipboardApiEvents = typeof ClipboardApiEvents

export const ClipboardApi: ApiContractClass<"Clipboard", ClipboardApiSpec, ClipboardApiEvents> =
  (() => {
    const contract = class {
      static readonly tag = "Clipboard"
      static readonly spec = ClipboardApiSpec
      static readonly events = ClipboardApiEvents

      static layer<Handlers extends ApiHandlers<ClipboardApiSpec>>(
        handlers: Handlers
      ): ApiLayer<"Clipboard", ClipboardApiSpec, Handlers, ClipboardApiEvents> {
        return Object.freeze({
          contract,
          handlers: Object.freeze(handlers)
        })
      }
    } as ApiContractClass<"Clipboard", ClipboardApiSpec, ClipboardApiEvents>

    return Object.freeze(contract)
  })()

export const registerClipboardApi = (): Effect.Effect<
  ApiContractClass<"Clipboard", ClipboardApiSpec, ClipboardApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Clipboard")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Clipboard", ClipboardApiSpec, ClipboardApiEvents>
    }

    return yield* Api.Tag("Clipboard")<unknown>()(ClipboardApiSpec, ClipboardApiEvents)
  })

export const ClipboardMethodNames = Object.freeze(
  Object.keys(ClipboardApiSpec) as ReadonlyArray<keyof ClipboardApiSpec>
)

export interface ClipboardClientApi {
  readonly readText: () => Effect.Effect<ClipboardText, ClipboardError, never>
  readonly writeText: (input: string) => Effect.Effect<void, ClipboardError, never>
  readonly readImage: () => Effect.Effect<ClipboardImage, ClipboardError, never>
  readonly writeImage: (input: ClipboardImageOptions) => Effect.Effect<void, ClipboardError, never>
  readonly clear: () => Effect.Effect<void, ClipboardError, never>
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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<ClipboardClient> =>
  Layer.succeed(ClipboardClient)(makeClipboardBridgeClient(exchange, options))

export const makeHostClipboardApiLayer = <Handlers extends ApiHandlers<ClipboardApiSpec>>(
  handlers: Handlers
): ApiLayer<"Clipboard", ClipboardApiSpec, Handlers, ClipboardApiEvents> =>
  ClipboardApi.layer(handlers)

const makeClipboardService = (client: ClipboardClientApi): ClipboardServiceApi => {
  const service: ClipboardServiceApi = {
    readText: () => client.readText().pipe(Effect.map((result) => result.text)),
    writeText: (text) => client.writeText(text),
    readImage: () => client.readImage(),
    writeImage: (input) => client.writeImage(input),
    clear: () => client.clear()
  }

  return Object.freeze(service)
}

const makeClipboardBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): ClipboardClientApi => {
  const client = Client({ Clipboard: ClipboardApi }, exchange, options).Clipboard

  const clipboardClient: ClipboardClientApi = {
    readText: () => client.readText(),
    writeText: (text) => decodeClipboardText({ text }).pipe(Effect.flatMap(client.writeText)),
    readImage: () => client.readImage(),
    writeImage: (input) =>
      decodeClipboardImage(input)
        .pipe(Effect.flatMap(validateClipboardImage))
        .pipe(Effect.flatMap(client.writeImage)),
    clear: () => client.clear()
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
    clear: () => unsupportedEffect<void>("Clipboard.clear")
  }

  return Object.freeze(client)
}

export const validateClipboardImage = (
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

const isSupportedImageHeader = (mime: ClipboardImageMime, bytes: Uint8Array): boolean => {
  if (mime === "image/png") {
    return hasPrefix(bytes, PNG_HEADER)
  }

  return hasPrefix(bytes, JPEG_HEADER)
}

const hasPrefix = (bytes: Uint8Array, prefix: Uint8Array): boolean => {
  if (bytes.length < prefix.length) {
    return false
  }

  return prefix.every((byte, index) => bytes[index] === byte)
}

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff])

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
