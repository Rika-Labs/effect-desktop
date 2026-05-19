import { expect, test } from "bun:test"
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { EventJournal } from "effect/unstable/eventlog"

import { AuditEvent, type AuditEventsApi } from "./audit-events.js"
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

test("PermissionRegistry denies undeclared capabilities by default and audits the normalized request", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: unknown[] = []
      const registry = yield* makePermissionRegistry({
        audit: memoryAudit(rows),
        traceId: () => "trace-1"
      })
      const exit = yield* Effect.exit(
        registry.check(filesystemWrite(["/tmp/app/file.txt"]), context("window-main"))
      )

      expectDenied(exit, (error) => {
        expect(error.reason).toBe("default-deny")
        expect(error.traceId).toBe("trace-1")
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toBeInstanceOf(AuditEvent)
      expect((rows[0] as AuditEvent).kind).toBe("permission-denied")
      expect((rows[0] as AuditEvent).source).toBe("default-deny")
      expect((rows[0] as AuditEvent).traceId).toBe("trace-1")
      expect((rows[0] as AuditEvent).outcome).toBe("denied")
    })
  ))

test("PermissionRegistry allows filesystem writes inside declared roots and denies outside", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry({
        traceId: () => "trace-1",
        nextToken: () => "grant-1"
      })

      yield* registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" })
      const granted = yield* registry.check(
        filesystemWrite(["/tmp/app/config.json"]),
        context("window-main")
      )
      const denied = yield* Effect.exit(
        registry.check(filesystemWrite(["/tmp/other/config.json"]), context("window-main"))
      )

      expect(granted.token).toBe("grant-1")
      expect(granted.source).toBe("manifest")
      expectDenied(denied, (error) => {
        expect(error.reason).toBe("default-deny")
      })
    })
  ))

test("PermissionRegistry uses the Effect Clock when no explicit clock is supplied", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_715_000_000_000
      const registry = yield* makePermissionRegistry({
        traceId: () => "trace-1",
        nextToken: () => "grant-1"
      }).pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))

      yield* registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" })
      const granted = yield* registry.check(
        filesystemWrite(["/tmp/app/config.json"]),
        context("window-main")
      )

      expect(granted.grantedAt).toBe(timestamp)
    })
  ))

test("PermissionRegistry allows sqlite opens inside declared database roots and denies outside", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry({
        traceId: () => "trace-1",
        nextToken: () => "grant-1"
      })

      yield* registry.declare(sqliteOpen(["/tmp/app/databases"]), { source: "manifest" })
      const granted = yield* registry.check(
        sqliteOpen(["/tmp/app/databases/main.sqlite"]),
        context("window-main")
      )
      const denied = yield* Effect.exit(
        registry.check(sqliteOpen(["/tmp/other/main.sqlite"]), context("window-main"))
      )

      expect(granted.token).toBe("grant-1")
      expect(granted.source).toBe("manifest")
      expectDenied(denied, (error) => {
        expect(error.reason).toBe("default-deny")
      })
    })
  ))

test("PermissionRegistry matches Windows-style roots by path segment", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry({
        traceId: () => "trace-1",
        nextToken: () => "grant-1"
      })

      yield* registry.declare(sqliteOpen(["C:\\Temp\\app\\databases"]), { source: "manifest" })
      const granted = yield* registry.check(
        sqliteOpen(["C:\\Temp\\app\\databases\\main.sqlite"]),
        context("window-main")
      )
      const denied = yield* Effect.exit(
        registry.check(
          sqliteOpen(["C:\\Temp\\app\\database-shadow\\main.sqlite"]),
          context("window-main")
        )
      )

      expect(granted.token).toBe("grant-1")
      expectDenied(denied, (error) => {
        expect(error.reason).toBe("default-deny")
      })
    })
  ))

