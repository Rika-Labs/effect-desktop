import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcGroup,
  type BridgeRpcSpec,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"
import * as nodePath from "node:path"

import {
  ProtocolDenyInput,
  type ProtocolDenyOptions,
  ProtocolRegisterAppProtocolInput,
  type ProtocolRegisterAppProtocolOptions,
  ProtocolServeAssetInput,
  type ProtocolServeAssetOptions,
  ProtocolServeRouteInput,
  type ProtocolServeRouteOptions,
  ProtocolScheme
} from "./contracts/protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
export type ProtocolError = HostProtocolError

export const ProtocolRpcSpec = Object.freeze({
  registerAppProtocol: protocolMethodSpec(
    ProtocolRegisterAppProtocolInput,
    "native.invoke:Protocol.registerAppProtocol"
  ),
  serveAsset: protocolMethodSpec(ProtocolServeAssetInput, "native.invoke:Protocol.serveAsset"),
  serveRoute: protocolMethodSpec(ProtocolServeRouteInput, "native.invoke:Protocol.serveRoute"),
  deny: protocolMethodSpec(ProtocolDenyInput, "native.invoke:Protocol.deny")
}) satisfies BridgeRpcSpec

export type ProtocolRpcSpec = typeof ProtocolRpcSpec

export const ProtocolRpcEvents = Object.freeze({})

export type ProtocolRpcEvents = typeof ProtocolRpcEvents

export const ProtocolRpcs: BridgeRpcGroup<"Protocol", ProtocolRpcSpec, ProtocolRpcEvents> =
  BridgeRpc.group("Protocol", ProtocolRpcSpec, ProtocolRpcEvents)

export const ProtocolMethodNames = Object.freeze(
  Object.keys(ProtocolRpcSpec) as ReadonlyArray<keyof ProtocolRpcSpec>
)

export interface ProtocolClientApi {
  readonly registerAppProtocol: (
    input: ProtocolRegisterAppProtocolOptions
  ) => Effect.Effect<void, ProtocolError, never>
  readonly serveAsset: (
    input: ProtocolServeAssetOptions
  ) => Effect.Effect<void, ProtocolError, never>
  readonly serveRoute: (
    input: ProtocolServeRouteOptions
  ) => Effect.Effect<void, ProtocolError, never>
  readonly deny: (input: ProtocolDenyOptions) => Effect.Effect<void, ProtocolError, never>
}

export class ProtocolClient extends Context.Service<ProtocolClient, ProtocolClientApi>()(
  "@effect-desktop/native/ProtocolClient"
) {}

export type ProtocolServiceApi = ProtocolClientApi

export class Protocol extends Context.Service<Protocol, ProtocolServiceApi>()(
  "@effect-desktop/native/Protocol"
) {}

export const ProtocolLive = Layer.effect(Protocol)(
  Effect.gen(function* () {
    const client = yield* ProtocolClient
    return Object.freeze({
      registerAppProtocol: (input) => client.registerAppProtocol(input),
      serveAsset: (input) => client.serveAsset(input),
      serveRoute: (input) => client.serveRoute(input),
      deny: (input) => client.deny(input)
    } satisfies ProtocolServiceApi)
  })
)

export const makeProtocolClientLayer = (client: ProtocolClientApi): Layer.Layer<ProtocolClient> =>
  Layer.succeed(ProtocolClient)(client)

export const makeProtocolServiceLayer = (client: ProtocolClientApi): Layer.Layer<Protocol> =>
  Layer.provide(ProtocolLive, makeProtocolClientLayer(client))

export const makeProtocolBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ProtocolClient> =>
  Layer.succeed(ProtocolClient)(makeProtocolBridgeClient(exchange, options))

export const makeHostProtocolBridgeRpcLayer = <Handlers extends BridgeRpcHandlers<ProtocolRpcSpec>>(
  handlers: Handlers
): BridgeRpcLayer<"Protocol", ProtocolRpcSpec, Handlers, ProtocolRpcEvents> =>
  BridgeRpc.layer(ProtocolRpcs)(handlers)

const makeProtocolBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): ProtocolClientApi => {
  const client = Client({ Protocol: ProtocolRpcs }, exchange, options).Protocol
  return Object.freeze({
    registerAppProtocol: (input) =>
      decodeProtocolRegisterAppProtocolInput(input).pipe(
        Effect.flatMap(validateRegisterAppProtocolInput),
        Effect.flatMap(client.registerAppProtocol)
      ),
    serveAsset: (input) =>
      decodeProtocolServeAssetInput(input).pipe(
        Effect.flatMap(validateServeAssetInput),
        Effect.flatMap(client.serveAsset)
      ),
    serveRoute: (input) =>
      decodeProtocolServeRouteInput(input).pipe(
        Effect.flatMap(validateServeRouteInput),
        Effect.flatMap(client.serveRoute)
      ),
    deny: (input) =>
      decodeProtocolDenyInput(input).pipe(
        Effect.flatMap(validateDenyInput),
        Effect.flatMap(client.deny)
      )
  } satisfies ProtocolClientApi)
}

