import {
  HostProtocolNotFoundError,
  HostProtocolUnsupportedError,
  hostProtocolErrorRecoverableDefault
} from "@effect-desktop/bridge"
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Option, Schema, Stream } from "effect"

import { type EventLogStore } from "./event-log.js"
import { SecretValue, type SecretsApi, type SecretsSafeStorageApi, makeSecrets } from "./secrets.js"
import { SecretsMigrationFailedError, runSecretsMigration } from "./secrets-migration.js"
import { makeSettings, type SettingsStore } from "./settings.js"
import { KeyValueStore } from "effect/unstable/persistence"

test("SecretsMigration moves secret-shaped Settings keys into Secrets and audits without values", async () => {
  const { settings, secrets, auditRows } = await makeFixture()

  await Effect.runPromise(settings.set("refresh_token", Schema.String, "refresh-value"))
  await Effect.runPromise(settings.set("theme", Schema.String, "dark"))
  const report = await Effect.runPromise(
    runSecretsMigration({ settings, secrets, audit: memoryAudit(auditRows) })
  )
  const migrated = await Effect.runPromise(secrets.get("legacy", "refresh_token"))
  const legacy = await Effect.runPromise(settings.get("refresh_token", Schema.String))
  const theme = await Effect.runPromise(settings.get("theme", Schema.String))

  expect(report).toEqual({ completed: true, migrated: ["refresh_token"], skipped: false })
  expect(secretText(migrated)).toBe("refresh-value")
  expect(Option.isNone(legacy)).toBe(true)
  expect(Option.getOrUndefined(theme)).toBe("dark")
  expect(JSON.stringify(auditRows)).not.toContain("refresh-value")
  expect(auditRows).toEqual([
    {
      type: "secret-migrated",
      payload: { sourceKey: "refresh_token", namespace: "legacy", outcome: "ok" },
      source: "SecretsMigration"
    }
  ])
})

test("SecretsMigration is a no-op after the complete flag is written", async () => {
  const { settings, secrets, auditRows } = await makeFixture()

  await Effect.runPromise(settings.set("api_key", Schema.String, "key-value"))
  await Effect.runPromise(runSecretsMigration({ settings, secrets, audit: memoryAudit(auditRows) }))
  const second = await Effect.runPromise(
    runSecretsMigration({ settings, secrets, audit: memoryAudit(auditRows) })
  )

  expect(second).toEqual({ completed: true, migrated: [], skipped: true })
  expect(auditRows).toHaveLength(1)
})

test("SecretsMigration leaves the flag unset after a write failure and retries remaining keys", async () => {
  const failOnce = { key: "com.rika.test/legacy/client_secret", used: false }
  const { settings, secrets, auditRows } = await makeFixture({ failOnce })

  await Effect.runPromise(settings.set("api_key", Schema.String, "first"))
  await Effect.runPromise(settings.set("client_secret", Schema.String, "second"))
  const failed = await Effect.runPromiseExit(
    runSecretsMigration({ settings, secrets, audit: memoryAudit(auditRows) })
  )
  const flagAfterFailure = await Effect.runPromise(
    settings.get("migration.secrets.v1.complete", Schema.Boolean)
  )
  const firstLegacy = await Effect.runPromise(settings.get("api_key", Schema.String))
  const secondLegacy = await Effect.runPromise(settings.get("client_secret", Schema.String))

  expectFailure(failed, SecretsMigrationFailedError)
  expect(Option.isNone(flagAfterFailure)).toBe(true)
  expect(Option.isNone(firstLegacy)).toBe(true)
  expect(Option.getOrUndefined(secondLegacy)).toBe("second")

  const retried = await Effect.runPromise(
    runSecretsMigration({ settings, secrets, audit: memoryAudit(auditRows) })
  )
  const flagAfterRetry = await Effect.runPromise(
    settings.get("migration.secrets.v1.complete", Schema.Boolean)
  )
  const migrated = await Effect.runPromise(secrets.get("legacy", "client_secret"))

  expect(retried).toEqual({ completed: true, migrated: ["client_secret"], skipped: false })
  expect(Option.getOrUndefined(flagAfterRetry)).toBe(true)
  expect(secretText(migrated)).toBe("second")
  expect(JSON.stringify(auditRows)).not.toContain("first")
  expect(JSON.stringify(auditRows)).not.toContain("second")
})

async function makeFixture(
  options: {
    readonly failOnce?: { readonly key: string; used: boolean }
  } = {}
): Promise<{
  readonly settings: SettingsStore
  readonly secrets: SecretsApi
  readonly auditRows: unknown[]
}> {
  const kv = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* KeyValueStore.KeyValueStore
    }).pipe(Effect.provide(KeyValueStore.layerMemory))
  )
  const settingsApi = await Effect.runPromise(makeSettings(kv))
  const settings = await Effect.runPromise(
    settingsApi.open({ path: ":memory:", ownerScope: "scope-main", schemaVersion: 1 })
  )
  const secrets = await Effect.runPromise(
    makeSecrets(memorySafeStorage(options.failOnce), {
      appId: "com.rika.test",
      permissions: { read: ["legacy"], write: ["legacy"] }
    })
  )
  return { settings, secrets, auditRows: [] }
}

const memorySafeStorage = (failOnce?: {
  readonly key: string
  used: boolean
}): SecretsSafeStorageApi => {
  const values = new Map<string, Uint8Array>()
  return {
    isAvailable: () => Effect.succeed(true),
    set: (key, value) =>
      Effect.gen(function* () {
        if (failOnce !== undefined && failOnce.key === key && !failOnce.used) {
          failOnce.used = true
          return yield* Effect.fail(unsupported(key))
        }
        values.set(key, value.unsafeBytes())
      }),
    get: (key) =>
      Effect.gen(function* () {
        const value = values.get(key)
        if (value === undefined) {
          return yield* Effect.fail(notFound(key))
        }
        return SecretValue.fromBytes(value)
      }),
    delete: (key) =>
      Effect.sync(() => {
        values.delete(key)
      }),
    list: () => Effect.succeed([...values.keys()])
  }
}

const memoryAudit = (rows: unknown[]): EventLogStore => ({
  append: (event, options) =>
    Effect.sync(() => {
      rows.push({
        type: event.type,
        ...(event.payload === undefined ? {} : { payload: event.payload }),
        ...(options?.source === undefined ? {} : { source: options.source })
      })
      return rows.length - 1
    }),
  query: () => Effect.succeed([]),
  subscribe: () => Stream.die("unused"),
  close: () => Effect.void
})

const secretText = (secret: SecretValue): string => new TextDecoder().decode(secret.unsafeBytes())

const unsupported = (key: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "test write failure",
    message: `secret write failed: ${key}`,
    operation: "SafeStorage.set",
    recoverable: hostProtocolErrorRecoverableDefault("Unsupported")
  })

const notFound = (key: string): HostProtocolNotFoundError =>
  new HostProtocolNotFoundError({
    tag: "NotFound",
    resource: key,
    message: `secret not found: ${key}`,
    operation: "SafeStorage.get",
    recoverable: hostProtocolErrorRecoverableDefault("NotFound")
  })

const expectFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  expected: abstract new (...args: never[]) => E
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(expected)
  }
}
