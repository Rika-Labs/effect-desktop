import { randomUUID } from "node:crypto"

import { HostProtocolPermissionDeniedError, type HostProtocolError } from "@effect-desktop/bridge"
import { Context, Data, Effect, Layer, Option, Schema } from "effect"

import { emitAuditEvent, secretsAuditEvent, type AuditEventsApi } from "./audit-events.js"

const NonEmptyString = Schema.NonEmptyString
const SecretName = Schema.NonEmptyString
const SecretNamePattern = /^[A-Za-z0-9._-]+$/
const Redacted = "[REDACTED]"
const NodeInspectCustom = Symbol.for("nodejs.util.inspect.custom")

export class SecretValue {
  readonly _tag = "SecretValue"
  #bytes: Uint8Array

  private constructor(bytes: Uint8Array) {
    this.#bytes = new Uint8Array(bytes)
  }

  static fromBytes(bytes: Uint8Array): SecretValue {
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

export class SecretsNamespaceInput extends Schema.Class<SecretsNamespaceInput>(
  "SecretsNamespaceInput"
)({
  namespace: SecretName
}) {}

export class SecretsKeyInput extends Schema.Class<SecretsKeyInput>("SecretsKeyInput")({
  namespace: SecretName,
  key: SecretName
}) {}

export class SecretsSetInput extends Schema.Class<SecretsSetInput>("SecretsSetInput")({
  namespace: SecretName,
  key: SecretName
}) {}

export class SecretsOptionsInput extends Schema.Class<SecretsOptionsInput>("SecretsOptionsInput")({
  appId: NonEmptyString
}) {}

export class SecretNotFoundError extends Data.TaggedError("SecretNotFound")<{
  readonly operation: string
  readonly namespace: string
  readonly key: string
}> {}

export class SecretsSafeStorageUnavailableError extends Data.TaggedError("SafeStorageUnavailable")<{
  readonly operation: string
  readonly cause: Option.Option<HostProtocolError>
}> {}

export class SecretsPermissionDeniedError extends Data.TaggedError("PermissionDenied")<{
  readonly operation: string
  readonly capability: "secrets.read" | "secrets.write"
  readonly namespace: string
}> {}

export class SecretsInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: "appId" | "namespace" | "key"
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class SecretsAuditFailedError extends Data.TaggedError("SecretsAuditFailed")<{
  readonly operation: string
  readonly namespace: string
  readonly key: Option.Option<string>
  readonly cause: unknown
}> {}

export type SecretsError =
  | SecretNotFoundError
  | SecretsSafeStorageUnavailableError
  | SecretsPermissionDeniedError
  | SecretsInvalidArgumentError
  | SecretsAuditFailedError
  | HostProtocolError

export interface SecretsApi {
  readonly set: (
    namespace: string,
    key: string,
    value: SecretValue
  ) => Effect.Effect<void, SecretsError, never>
  readonly get: (namespace: string, key: string) => Effect.Effect<SecretValue, SecretsError, never>
  readonly delete: (namespace: string, key: string) => Effect.Effect<void, SecretsError, never>
  readonly list: (namespace: string) => Effect.Effect<readonly string[], SecretsError, never>
}

export interface SecretsSafeStorageApi {
  readonly set: (key: string, value: SecretValue) => Effect.Effect<void, HostProtocolError, never>
  readonly get: (key: string) => Effect.Effect<SecretValue, HostProtocolError, never>
  readonly delete: (key: string) => Effect.Effect<void, HostProtocolError, never>
  readonly list: () => Effect.Effect<ReadonlyArray<string>, HostProtocolError, never>
  readonly isAvailable: () => Effect.Effect<boolean, HostProtocolError, never>
}

export class SecretsSafeStorage extends Context.Service<
  SecretsSafeStorage,
  SecretsSafeStorageApi
>()("SecretsSafeStorage") {}

export interface SecretsPermissionPolicy {
  readonly read?: readonly string[]
  readonly write?: readonly string[]
}

export interface SecretsOptions {
  readonly appId: string
  readonly permissions?: SecretsPermissionPolicy
  readonly audit?: AuditEventsApi
  readonly traceId?: () => string
}

const EMPTY_PERMISSIONS: SecretsPermissionPolicy = Object.freeze({})

export const makeSecrets = (
  safeStorage: SecretsSafeStorageApi,
  options: SecretsOptions
): Effect.Effect<SecretsApi, SecretsInvalidArgumentError, never> =>
  Effect.gen(function* () {
    const input = yield* decodeOptions(options, "Secrets.make")
    const permissions = options.permissions ?? EMPTY_PERMISSIONS
    const traceId = options.traceId ?? randomUUID

    return Object.freeze({
      set: (namespace, key, value) =>
        Effect.gen(function* () {
          const decoded = yield* decodeKeyInput({ namespace, key }, "Secrets.set")
          const audit = {
            operation: "Secrets.set",
            namespace: decoded.namespace,
            key: Option.some(decoded.key)
          } as const
          yield* authorize(permissions, "secrets.write", decoded.namespace, "Secrets.set").pipe(
            Effect.tapError(() =>
              auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "denied" })
            )
          )
          yield* ensureAvailable(safeStorage, "Secrets.set").pipe(
            Effect.andThen(
              safeStorage
                .set(deriveStorageKey(input.appId, decoded.namespace, decoded.key), value)
                .pipe(
                  Effect.mapError(
                    mapSafeStorageError("Secrets.set", decoded.namespace, decoded.key)
                  )
                )
            ),
            Effect.tapError(() =>
              auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "error" })
            )
          )
          yield* auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "ok" })
        }).pipe(Effect.withSpan("Secrets.set", { attributes: { namespace, key } })),
      get: (namespace, key) =>
        Effect.gen(function* () {
          const decoded = yield* decodeKeyInput({ namespace, key }, "Secrets.get")
          const audit = {
            operation: "Secrets.get",
            namespace: decoded.namespace,
            key: Option.some(decoded.key)
          } as const
          yield* authorize(permissions, "secrets.read", decoded.namespace, "Secrets.get").pipe(
            Effect.tapError(() =>
              auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "denied" })
            )
          )
          const secret = yield* ensureAvailable(safeStorage, "Secrets.get").pipe(
            Effect.andThen(
              safeStorage
                .get(deriveStorageKey(input.appId, decoded.namespace, decoded.key))
                .pipe(
                  Effect.mapError(
                    mapSafeStorageError("Secrets.get", decoded.namespace, decoded.key)
                  )
                )
            ),
            Effect.tapError(() =>
              auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "error" })
            )
          )
          yield* auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "ok" })
          return secret
        }).pipe(Effect.withSpan("Secrets.get", { attributes: { namespace, key } })),
      delete: (namespace, key) =>
        Effect.gen(function* () {
          const decoded = yield* decodeKeyInput({ namespace, key }, "Secrets.delete")
          const audit = {
            operation: "Secrets.delete",
            namespace: decoded.namespace,
            key: Option.some(decoded.key)
          } as const
          yield* authorize(permissions, "secrets.write", decoded.namespace, "Secrets.delete").pipe(
            Effect.tapError(() =>
              auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "denied" })
            )
          )
          yield* ensureAvailable(safeStorage, "Secrets.delete").pipe(
            Effect.andThen(
              safeStorage
                .delete(deriveStorageKey(input.appId, decoded.namespace, decoded.key))
                .pipe(
                  Effect.mapError(
                    mapSafeStorageError("Secrets.delete", decoded.namespace, decoded.key)
                  )
                )
            ),
            Effect.tapError(() =>
              auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "error" })
            )
          )
          yield* auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "ok" })
        }).pipe(Effect.withSpan("Secrets.delete", { attributes: { namespace, key } })),
      list: (namespace) =>
        Effect.gen(function* () {
          const decoded = yield* decodeNamespaceInput({ namespace }, "Secrets.list")
          const audit = {
            operation: "Secrets.list",
            namespace: decoded.namespace,
            key: Option.none<string>()
          } as const
          yield* authorize(permissions, "secrets.read", decoded.namespace, "Secrets.list").pipe(
            Effect.tapError(() =>
              auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "denied" })
            )
          )
          const keys = yield* ensureAvailable(safeStorage, "Secrets.list").pipe(
            Effect.andThen(
              safeStorage
                .list()
                .pipe(
                  Effect.mapError(mapSafeStorageError("Secrets.list", decoded.namespace, undefined))
                )
            ),
            Effect.tapError(() =>
              auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "error" })
            )
          )
          yield* auditSecretAccess(options.audit, traceId(), { ...audit, outcome: "ok" })
          return keys.flatMap((storageKey) =>
            namespaceKey(input.appId, decoded.namespace, storageKey)
          )
        }).pipe(Effect.withSpan("Secrets.list", { attributes: { namespace } }))
    } satisfies SecretsApi)
  })

