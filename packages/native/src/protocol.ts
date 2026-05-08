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
  ProtocolDenyInput,
  type ProtocolDenyOptions,
  ProtocolRegisterAppProtocolInput,
  type ProtocolRegisterAppProtocolOptions,
  ProtocolServeAssetInput,
  type ProtocolServeAssetOptions,
  ProtocolServeRouteInput,
  type ProtocolServeRouteOptions
} from "./contracts/protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const SchemePattern = /^[a-z][a-z0-9+.-]*$/u
const ReservedSchemes = Object.freeze([
  "about",
  "app",
  "blob",
  "data",
  "file",
  "http",
  "https",
  "javascript"
])

export type ProtocolError = HostProtocolError

export const ProtocolApiSpec = Object.freeze({
  registerAppProtocol: protocolMethodSpec(
    ProtocolRegisterAppProtocolInput,
    "native.invoke:Protocol.registerAppProtocol"
  ),
  serveAsset: protocolMethodSpec(ProtocolServeAssetInput, "native.invoke:Protocol.serveAsset"),
  serveRoute: protocolMethodSpec(ProtocolServeRouteInput, "native.invoke:Protocol.serveRoute"),
  deny: protocolMethodSpec(ProtocolDenyInput, "native.invoke:Protocol.deny")
}) satisfies ApiContractSpec

export type ProtocolApiSpec = typeof ProtocolApiSpec

export const ProtocolApiEvents = Object.freeze({})

export type ProtocolApiEvents = typeof ProtocolApiEvents

export const ProtocolApi: ApiContractClass<"Protocol", ProtocolApiSpec, ProtocolApiEvents> =
  (() => {
    const contract = class {
      static readonly tag = "Protocol"
      static readonly spec = ProtocolApiSpec
      static readonly events = ProtocolApiEvents

      static layer<Handlers extends ApiHandlers<ProtocolApiSpec>>(
        handlers: Handlers
      ): ApiLayer<"Protocol", ProtocolApiSpec, Handlers, ProtocolApiEvents> {
        return Object.freeze({ contract, handlers: Object.freeze(handlers) })
      }
    } as ApiContractClass<"Protocol", ProtocolApiSpec, ProtocolApiEvents>

    return Object.freeze(contract)
  })()

export const registerProtocolApi = (): Effect.Effect<
  ApiContractClass<"Protocol", ProtocolApiSpec, ProtocolApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Protocol")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Protocol", ProtocolApiSpec, ProtocolApiEvents>
    }
    return yield* Api.Tag("Protocol")<unknown>()(ProtocolApiSpec, ProtocolApiEvents)
  })

export const ProtocolMethodNames = Object.freeze(
  Object.keys(ProtocolApiSpec) as ReadonlyArray<keyof ProtocolApiSpec>
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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<ProtocolClient> =>
  Layer.succeed(ProtocolClient)(makeProtocolBridgeClient(exchange, options))

export const makeHostProtocolApiLayer = <Handlers extends ApiHandlers<ProtocolApiSpec>>(
  handlers: Handlers
): ApiLayer<"Protocol", ProtocolApiSpec, Handlers, ProtocolApiEvents> => ProtocolApi.layer(handlers)

const makeProtocolBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): ProtocolClientApi => {
  const client = Client({ Protocol: ProtocolApi }, exchange, options).Protocol
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
  if (!SchemePattern.test(scheme)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(
        "scheme",
        "must be lowercase and match RFC 3986 scheme syntax",
        operation
      )
    )
  }

  if (ReservedSchemes.includes(scheme)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError("scheme", `reserved scheme: ${scheme}`, operation)
    )
  }

  return Effect.succeed(scheme)
}

// eslint-disable-next-line no-control-regex -- Intentionally matches control chars to reject them.
const ControlCharPattern = /[\x00-\x1f\x7f]/

const validateLocalPath = (
  path: string,
  field: string,
  operation: string
): Effect.Effect<string, ProtocolError, never> => {
  if (ControlCharPattern.test(path)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must not contain control characters", operation)
    )
  }

  return Effect.succeed(path)
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
