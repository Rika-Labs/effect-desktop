import {
  type BridgeClientExchange,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  RpcGroup,
  type SecretBytes
} from "@orika/bridge"
import {
  AuditEvents,
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  type NormalizedCapability,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  permissionAuditEvent
} from "@orika/core"
import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  PubSub,
  Redacted,
  Ref,
  Schema,
  Stream
} from "effect"

import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import {
  ExtensionConfigActor,
  ExtensionConfigEvent,
  type ExtensionConfigEventPhase,
  ExtensionConfigField,
  ExtensionConfigReadInput,
  ExtensionConfigReadRequest,
  ExtensionConfigReadResult,
  ExtensionConfigRedactInput,
  ExtensionConfigRedactRequest,
  ExtensionConfigRedactResult,
  ExtensionConfigRedactionEvidence,
  ExtensionConfigResetInput,
  ExtensionConfigResetRequest,
  ExtensionConfigResetResult,
  ExtensionConfigSecretState,
  ExtensionConfigSupportedResult,
  ExtensionConfigValueEntry,
  type ExtensionConfigValueType,
  ExtensionConfigWriteInput,
  ExtensionConfigWriteResult
} from "./contracts/extension-config.js"
import { SafeStorage } from "./safe-storage.js"

const Surface = "ExtensionConfig"
const UnsupportedReason = "host-adapter-unimplemented"
const ExtensionConfigEventMethod = "ExtensionConfig.Event"

const ConfigNamePattern = /^[A-Za-z0-9._-]+$/
const RedactedSecretValue = "<redacted:ExtensionConfigSecret>"

export type ExtensionConfigError = HostProtocolError

export const ExtensionConfigRead = extensionConfigRpc(
  "read",
  ExtensionConfigReadInput,
  ExtensionConfigReadResult,
  P.nativeInvoke({ primitive: Surface, methods: ["read"] })
)
export const ExtensionConfigWrite = extensionConfigRpc(
  "write",
  ExtensionConfigWriteInput,
  ExtensionConfigWriteResult,
  P.nativeInvoke({ primitive: Surface, methods: ["write"] })
)
export const ExtensionConfigReset = extensionConfigRpc(
  "reset",
  ExtensionConfigResetInput,
  ExtensionConfigResetResult,
  P.nativeInvoke({ primitive: Surface, methods: ["reset"] })
)
export const ExtensionConfigRedact = extensionConfigRpc(
  "redact",
  ExtensionConfigRedactInput,
  ExtensionConfigRedactResult,
  P.nativeInvoke({ primitive: Surface, methods: ["redact"] })
)
export const ExtensionConfigIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: ExtensionConfigSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const ExtensionConfigRpcEvents = Object.freeze({
  Event: { payload: ExtensionConfigEvent }
})

export type ExtensionConfigRpcEvents = typeof ExtensionConfigRpcEvents

const ExtensionConfigRpcGroup = RpcGroup.make(
  ExtensionConfigRead,
  ExtensionConfigWrite,
  ExtensionConfigReset,
  ExtensionConfigRedact,
  ExtensionConfigIsSupported
)

export const ExtensionConfigRpcs: RpcGroup.RpcGroup<ExtensionConfigRpc> = ExtensionConfigRpcGroup

export const ExtensionConfigMethodNames = Object.freeze([
  "read",
  "write",
  "reset",
  "redact",
  "isSupported"
] as const)

const ExtensionConfigCapabilityMethods = Object.freeze([
  "read",
  "write",
  "reset",
  "redact"
] as const satisfies readonly (typeof ExtensionConfigMethodNames)[number][])

export interface ExtensionConfigClientApi {
  readonly read: (
    input: ExtensionConfigReadInput
  ) => Effect.Effect<ExtensionConfigReadResult, ExtensionConfigError, never>
  readonly write: (
    input: ExtensionConfigWriteInput
  ) => Effect.Effect<ExtensionConfigWriteResult, ExtensionConfigError, never>
  readonly reset: (
    input: ExtensionConfigResetInput
  ) => Effect.Effect<ExtensionConfigResetResult, ExtensionConfigError, never>
  readonly redact: (
    input: ExtensionConfigRedactInput
  ) => Effect.Effect<ExtensionConfigRedactResult, ExtensionConfigError, never>
  readonly isSupported: () => Effect.Effect<
    ExtensionConfigSupportedResult,
    ExtensionConfigError,
    never
  >
  readonly events: () => Stream.Stream<ExtensionConfigEvent, ExtensionConfigError, never>
}

export class ExtensionConfigClient extends Context.Service<
  ExtensionConfigClient,
  ExtensionConfigClientApi
>()("@orika/native/ExtensionConfigClient") {}

export interface ExtensionConfigServiceApi {
  readonly read: (
    input: ExtensionConfigReadRequest
  ) => Effect.Effect<ExtensionConfigReadResult, ExtensionConfigError, never>
  readonly write: (
    input: ExtensionConfigWriteRequest
  ) => Effect.Effect<ExtensionConfigWriteResult, ExtensionConfigError, never>
  readonly reset: (
    input: ExtensionConfigResetRequest
  ) => Effect.Effect<ExtensionConfigResetResult, ExtensionConfigError, never>
  readonly redact: (
    input: ExtensionConfigRedactRequest
  ) => Effect.Effect<ExtensionConfigRedactResult, ExtensionConfigError, never>
  readonly isSupported: () => Effect.Effect<
    ExtensionConfigSupportedResult,
    ExtensionConfigError,
    never
  >
  readonly events: () => Stream.Stream<ExtensionConfigEvent, ExtensionConfigError, never>
}