export class Secrets extends Context.Service<Secrets, SecretsApi>()("Secrets") {}

export const SecretsLayer = (
  options: SecretsOptions
): Layer.Layer<Secrets, SecretsInvalidArgumentError, SecretsSafeStorage> =>
  Layer.effect(
    Secrets,
    Effect.gen(function* () {
      const safeStorage = yield* SecretsSafeStorage
      return yield* makeSecrets(safeStorage, options)
    })
  )

export const makeSecretsSafeStorageLayer = (
  safeStorage: SecretsSafeStorageApi
): Layer.Layer<SecretsSafeStorage> => Layer.succeed(SecretsSafeStorage)(safeStorage)

const deriveStorageKey = (appId: string, namespace: string, key: string): string =>
  `${appId}/${namespace}/${key}`

const namespaceKey = (appId: string, namespace: string, storageKey: string): readonly string[] => {
  const prefix = `${appId}/${namespace}/`
  if (!storageKey.startsWith(prefix)) {
    return []
  }
  const key = storageKey.slice(prefix.length)
  return key.includes("/") || key.length === 0 ? [] : [key]
}

const ensureAvailable = (
  safeStorage: SecretsSafeStorageApi,
  operation: string
): Effect.Effect<void, SecretsSafeStorageUnavailableError | HostProtocolError, never> =>
  safeStorage.isAvailable().pipe(
    Effect.mapError(
      (cause) =>
        new SecretsSafeStorageUnavailableError({
          operation,
          cause: Option.some(cause)
        })
    ),
    Effect.flatMap((available) =>
      available
        ? Effect.void
        : Effect.fail(
            new SecretsSafeStorageUnavailableError({
              operation,
              cause: Option.none()
            })
          )
    )
  )