test("PermissionRegistry does not let weaker native audit policy cover stronger requests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry({
        traceId: () => "trace-1",
        nextToken: () => "grant-1"
      })

      yield* registry.declare(nativeInvoke(["Dialog.openFile"], "never"), { source: "manifest" })
      const denied = yield* Effect.exit(
        registry.check(nativeInvoke(["Dialog.openFile"], "always"), context("window-main"))
      )
      const granted = yield* registry.check(
        nativeInvoke(["Dialog.openFile"], "never"),
        context("window-main")
      )

      expectDenied(denied, (error) => {
        expect(error.reason).toBe("default-deny")
      })
      expect(granted.token).toBe("grant-1")
    })
  ))

test("PermissionRegistry does not let weaker secret audit policy cover stronger requests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const kind of [
        "secrets.read",
        "secrets.write",
        "safeStorage.read",
        "safeStorage.write"
      ] as const) {
        const registry = yield* makePermissionRegistry({
          traceId: () => "trace-1",
          nextToken: () => "grant-1"
        })

        yield* registry.declare(secretCapability(kind, ["auth"], "on-deny"), {
          source: "manifest"
        })
        const denied = yield* Effect.exit(
          registry.check(secretCapability(kind, ["auth"], "always"), context("window-main"))
        )
        const granted = yield* registry.check(
          secretCapability(kind, ["auth"], "on-deny"),
          context("window-main")
        )

        expectDenied(denied, (error) => {
          expect(error.reason).toBe("default-deny")
        })
        expect(granted.token).toBe("grant-1")
      }
    })
  ))

test("PermissionRegistry does not let narrower network policy cover ask-unknown requests", async () => {
  const registry = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => "trace-1", nextToken: () => "grant-1" })
  )

  await Effect.runPromise(
    registry.declare(networkConnect(["api.example.com"], false), { source: "manifest" })
  )
  const denied = await Effect.runPromiseExit(
    registry.check(networkConnect(["api.example.com"], true), context("window-main"))
  )
  const granted = await Effect.runPromise(
    registry.check(networkConnect(["api.example.com"], false), context("window-main"))
  )

  expectDenied(denied, (error) => {
    expect(error.reason).toBe("default-deny")
  })
  expect(granted.token).toBe("grant-1")
})

test("PermissionRegistry scopes process spawn grants by cwd and environment policy", async () => {
  const registry = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => "trace-1", nextToken: () => "grant-1" })
  )

  await Effect.runPromise(
    registry.declare(processSpawn(["node"], ["/workspace/app"], "none"), { source: "manifest" })
  )
  const granted = await Effect.runPromise(
    registry.check(processSpawn(["node"], ["/workspace/app/tasks"], "none"), context("window-main"))
  )
  const wrongCwd = await Effect.runPromiseExit(
    registry.check(processSpawn(["node"], ["/tmp/app"], "none"), context("window-main"))
  )
  const wrongEnvironment = await Effect.runPromiseExit(
    registry.check(processSpawn(["node"], ["/workspace/app"], "allowlist"), context("window-main"))
  )

  expect(granted.token).toBe("grant-1")
  expectDenied(wrongCwd, (error) => {
    expect(error.reason).toBe("default-deny")
  })
  expectDenied(wrongEnvironment, (error) => {
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
    registry.check(filesystemWrite(["/tmp/app"]), invalidContext)
  )

  expectInvalid(exit)
  expect(rows).toEqual([])
})

test("PermissionRegistry rejects control bytes in caller-supplied trace ids", async () => {
  const rows: unknown[] = []
  const registry = await Effect.runPromise(makePermissionRegistry({ audit: memoryAudit(rows) }))
  for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
    const traceId = `trace${String.fromCharCode(codePoint)}forged`
    const checkExit = await Effect.runPromiseExit(
      registry.check(filesystemWrite(["/tmp/app"]), {
        actor: actor("window-main"),
        traceId
      })
    )
    const grantExit = await Effect.runPromiseExit(
      registry.grant(filesystemWrite(["/tmp/app"]), {
        actor: actor("window-main"),
        traceId
      })
    )
    expectInvalid(checkExit)
    expectInvalid(grantExit)
  }
  const delTrace = `trace${String.fromCharCode(127)}forged`
  expectInvalid(
    await Effect.runPromiseExit(
      registry.check(filesystemWrite(["/tmp/app"]), {
        actor: actor("window-main"),
        traceId: delTrace
      })
    )
  )
  expect(rows).toEqual([])
})