export interface ExtensionConfigSecretWrite {
  readonly key: string
  readonly value: SecretBytes
}

export interface ExtensionConfigWriteRequest {
  readonly actor: ExtensionConfigActor
  readonly extensionId: string
  readonly fields: readonly ExtensionConfigField[]
  readonly values?: readonly ExtensionConfigValueEntry[]
  readonly secrets?: readonly ExtensionConfigSecretWrite[]
  readonly traceId?: string
}

export interface ExtensionConfigSecretStoreApi {
  readonly set: (key: string, value: SecretBytes) => Effect.Effect<void, HostProtocolError, never>
  readonly get: (key: string) => Effect.Effect<SecretBytes, HostProtocolError, never>
  readonly delete: (key: string) => Effect.Effect<void, HostProtocolError, never>
  readonly list: () => Effect.Effect<ReadonlyArray<string>, HostProtocolError, never>
  readonly isAvailable: () => Effect.Effect<boolean, HostProtocolError, never>
}

export interface ExtensionConfigServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly secrets: ExtensionConfigSecretStoreApi
  readonly audit?: AuditEventsApi
  readonly nextTraceId?: () => string
}

export class ExtensionConfig extends Context.Service<ExtensionConfig, ExtensionConfigServiceApi>()(
  "@orika/native/ExtensionConfig"
) {
  static readonly layer = Layer.effect(ExtensionConfig)(
    Effect.gen(function* () {
      const client = yield* ExtensionConfigClient
      const permissions = yield* PermissionRegistry
      const secrets = yield* SafeStorage
      const audit = yield* Effect.serviceOption(AuditEvents)
      return yield* makeExtensionConfigService(client, {
        permissions,
        secrets,
        ...(Option.isSome(audit) ? { audit: audit.value } : {})
      })
    })
  )
}

export const ExtensionConfigLive = ExtensionConfig.layer

export const makeExtensionConfigServiceLayer = (
  client: ExtensionConfigClientApi,
  options: ExtensionConfigServiceOptions
): Layer.Layer<ExtensionConfig> =>
  Layer.effect(ExtensionConfig)(makeExtensionConfigService(client, options))

export type ExtensionConfigRpc = RpcGroup.Rpcs<typeof ExtensionConfigRpcGroup>

export type ExtensionConfigRpcHandlers<R = never> = NativeRpcHandlers<
  typeof ExtensionConfigRpcGroup,
  R
>

export const ExtensionConfigHandlersLive = ExtensionConfigRpcGroup.toLayer({
  "ExtensionConfig.read": (input) =>
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* config.read(input)
    }),
  "ExtensionConfig.write": (input) =>
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      if ((input.secretKeys ?? []).length > 0) {
        return yield* invalid(
          "secretKeys",
          "bridge writes cannot carry secret values; call the service write API with SecretBytes",
          "ExtensionConfig.write"
        )
      }
      return yield* config.write({
        actor: input.actor,
        extensionId: input.extensionId,
        fields: input.fields,
        values: input.values ?? [],
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "ExtensionConfig.reset": (input) =>
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* config.reset(input)
    }),
  "ExtensionConfig.redact": (input) =>
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* config.redact(input)
    }),
  "ExtensionConfig.isSupported": () =>
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* config.isSupported()
    })
})

export const ExtensionConfigSurface = NativeSurface.make(Surface, ExtensionConfigRpcGroup, {
  service: ExtensionConfigClient,
  capabilities: ExtensionConfigCapabilityMethods,
  handlers: ExtensionConfigHandlersLive,
  client: (client) => extensionConfigClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => extensionConfigClientFromRpcClient(client, exchange)
})

export const makeHostExtensionConfigRpcRuntime = <R = never>(
  handlers: ExtensionConfigRpcHandlers<R>,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
) => ExtensionConfigSurface.hostRuntime(handlers, runtimeOptions)

export interface ExtensionConfigMemoryClientOptions {
  readonly failure?: Partial<Record<"read" | "write" | "reset" | "redact", ExtensionConfigError>>
}

interface ExtensionConfigState {
  readonly values: ReadonlyMap<string, typeof Schema.Json.Type>
  readonly revision: number
}