export const makeUnsupportedProtocolClient = (): ProtocolClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, ProtocolError, never> =>
    Effect.fail(unsupportedError(method))
  return Object.freeze({
    registerAppProtocol: () => unsupportedEffect<void>("Protocol.registerAppProtocol"),
    serveAsset: () => unsupportedEffect<void>("Protocol.serveAsset"),
    serveRoute: () => unsupportedEffect<void>("Protocol.serveRoute"),
    deny: () => unsupportedEffect<void>("Protocol.deny")
  } satisfies ProtocolClientApi)
}

const validateRegisterAppProtocolInput = (
  input: ProtocolRegisterAppProtocolInput
): Effect.Effect<ProtocolRegisterAppProtocolInput, ProtocolError, never> =>
  validateScheme(input.scheme, "Protocol.registerAppProtocol").pipe(Effect.as(input))

const validateServeAssetInput = (
  input: ProtocolServeAssetInput
): Effect.Effect<ProtocolServeAssetInput, ProtocolError, never> =>
  validateScheme(input.scheme, "Protocol.serveAsset").pipe(
    Effect.flatMap(() => validateLocalPath(input.root, "root", "Protocol.serveAsset")),
    Effect.as(input)
  )

const validateServeRouteInput = (
  input: ProtocolServeRouteInput
): Effect.Effect<ProtocolServeRouteInput, ProtocolError, never> =>
  validateScheme(input.scheme, "Protocol.serveRoute").pipe(
    Effect.flatMap(() => validateRoutePath(input.route, "route", "Protocol.serveRoute")),
    Effect.as(input)
  )

const validateDenyInput = (
  input: ProtocolDenyInput
): Effect.Effect<ProtocolDenyInput, ProtocolError, never> =>
  validateScheme(input.scheme, "Protocol.deny").pipe(
    Effect.flatMap(() => validateRoutePath(input.path, "path", "Protocol.deny")),
    Effect.as(input)
  )

const validateScheme = (
  scheme: string,
  operation: string
): Effect.Effect<string, ProtocolError, never> => {
  return decodeInput(ProtocolScheme, scheme, operation) as Effect.Effect<
    string,
    ProtocolError,
    never
  >
}

const TraversalSegmentPattern = /(?:^|[\\/])\.\.(?:$|[\\/])/

// eslint-disable-next-line no-control-regex -- Intentionally matches control chars to reject them.
const ControlCharPattern = /[\x00-\x1f\x7f]/

const validateLocalPath = (
  inputPath: string,
  field: string,
  operation: string
): Effect.Effect<string, ProtocolError, never> => {
  if (inputPath.length === 0) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(
        field,
        "must be a non-empty absolute local path",
        operation
      )
    )
  }

  if (!nodePath.isAbsolute(inputPath)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must be an absolute local path", operation)
    )
  }

  if (TraversalSegmentPattern.test(inputPath)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must not contain traversal segments", operation)
    )
  }

  if (ControlCharPattern.test(inputPath)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must not contain control characters", operation)
    )
  }

  return Effect.succeed(inputPath)
}

const validateRoutePath = (
  path: string,
  field: string,
  operation: string
): Effect.Effect<string, ProtocolError, never> => {
  if (!path.startsWith("/")) {
    return Effect.fail(makeHostProtocolInvalidArgumentError(field, "must start with /", operation))
  }

  if (path.split("/").includes("..")) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must not contain .. segments", operation)
    )
  }

  return validateLocalPath(path, field, operation)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Protocol platform adapter is not implemented yet",
    message: `unsupported Protocol method: ${method}`,
    operation: method,
    recoverable: false
  })

const decodeProtocolRegisterAppProtocolInput = (
  input: unknown
): Effect.Effect<ProtocolRegisterAppProtocolInput, ProtocolError, never> =>
  decodeInput(
    ProtocolRegisterAppProtocolInput,
    input,
    "Protocol.registerAppProtocol"
  ) as Effect.Effect<ProtocolRegisterAppProtocolInput, ProtocolError, never>

const decodeProtocolServeAssetInput = (
  input: unknown
): Effect.Effect<ProtocolServeAssetInput, ProtocolError, never> =>
  decodeInput(ProtocolServeAssetInput, input, "Protocol.serveAsset") as Effect.Effect<
    ProtocolServeAssetInput,
    ProtocolError,
    never
  >

const decodeProtocolServeRouteInput = (
  input: unknown
): Effect.Effect<ProtocolServeRouteInput, ProtocolError, never> =>
  decodeInput(ProtocolServeRouteInput, input, "Protocol.serveRoute") as Effect.Effect<
    ProtocolServeRouteInput,
    ProtocolError,
    never
  >

const decodeProtocolDenyInput = (
  input: unknown
): Effect.Effect<ProtocolDenyInput, ProtocolError, never> =>
  decodeInput(ProtocolDenyInput, input, "Protocol.deny") as Effect.Effect<
    ProtocolDenyInput,
    ProtocolError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, ProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function protocolMethodSpec<Input extends Schema.Schema<unknown>>(
  input: Input,
  permission: string
) {
  return { input, output: Schema.Void, error: HostProtocolErrorSchema, permission } as const
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