test("PermissionRegistry rejects control bytes returned by the trace id callback", async () => {
  const registry = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => `gen${String.fromCharCode(10)}forged` })
  )
  const checkExit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app"]), context("window-main"))
  )
  const grantExit = await Effect.runPromiseExit(
    registry.grant(filesystemWrite(["/tmp/app"]), context("window-main"))
  )

  expectInvalid(checkExit)
  expectInvalid(grantExit)
})

test("PermissionRegistry rejects empty trace IDs returned by the traceId callback", async () => {
  const rows: unknown[] = []
  const registry = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "",
      nextToken: () => "grant-1"
    })
  )
  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))

  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app"]), context("window-main"))
  )
  expectInvalid(exit)
  expect(rows).toEqual([])
  expect(await Effect.runPromise(registry.listDecisions())).toEqual([])
})

test("PermissionRegistry rejects control bytes in actor ids, resources, and sources", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  const declareExit = await Effect.runPromiseExit(
    registry.declare(filesystemWrite(["/tmp/app"]), {
      source: `declaration${String.fromCharCode(10)}forged`
    })
  )
  expectInvalid(declareExit)

  const actorExit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app"]), {
      actor: { kind: "window", id: `app${String.fromCharCode(10)}forged` }
    })
  )
  expectInvalid(actorExit)

  const resourceExit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app"]), {
      actor: actor("window-main"),
      resource: `resource${String.fromCharCode(10)}forged`
    })
  )
  expectInvalid(resourceExit)

  const grantSourceExit = await Effect.runPromiseExit(
    registry.grant(filesystemWrite(["/tmp/app"]), context("window-main"), {
      source: `grant${String.fromCharCode(10)}forged`
    })
  )
  expectInvalid(grantSourceExit)
})

test("PermissionRegistry rejects empty token returned by the nextToken callback during check and grant", async () => {
  const auditRows: unknown[] = []
  const registry = await Effect.runPromise(
    makePermissionRegistry({
      nextToken: () => "",
      traceId: () => "trace-1",
      audit: memoryAudit(auditRows)
    })
  )
  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))

  const checkExit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app"]), context("window-main"))
  )
  const grantExit = await Effect.runPromiseExit(
    registry.grant(filesystemWrite(["/tmp/app"]), context("window-main"))
  )

  expectInvalid(checkExit)
  expectInvalid(grantExit)
  expect(auditRows).toEqual([])
  expect(await Effect.runPromise(registry.listDecisions())).toEqual([])
})

test("PermissionRegistry rejects invalid clock timestamps before grant state changes", async () => {
  for (const now of invalidTimestamps) {
    let currentTime = now
    const grantRows: unknown[] = []
    const grantRegistry = await Effect.runPromise(
      makePermissionRegistry({
        audit: memoryAudit(grantRows),
        now: () => currentTime,
        nextToken: () => "grant-1",
        traceId: () => "trace-1"
      })
    )
    const grantExit = await Effect.runPromiseExit(
      grantRegistry.grant(filesystemWrite(["/tmp/app"]), context("window-main"))
    )

    expectInvalid(grantExit)
    expect(grantRows).toEqual([])
    currentTime = 1_000
    expectFailure(
      await Effect.runPromiseExit(grantRegistry.inspect("grant-1")),
      PermissionGrantNotFoundError
    )

    const checkRows: AuditEvent[] = []
    const checkRegistry = await Effect.runPromise(
      makePermissionRegistry({
        audit: memoryAudit(checkRows),
        now: () => now,
        nextToken: () => "grant-1",
        traceId: () => "trace-1"
      })
    )
    await Effect.runPromise(
      checkRegistry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" })
    )
    const checkExit = await Effect.runPromiseExit(
      checkRegistry.check(filesystemWrite(["/tmp/app"]), context("window-main"))
    )

    expectInvalid(checkExit)
    expect(checkRows).toEqual([])
    expect(await Effect.runPromise(checkRegistry.listDecisions())).toEqual([])
  }
})

