import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import type { DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema } from "effect"

import {
  SafeStorageAvailabilityResult,
  SafeStorageKeyInput,
  SafeStorageListResult,
  SafeStorageSecretPayload,
  SafeStorageSetInput
} from "./contracts/safe-storage.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const Redacted = "[REDACTED]"
const NodeInspectCustom = Symbol.for("nodejs.util.inspect.custom")

export type SafeStorageError = HostProtocolError

export class SecretValue {
  readonly _tag = "SecretValue"
  #bytes: Uint8Array

  private constructor(bytes: Uint8Array) {
    this.#bytes = new Uint8Array(bytes)
  }

  static fromBytes(bytes: Uint8Array): SecretValue {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError("SecretValue.fromBytes requires a Uint8Array")
    }
    return new SecretValue(bytes)
  }

  static fromUtf8(value: string): SecretValue {
    return new SecretValue(new TextEncoder().encode(value))
  }

  unsafeBytes(): Uint8Array {
    return new Uint8Array(this.#bytes)
  }

  dispose(): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      this.#bytes.fill(0)
    })
  }

  toString(): string {
    return Redacted
  }

  toJSON(): string {
    return Redacted
  }

  [NodeInspectCustom](): string {
    return Redacted
  }
}

export const SafeStorageSet = safeStorageRpc(
  "set",
  SafeStorageSetInput,
  Schema.Void,
  "native.invoke:SafeStorage.set"
)
export const SafeStorageGet = safeStorageRpc(
  "get",
  SafeStorageKeyInput,
  SafeStorageSecretPayload,
  "native.invoke:SafeStorage.get"
)
export const SafeStorageDelete = safeStorageRpc(
  "delete",
  SafeStorageKeyInput,
  Schema.Void,
  "native.invoke:SafeStorage.delete"
)
export const SafeStorageList = safeStorageRpc(
  "list",
  Schema.Void,
  SafeStorageListResult,
  "native.invoke:SafeStorage.list"
)
export const SafeStorageIsAvailable = safeStorageRpc(
  "isAvailable",
  Schema.Void,
  SafeStorageAvailabilityResult,
  "none"
)

export const SafeStorageRpcEvents = Object.freeze({})

export type SafeStorageRpcEvents = typeof SafeStorageRpcEvents

const SafeStorageRpcGroup = RpcGroup.make(
  SafeStorageSet,
  SafeStorageGet,
  SafeStorageDelete,
  SafeStorageList,
  SafeStorageIsAvailable
)

export const SafeStorageRpcs: RpcGroup.RpcGroup<SafeStorageRpc> = SafeStorageRpcGroup

export const SafeStorageMethodNames = Object.freeze([
  "set",
  "get",
  "delete",
  "list",
  "isAvailable"
] as const)

export interface SafeStorageClientApi {
  readonly set: (key: string, value: SecretValue) => Effect.Effect<void, SafeStorageError, never>
  readonly get: (key: string) => Effect.Effect<SecretValue, SafeStorageError, never>
  readonly delete: (key: string) => Effect.Effect<void, SafeStorageError, never>
  readonly list: () => Effect.Effect<ReadonlyArray<string>, SafeStorageError, never>
  readonly isAvailable: () => Effect.Effect<boolean, SafeStorageError, never>
}

export class SafeStorageClient extends Context.Service<SafeStorageClient, SafeStorageClientApi>()(
  "@effect-desktop/native/SafeStorageClient"
) {}

export type SafeStorageServiceApi = SafeStorageClientApi

export class SafeStorage extends Context.Service<SafeStorage, SafeStorageServiceApi>()(
  "@effect-desktop/native/SafeStorage"
) {}

export const SafeStorageLive = Layer.effect(SafeStorage)(
  Effect.gen(function* () {
    const client = yield* SafeStorageClient
    return Object.freeze({
      set: (key, value) => client.set(key, value),
      get: (key) => client.get(key),
      delete: (key) => client.delete(key),
      list: () => client.list(),
      isAvailable: () => client.isAvailable()
    } satisfies SafeStorageServiceApi)
  })
)

export const makeSafeStorageClientLayer = (
  client: SafeStorageClientApi
): Layer.Layer<SafeStorageClient> => Layer.succeed(SafeStorageClient)(client)

export const makeSafeStorageServiceLayer = (
  client: SafeStorageClientApi
): Layer.Layer<SafeStorage> => Layer.provide(SafeStorageLive, makeSafeStorageClientLayer(client))

export const makeSafeStorageBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<SafeStorageClient> =>
  Layer.succeed(SafeStorageClient)(makeSafeStorageBridgeClient(exchange, options))

export type SafeStorageRpc = RpcGroup.Rpcs<typeof SafeStorageRpcGroup>

export type SafeStorageRpcHandlers = Parameters<typeof SafeStorageRpcGroup.toLayer>[0]

