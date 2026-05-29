import { HostProtocolNotFoundError, hostProtocolErrorRecoverableDefault } from "@orika/bridge"
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Logger, Schema, Stream } from "effect"
import { EventJournal } from "effect/unstable/eventlog"

import { AuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  SecretNotFoundError,
  SecretsCommittedAuditFailedError,
  SecretsInvalidArgumentError,
  SecretsPermissionDeniedError,
  type SecretsSafeStorageApi,
  SecretsSafeStorageUnavailableError,
  makeSecretBytes,
  makeSecretBytesFromUtf8,
  makeSecrets,
  type SecretBytes,
  type SecretsApi,
  unsafeSecretBytes
} from "./secrets.js"

test("Secrets set/get/delete scopes safe storage keys by app and namespace", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const secrets = yield* makeSecretsService(calls)

      yield* secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      const secret = yield* secrets.get("auth", "token")
      yield* secrets.delete("auth", "token")
      const missing = yield* Effect.exit(secrets.get("auth", "token"))

      expect(new TextDecoder().decode(unsafeSecretBytes(secret))).toBe("refresh-token")
      expect(calls).toEqual([
        "set:com.rika.test/auth/token",
        "get:com.rika.test/auth/token",
        "delete:com.rika.test/auth/token",
        "get:com.rika.test/auth/token"
      ])
      expectFailure(missing, SecretNotFoundError)
    })
  ))

test("Secrets list returns only keys in the requested namespace", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secrets = yield* makeSecretsService()

      yield* secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      yield* secrets.set("sync", "token", makeSecretBytesFromUtf8("sync-token"))

      expect(yield* secrets.list("auth")).toEqual(["token"])
    })
  ))

test("Secrets list returns namespace keys in sorted order", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secrets = yield* makeSecretsService()

      yield* secrets.set("auth", "zeta", makeSecretBytesFromUtf8("z"))
      yield* secrets.set("auth", "alpha", makeSecretBytesFromUtf8("a"))

      expect(yield* secrets.list("auth")).toEqual(["alpha", "zeta"])
    })
  ))

test("Secrets validates namespace and key before safe storage calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const secrets = yield* makeSecretsService(calls)

      const exit = yield* Effect.exit(
        secrets.set("auth/private", "token", makeSecretBytesFromUtf8("refresh-token"))
      )

      expectFailure(exit, SecretsInvalidArgumentError)
      expect(calls).toEqual([])
    })
  ))

test("Secrets denies missing read and write permissions before safe storage calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const storage = memorySafeStorage(calls)
      const secrets = yield* makeSecrets(storage, {
        appId: "com.rika.test",
        permissions: { read: ["auth"] }
      })

      const write = yield* Effect.exit(
        secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      )
      const read = yield* Effect.exit(secrets.get("sync", "token"))

      expectFailure(write, SecretsPermissionDeniedError)
      expectFailure(read, SecretsPermissionDeniedError)
      expect(calls).toEqual([])
    })
  ))

test("Secrets maps unavailable safe storage before commands", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = memorySafeStorage([], { available: false })
      const secrets = yield* makeSecrets(storage, {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] }
      })

      const exit = yield* Effect.exit(
        secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      )

      expectFailure(exit, SecretsSafeStorageUnavailableError)
    })
  ))

test("Secrets writes audit rows without secret values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const secrets = yield* makeSecretsService([], rows)

      yield* secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      yield* secrets.get("auth", "token")

      const rowsJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(rows)
      expect(rowsJson).not.toContain("refresh-token")
      expect(rows.map((r) => r.kind)).toEqual(["secrets-accessed", "secrets-accessed"])
      expect(rows[0]?.outcome).toBe("ok")
      expect(rows[0]?.traceId).toBe("trace-1")
    })
  ))

test("Secrets rejects empty generated audit trace ids before side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const rows: AuditEvent[] = []
      const secrets = yield* makeSecrets(memorySafeStorage(calls), {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] },
        audit: memoryAudit(rows),
        traceId: () => ""
      })

      const exit = yield* Effect.exit(
        secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      )

      expectFailure(exit, SecretsInvalidArgumentError)
      expect(calls).toEqual([])
      expect(rows).toEqual([])
    })
  ))

test("SecretBytes rejects non-byte input", () => {
  // @ts-expect-error intentionally invalid secret material exercises runtime guard.
  expect(() => makeSecretBytes("refresh-token")).toThrow(TypeError)
  const bytes = new Uint8Array([1, 2, 3])
  const secret = makeSecretBytes(bytes)
  bytes.fill(0)
  expect(Array.from(unsafeSecretBytes(secret))).toEqual([1, 2, 3])
})

test("Secrets reports committed audit failures for successful writes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secrets = yield* makeSecrets(memorySafeStorage(), {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] },
        audit: failingAudit()
      })

      const exit = yield* Effect.exit(
        secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      )

      expectFailure(exit, SecretsCommittedAuditFailedError)
    })
  ))

test("Secrets reports committed set when post-write audit fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = memorySafeStorage()
      const secrets = yield* makeSecrets(storage, {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] },
        audit: failingAudit()
      })
      const verifier = yield* makeSecrets(storage, {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] }
      })

      const exit = yield* Effect.exit(
        secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      )
      const stored = yield* verifier.get("auth", "token")

      expectFailure(exit, SecretsCommittedAuditFailedError)
      expect(new TextDecoder().decode(unsafeSecretBytes(stored))).toBe("refresh-token")
    })
  ))