export const makeExtensionConfigMemoryClient = (
  options: ExtensionConfigMemoryClientOptions = {}
): Effect.Effect<ExtensionConfigClientApi, never, never> =>
  Effect.gen(function* () {
    const states = yield* Ref.make<ReadonlyMap<string, ExtensionConfigState>>(new Map())
    const pubsub = yield* PubSub.bounded<ExtensionConfigEvent>({ capacity: 256, replay: 64 })

    const currentState = (extensionId: string, state: ReadonlyMap<string, ExtensionConfigState>) =>
      state.get(extensionId) ?? { values: new Map<string, typeof Schema.Json.Type>(), revision: 0 }

    return Object.freeze({
      read: (input) =>
        validateReadInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.read,
              Effect.gen(function* () {
                const state = currentState(valid.extensionId, yield* Ref.get(states))
                const values = nonSecretFields(valid.fields).flatMap((field) =>
                  resolveStoredValue(field, state.values)
                )
                return new ExtensionConfigReadResult({
                  extensionId: valid.extensionId,
                  values,
                  secrets: [],
                  revision: state.revision
                })
              })
            )
          )
        ),
      write: (input) =>
        validateWriteInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.write,
              Effect.gen(function* () {
                const writtenKeys = [
                  ...(valid.values ?? []).map((entry) => entry.key),
                  ...(valid.secretKeys ?? [])
                ]
                const revision = yield* Ref.modify(states, (current) => {
                  const state = currentState(valid.extensionId, current)
                  const values = new Map(state.values)
                  for (const entry of valid.values ?? []) {
                    values.set(entry.key, entry.value)
                  }
                  const nextRevision = state.revision + 1
                  const next = new Map(current).set(valid.extensionId, {
                    values,
                    revision: nextRevision
                  })
                  return [nextRevision, next] as const
                })
                yield* publish(pubsub, valid.extensionId, "written", writtenKeys, revision)
                return new ExtensionConfigWriteResult({
                  extensionId: valid.extensionId,
                  writtenKeys,
                  revision
                })
              })
            )
          )
        ),
      reset: (input) =>
        validateResetInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.reset,
              Effect.gen(function* () {
                const resetKeys = valid.keys ?? valid.fields.map((field) => field.key)
                const revision = yield* Ref.modify(states, (current) => {
                  const state = currentState(valid.extensionId, current)
                  const values = new Map(state.values)
                  for (const key of resetKeys) {
                    values.delete(key)
                  }
                  const nextRevision = state.revision + 1
                  const next = new Map(current).set(valid.extensionId, {
                    values,
                    revision: nextRevision
                  })
                  return [nextRevision, next] as const
                })
                yield* publish(pubsub, valid.extensionId, "reset", resetKeys, revision)
                return new ExtensionConfigResetResult({
                  extensionId: valid.extensionId,
                  resetKeys,
                  revision
                })
              })
            )
          )
        ),
      redact: (input) =>
        validateRedactInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.redact,
              Effect.gen(function* () {
                const state = currentState(valid.extensionId, yield* Ref.get(states))
                return redactState(valid.extensionId, valid.fields, state.values)
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new ExtensionConfigSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies ExtensionConfigClientApi)
  })

export const makeExtensionConfigUnsupportedClient = (): ExtensionConfigClientApi =>
  Object.freeze({
    read: (input) =>
      validateReadInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExtensionConfig.read")))
      ),
    write: (input) =>
      validateWriteInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExtensionConfig.write")))
      ),
    reset: (input) =>
      validateResetInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExtensionConfig.reset")))
      ),
    redact: (input) =>
      validateRedactInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExtensionConfig.redact")))
      ),
    isSupported: () =>
      Effect.succeed(
        new ExtensionConfigSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("ExtensionConfig.events"))
  } satisfies ExtensionConfigClientApi)