export const makeHostSafeStorageRpcRuntime = (
  handlers: SafeStorageRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(
    SafeStorageRpcGroup,
    SafeStorageRpcGroup.toLayer(handlers),
    runtimeOptions
  )

const makeSafeStorageBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): SafeStorageClientApi => {
  return Object.freeze({
    set: (key, value) =>
      decodeSafeStorageSetInput({ key, value: value.unsafeBytes() }).pipe(
        Effect.flatMap(validateSafeStorageSetInput),
        Effect.flatMap((decoded) =>
          withSafeStorageRpcClient(exchange, options, (client) =>
            runSafeStorageRpc(client["SafeStorage.set"](decoded), "SafeStorage.set")
          )
        )
      ),
    get: (key) =>
      decodeSafeStorageKeyInput({ key }, "SafeStorage.get").pipe(
        Effect.flatMap(validateSafeStorageKeyInput("SafeStorage.get")),
        Effect.flatMap((decoded) =>
          withSafeStorageRpcClient(exchange, options, (client) =>
            runSafeStorageRpc(client["SafeStorage.get"](decoded), "SafeStorage.get")
          )
        ),
        Effect.map((result) => SecretValue.fromBytes(result.value))
      ),
    delete: (key) =>
      decodeSafeStorageKeyInput({ key }, "SafeStorage.delete").pipe(
        Effect.flatMap(validateSafeStorageKeyInput("SafeStorage.delete")),
        Effect.flatMap((decoded) =>
          withSafeStorageRpcClient(exchange, options, (client) =>
            runSafeStorageRpc(client["SafeStorage.delete"](decoded), "SafeStorage.delete")
          )
        )
      ),
    list: () =>
      withSafeStorageRpcClient(exchange, options, (client) =>
        runSafeStorageRpc(client["SafeStorage.list"](undefined), "SafeStorage.list")
      ).pipe(Effect.map((result) => result.keys)),
    isAvailable: () =>
      withSafeStorageRpcClient(exchange, options, (client) =>
        runSafeStorageRpc(client["SafeStorage.isAvailable"](undefined), "SafeStorage.isAvailable")
      ).pipe(Effect.map((result) => result.available))
  } satisfies SafeStorageClientApi)
}

const makeSafeStorageBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const withSafeStorageRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: SafeStorageRpcClient) => Effect.Effect<A, SafeStorageError, never>
): Effect.Effect<A, SafeStorageError, never> =>
  Effect.scoped(
    RpcClient.make(SafeStorageRpcGroup).pipe(
      Effect.flatMap(use),
      Effect.provide(makeSafeStorageBridgeProtocolLayer(exchange, options))
    )
  )

export const makeUnsupportedSafeStorageClient = (): SafeStorageClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, SafeStorageError, never> =>
    Effect.fail(unsupportedError(method))
  return Object.freeze({
    set: () => unsupportedEffect<void>("SafeStorage.set"),
    get: () => unsupportedEffect<SecretValue>("SafeStorage.get"),
    delete: () => unsupportedEffect<void>("SafeStorage.delete"),
    list: () => unsupportedEffect<ReadonlyArray<string>>("SafeStorage.list"),
    isAvailable: () => Effect.succeed(false)
  } satisfies SafeStorageClientApi)
}

export const makeLinuxSafeStorageClient = (): SafeStorageClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, SafeStorageError, never> =>
    Effect.fail(unsupportedError(method, "secret-service-adapter-unimplemented"))
  return Object.freeze({
    set: () => unsupportedEffect<void>("SafeStorage.set"),
    get: () => unsupportedEffect<SecretValue>("SafeStorage.get"),
    delete: () => unsupportedEffect<void>("SafeStorage.delete"),
    list: () => Effect.succeed([]),
    isAvailable: () => Effect.succeed(false)
  } satisfies SafeStorageClientApi)
}

const validateSafeStorageSetInput = (
  input: SafeStorageSetInput
): Effect.Effect<SafeStorageSetInput, SafeStorageError, never> =>
  validateKey(input.key, "SafeStorage.set").pipe(Effect.as(input))

const validateSafeStorageKeyInput =
  (operation: string) =>
  (input: SafeStorageKeyInput): Effect.Effect<SafeStorageKeyInput, SafeStorageError, never> =>
    validateKey(input.key, operation).pipe(Effect.as(input))

const validateKey = (
  key: string,
  operation: string
): Effect.Effect<string, SafeStorageError, never> => {
  if (key.length === 0) {
    return Effect.fail(makeHostProtocolInvalidArgumentError("key", "must not be empty", operation))
  }
  if (key.includes("\0")) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError("key", "must not contain NUL bytes", operation)
    )
  }
  return Effect.succeed(key)
}

const unsupportedError = (
  method: string,
  reason = "host SafeStorage platform adapter is not implemented yet"
): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason,
    message: `unsupported SafeStorage method: ${method}`,
    operation: method,
    recoverable: false
  })

const decodeSafeStorageSetInput = (
  input: unknown
): Effect.Effect<SafeStorageSetInput, SafeStorageError, never> =>
  decodeInput(SafeStorageSetInput, input, "SafeStorage.set")

const decodeSafeStorageKeyInput = (
  input: unknown,
  operation: string
): Effect.Effect<SafeStorageKeyInput, SafeStorageError, never> =>
  decodeInput(SafeStorageKeyInput, input, operation)

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, SafeStorageError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function safeStorageRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`SafeStorage.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

type SafeStorageRpcClient = DesktopRpcClient<SafeStorageRpc>

const runSafeStorageRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SafeStorageError, never> =>
  effect.pipe(
    Effect.mapError(mapSafeStorageRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapSafeStorageRpcClientError = (error: unknown): SafeStorageError =>
  isSafeStorageError(error)
    ? error
    : makeHostProtocolInternalError("SafeStorage RPC client failed", "SafeStorage")

const isSafeStorageError = (error: unknown): error is SafeStorageError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
