import {
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeSecretBytes,
  type SecretBytes,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError,
  unsafeSecretBytes
} from "@orika/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import {
  SafeStorageAvailabilityResult,
  SafeStorageKeyInput,
  SafeStorageListResult,
  SafeStorageSecretPayload,
  SafeStorageSetInput
} from "./contracts/safe-storage.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const SafeStorageHostSupport = NativeSurface.support.supported

export type SafeStorageError = HostProtocolError

export {
  makeSecretBytes,
  makeSecretBytesFromUtf8,
  unsafeSecretBytes,
  wipeSecretBytes,
  type SecretBytes
} from "@orika/bridge"

export const SafeStorageSet = safeStorageRpc(
  "set",
  SafeStorageSetInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "SafeStorage", methods: ["set"] })
)
export const SafeStorageGet = safeStorageRpc(
  "get",
  SafeStorageKeyInput,
  SafeStorageSecretPayload,
  P.nativeInvoke({ primitive: "SafeStorage", methods: ["get"] })
)
export const SafeStorageDelete = safeStorageRpc(
  "delete",
  SafeStorageKeyInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "SafeStorage", methods: ["delete"] })
)
export const SafeStorageList = safeStorageRpc(
  "list",
  Schema.Void,
  SafeStorageListResult,
  P.nativeInvoke({ primitive: "SafeStorage", methods: ["list"] })
)
export const SafeStorageIsAvailable = safeStorageRpc(
  "isAvailable",
  Schema.Void,
  SafeStorageAvailabilityResult,
  { kind: "none" }
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

const SafeStorageCapabilityMethods = Object.freeze([
  "set",
  "get",
  "delete",
  "list"
] as const satisfies readonly (typeof SafeStorageMethodNames)[number][])

export interface SafeStorageClientApi {
  readonly set: (key: string, value: SecretBytes) => Effect.Effect<void, SafeStorageError, never>
  readonly get: (key: string) => Effect.Effect<SecretBytes, SafeStorageError, never>
  readonly delete: (key: string) => Effect.Effect<void, SafeStorageError, never>
  readonly list: () => Effect.Effect<ReadonlyArray<string>, SafeStorageError, never>
  readonly isAvailable: () => Effect.Effect<boolean, SafeStorageError, never>
}

export class SafeStorageClient extends Context.Service<SafeStorageClient, SafeStorageClientApi>()(
  "@orika/native/SafeStorageClient"
) {}

export type SafeStorageServiceApi = SafeStorageClientApi

export class SafeStorage extends Context.Service<SafeStorage, SafeStorageServiceApi>()(
  "@orika/native/SafeStorage"
) {
  static readonly layer = Layer.effect(SafeStorage)(
    Effect.gen(function* () {
      const client = yield* SafeStorageClient
      return SafeStorage.of({
        set: (key, value) => client.set(key, value),
        get: (key) => client.get(key),
        delete: (key) => client.delete(key),
        list: () => client.list(),
        isAvailable: () => client.isAvailable()
      } satisfies SafeStorageServiceApi)
    })
  )
}

export const SafeStorageLive = SafeStorage.layer

export type SafeStorageRpc = RpcGroup.Rpcs<typeof SafeStorageRpcGroup>

export type SafeStorageRpcHandlers<R = never> = NativeRpcHandlers<typeof SafeStorageRpcGroup, R>

export const SafeStorageHandlersLive = SafeStorageRpcGroup.toLayer({
  "SafeStorage.set": (input) =>
    Effect.gen(function* () {
      const storage = yield* SafeStorage
      yield* storage.set(input.key, makeSecretBytes(input.value))
    }),
  "SafeStorage.get": (input) =>
    Effect.gen(function* () {
      const storage = yield* SafeStorage
      const value = yield* storage.get(input.key)
      return new SafeStorageSecretPayload({ value: unsafeSecretBytes(value) })
    }),
  "SafeStorage.delete": (input) =>
    Effect.gen(function* () {
      const storage = yield* SafeStorage
      yield* storage.delete(input.key)
    }),
  "SafeStorage.list": () =>
    Effect.gen(function* () {
      const storage = yield* SafeStorage
      const keys = yield* storage.list()
      return new SafeStorageListResult({ keys })
    }),
  "SafeStorage.isAvailable": () =>
    Effect.gen(function* () {
      const storage = yield* SafeStorage
      const available = yield* storage.isAvailable()
      return new SafeStorageAvailabilityResult({ available })
    })
})

export const SafeStorageSurface = NativeSurface.make("SafeStorage", SafeStorageRpcGroup, {
  service: SafeStorageClient,
  capabilities: SafeStorageCapabilityMethods,
  handlers: SafeStorageHandlersLive,
  client: (client) => safeStorageClientFromRpcClient(client)
})

export const makeHostSafeStorageRpcRuntime = (
  handlers: SafeStorageRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  SafeStorageSurface.hostRuntime(handlers, runtimeOptions)

const safeStorageClientFromRpcClient = (
  client: DesktopRpcClient<SafeStorageRpc>
): SafeStorageClientApi => {
  return Object.freeze({
    set: (key, value) =>
      decodeSafeStorageSetInput({ key, value: unsafeSecretBytes(value) }).pipe(
        Effect.flatMap(validateSafeStorageSetInput),
        Effect.flatMap((decoded) =>
          runSafeStorageRpc(client["SafeStorage.set"](decoded), "SafeStorage.set")
        )
      ),
    get: (key) =>
      decodeSafeStorageKeyInput({ key }, "SafeStorage.get").pipe(
        Effect.flatMap(validateSafeStorageKeyInput("SafeStorage.get")),
        Effect.flatMap((decoded) =>
          runSafeStorageRpc(client["SafeStorage.get"](decoded), "SafeStorage.get")
        ),
        Effect.map((result) => makeSecretBytes(result.value))
      ),
    delete: (key) =>
      decodeSafeStorageKeyInput({ key }, "SafeStorage.delete").pipe(
        Effect.flatMap(validateSafeStorageKeyInput("SafeStorage.delete")),
        Effect.flatMap((decoded) =>
          runSafeStorageRpc(client["SafeStorage.delete"](decoded), "SafeStorage.delete")
        )
      ),
    list: () =>
      runSafeStorageRpc(client["SafeStorage.list"](undefined), "SafeStorage.list").pipe(
        Effect.map((result) => result.keys)
      ),
    isAvailable: () =>
      runSafeStorageRpc(
        client["SafeStorage.isAvailable"](undefined),
        "SafeStorage.isAvailable"
      ).pipe(Effect.map((result) => result.available))
  } satisfies SafeStorageClientApi)
}

export const makeLinuxSafeStorageClient = (): SafeStorageClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, SafeStorageError, never> =>
    Effect.fail(unsupportedError(method, "secret-service-adapter-unimplemented"))
  return Object.freeze({
    set: () => unsupportedEffect<void>("SafeStorage.set"),
    get: () => unsupportedEffect<SecretBytes>("SafeStorage.get"),
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

const unsupportedError = (method: string, reason: string): HostProtocolUnsupportedError =>
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
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("SafeStorage", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: SafeStorageHostSupport
  })
}

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