test("PermissionRegistry rejects invalid clock timestamps before lifecycle transitions", async () => {
  for (const now of invalidTimestamps) {
    for (const operation of ["inspect", "revoke", "use"] as const) {
      let currentTime = 1_000
      const rows: AuditEvent[] = []
      const registry = await Effect.runPromise(
        makePermissionRegistry({
          audit: memoryAudit(rows),
          now: () => currentTime,
          nextToken: () => "grant-1",
          traceId: () => "trace-1"
        })
      )
      const grant = await Effect.runPromise(
        registry.grant(filesystemWrite(["/tmp/app"]), context("window-main"), { oneTime: true })
      )
      currentTime = now

      let effectRuns = 0
      const exit = await Effect.runPromiseExit(
        operation === "inspect"
          ? registry.inspect(grant.token)
          : operation === "revoke"
            ? registry.revoke(grant.token)
            : registry.use(
                grant,
                Effect.sync(() => {
                  effectRuns += 1
                })
              )
      )

      expectInvalid(exit)
      expect(effectRuns).toBe(0)
      expect(rows.map((row) => row.kind)).toEqual(["permission-granted"])
      currentTime = 1_010
      const snapshot = await Effect.runPromise(registry.inspect(grant.token))
      expect(snapshot.status).toBe("active")
    }
  }
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

test("PermissionRegistry does not retain a check grant when decision audit fails", async () => {
  const rows: AuditEvent[] = []
  const registry = await Effect.runPromise(
    makePermissionRegistry({
      audit: failingPermissionDecisionAudit(rows),
      traceId: () => "trace-1",
      nextToken: () => "grant-1",
      now: () => 1_000
    })
  )
  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))

  const checkExit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app"]), context("window-main"))
  )
  const inspectExit = await Effect.runPromiseExit(registry.inspect("grant-1"))

  expectFailure(checkExit, PermissionAuditFailedError)
  expectFailure(inspectExit, PermissionGrantNotFoundError)
  expect(rows.map((row) => row.kind)).toContain("permission-granted")
  expect(await Effect.runPromise(registry.listDecisions())).toEqual([])
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
  expect(rows.map((row) => (row as AuditEvent).kind)).toEqual([
    "permission-granted",
    "permission-expired"
  ])
  expect(JSON.stringify(rows)).not.toContain("grant-1")
  expect(JSON.stringify(rows)).toContain("<redacted:PermissionGrantToken>")
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

const invalidTimestamps = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5]

const filesystemWrite = (roots: readonly string[]): NormalizedCapability => ({
  kind: "filesystem.write",
  roots,
  audit: "always"
})

const sqliteOpen = (roots: readonly string[]): NormalizedCapability => ({
  kind: "sqlite.open",
  roots,
  audit: "always"
})

const networkConnect = (
  hosts: readonly string[],
  askUnknownHosts = false
): NormalizedCapability => ({
  kind: "network.connect",
  hosts,
  askUnknownHosts,
  audit: "always"
})

const processSpawn = (
  commands: readonly string[],
  cwd: readonly string[],
  environment: "none" | "allowlist"
): NormalizedCapability => ({
  kind: "process.spawn",
  commands,
  cwd,
  environment,
  shell: false,
  audit: "always"
})

const nativeInvoke = (
  methods: readonly string[],
  audit: "always" | "on-deny" | "never"
): NormalizedCapability => ({
  kind: "native.invoke",
  primitive: "Dialog",
  methods,
  audit
})

const secretCapability = (
  kind: "secrets.read" | "secrets.write" | "safeStorage.read" | "safeStorage.write",
  namespaces: readonly string[],
  audit: "always" | "on-deny"
): NormalizedCapability => ({
  kind,
  namespaces,
  audit
})

const memoryAudit = (rows: unknown[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.empty
})

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

const failingPermissionDecisionAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    event.outcome === "granted"
      ? Effect.fail(
          new EventJournal.EventJournalError({
            method: "EventJournal.write",
            cause: new Error("journal full")
          })
        )
      : Effect.sync(() => {
          rows.push(event)
        }),
  observe: () => Stream.empty
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

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
