import {
  HostProtocolNotFoundError,
  hostProtocolErrorRecoverableDefault
} from "@effect-desktop/bridge"
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import { EventLogFullError, type EventLogStore } from "./event-log.js"
import {
  SecretNotFoundError,
  SecretValue,
  SecretsAuditFailedError,
  SecretsInvalidArgumentError,
  SecretsPermissionDeniedError,
  type SecretsSafeStorageApi,
  SecretsSafeStorageUnavailableError,
  makeSecrets,
  type SecretsApi
} from "./secrets.js"

test("Secrets set/get/delete scopes safe storage keys by app and namespace", async () => {
  const calls: string[] = []
  const secrets = await makeSecretsService(calls)

  await Effect.runPromise(secrets.set("auth", "token", SecretValue.fromUtf8("refresh-token")))
  const secret = await Effect.runPromise(secrets.get("auth", "token"))
  await Effect.runPromise(secrets.delete("auth", "token"))
  const missing = await Effect.runPromiseExit(secrets.get("auth", "token"))

  expect(new TextDecoder().decode(secret.unsafeBytes())).toBe("refresh-token")
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

  await Effect.runPromise(secrets.set("auth", "token", SecretValue.fromUtf8("refresh-token")))
  await Effect.runPromise(secrets.set("sync", "token", SecretValue.fromUtf8("sync-token")))

  expect(await Effect.runPromise(secrets.list("auth"))).toEqual(["token"])
})

test("Secrets validates namespace and key before safe storage calls", async () => {
  const calls: string[] = []
  const secrets = await makeSecretsService(calls)

  const exit = await Effect.runPromiseExit(
    secrets.set("auth/private", "token", SecretValue.fromUtf8("refresh-token"))
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
    secrets.set("auth", "token", SecretValue.fromUtf8("refresh-token"))
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
    secrets.set("auth", "token", SecretValue.fromUtf8("refresh-token"))
  )

  expectFailure(exit, SecretsSafeStorageUnavailableError)
})

test("Secrets writes audit rows without secret values", async () => {
  const rows: unknown[] = []
  const secrets = await makeSecretsService([], rows)

  await Effect.runPromise(secrets.set("auth", "token", SecretValue.fromUtf8("refresh-token")))
  await Effect.runPromise(secrets.get("auth", "token"))

  expect(JSON.stringify(rows)).not.toContain("refresh-token")
  expect(rows).toEqual([
    {
      type: "secret accessed",
      payload: {
        operation: "Secrets.set",
        namespace: "auth",
        key: "token",
        outcome: "ok",
        traceId: "trace-1"
      }
    },
    {
      type: "secret accessed",
      payload: {
        operation: "Secrets.get",
        namespace: "auth",
        key: "token",
        outcome: "ok",
        traceId: "trace-1"
      }
    }
  ])
})

test("Secrets returns typed audit failures", async () => {
  const secrets = await Effect.runPromise(
    makeSecrets(memorySafeStorage(), {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] },
      audit: {
        append: () => Effect.fail(newTestAuditFailure()),
        query: () => Effect.succeed([]),
        subscribe: () => Stream.die("unused"),
        close: () => Effect.void
      }
    })
  )

  const exit = await Effect.runPromiseExit(
    secrets.set("auth", "token", SecretValue.fromUtf8("refresh-token"))
  )

  expectFailure(exit, SecretsAuditFailedError)
})

const makeSecretsService = async (
  calls: string[] = [],
  auditRows?: unknown[]
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
  const values = new Map<string, SecretValue>()
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

const memoryAudit = (rows: unknown[]): EventLogStore => ({
  append: (event: { readonly type: string; readonly payload?: unknown }) =>
    Effect.sync(() => {
      rows.push({
        type: event.type,
        ...(event.payload === undefined ? {} : { payload: event.payload })
      })
      return rows.length - 1
    }),
  query: () => Effect.succeed([]),
  subscribe: () => Stream.die("unused"),
  close: () => Effect.void
})

const notFound = (key: string): HostProtocolNotFoundError =>
  new HostProtocolNotFoundError({
    tag: "NotFound",
    resource: key,
    message: `secret not found: ${key}`,
    operation: "SafeStorage.get",
    recoverable: hostProtocolErrorRecoverableDefault("NotFound")
  })

const newTestAuditFailure = (): EventLogFullError =>
  new EventLogFullError({
    freeBytes: 0,
    operation: "EventLog.append",
    cause: Option.none()
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