const makeExtensionConfigService = (
  client: ExtensionConfigClientApi,
  options: ExtensionConfigServiceOptions
): Effect.Effect<ExtensionConfigServiceApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      read: (input) =>
        Effect.gen(function* () {
          const request = yield* validateReadRequest(input)
          yield* checkConfigPermission(
            options,
            "read",
            request.actor,
            request.extensionId,
            request.traceId
          )
          const secrets = secretFields(request.fields)
          if (secrets.length > 0) {
            yield* checkSecretPermission(
              options,
              "read",
              request.actor,
              request.extensionId,
              request.traceId
            )
            yield* ensureSecretsAvailable(options, "ExtensionConfig.read")
          }
          const result = yield* client.read(toReadInput(request))
          const secretState =
            secrets.length === 0 ? [] : yield* secretStates(options, request.extensionId, secrets)
          const read = new ExtensionConfigReadResult({
            extensionId: result.extensionId,
            values: result.values,
            secrets: secretState,
            revision: result.revision
          })
          yield* validateRequiredRead(request.fields, read, "ExtensionConfig.read")
          yield* emitConfigAudit(
            options,
            "permission-used",
            "read",
            request.actor,
            request.extensionId,
            request.traceId,
            {
              keys: [
                ...read.values.map((entry) => entry.key),
                ...read.secrets.filter((entry) => entry.present).map((entry) => entry.key)
              ]
            }
          )
          return read
        }),
      write: (input) =>
        Effect.gen(function* () {
          const request = yield* validateWriteRequest(input)
          yield* checkConfigPermission(
            options,
            "write",
            request.actor,
            request.extensionId,
            request.traceId
          )
          if ((request.secrets ?? []).length > 0) {
            yield* checkSecretPermission(
              options,
              "write",
              request.actor,
              request.extensionId,
              request.traceId
            )
            yield* ensureSecretsAvailable(options, "ExtensionConfig.write")
          }
          const secretSnapshot = yield* snapshotSecrets(
            options,
            request.extensionId,
            (request.secrets ?? []).map((entry) => entry.key)
          )
          yield* writeSecrets(options, request.extensionId, request.secrets ?? [], secretSnapshot)
          const result = yield* client
            .write(toWriteInput(request))
            .pipe(
              Effect.catch((error: ExtensionConfigError) =>
                restoreSecrets(
                  options,
                  request.extensionId,
                  secretSnapshot,
                  "ExtensionConfig.write"
                ).pipe(Effect.andThen(Effect.fail(error)))
              )
            )
          yield* emitConfigAudit(
            options,
            "permission-used",
            "write",
            request.actor,
            request.extensionId,
            request.traceId,
            {
              keys: result.writtenKeys
            }
          )
          return result
        }),
      reset: (input) =>
        Effect.gen(function* () {
          const request = yield* validateResetRequest(input)
          yield* checkConfigPermission(
            options,
            "reset",
            request.actor,
            request.extensionId,
            request.traceId
          )
          const resetKeys = request.keys ?? request.fields.map((field) => field.key)
          const secretResetKeys = secretFields(request.fields)
            .filter((field) => resetKeys.includes(field.key))
            .map((field) => field.key)
          if (secretResetKeys.length > 0) {
            yield* checkSecretPermission(
              options,
              "write",
              request.actor,
              request.extensionId,
              request.traceId
            )
            yield* ensureSecretsAvailable(options, "ExtensionConfig.reset")
          }
          const secretSnapshot = yield* snapshotSecrets(
            options,
            request.extensionId,
            secretResetKeys
          )
          yield* deleteSecrets(options, request.extensionId, secretResetKeys, secretSnapshot)
          const result = yield* client
            .reset(toResetInput(request))
            .pipe(
              Effect.catch((error: ExtensionConfigError) =>
                restoreSecrets(
                  options,
                  request.extensionId,
                  secretSnapshot,
                  "ExtensionConfig.reset"
                ).pipe(Effect.andThen(Effect.fail(error)))
              )
            )
          yield* emitConfigAudit(
            options,
            "permission-used",
            "reset",
            request.actor,
            request.extensionId,
            request.traceId,
            {
              keys: result.resetKeys
            }
          )
          return result
        }),
      redact: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRedactRequest(input)
          yield* checkConfigPermission(
            options,
            "redact",
            request.actor,
            request.extensionId,
            request.traceId
          )
          const result = yield* client.redact(toRedactInput(request))
          yield* emitConfigAudit(
            options,
            "permission-used",
            "redact",
            request.actor,
            request.extensionId,
            request.traceId,
            { redactions: result.redactions.map((entry) => entry.key) }
          )
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies ExtensionConfigServiceApi)
  )

