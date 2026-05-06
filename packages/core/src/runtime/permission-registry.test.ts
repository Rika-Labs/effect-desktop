import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Stream } from "effect"

import { EventLogFullError, type EventLogStore } from "./event-log.js"
import {
  makePermissionRegistry,
  type NormalizedCapability,
  PermissionActor,
  PermissionAuditFailedError,
  PermissionDeniedError,
  PermissionGrantNotFoundError,
  PermissionInvalidArgumentError,
  PermissionRevokedError
} from "./permission-registry.js"

test("PermissionRegistry denies undeclared capabilities by default and audits the normalized request", async () => {
  const rows: unknown[] = []
  const registry = await Effect.runPromise(
    makePermissionRegistry({ audit: memoryAudit(rows), traceId: () => "trace-1" })
  )
  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app/file.txt"]), context("window-main"))
  )

  expectDenied(exit, (error) => {
    expect(error.reason).toBe("default-deny")
    expect(error.traceId).toBe("trace-1")
  })
  expect(rows).toEqual([
    {
      type: "audit/permission-denied",
      payload: {
        kind: "permission-denied",
        source: "default-deny",
        traceId: "trace-1",
        outcome: "denied",
        normalizedCapability: filesystemWrite(["/tmp/app/file.txt"]),
        actor: actor("window-main"),
        details: {
          reason: "default-deny"
        }
      },
      source: "AuditEvents"
    }
  ])
})

test("PermissionRegistry allows filesystem writes inside declared roots and denies outside", async () => {
  const registry = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => "trace-1", nextToken: () => "grant-1" })
  )

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))
  const granted = await Effect.runPromise(
    registry.check(filesystemWrite(["/tmp/app/config.json"]), context("window-main"))
  )
  const denied = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/other/config.json"]), context("window-main"))
  )

  expect(granted.token).toBe("grant-1")
  expect(granted.source).toBe("manifest")
  expectDenied(denied, (error) => {
    expect(error.reason).toBe("default-deny")
  })
})

test("PermissionRegistry exposes decision history and live decision events for devtools", async () => {
  const registry = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => "trace-devtools", nextToken: () => "grant-1" })
  )
  const observed = Effect.runFork(
    registry.observeDecisions().pipe(Stream.take(2), Stream.runCollect)
  )

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))
  await Effect.runPromise(
    registry.check(filesystemWrite(["/tmp/app/config.json"]), context("window-main"))
  )
  await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/blocked/config.json"]), context("window-main"))
  )

  const history = await Effect.runPromise(registry.listDecisions())
  const events = Array.from(await Effect.runPromise(Fiber.join(observed)))

  expect(history.map((decision) => decision.outcome)).toEqual(["granted", "denied"])
  expect(events.map((decision) => decision.traceId)).toEqual(["trace-devtools", "trace-devtools"])
  expect(events[1]?.reason).toBe("default-deny")
})

test("PermissionRegistry explicit deny overrides a matching allow", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))
  await Effect.runPromise(
    registry.declare(filesystemWrite(["/tmp/app/blocked"]), {
      effect: "deny",
      source: "policy"
    })
  )
  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app/blocked/secret.json"]), context("window-main"))
  )

  expectDenied(exit, (error) => {
    expect(error.reason).toBe("explicit-deny")
  })
})

test("PermissionRegistry revoked rules deny even when an allow also matches", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))
  await Effect.runPromise(
    registry.declare(filesystemWrite(["/tmp/app"]), {
      effect: "revoked",
      source: "revocation"
    })
  )
  await Effect.runPromise(
    registry.declare(filesystemWrite(["/tmp/app"]), { source: "later-manifest" })
  )
  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app/config.json"]), context("window-main"))
  )

  expectDenied(exit, (error) => {
    expect(error.reason).toBe("revoked")
  })
})

test("PermissionRegistry query returns global and actor-scoped declarations", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "global" }))
  await Effect.runPromise(
    registry.declare(networkConnect(["api.example.com"]), {
      actor: actor("window-main"),
      source: "window"
    })
  )
  await Effect.runPromise(
    registry.declare(networkConnect(["other.example.com"]), {
      actor: actor("other-window"),
      source: "other"
    })
  )

  const filesystemRules = await Effect.runPromise(
    registry.query("filesystem.write", actor("window-main"))
  )
  const networkRules = await Effect.runPromise(
    registry.query("network.connect", actor("window-main"))
  )

  expect(filesystemRules.map((rule) => rule.source)).toEqual(["global"])
  expect(networkRules.map((rule) => rule.source)).toEqual(["window"])
})

test("PermissionRegistry validates inputs before audit side effects", async () => {
  const rows: unknown[] = []
  const registry = await Effect.runPromise(makePermissionRegistry({ audit: memoryAudit(rows) }))
  const invalidContext = { actor: { kind: "window", id: "" } }
  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app"]), invalidContext as never)
  )

  expectInvalid(exit)
  expect(rows).toEqual([])
})

