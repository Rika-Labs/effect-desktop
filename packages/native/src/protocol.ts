import {
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { P, type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer, Schema } from "effect"
import * as nodePath from "node:path"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
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

export const ProtocolRegisterAppProtocol = protocolRpc(
  "registerAppProtocol",
  ProtocolRegisterAppProtocolInput,
  P.nativeInvoke({ primitive: "Protocol", methods: ["registerAppProtocol"] })
)
export const ProtocolServeAsset = protocolRpc(
  "serveAsset",
  ProtocolServeAssetInput,
  P.nativeInvoke({ primitive: "Protocol", methods: ["serveAsset"] })
)
export const ProtocolServeRoute = protocolRpc(
  "serveRoute",
  ProtocolServeRouteInput,
  P.nativeInvoke({ primitive: "Protocol", methods: ["serveRoute"] })
)
export const ProtocolDeny = protocolRpc(
  "deny",
  ProtocolDenyInput,
  P.nativeInvoke({ primitive: "Protocol", methods: ["deny"] })
)

export const ProtocolRpcEvents = Object.freeze({})

export type ProtocolRpcEvents = typeof ProtocolRpcEvents

const ProtocolRpcGroup = RpcGroup.make(
  ProtocolRegisterAppProtocol,
  ProtocolServeAsset,
  ProtocolServeRoute,
  ProtocolDeny
)

export const ProtocolRpcs: RpcGroup.RpcGroup<ProtocolRpc> = ProtocolRpcGroup

export const ProtocolMethodNames = Object.freeze([
  "registerAppProtocol",
  "serveAsset",
  "serveRoute",
  "deny"
] as const)

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
  "@orika/native/ProtocolClient"
) {}

export type ProtocolServiceApi = ProtocolClientApi

export class Protocol extends Context.Service<Protocol, ProtocolServiceApi>()(
  "@orika/native/Protocol"
) {
  static readonly layer = Layer.effect(Protocol)(
    Effect.gen(function* () {
      const client = yield* ProtocolClient
      return Protocol.of({
        registerAppProtocol: (input) => client.registerAppProtocol(input),
        serveAsset: (input) => client.serveAsset(input),
        serveRoute: (input) => client.serveRoute(input),
        deny: (input) => client.deny(input)
      } satisfies ProtocolServiceApi)
    })
  )
}

export const ProtocolLive = Protocol.layer

export type ProtocolRpc = RpcGroup.Rpcs<typeof ProtocolRpcGroup>

export type ProtocolRpcHandlers<R = never> = NativeRpcHandlers<typeof ProtocolRpcGroup, R>

export const ProtocolHandlersLive = ProtocolRpcGroup.toLayer({
  "Protocol.registerAppProtocol": (input) =>
    Effect.gen(function* () {
      const protocol = yield* Protocol
      yield* protocol.registerAppProtocol(input)
    }),
  "Protocol.serveAsset": (input) =>
    Effect.gen(function* () {
      const protocol = yield* Protocol
      yield* protocol.serveAsset(input)
    }),
  "Protocol.serveRoute": (input) =>
    Effect.gen(function* () {
      const protocol = yield* Protocol
      yield* protocol.serveRoute(input)
    }),
  "Protocol.deny": (input) =>
    Effect.gen(function* () {
      const protocol = yield* Protocol
      yield* protocol.deny(input)
    })
})

export const ProtocolSurface = NativeSurface.make("Protocol", ProtocolRpcGroup, {
  service: ProtocolClient,
  capabilities: ProtocolMethodNames,
  handlers: ProtocolHandlersLive,
  client: (client) => protocolClientFromRpcClient(client)
})

export const makeHostProtocolRpcRuntime = <R = never>(
  handlers: ProtocolRpcHandlers<R>,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
) => ProtocolSurface.hostRuntime(handlers, runtimeOptions)

