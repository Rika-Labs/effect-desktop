import { RedactionFilter } from "@effect-desktop/bridge"
import { Data, Effect, Option, Schema } from "effect"

import { emitAuditEvent, secretsAuditEvent, type AuditEventsApi } from "./audit-events.js"
import { EventJournal } from "effect/unstable/eventlog"
import { type SecretsApi, type SecretsError, SecretValue } from "./secrets.js"
import type { SettingsError, SettingsStore } from "./settings.js"

const MigrationCompleteFlag = "migration.secrets.v1.complete"
const LegacyNamespace = "legacy"
const MigrationSource = "SecretsMigration"

export type SecretsMigrationPhase =
  | "read-flag"
  | "list"
  | "read"
  | "write"
  | "verify"
  | "delete"
  | "audit"
  | "write-flag"

export class SecretsMigrationFailedError extends Data.TaggedError("SecretsMigrationFailed")<{
  readonly key: Option.Option<string>
  readonly phase: SecretsMigrationPhase
  readonly cause:
    | SettingsError
    | SecretsError
    | EventJournal.EventJournalError
    | SecretVerificationMismatchError
}> {}

export class SecretVerificationMismatchError extends Data.TaggedError(
  "SecretVerificationMismatch"
)<{
  readonly namespace: string
  readonly key: string
}> {}

export type SecretsMigrationError = SecretsMigrationFailedError

export class SecretsMigrationReport extends Schema.Class<SecretsMigrationReport>(
  "SecretsMigrationReport"
)({
  completed: Schema.Boolean,
  migrated: Schema.Array(Schema.String),
  skipped: Schema.Boolean
}) {}

export interface SecretsMigrationOptions {
  readonly settings: SettingsStore
  readonly secrets: SecretsApi
  readonly audit?: AuditEventsApi
  readonly namespace?: string
  readonly completeFlagKey?: string
  readonly legacyKeys?: readonly string[]
  readonly keyPattern?: RegExp
}

export const runSecretsMigration = (
  options: SecretsMigrationOptions
): Effect.Effect<SecretsMigrationReport, SecretsMigrationError, never> =>
  Effect.gen(function* () {
    const namespace = options.namespace ?? LegacyNamespace
    const completeFlagKey = options.completeFlagKey ?? MigrationCompleteFlag
    const pattern = options.keyPattern ?? RedactionFilter.defaultPattern
    const complete = yield* options.settings
      .get(completeFlagKey, Schema.Boolean)
      .pipe(
        Effect.mapError((cause) =>
          migrationFailed({ key: Option.some(completeFlagKey), phase: "read-flag", cause })
        )
      )

    if (Option.getOrElse(complete, () => false)) {
      return new SecretsMigrationReport({ completed: true, migrated: [], skipped: true })
    }

    const keys =
      options.legacyKeys === undefined
        ? yield* options.settings
            .keys()
            .pipe(
              Effect.mapError((cause) =>
                migrationFailed({ key: Option.none(), phase: "list", cause })
              )
            )
        : options.legacyKeys
    const candidates = keys.filter((key) => key !== completeFlagKey && matches(pattern, key))
    const migrated = yield* Effect.forEach(candidates, (key) => migrateKey(options, namespace, key))

    yield* options.settings
      .set(completeFlagKey, Schema.Boolean, true, { source: MigrationSource })
      .pipe(
        Effect.mapError((cause) =>
          migrationFailed({ key: Option.some(completeFlagKey), phase: "write-flag", cause })
        )
      )

    return new SecretsMigrationReport({ completed: true, migrated, skipped: false })
  }).pipe(Effect.withSpan("SecretsMigration.run"))

const migrateKey = (
  options: SecretsMigrationOptions,
  namespace: string,
  key: string
): Effect.Effect<string, SecretsMigrationError, never> =>
  Effect.gen(function* () {
    const current = yield* options.settings
      .get(key, Schema.String)
      .pipe(
        Effect.mapError((cause) => migrationFailed({ key: Option.some(key), phase: "read", cause }))
      )
    if (Option.isNone(current)) {
      return key
    }

    yield* options.secrets
      .set(namespace, key, SecretValue.fromUtf8(current.value))
      .pipe(
        Effect.mapError((cause) =>
          migrationFailed({ key: Option.some(key), phase: "write", cause })
        )
      )
    yield* verifySecret(options.secrets, namespace, key, current.value)
    yield* auditMigrated(options.audit, namespace, key)
    yield* options.settings
      .delete(key, { source: MigrationSource })
      .pipe(
        Effect.mapError((cause) =>
          migrationFailed({ key: Option.some(key), phase: "delete", cause })
        )
      )
    return key
  }).pipe(Effect.withSpan("SecretsMigration.migrateKey", { attributes: { namespace, key } }))

const verifySecret = (
  secrets: SecretsApi,
  namespace: string,
  key: string,
  expected: string
): Effect.Effect<void, SecretsMigrationError, never> =>
  Effect.acquireUseRelease(
    secrets
      .get(namespace, key)
      .pipe(
        Effect.mapError((cause) =>
          migrationFailed({ key: Option.some(key), phase: "verify", cause })
        )
      ),
    (secret) =>
      new TextDecoder().decode(secret.unsafeBytes()) === expected
        ? Effect.void
        : Effect.fail(
            migrationFailed({
              key: Option.some(key),
              phase: "verify",
              cause: new SecretVerificationMismatchError({ namespace, key })
            })
          ),
    (secret) => secret.dispose()
  )

const auditMigrated = (
  audit: AuditEventsApi | undefined,
  namespace: string,
  key: string
): Effect.Effect<void, SecretsMigrationError, never> =>
  emitAuditEvent(
    audit,
    secretsAuditEvent({
      source: MigrationSource,
      traceId: key,
      outcome: "ok",
      namespace,
      key
    })
  ).pipe(
    Effect.mapError((cause) => migrationFailed({ key: Option.some(key), phase: "audit", cause }))
  )

const migrationFailed = (input: {
  readonly key: Option.Option<string>
  readonly phase: SecretsMigrationPhase
  readonly cause:
    | SettingsError
    | SecretsError
    | EventJournal.EventJournalError
    | SecretVerificationMismatchError
}): SecretsMigrationFailedError =>
  new SecretsMigrationFailedError({
    key: input.key,
    phase: input.phase,
    cause: input.cause
  })

const matches = (pattern: RegExp, key: string): boolean => {
  pattern.lastIndex = 0
  return pattern.test(key)
}
