import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { DesktopRpc, type DesktopRpcClient } from "@effect-desktop/core"
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

export const ClipboardRpcs: RpcGroup.RpcGroup<ClipboardRpc> = ClipboardRpcGroup

export type ClipboardRpc = RpcGroup.Rpcs<typeof ClipboardRpcGroup>

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

export type ClipboardRpcHandlers = Parameters<typeof ClipboardRpcGroup.toLayer>[0]

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

export const ClipboardSurface = DesktopRpc.surface("Clipboard", ClipboardRpcGroup, {
  service: ClipboardClient,
  handlers: ClipboardHandlersLive,
  client: (client) => clipboardClientFromRpcClient(client)
})

export const makeHostClipboardRpcRuntime = (
  handlers: ClipboardRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(
    ClipboardRpcGroup,
    ClipboardRpcGroup.toLayer(handlers),
    runtimeOptions
  )

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

const makeClipboardBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const makeClipboardBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): ClipboardClientApi => {
  const useClient = <A>(
    use: (client: ClipboardClientApi) => Effect.Effect<A, ClipboardError, never>
  ): Effect.Effect<A, ClipboardError, never> =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* ClipboardClient
        return yield* use(client)
      }).pipe(
        Effect.provide(ClipboardSurface.clientLayer),
        Effect.provide(makeClipboardBridgeProtocolLayer(exchange, options))
      )
    )

  return Object.freeze({
    readText: () => useClient((client) => client.readText()),
    writeText: (text) => useClient((client) => client.writeText(text)),
    readImage: () => useClient((client) => client.readImage()),
    writeImage: (input) => useClient((client) => client.writeImage(input)),
    clear: () => useClient((client) => client.clear()),
    isSupported: (capability) => useClient((client) => client.isSupported(capability))
  } satisfies ClipboardClientApi)
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
  decodeInput(ClipboardText, input, "Clipboard.writeText")

const decodeClipboardImage = (
  input: unknown
): Effect.Effect<ClipboardImage, ClipboardError, never> =>
  decodeInput(ClipboardImage, input, "Clipboard.writeImage")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, ClipboardError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const runClipboardRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ClipboardError, never> =>
  effect.pipe(
    Effect.mapError(mapClipboardRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapClipboardRpcClientError = (error: unknown): ClipboardError =>
  isClipboardError(error)
    ? error
    : makeHostProtocolInternalError("Clipboard RPC client failed", "Clipboard")

const isClipboardError = (error: unknown): error is ClipboardError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

function clipboardRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`Clipboard.${method}` as const, {
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