const authorize = (
  permissions: SecretsPermissionPolicy,
  capability: "secrets.read" | "secrets.write",
  namespace: string,
  operation: string
): Effect.Effect<void, SecretsPermissionDeniedError, never> => {
  const allowed = capability === "secrets.read" ? permissions.read : permissions.write
  if (allowed?.includes(namespace) === true || allowed?.includes("*") === true) {
    return Effect.void
  }
  return Effect.fail(new SecretsPermissionDeniedError({ operation, capability, namespace }))
}

const auditSecretAccess = (
  audit: AuditEventsApi | undefined,
  traceId: string,
  input: {
    readonly operation: string
    readonly namespace: string
    readonly key: Option.Option<string>
    readonly outcome: "ok" | "denied" | "error"
  }
): Effect.Effect<void, SecretsAuditFailedError, never> =>
  emitAuditEvent(
    audit,
    secretsAuditEvent({
      source: "Secrets",
      traceId,
      outcome: input.outcome,
      namespace: input.namespace,
      ...(Option.isSome(input.key) ? { key: input.key.value } : {})
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new SecretsAuditFailedError({
          operation: input.operation,
          namespace: input.namespace,
          key: input.key,
          cause
        })
    )
  )

const mapSafeStorageError =
  (operation: string, namespace: string, key: string | undefined) =>
  (cause: HostProtocolError): SecretsError => {
    if (isNotFound(cause) && key !== undefined) {
      return new SecretNotFoundError({ operation, namespace, key })
    }
    if (cause._tag === "Unsupported") {
      return new SecretsSafeStorageUnavailableError({ operation, cause: Option.some(cause) })
    }
    if (cause instanceof HostProtocolPermissionDeniedError) {
      return new SecretsPermissionDeniedError({
        operation,
        capability:
          operation === "Secrets.get" || operation === "Secrets.list"
            ? "secrets.read"
            : "secrets.write",
        namespace
      })
    }
    return cause
  }

const isNotFound = (error: HostProtocolError): boolean =>
  error._tag === "NotFound" || error._tag === "FileNotFound"

const decodeOptions = (
  input: unknown,
  operation: string
): Effect.Effect<SecretsOptionsInput, SecretsInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(SecretsOptionsInput)(input).pipe(
    Effect.mapError(
      (cause) =>
        new SecretsInvalidArgumentError({
          operation,
          field: "appId",
          message: formatUnknownError(cause),
          cause: Option.some(cause)
        })
    ),
    Effect.flatMap((decoded) =>
      validateName(decoded.appId, "appId", operation).pipe(Effect.as(decoded))
    )
  )

const decodeNamespaceInput = (
  input: unknown,
  operation: string
): Effect.Effect<SecretsNamespaceInput, SecretsInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(SecretsNamespaceInput)(input).pipe(
    Effect.mapError(
      (cause) =>
        new SecretsInvalidArgumentError({
          operation,
          field: "namespace",
          message: formatUnknownError(cause),
          cause: Option.some(cause)
        })
    ),
    Effect.flatMap((decoded) =>
      validateName(decoded.namespace, "namespace", operation).pipe(Effect.as(decoded))
    )
  )

const decodeKeyInput = (
  input: unknown,
  operation: string
): Effect.Effect<SecretsKeyInput, SecretsInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(SecretsKeyInput)(input).pipe(
    Effect.mapError((cause) => {
      const message = formatUnknownError(cause)
      return new SecretsInvalidArgumentError({
        operation,
        field: message.includes("key") ? "key" : "namespace",
        message,
        cause: Option.some(cause)
      })
    }),
    Effect.flatMap((decoded) =>
      Effect.all([
        validateName(decoded.namespace, "namespace", operation),
        validateName(decoded.key, "key", operation)
      ]).pipe(Effect.as(decoded))
    )
  )

const validateName = (
  value: string,
  field: "appId" | "namespace" | "key",
  operation: string
): Effect.Effect<string, SecretsInvalidArgumentError, never> =>
  SecretNamePattern.test(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new SecretsInvalidArgumentError({
          operation,
          field,
          message: `${field} must contain only letters, numbers, dots, underscores, or dashes`,
          cause: Option.none()
        })
      )

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
