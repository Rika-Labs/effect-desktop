import {
  HostProtocolNotFoundError,
  hostProtocolErrorRecoverableDefault
} from "@effect-desktop/bridge"
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Stream } from "effect"
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

test("Secrets set/get/delete scopes safe storage keys by app and namespace", async () => {
  const calls: string[] = []
  const secrets = await makeSecretsService(calls)

  await Effect.runPromise(secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token")))
  const secret = await Effect.runPromise(secrets.get("auth", "token"))
  await Effect.runPromise(secrets.delete("auth", "token"))
  const missing = await Effect.runPromiseExit(secrets.get("auth", "token"))

  expect(new TextDecoder().decode(unsafeSecretBytes(secret))).toBe("refresh-token")
  expect(calls).toEqual([
    "set:com.rika.test/auth/token",
    "get:com.rika.test/auth/token",
    "delete:com.rika.test/auth/token",
    "get:com.rika.test/auth/token"
  ])
  expectFailure(missing, SecretNotFoundError)
})

test("Secrets list returns only keys in the requested namespace", async () => {
  const secrets = await makeSecretsService()

  await Effect.runPromise(secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token")))
  await Effect.runPromise(secrets.set("sync", "token", makeSecretBytesFromUtf8("sync-token")))

  expect(await Effect.runPromise(secrets.list("auth"))).toEqual(["token"])
})

test("Secrets list returns namespace keys in sorted order", async () => {
  const secrets = await makeSecretsService()

  await Effect.runPromise(secrets.set("auth", "zeta", makeSecretBytesFromUtf8("z")))
  await Effect.runPromise(secrets.set("auth", "alpha", makeSecretBytesFromUtf8("a")))

  expect(await Effect.runPromise(secrets.list("auth"))).toEqual(["alpha", "zeta"])
})

test("Secrets validates namespace and key before safe storage calls", async () => {
  const calls: string[] = []
  const secrets = await makeSecretsService(calls)

  const exit = await Effect.runPromiseExit(
    secrets.set("auth/private", "token", makeSecretBytesFromUtf8("refresh-token"))
  )

  expectFailure(exit, SecretsInvalidArgumentError)
  expect(calls).toEqual([])
})

test("Secrets denies missing read and write permissions before safe storage calls", async () => {
  const calls: string[] = []
  const storage = memorySafeStorage(calls)
  const secrets = await Effect.runPromise(
    makeSecrets(storage, { appId: "com.rika.test", permissions: { read: ["auth"] } })
  )

  const write = await Effect.runPromiseExit(
    secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
  )
  const read = await Effect.runPromiseExit(secrets.get("sync", "token"))

  expectFailure(write, SecretsPermissionDeniedError)
  expectFailure(read, SecretsPermissionDeniedError)
  expect(calls).toEqual([])
})

test("Secrets maps unavailable safe storage before commands", async () => {
  const storage = memorySafeStorage([], { available: false })
  const secrets = await Effect.runPromise(
    makeSecrets(storage, {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] }
    })
  )

  const exit = await Effect.runPromiseExit(
    secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
  )

  expectFailure(exit, SecretsSafeStorageUnavailableError)
})

test("Secrets writes audit rows without secret values", async () => {
  const rows: AuditEvent[] = []
  const secrets = await makeSecretsService([], rows)

  await Effect.runPromise(secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token")))
  await Effect.runPromise(secrets.get("auth", "token"))

  expect(JSON.stringify(rows)).not.toContain("refresh-token")
  expect(rows.map((r) => r.kind)).toEqual(["secrets-accessed", "secrets-accessed"])
  expect(rows[0]?.outcome).toBe("ok")
  expect(rows[0]?.traceId).toBe("trace-1")
})

test("Secrets rejects empty generated audit trace ids before side effects", async () => {
  const calls: string[] = []
  const rows: AuditEvent[] = []
  const secrets = await Effect.runPromise(
    makeSecrets(memorySafeStorage(calls), {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] },
      audit: memoryAudit(rows),
      traceId: () => ""
    })
  )

  const exit = await Effect.runPromiseExit(
    secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
  )

  expectFailure(exit, SecretsInvalidArgumentError)
  expect(calls).toEqual([])
  expect(rows).toEqual([])
})

test("SecretBytes rejects non-byte input", () => {
  // @ts-expect-error intentionally invalid secret material exercises runtime guard.
  expect(() => makeSecretBytes("refresh-token")).toThrow(TypeError)
  const bytes = new Uint8Array([1, 2, 3])
  const secret = makeSecretBytes(bytes)
  bytes.fill(0)
  expect(Array.from(unsafeSecretBytes(secret))).toEqual([1, 2, 3])
})

test("Secrets reports committed audit failures for successful writes", async () => {
  const secrets = await Effect.runPromise(
    makeSecrets(memorySafeStorage(), {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] },
      audit: failingAudit()
    })
  )

  const exit = await Effect.runPromiseExit(
    secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
  )

  expectFailure(exit, SecretsCommittedAuditFailedError)
})

test("Secrets reports committed set when post-write audit fails", async () => {
  const storage = memorySafeStorage()
  const secrets = await Effect.runPromise(
    makeSecrets(storage, {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] },
      audit: failingAudit()
    })
  )
  const verifier = await Effect.runPromise(
    makeSecrets(storage, {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] }
    })
  )

  const exit = await Effect.runPromiseExit(
    secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
  )
  const stored = await Effect.runPromise(verifier.get("auth", "token"))

  expectFailure(exit, SecretsCommittedAuditFailedError)
  expect(new TextDecoder().decode(unsafeSecretBytes(stored))).toBe("refresh-token")
})

test("Secrets reports committed delete when post-delete audit fails", async () => {
  const storage = memorySafeStorage()
  const seed = await Effect.runPromise(
    makeSecrets(storage, {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] }
    })
  )
  const secrets = await Effect.runPromise(
    makeSecrets(storage, {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] },
      audit: failingAudit()
    })
  )
  await Effect.runPromise(seed.set("auth", "token", makeSecretBytesFromUtf8("refresh-token")))

  const exit = await Effect.runPromiseExit(secrets.delete("auth", "token"))
  const afterDelete = await Effect.runPromiseExit(seed.get("auth", "token"))

  expectFailure(exit, SecretsCommittedAuditFailedError)
  expectFailure(afterDelete, SecretNotFoundError)
})

test("Secrets preserves denied errors when deny-audit write fails", async () => {
  const secrets = await Effect.runPromise(
    makeSecrets(memorySafeStorage(), {
      appId: "com.rika.test",
      permissions: { read: ["auth"] },
      audit: failingAudit()
    })
  )

  const exit = await Effect.runPromiseExit(
    secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
  )

  expectFailure(exit, SecretsPermissionDeniedError)
})

test("Secrets preserves storage errors when error-audit write fails", async () => {
  const secrets = await Effect.runPromise(
    makeSecrets(
      failingStorage({
        get: () => Effect.fail(notFound("auth/token"))
      }),
      {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] },
        audit: failingAudit()
      }
    )
  )

  const exit = await Effect.runPromiseExit(secrets.get("auth", "token"))

  expectFailure(exit, SecretNotFoundError)
})

const makeSecretsService = async (
  calls: string[] = [],
  auditRows?: AuditEvent[]
): Promise<SecretsApi> =>
  Effect.runPromise(
    makeSecrets(memorySafeStorage(calls), {
      appId: "com.rika.test",
      permissions: { read: ["auth", "sync"], write: ["auth", "sync"] },
      ...(auditRows === undefined ? {} : { audit: memoryAudit(auditRows) }),
      traceId: () => "trace-1"
    })
  )

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