test("Secrets reports committed delete when post-delete audit fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = memorySafeStorage()
      const seed = yield* makeSecrets(storage, {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] }
      })
      const secrets = yield* makeSecrets(storage, {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] },
        audit: failingAudit()
      })
      yield* seed.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))

      const exit = yield* Effect.exit(secrets.delete("auth", "token"))
      const afterDelete = yield* Effect.exit(seed.get("auth", "token"))

      expectFailure(exit, SecretsCommittedAuditFailedError)
      expectFailure(afterDelete, SecretNotFoundError)
    })
  ))

test("Secrets preserves denied errors when deny-audit write fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secrets = yield* makeSecrets(memorySafeStorage(), {
        appId: "com.rika.test",
        permissions: { read: ["auth"] },
        audit: failingAudit()
      })

      const exit = yield* Effect.exit(
        secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      )

      expectFailure(exit, SecretsPermissionDeniedError)
    })
  ))

test("Secrets preserves storage errors when error-audit write fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secrets = yield* makeSecrets(
        failingStorage({
          get: () => Effect.fail(notFound("auth/token"))
        }),
        {
          appId: "com.rika.test",
          permissions: { read: ["auth"], write: ["auth"] },
          audit: failingAudit()
        }
      )

      const exit = yield* Effect.exit(secrets.get("auth", "token"))

      expectFailure(exit, SecretNotFoundError)
    })
  ))

test("Secrets surfaces the underlying reason when a deny pre-check audit fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const warnings: ReadonlyArray<unknown>[] = []
      const secrets = yield* makeSecrets(memorySafeStorage(), {
        appId: "com.rika.test",
        permissions: { read: ["auth"] },
        audit: failingAudit()
      })

      const exit = yield* Effect.exit(
        secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      ).pipe(Effect.provideService(Logger.CurrentLoggers, new Set([captureLogger(warnings)])))

      expectFailure(exit, SecretsPermissionDeniedError)
      const reason = warningReason(warnings, "Secrets audit failed")
      expect(reason).toBeDefined()
      expect(reason).toContain("journal full")
    })
  ))

test("Secrets attributes a non-string namespace to the namespace field", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secrets = yield* makeSecretsService()

      const exit = yield* Effect.exit(
        // @ts-expect-error namespace is typed as string; runtime guard must label the field.
        secrets.set(["key"], "token", makeSecretBytesFromUtf8("refresh-token"))
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toBeInstanceOf(SecretsInvalidArgumentError)
        if (failure?.error instanceof SecretsInvalidArgumentError) {
          expect(failure.error.field).toBe("namespace")
        }
      }
    })
  ))

const makeSecretsService = (
  calls: string[] = [],
  auditRows?: AuditEvent[]
): Effect.Effect<SecretsApi, SecretsInvalidArgumentError> =>
  makeSecrets(memorySafeStorage(calls), {
    appId: "com.rika.test",
    permissions: { read: ["auth", "sync"], write: ["auth", "sync"] },
    ...(auditRows === undefined ? {} : { audit: memoryAudit(auditRows) }),
    traceId: () => "trace-1"
  })

const memorySafeStorage = (
  calls: string[] = [],
  options: { readonly available?: boolean } = {}
): SecretsSafeStorageApi => {
  const values = new Map<string, SecretBytes>()
  const available = options.available ?? true
  return {
    isAvailable: () => Effect.succeed(available),
    set: (key, value) =>
      Effect.sync(() => {
        calls.push(`set:${key}`)
        values.set(key, value)
      }),
    get: (key) =>
      Effect.gen(function* () {
        calls.push(`get:${key}`)
        const value = values.get(key)
        if (value === undefined) {
          return yield* Effect.fail(notFound(key))
        }
        return value
      }),
    delete: (key) =>
      Effect.sync(() => {
        calls.push(`delete:${key}`)
        values.delete(key)
      }),
    list: () =>
      Effect.sync(() => {
        calls.push("list")
        return [...values.keys()]
      })
  }
}

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.empty
})

const failingStorage = (
  options: {
    readonly get?: () => Effect.Effect<SecretBytes, HostProtocolNotFoundError, never>
    readonly set?: () => Effect.Effect<void, never, never>
    readonly delete?: () => Effect.Effect<void, never, never>
    readonly list?: () => Effect.Effect<readonly string[], never, never>
    readonly available?: () => Effect.Effect<boolean, never, never>
  } = {}
): SecretsSafeStorageApi => {
  const values = new Map<string, SecretBytes>()
  return {
    isAvailable: options.available ?? (() => Effect.succeed(true)),
    set:
      options.set ??
      (() =>
        Effect.sync(() => {
          values.set("auth/token", makeSecretBytesFromUtf8("refresh-token"))
        })),
    get: options.get ?? (() => Effect.fail(notFound("missing"))),
    delete: options.delete ?? (() => Effect.void),
    list: options.list ?? (() => Effect.succeed(Array.from(values.keys())))
  }
}

const failingAudit = (): AuditEventsApi => ({
  emit: () =>
    Effect.fail(
      new EventJournal.EventJournalError({
        method: "EventJournal.write",
        cause: new Error("journal full")
      })
    ),
  observe: () => Stream.empty
})

const captureLogger = (sink: ReadonlyArray<unknown>[]) =>
  Logger.make<unknown, void>((options) => {
    if (Array.isArray(options.message)) {
      sink.push(options.message)
    }
  })

const warningReason = (warnings: ReadonlyArray<unknown>[], label: string): string | undefined => {
  for (const message of warnings) {
    if (message[0] !== label) {
      continue
    }
    const fields = message[1]
    if (
      typeof fields === "object" &&
      fields !== null &&
      "reason" in fields &&
      typeof (fields as { readonly reason: unknown }).reason === "string"
    ) {
      return (fields as { readonly reason: string }).reason
    }
  }
  return undefined
}

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