const extensionConfigClientFromRpcClient = (
  client: DesktopRpcClient<ExtensionConfigRpc>,
  exchange: BridgeClientExchange | undefined
): ExtensionConfigClientApi =>
  Object.freeze({
    read: (input) =>
      validateReadInput(input).pipe(
        Effect.flatMap((valid) =>
          runExtensionConfigRpc(client["ExtensionConfig.read"](valid), "ExtensionConfig.read")
        )
      ),
    write: (input) =>
      validateWriteInput(input).pipe(
        Effect.flatMap((valid) =>
          runExtensionConfigRpc(client["ExtensionConfig.write"](valid), "ExtensionConfig.write")
        )
      ),
    reset: (input) =>
      validateResetInput(input).pipe(
        Effect.flatMap((valid) =>
          runExtensionConfigRpc(client["ExtensionConfig.reset"](valid), "ExtensionConfig.reset")
        )
      ),
    redact: (input) =>
      validateRedactInput(input).pipe(
        Effect.flatMap((valid) =>
          runExtensionConfigRpc(client["ExtensionConfig.redact"](valid), "ExtensionConfig.redact")
        )
      ),
    isSupported: () =>
      runExtensionConfigRpc(
        client["ExtensionConfig.isSupported"](undefined),
        "ExtensionConfig.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, ExtensionConfigEventMethod, ExtensionConfigEvent)
  } satisfies ExtensionConfigClientApi)

function extensionConfigRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runExtensionConfigRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ExtensionConfigError, never> => runNativeRpc(effect, operation, Surface)

const validateReadRequest = (
  input: unknown
): Effect.Effect<ExtensionConfigReadRequest, ExtensionConfigError, never> =>
  decodeNativeInput(ExtensionConfigReadRequest, input, "ExtensionConfig.read").pipe(
    Effect.tap(validateDefinition("ExtensionConfig.read"))
  )

const validateReadInput = (
  input: unknown
): Effect.Effect<ExtensionConfigReadInput, ExtensionConfigError, never> =>
  decodeNativeInput(ExtensionConfigReadInput, input, "ExtensionConfig.read").pipe(
    Effect.tap(validateDefinition("ExtensionConfig.read"))
  )

const validateWriteRequest = (
  input: unknown
): Effect.Effect<ExtensionConfigWriteRequest, ExtensionConfigError, never> =>
  Effect.gen(function* () {
    if (!isRecord(input)) {
      return yield* invalid("payload", "must be an object", "ExtensionConfig.write")
    }
    if (input["secretKeys"] !== undefined) {
      return yield* invalid(
        "secretKeys",
        "public service writes must provide SecretBytes via secrets",
        "ExtensionConfig.write"
      )
    }
    const request = yield* decodeNativeInput(
      ExtensionConfigWriteInput,
      {
        actor: input["actor"],
        extensionId: input["extensionId"],
        fields: input["fields"],
        values: input["values"],
        traceId: input["traceId"]
      },
      "ExtensionConfig.write"
    )
    const secrets = yield* validateSecretWrites(input["secrets"], "ExtensionConfig.write")
    const valid = {
      actor: request.actor,
      extensionId: request.extensionId,
      fields: request.fields,
      ...(request.values === undefined ? {} : { values: request.values }),
      ...(secrets.length === 0 ? {} : { secrets }),
      ...(request.traceId === undefined ? {} : { traceId: request.traceId })
    } satisfies ExtensionConfigWriteRequest
    yield* validateDefinition("ExtensionConfig.write")(valid)
    yield* validateWritePayload("ExtensionConfig.write")(valid)
    return valid
  })

const validateWriteInput = (
  input: unknown
): Effect.Effect<ExtensionConfigWriteInput, ExtensionConfigError, never> =>
  decodeNativeInput(ExtensionConfigWriteInput, input, "ExtensionConfig.write").pipe(
    Effect.tap(validateDefinition("ExtensionConfig.write")),
    Effect.tap(validateWritePayload("ExtensionConfig.write"))
  )

const validateResetRequest = (
  input: unknown
): Effect.Effect<ExtensionConfigResetRequest, ExtensionConfigError, never> =>
  decodeNativeInput(ExtensionConfigResetRequest, input, "ExtensionConfig.reset").pipe(
    Effect.tap(validateDefinition("ExtensionConfig.reset")),
    Effect.tap(validateResetKeys("ExtensionConfig.reset"))
  )

const validateResetInput = (
  input: unknown
): Effect.Effect<ExtensionConfigResetInput, ExtensionConfigError, never> =>
  decodeNativeInput(ExtensionConfigResetInput, input, "ExtensionConfig.reset").pipe(
    Effect.tap(validateDefinition("ExtensionConfig.reset")),
    Effect.tap(validateResetKeys("ExtensionConfig.reset"))
  )

const validateRedactRequest = (
  input: unknown
): Effect.Effect<ExtensionConfigRedactRequest, ExtensionConfigError, never> =>
  decodeNativeInput(ExtensionConfigRedactRequest, input, "ExtensionConfig.redact").pipe(
    Effect.tap(validateDefinition("ExtensionConfig.redact"))
  )

const validateRedactInput = (
  input: unknown
): Effect.Effect<ExtensionConfigRedactInput, ExtensionConfigError, never> =>
  decodeNativeInput(ExtensionConfigRedactInput, input, "ExtensionConfig.redact").pipe(
    Effect.tap(validateDefinition("ExtensionConfig.redact"))
  )

const validateDefinition =
  (operation: string) =>
  (input: {
    readonly actor: ExtensionConfigActor
    readonly extensionId: string
    readonly fields: readonly ExtensionConfigField[]
  }) =>
    Effect.gen(function* () {
      yield* validateName("extensionId", input.extensionId, operation)
      yield* validateName("actor.id", input.actor.id, operation)
      if (input.fields.length === 0) {
        return yield* invalid("fields", "must include at least one field", operation)
      }
      const keys = new Set<string>()
      for (const field of input.fields) {
        yield* validateName("fields.key", field.key, operation)
        if (keys.has(field.key)) {
          return yield* invalid("fields.key", "must be unique", operation)
        }
        keys.add(field.key)
        if (field.secret && field.defaultValue !== undefined) {
          return yield* invalid(
            "fields.defaultValue",
            "secret fields cannot declare defaults",
            operation
          )
        }
        if (field.defaultValue !== undefined) {
          yield* validateValueType(field.key, field.valueType, field.defaultValue, operation)
        }
      }
    })

const validateWritePayload =
  (operation: string) =>
  (
    input: ExtensionConfigWriteRequest | ExtensionConfigWriteInput
  ): Effect.Effect<void, ExtensionConfigError, never> =>
    Effect.gen(function* () {
      const byKey = fieldMap(input.fields)
      const seen = new Set<string>()
      for (const entry of input.values ?? []) {
        const field = byKey.get(entry.key)
        if (field === undefined) {
          return yield* invalid("values.key", "must reference a declared field", operation)
        }
        if (field.secret) {
          return yield* invalid("values.key", "secret fields must be written as secrets", operation)
        }
        if (seen.has(entry.key)) {
          return yield* invalid("values.key", "must be unique", operation)
        }
        seen.add(entry.key)
        yield* validateValueType(entry.key, field.valueType, entry.value, operation)
      }
      if ("secrets" in input) {
        const secretSeen = new Set<string>()
        for (const entry of input.secrets ?? []) {
          yield* validateSecretKey(byKey, entry, secretSeen, operation)
        }
      }
      if ("secretKeys" in input) {
        const secretSeen = new Set<string>()
        for (const key of input.secretKeys ?? []) {
          const field = byKey.get(key)
          if (field === undefined || !field.secret) {
            return yield* invalid("secretKeys", "must reference declared secret fields", operation)
          }
          if (secretSeen.has(key)) {
            return yield* invalid("secretKeys", "must be unique", operation)
          }
          secretSeen.add(key)
        }
      }
    })

const validateSecretKey = (
  fields: ReadonlyMap<string, ExtensionConfigField>,
  entry: ExtensionConfigSecretWrite,
  seen: Set<string>,
  operation: string
): Effect.Effect<void, ExtensionConfigError, never> => {
  const field = fields.get(entry.key)
  if (field === undefined || !field.secret) {
    return invalid("secrets.key", "must reference declared secret fields", operation)
  }
  if (seen.has(entry.key)) {
    return invalid("secrets.key", "must be unique", operation)
  }
  seen.add(entry.key)
  return Effect.void
}

const validateSecretWrites = (
  input: unknown,
  operation: string
): Effect.Effect<readonly ExtensionConfigSecretWrite[], ExtensionConfigError, never> =>
  Effect.gen(function* () {
    if (input === undefined) {
      return []
    }
    if (!Array.isArray(input)) {
      return yield* invalid("secrets", "must be an array", operation)
    }
    const secrets: ExtensionConfigSecretWrite[] = []
    for (const entry of input) {
      if (!isRecord(entry)) {
        return yield* invalid("secrets", "entries must be objects", operation)
      }
      if (typeof entry["key"] !== "string") {
        return yield* invalid("secrets.key", "must be a string", operation)
      }
      yield* validateName("secrets.key", entry["key"], operation)
      if (!isSecretBytes(entry["value"])) {
        return yield* invalid("secrets.value", "must be SecretBytes", operation)
      }
      secrets.push({ key: entry["key"], value: entry["value"] })
    }
    return secrets
  })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isSecretBytes = (value: unknown): value is SecretBytes =>
  Redacted.isRedacted(value) && Redacted.value(value) instanceof Uint8Array

const validateResetKeys =
  (operation: string) =>
  (
    input: ExtensionConfigResetRequest | ExtensionConfigResetInput
  ): Effect.Effect<void, ExtensionConfigError, never> => {
    const keys = new Set(input.fields.map((field) => field.key))
    for (const key of input.keys ?? []) {
      if (!keys.has(key)) {
        return invalid("keys", "must reference declared fields", operation)
      }
    }
    return Effect.void
  }

const validateRequiredRead = (
  fields: readonly ExtensionConfigField[],
  result: ExtensionConfigReadResult,
  operation: string
): Effect.Effect<void, ExtensionConfigError, never> => {
  const values = new Set(result.values.map((entry) => entry.key))
  const secrets = new Map(result.secrets.map((entry) => [entry.key, entry.present] as const))
  for (const field of fields) {
    if (field.required !== true) {
      continue
    }
    if (field.secret) {
      if (secrets.get(field.key) !== true) {
        return invalid(`secrets.${field.key}`, "required secret value is missing", operation)
      }
      continue
    }
    if (!values.has(field.key)) {
      return invalid(`values.${field.key}`, "required value is missing", operation)
    }
  }
  return Effect.void
}

const validateName = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<void, ExtensionConfigError, never> =>
  ConfigNamePattern.test(value)
    ? Effect.void
    : invalid(field, "must contain only letters, numbers, dots, underscores, or dashes", operation)

const validateValueType = (
  key: string,
  valueType: ExtensionConfigValueType,
  value: typeof Schema.Json.Type,
  operation: string
): Effect.Effect<void, ExtensionConfigError, never> => {
  const valid =
    valueType === "json" ||
    (valueType === "string" && typeof value === "string") ||
    (valueType === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (valueType === "boolean" && typeof value === "boolean")
  return valid ? Effect.void : invalid(`values.${key}`, `must be ${valueType}`, operation)
}

const invalid = (
  field: string,
  message: string,
  operation: string
): Effect.Effect<never, ExtensionConfigError, never> =>
  Effect.fail(makeHostProtocolInvalidArgumentError(field, message, operation))

const failOr = <A>(
  error: ExtensionConfigError | undefined,
  effect: Effect.Effect<A, ExtensionConfigError, never>
): Effect.Effect<A, ExtensionConfigError, never> =>
  error === undefined ? effect : Effect.fail(error)

const toReadInput = (request: ExtensionConfigReadRequest): ExtensionConfigReadInput =>
  new ExtensionConfigReadInput({
    actor: request.actor,
    extensionId: request.extensionId,
    fields: request.fields,
    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
  })

const toWriteInput = (request: ExtensionConfigWriteRequest): ExtensionConfigWriteInput =>
  new ExtensionConfigWriteInput({
    actor: request.actor,
    extensionId: request.extensionId,
    fields: request.fields,
    values: request.values ?? [],
    secretKeys: (request.secrets ?? []).map((entry) => entry.key),
    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
  })

const toResetInput = (request: ExtensionConfigResetRequest): ExtensionConfigResetInput =>
  new ExtensionConfigResetInput({
    actor: request.actor,
    extensionId: request.extensionId,
    fields: request.fields,
    ...(request.keys === undefined ? {} : { keys: request.keys }),
    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
  })

const toRedactInput = (request: ExtensionConfigRedactRequest): ExtensionConfigRedactInput =>
  new ExtensionConfigRedactInput({
    actor: request.actor,
    extensionId: request.extensionId,
    fields: request.fields,
    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
  })

const fieldMap = (
  fields: readonly ExtensionConfigField[]
): ReadonlyMap<string, ExtensionConfigField> => new Map(fields.map((field) => [field.key, field]))

const nonSecretFields = (
  fields: readonly ExtensionConfigField[]
): readonly ExtensionConfigField[] => fields.filter((field) => !field.secret)

const secretFields = (fields: readonly ExtensionConfigField[]): readonly ExtensionConfigField[] =>
  fields.filter((field) => field.secret)

const resolveStoredValue = (
  field: ExtensionConfigField,
  values: ReadonlyMap<string, typeof Schema.Json.Type>
): readonly ExtensionConfigValueEntry[] => {
  if (values.has(field.key)) {
    return [new ExtensionConfigValueEntry({ key: field.key, value: values.get(field.key) ?? null })]
  }
  if (field.defaultValue !== undefined) {
    return [new ExtensionConfigValueEntry({ key: field.key, value: field.defaultValue })]
  }
  return []
}

const redactState = (
  extensionId: string,
  fields: readonly ExtensionConfigField[],
  values: ReadonlyMap<string, typeof Schema.Json.Type>
): ExtensionConfigRedactResult => {
  const redactions: ExtensionConfigRedactionEvidence[] = []
  const entries: ExtensionConfigValueEntry[] = []
  for (const field of fields) {
    if (field.secret) {
      redactions.push(
        new ExtensionConfigRedactionEvidence({ key: field.key, reason: "secret-field" })
      )
      entries.push(new ExtensionConfigValueEntry({ key: field.key, value: RedactedSecretValue }))
      continue
    }
    if ((field.exportPolicy ?? "diagnostics") === "private") {
      redactions.push(
        new ExtensionConfigRedactionEvidence({ key: field.key, reason: "private-export" })
      )
      entries.push(
        new ExtensionConfigValueEntry({
          key: field.key,
          value: "<redacted:ExtensionConfigPrivate>"
        })
      )
      continue
    }
    entries.push(...resolveStoredValue(field, values))
  }
  return new ExtensionConfigRedactResult({ extensionId, values: entries, redactions })
}

const secretStorageKey = (extensionId: string, key: string): string =>
  `extension-config/${extensionId}/${key}`

const secretNamespace = (extensionId: string): string => `extension-config.${extensionId}`

const secretStates = (
  options: ExtensionConfigServiceOptions,
  extensionId: string,
  fields: readonly ExtensionConfigField[]
): Effect.Effect<readonly ExtensionConfigSecretState[], ExtensionConfigError, never> =>
  options.secrets.list().pipe(
    Effect.map((keys) => {
      const present = new Set(keys)
      return fields.map(
        (field) =>
          new ExtensionConfigSecretState({
            key: field.key,
            present: present.has(secretStorageKey(extensionId, field.key))
          })
      )
    })
  )

interface SecretSnapshotEntry {
  readonly key: string
  readonly value: Option.Option<SecretBytes>
}

const snapshotSecrets = (
  options: ExtensionConfigServiceOptions,
  extensionId: string,
  keys: readonly string[]
): Effect.Effect<readonly SecretSnapshotEntry[], ExtensionConfigError, never> =>
  Effect.gen(function* () {
    if (keys.length === 0) {
      return []
    }
    const present = new Set(yield* options.secrets.list())
    const entries: SecretSnapshotEntry[] = []
    for (const key of keys) {
      const storageKey = secretStorageKey(extensionId, key)
      if (present.has(storageKey)) {
        entries.push({ key, value: Option.some(yield* options.secrets.get(storageKey)) })
      } else {
        entries.push({ key, value: Option.none() })
      }
    }
    return entries
  })

const writeSecrets = (
  options: ExtensionConfigServiceOptions,
  extensionId: string,
  secrets: readonly ExtensionConfigSecretWrite[],
  snapshot: readonly SecretSnapshotEntry[]
): Effect.Effect<void, ExtensionConfigError, never> =>
  Effect.forEach(
    secrets,
    (entry) => options.secrets.set(secretStorageKey(extensionId, entry.key), entry.value),
    { discard: true }
  ).pipe(
    Effect.catch((error: ExtensionConfigError) =>
      restoreSecrets(options, extensionId, snapshot, "ExtensionConfig.write").pipe(
        Effect.andThen(Effect.fail(error))
      )
    )
  )

const deleteSecrets = (
  options: ExtensionConfigServiceOptions,
  extensionId: string,
  keys: readonly string[],
  snapshot: readonly SecretSnapshotEntry[]
): Effect.Effect<void, ExtensionConfigError, never> =>
  Effect.forEach(keys, (key) => options.secrets.delete(secretStorageKey(extensionId, key)), {
    discard: true
  }).pipe(
    Effect.catch((error: ExtensionConfigError) =>
      restoreSecrets(options, extensionId, snapshot, "ExtensionConfig.reset").pipe(
        Effect.andThen(Effect.fail(error))
      )
    )
  )

const restoreSecrets = (
  options: ExtensionConfigServiceOptions,
  extensionId: string,
  snapshot: readonly SecretSnapshotEntry[],
  operation: string
): Effect.Effect<void, ExtensionConfigError, never> =>
  Effect.forEach(
    snapshot,
    (entry) => {
      const storageKey = secretStorageKey(extensionId, entry.key)
      return Option.isSome(entry.value)
        ? options.secrets.set(storageKey, entry.value.value)
        : options.secrets.delete(storageKey)
    },
    { discard: true }
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `extension config secret rollback failed: ${error.tag}`,
        operation
      )
    )
  )