test("PermissionRegistry does not retain a new grant when initial lifecycle audit fails", async () => {
  const registry = await Effect.runPromise(
    makePermissionRegistry({
      audit: failingAudit(),
      nextToken: () => "grant-1",
      now: () => 1_000
    })
  )

  const grantExit = await Effect.runPromiseExit(
    registry.grant(filesystemWrite(["/tmp/app"]), context("window-main"))
  )
  const inspectExit = await Effect.runPromiseExit(registry.inspect("grant-1"))

  expectFailure(grantExit, PermissionAuditFailedError)
  expectFailure(inspectExit, PermissionGrantNotFoundError)
})

test("PermissionRegistry expires grants as typed revocation values and audits the transition", async () => {
  const rows: unknown[] = []
  let currentTime = 1_000
  const registry = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-1",
      nextToken: () => "grant-1",
      now: () => currentTime
    })
  )

  const grant = await Effect.runPromise(
    registry.grant(filesystemWrite(["/tmp/app"]), context("window-main"), {
      expiresAt: 1_010,
      source: "approval"
    })
  )
  currentTime = 1_020
  const exit = await Effect.runPromiseExit(registry.use(grant, Effect.succeed("allowed")))
  const snapshot = await Effect.runPromise(registry.inspect(grant.token))

  expectRevoked(exit, (error) => {
    expect(error.reason).toBe("expired")
    expect(error.token).toBe("grant-1")
  })
  expect(snapshot.status).toBe("expired")
  expect(rows.map((row) => eventType(row))).toEqual([
    "audit/permission-granted",
    "audit/permission-expired"
  ])
})

test("PermissionRegistry consumes one-time grants after the first use", async () => {
  const registry = await Effect.runPromise(
    makePermissionRegistry({ nextToken: () => "grant-1", now: () => 1_000 })
  )
  const grant = await Effect.runPromise(
    registry.grant(filesystemWrite(["/tmp/app"]), context("window-main"), { oneTime: true })
  )

  const first = await Effect.runPromise(registry.use(grant, Effect.succeed("allowed")))
  const second = await Effect.runPromiseExit(registry.use(grant, Effect.succeed("denied")))
  const snapshot = await Effect.runPromise(registry.inspect(grant.token))

  expect(first).toBe("allowed")
  expect(snapshot.status).toBe("consumed")
  expectRevoked(second, (error) => {
    expect(error.reason).toBe("consumed")
  })
})

test("PermissionRegistry revokes in-flight grant users through the lifecycle bus", async () => {
  let currentTime = 1_000
  const registry = await Effect.runPromise(
    makePermissionRegistry({ nextToken: () => "grant-1", now: () => currentTime })
  )
  const grant = await Effect.runPromise(
    registry.grant(filesystemWrite(["/tmp/app"]), context("window-main"))
  )
  const started = await Effect.runPromise(Deferred.make<void>())
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const fiber = yield* registry
        .use(
          grant,
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            yield* Effect.sleep("1 minute")
          })
        )
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(started)
      currentTime = 1_250
      yield* registry.revoke(grant.token)
      return yield* Fiber.await(fiber)
    })
  )

  expect(Exit.isSuccess(exit)).toBe(true)
  if (Exit.isSuccess(exit)) {
    expectRevoked(exit.value, (error) => {
      expect(error.reason).toBe("revoked")
      expect(error.revokedAt).toBe(1_250)
    })
  }
})

const actor = (id: string): PermissionActor => new PermissionActor({ kind: "window", id })

const context = (id: string) => ({ actor: actor(id) })

const filesystemWrite = (roots: readonly string[]): NormalizedCapability => ({
  kind: "filesystem.write",
  roots,
  audit: "always"
})

const networkConnect = (hosts: readonly string[]): NormalizedCapability => ({
  kind: "network.connect",
  hosts,
  askUnknownHosts: false,
  audit: "always"
})

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

const failingAudit = (): EventLogStore => ({
  append: () =>
    Effect.fail(
      new EventLogFullError({
        freeBytes: 0,
        operation: "EventLog.append",
        cause: Option.none()
      })
    ),
  query: () => Effect.succeed([]),
  subscribe: () => Stream.die("unused"),
  close: () => Effect.void
})

const expectDenied = (
  exit: Exit.Exit<unknown, unknown>,
  inspect?: (error: PermissionDeniedError) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(PermissionDeniedError)
    if (failure?.error instanceof PermissionDeniedError) {
      inspect?.(failure.error)
    }
  }
}

const expectInvalid = (exit: Exit.Exit<unknown, unknown>): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(PermissionInvalidArgumentError)
  }
}

const expectFailure = <Error extends new (...args: never[]) => unknown>(
  exit: Exit.Exit<unknown, unknown>,
  errorClass: Error
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(errorClass)
  }
}

const expectRevoked = (
  exit: Exit.Exit<unknown, unknown>,
  inspect?: (error: PermissionRevokedError) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(PermissionRevokedError)
    if (failure?.error instanceof PermissionRevokedError) {
      inspect?.(failure.error)
    }
  }
}

const eventType = (row: unknown): string | undefined =>
  typeof row === "object" && row !== null && "type" in row && typeof row.type === "string"
    ? row.type
    : undefined