const protocolClientFromRpcClient = (client: DesktopRpcClient<ProtocolRpc>): ProtocolClientApi => {
  return Object.freeze({
    registerAppProtocol: (input) =>
      decodeProtocolRegisterAppProtocolInput(input).pipe(
        Effect.flatMap(validateRegisterAppProtocolInput),
        Effect.flatMap((decoded) =>
          runProtocolRpc(
            client["Protocol.registerAppProtocol"](decoded),
            "Protocol.registerAppProtocol"
          )
        )
      ),
    serveAsset: (input) =>
      decodeProtocolServeAssetInput(input).pipe(
        Effect.flatMap(validateServeAssetInput),
        Effect.flatMap((decoded) =>
          runProtocolRpc(client["Protocol.serveAsset"](decoded), "Protocol.serveAsset")
        )
      ),
    serveRoute: (input) =>
      decodeProtocolServeRouteInput(input).pipe(
        Effect.flatMap(validateServeRouteInput),
        Effect.flatMap((decoded) =>
          runProtocolRpc(client["Protocol.serveRoute"](decoded), "Protocol.serveRoute")
        )
      ),
    deny: (input) =>
      decodeProtocolDenyInput(input).pipe(
        Effect.flatMap(validateDenyInput),
        Effect.flatMap((decoded) =>
          runProtocolRpc(client["Protocol.deny"](decoded), "Protocol.deny")
        )
      )
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
  return decodeInput(ProtocolScheme, scheme, operation)
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

  if (nodePath.parse(inputPath).root === inputPath) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(
        field,
        "must name a scoped directory, not a filesystem root",
        operation
      )
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

  const decoded = decodeUrlPath(path, field, operation)
  if (decoded._tag === "Left") {
    return Effect.fail(decoded.left)
  }

  if (decoded.right.split("/").includes("..")) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must not contain .. segments", operation)
    )
  }

  if (decoded.right.split("/").includes(".")) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must not contain . segments", operation)
    )
  }

  if (ControlCharPattern.test(decoded.right)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must not contain control characters", operation)
    )
  }

  if (decoded.right.includes("\\")) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(field, "must not contain backslashes", operation)
    )
  }

  return Effect.succeed(path)
}

type DecodeUrlPathResult =
  | { readonly _tag: "Left"; readonly left: ProtocolError }
  | { readonly _tag: "Right"; readonly right: string }

const decodeUrlPath = (path: string, field: string, operation: string): DecodeUrlPathResult => {
  try {
    return { _tag: "Right", right: decodeURIComponent(path) }
  } catch {
    return {
      _tag: "Left",
      left: makeHostProtocolInvalidArgumentError(
        field,
        "must not contain malformed percent escapes",
        operation
      )
    }
  }
}

const decodeProtocolRegisterAppProtocolInput = (
  input: unknown
): Effect.Effect<ProtocolRegisterAppProtocolInput, ProtocolError, never> =>
  decodeInput(ProtocolRegisterAppProtocolInput, input, "Protocol.registerAppProtocol")

const decodeProtocolServeAssetInput = (
  input: unknown
): Effect.Effect<ProtocolServeAssetInput, ProtocolError, never> =>
  decodeInput(ProtocolServeAssetInput, input, "Protocol.serveAsset")

const decodeProtocolServeRouteInput = (
  input: unknown
): Effect.Effect<ProtocolServeRouteInput, ProtocolError, never> =>
  decodeInput(ProtocolServeRouteInput, input, "Protocol.serveRoute")

const decodeProtocolDenyInput = (
  input: unknown
): Effect.Effect<ProtocolDenyInput, ProtocolError, never> =>
  decodeInput(ProtocolDenyInput, input, "Protocol.deny")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, ProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function protocolRpc<
  const Method extends (typeof ProtocolMethodNames)[number],
  Input extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, input: Input, permission: RpcCapabilityMetadata) {
  return NativeSurface.rpc("Protocol", method, {
    payload: input,
    success: Schema.Void,
    authority: NativeSurface.authority.custom(permission),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runProtocolRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ProtocolError, never> =>
  effect.pipe(
    Effect.mapError(mapProtocolRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapProtocolRpcClientError = (error: unknown): ProtocolError =>
  isProtocolError(error)
    ? error
    : makeHostProtocolInternalError("Protocol RPC client failed", "Protocol")

const isProtocolError = (error: unknown): error is ProtocolError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