const ensureSecretsAvailable = (
  options: ExtensionConfigServiceOptions,
  operation: string
): Effect.Effect<void, ExtensionConfigError, never> =>
  options.secrets
    .isAvailable()
    .pipe(
      Effect.flatMap((available) =>
        available ? Effect.void : Effect.fail(unsupportedError(operation))
      )
    )

const checkConfigPermission = (
  options: ExtensionConfigServiceOptions,
  method: "read" | "write" | "reset" | "redact",
  actor: ExtensionConfigActor,
  extensionId: string,
  traceId: string | undefined
): Effect.Effect<void, ExtensionConfigError, never> =>
  checkPermission(
    options,
    P.nativeInvoke({ primitive: Surface, methods: [method] }),
    actor,
    extensionId,
    `ExtensionConfig.${method}`,
    traceId
  )

const checkSecretPermission = (
  options: ExtensionConfigServiceOptions,
  access: "read" | "write",
  actor: ExtensionConfigActor,
  extensionId: string,
  traceId: string | undefined
): Effect.Effect<void, ExtensionConfigError, never> =>
  checkPermission(
    options,
    access === "read"
      ? P.safeStorageRead({ namespaces: [secretNamespace(extensionId)] })
      : P.safeStorageWrite({ namespaces: [secretNamespace(extensionId)] }),
    actor,
    extensionId,
    `ExtensionConfig.secret.${access}`,
    traceId
  )

