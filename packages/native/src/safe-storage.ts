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

export const SafeStorageRpcSpec = Object.freeze({
  set: safeStorageMethodSpec(SafeStorageSetInput, "native.invoke:SafeStorage.set"),
  get: {
    input: SafeStorageKeyInput,
    output: SafeStorageSecretPayload,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:SafeStorage.get"
  },
  delete: safeStorageMethodSpec(SafeStorageKeyInput, "native.invoke:SafeStorage.delete"),
  list: {
    input: Schema.Void,
    output: SafeStorageListResult,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:SafeStorage.list"
  },
  isAvailable: {
    input: Schema.Void,
    output: SafeStorageAvailabilityResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies BridgeRpcSpec

export type SafeStorageRpcSpec = typeof SafeStorageRpcSpec

export const SafeStorageRpcEvents = Object.freeze({})

export type SafeStorageRpcEvents = typeof SafeStorageRpcEvents

export const SafeStorageRpcs: BridgeRpcGroup<
  "SafeStorage",
  SafeStorageRpcSpec,
  SafeStorageRpcEvents
> = BridgeRpc.group("SafeStorage", SafeStorageRpcSpec, SafeStorageRpcEvents)

export const SafeStorageMethodNames = Object.freeze(
  Object.keys(SafeStorageRpcSpec) as ReadonlyArray<keyof SafeStorageRpcSpec>
)

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

export const makeHostSafeStorageBridgeRpcLayer = <
  Handlers extends BridgeRpcHandlers<SafeStorageRpcSpec>
>(
  handlers: Handlers
): BridgeRpcLayer<"SafeStorage", SafeStorageRpcSpec, Handlers, SafeStorageRpcEvents> =>
  BridgeRpc.layer(SafeStorageRpcs)(handlers)

const makeSafeStorageBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): SafeStorageClientApi => {
  const client = Client({ SafeStorage: SafeStorageRpcs }, exchange, options).SafeStorage
  return Object.freeze({
    set: (key, value) =>
      decodeSafeStorageSetInput({ key, value: value.unsafeBytes() }).pipe(
        Effect.flatMap(validateSafeStorageSetInput),
        Effect.flatMap(client.set)
      ),
    get: (key) =>
      decodeSafeStorageKeyInput({ key }, "SafeStorage.get").pipe(
        Effect.flatMap(validateSafeStorageKeyInput("SafeStorage.get")),
        Effect.flatMap(client.get),
        Effect.map((result) => SecretValue.fromBytes(result.value))
      ),
    delete: (key) =>
      decodeSafeStorageKeyInput({ key }, "SafeStorage.delete").pipe(
        Effect.flatMap(validateSafeStorageKeyInput("SafeStorage.delete")),
        Effect.flatMap(client.delete)
      ),
    list: () => client.list().pipe(Effect.map((result) => result.keys)),
    isAvailable: () => client.isAvailable().pipe(Effect.map((result) => result.available))
  } satisfies SafeStorageClientApi)
}

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
  decodeInput(SafeStorageSetInput, input, "SafeStorage.set") as Effect.Effect<
    SafeStorageSetInput,
    SafeStorageError,
    never
  >

const decodeSafeStorageKeyInput = (
  input: unknown,
  operation: string
): Effect.Effect<SafeStorageKeyInput, SafeStorageError, never> =>
  decodeInput(SafeStorageKeyInput, input, operation) as Effect.Effect<
    SafeStorageKeyInput,
    SafeStorageError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, SafeStorageError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function safeStorageMethodSpec<Input extends Schema.Schema<unknown>>(
  input: Input,
  permission: string
) {
  return { input, output: Schema.Void, error: HostProtocolErrorSchema, permission } as const
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