const checkPermission = (
  options: ExtensionConfigServiceOptions,
  capability: NormalizedCapability,
  actor: ExtensionConfigActor,
  extensionId: string,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, ExtensionConfigError, never> =>
  options.permissions
    .check(
      capability,
      new PermissionContext({
        actor: permissionActor(actor),
        resource: extensionId,
        traceId: traceId ?? options.nextTraceId?.() ?? operation
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) => {
        if (!(error instanceof PermissionDeniedError)) {
          return Effect.fail(
            makeHostProtocolInternalError(
              `extension config permission registry failure: ${error._tag}`,
              operation
            )
          )
        }
        return emitConfigAudit(
          options,
          "permission-denied",
          operationMethod(operation),
          actor,
          extensionId,
          error.traceId,
          { reason: error.reason }
        ).pipe(Effect.andThen(Effect.fail(permissionDeniedError(capability, error, operation))))
      })
    )

const publish = (
  pubsub: PubSub.PubSub<ExtensionConfigEvent>,
  extensionId: string,
  phase: ExtensionConfigEventPhase,
  keys: readonly string[],
  revision: number
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis
    yield* PubSub.publish(
      pubsub,
      new ExtensionConfigEvent({
        type: "extension-config-event",
        timestamp,
        extensionId,
        phase,
        keys: [...keys],
        revision
      })
    )
  }).pipe(Effect.asVoid)

const emitConfigAudit = (
  options: ExtensionConfigServiceOptions,
  kind: "permission-denied" | "permission-used",
  method: "read" | "write" | "reset" | "redact",
  actor: ExtensionConfigActor,
  extensionId: string,
  traceId: string | undefined,
  details: unknown
): Effect.Effect<void, ExtensionConfigError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  const operation = `ExtensionConfig.${method}`
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind,
      source: operation,
      traceId: traceId ?? options.nextTraceId?.() ?? operation,
      outcome: kind === "permission-denied" ? "denied" : "used",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: permissionActor(actor),
      resource: extensionId,
      details
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write extension config audit event: ${error.message}`,
        operation
      )
    )
  )
}

const operationMethod = (operation: string): "read" | "write" | "reset" | "redact" => {
  if (operation.includes(".write") || operation.includes(".secret.write")) return "write"
  if (operation.includes(".reset")) return "reset"
  if (operation.includes(".redact")) return "redact"
  return "read"
}

const permissionActor = (actor: ExtensionConfigActor): PermissionActor =>
  new PermissionActor({
    kind:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.kind
        : "resource",
    id:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.id
        : `${actor.kind}:${actor.id}`
  })

const permissionDeniedError = (
  capability: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: capability.kind,
    message: `extension config denied ${capability.kind}: ${error.reason}`,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ExtensionConfig method: ${operation}`,
    operation,
    recoverable: false
  })
