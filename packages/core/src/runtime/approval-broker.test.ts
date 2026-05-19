import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Stream } from "effect"

import { EventJournal } from "effect/unstable/eventlog"

import { AuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  ApprovalBrokerAuditFailedError,
  ApprovalBrokerInvalidArgumentError,
  ApprovalBrokerPromptFailedError,
  ApprovalBrokerQueueOverflowError,
  ApprovalOutcome,
  ApprovalRequest,
  makeApprovalBroker,
  type ApprovalPromptPort
} from "./approval-broker.js"

test("ApprovalBroker coalesces identical concurrent requests into one host prompt", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      let promptCount = 0
      const prompt: ApprovalPromptPort = {
        prompt: (request) =>
          Effect.gen(function* () {
            promptCount += 1
            yield* Effect.sleep("10 millis")
            return outcome(request, "denied-for-scope", 1_100)
          })
      }
      const broker = yield* makeApprovalBroker({
        prompt,
        audit: memoryAudit(rows),
        now: () => 1_000
      })
      const request = approvalRequest("request-1", "filesystem.write", "window-main", "/tmp/app")

      const outcomes = yield* Effect.all(
        [
          broker.ask(request),
          broker.ask(copyRequest(request, "request-2")),
          broker.ask(copyRequest(request, "request-3"))
        ],
        { concurrency: "unbounded" }
      )
      yield* Effect.yieldNow
      const fourth = yield* broker.ask(copyRequest(request, "request-4"))

      expect(promptCount).toBe(1)
      expect(outcomes.map((current) => current.outcome)).toEqual([
        "denied-for-scope",
        "denied-for-scope",
        "denied-for-scope"
      ])
      expect(outcomes.map((current) => current.requestId)).toEqual([
        "request-1",
        "request-2",
        "request-3"
      ])
      expect(fourth.outcome).toBe("denied-for-scope")
      expect(fourth.requestId).toBe("request-4")
      expect(fourth.source).toBe("scope-cache")
      expect(rows.map((row) => row.kind)).toEqual([
        "approval-requested",
        "approval-requested",
        "approval-requested",
        "approval-denied",
        "approval-requested"
      ])
    })
  ))

test("ApprovalBroker rejects the ninth distinct queued request for one actor", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const prompt: ApprovalPromptPort = {
        prompt: (request) =>
          Deferred.await(release).pipe(Effect.as(outcome(request, "approved-once", 1_100)))
      }
      const broker = yield* makeApprovalBroker({
        prompt,
        maxQueueDepthPerActor: 8,
        now: () => 1_000
      })

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const active = yield* broker
            .ask(approvalRequest("active", "operation.active", "window-main", "active"))
            .pipe(Effect.forkChild({ startImmediately: true }))
          yield* Effect.sleep("1 millis")
          const queued = Array.from({ length: 8 }, (_value, index) =>
            broker
              .ask(
                approvalRequest(`queued-${index}`, `operation.${index}`, "window-main", `${index}`)
              )
              .pipe(Effect.forkChild({ startImmediately: true }))
          )
          yield* Effect.all(queued)
          const overflow = yield* Effect.exit(
            broker.ask(approvalRequest("overflow", "operation.overflow", "window-main", "overflow"))
          )
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.await(active)
          return overflow
        })
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expectFailure(exit.value, ApprovalBrokerQueueOverflowError, (error) => {
          expect(error.depth).toBe(8)
          expect(error.maxDepth).toBe(8)
        })
      }
    })
  ))

test("ApprovalBroker starts queued prompts after the active prompt completes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const activeStarted = yield* Deferred.make<void>()
      const releaseActive = yield* Deferred.make<void>()
      const promptCalls: string[] = []
      const prompt: ApprovalPromptPort = {
        prompt: (request) =>
          Effect.gen(function* () {
            promptCalls.push(request.id)
            if (request.id === "active") {
              yield* Deferred.succeed(activeStarted, undefined)
              yield* Deferred.await(releaseActive)
            }
            return outcome(request, "approved-once", 1_100)
          })
      }
      const broker = yield* makeApprovalBroker({ prompt, now: () => 1_000 })
      const active = yield* broker
        .ask(approvalRequest("active", "operation.active", "window-main", "active"))
        .pipe(Effect.forkChild({ startImmediately: true }))

      yield* Deferred.await(activeStarted)
      const queued = yield* broker
        .ask(approvalRequest("queued", "operation.queued", "window-main", "queued"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow
      expect(promptCalls).toEqual(["active"])

      yield* Deferred.succeed(releaseActive, undefined)
      const results = yield* Effect.all([Fiber.join(active), Fiber.join(queued)]).pipe(
        Effect.timeoutOption("50 millis")
      )

      expect(Option.isSome(results)).toBe(true)
      if (Option.isSome(results)) {
        expect(results.value.map((current) => current.requestId)).toEqual(["active", "queued"])
      }
      expect(promptCalls).toEqual(["active", "queued"])
    })
  ))

test("ApprovalBroker continues coalesced prompts after starter fiber interruption", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const promptStarted = yield* Deferred.make<void>()
      const releasePrompt = yield* Deferred.make<void>()
      const prompt: ApprovalPromptPort = {
        prompt: (request) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(promptStarted, undefined)
            yield* Deferred.await(releasePrompt)
            return outcome(request, "approved-once", 1_100)
          })
      }
      const broker = yield* makeApprovalBroker({ prompt, now: () => 1_000 })
      const request = approvalRequest("request-1", "filesystem.write", "window-main", "/tmp/app")
      const starter = yield* broker.ask(request).pipe(Effect.forkChild({ startImmediately: true }))

      yield* Deferred.await(promptStarted)
      yield* Fiber.interrupt(starter)
      const waiter = yield* broker
        .ask(copyRequest(request, "request-2"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(releasePrompt, undefined)
      const result = yield* Fiber.join(waiter).pipe(Effect.timeoutOption("50 millis"))

      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.outcome).toBe("approved-once")
      }
    })
  ))

test("ApprovalBroker shutdown interrupts active prompt loops and fails waiters", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const promptStarted = yield* Deferred.make<void>()
      const promptInterrupted = yield* Deferred.make<void>()
      const prompt: ApprovalPromptPort = {
        prompt: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(promptStarted, undefined)
            return yield* Effect.never.pipe(
              Effect.as(
                new ApprovalOutcome({
                  requestId: "never",
                  outcome: "canceled",
                  traceId: "trace-never",
                  decidedAt: 1_000,
                  source: "never"
                })
              )
            )
          }).pipe(Effect.onInterrupt(() => Deferred.succeed(promptInterrupted, undefined)))
      }
      const broker = yield* makeApprovalBroker({ prompt, now: () => 1_000 })
      const request = approvalRequest("request-1", "filesystem.write", "window-main", "/tmp/app")
      const waiter = yield* broker.ask(request).pipe(Effect.forkChild({ startImmediately: true }))

      yield* Deferred.await(promptStarted)
      yield* broker.shutdown
      yield* Deferred.await(promptInterrupted)
      const exit = yield* Fiber.await(waiter)

      expectFailure(exit, ApprovalBrokerPromptFailedError, (error) => {
        expect(error.operation).toBe("ApprovalBroker.shutdown")
      })
    })
  ))

test("ApprovalBroker dev bypass grants without touching the host prompt", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      let promptCount = 0
      const broker = yield* makeApprovalBroker({
        prompt: {
          prompt: (request) =>
            Effect.sync(() => {
              promptCount += 1
              return outcome(request, "denied-once", 1_000)
            })
        },
        audit: memoryAudit(rows),
        devApproveAll: true,
        now: () => 1_000,
        traceId: () => "trace-1"
      })

      const result = yield* broker.ask(
        approvalRequest("request-1", "process.spawn", "window-main", "git")
      )

      expect(result.outcome).toBe("approved-once")
      expect(result.source).toBe("dev-bypass")
      expect(result.traceId).toBe("trace-1")
      expect(promptCount).toBe(0)
      expect(rows.map((row) => row.kind)).toEqual(["approval-requested", "approval-granted"])
    })
  ))

test("ApprovalBroker returns typed failures for invalid input and audit failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const broker = yield* makeApprovalBroker({
        prompt: { prompt: (request) => Effect.succeed(outcome(request, "approved-once", 1_000)) },
        audit: failingAudit()
      })

      const invalid = yield* Effect.exit(
        broker.ask({ id: "", operation: "x", actor: "window-main" })
      )
      const audit = yield* Effect.exit(
        broker.ask(
          approvalRequest("request-1", "network.connect", "window-main", "api.example.com")
        )
      )

      expectFailure(invalid, ApprovalBrokerInvalidArgumentError)
      expectFailure(audit, ApprovalBrokerAuditFailedError)
    })
  ))

test("ApprovalBroker propagates host prompt failure as a typed value", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const broker = yield* makeApprovalBroker({
        prompt: {
          prompt: (request) =>
            Effect.fail(
              new ApprovalBrokerPromptFailedError({
                operation: "Approval.prompt",
                request,
                cause: "host unavailable"
              })
            )
        }
      })

      const exit = yield* Effect.exit(
        broker.ask(approvalRequest("request-1", "native.invoke", "window-main", "primitive.method"))
      )

      expectFailure(exit, ApprovalBrokerPromptFailedError)
    })
  ))

test("ApprovalBroker rejects empty explicit trace ids", () => {
  expect(
    () =>
      new ApprovalRequest({
        id: "request-1",
        operation: "x",
        actor: "window-main",
        risk: "low",
        summary: "test",
        details: {},
        traceId: ""
      })
  ).toThrow()
  expect(
    () =>
      new ApprovalRequest({
        id: "request-2",
        operation: "x",
        actor: "window-main",
        risk: "low",
        summary: "test",
        details: {}
      })
  ).not.toThrow()
})

test("ApprovalBroker rejects control bytes in approval request metadata", () => {
  const fields: ReadonlyArray<keyof ApprovalRequest> = [
    "id",
    "operation",
    "actor",
    "resource",
    "traceId"
  ]
  for (const field of fields) {
    for (const codePoint of [10, 13, 0, 27, 127]) {
      const bad = `value${String.fromCharCode(codePoint)}forged`
      expect(
        () =>
          new ApprovalRequest({
            id: field === "id" ? bad : "request-1",
            operation: field === "operation" ? bad : "operation",
            actor: field === "actor" ? bad : "window-main",
            ...(field === "resource" ? { resource: bad } : {}),
            risk: "low",
            summary: "test",
            details: {},
            ...(field === "traceId" ? { traceId: bad } : {})
          })
      ).toThrow()
    }
  }
})

test("ApprovalBroker ask rejects control bytes returned by the trace id callback", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const prompt: ApprovalPromptPort = {
        prompt: (request) => Effect.succeed(outcome(request, "approved-once", 1_100))
      }
      const broker = yield* makeApprovalBroker({
        prompt,
        now: () => 1_000,
        traceId: () => `gen${String.fromCharCode(10)}forged`
      })

      const exit = yield* Effect.exit(
        broker.ask(
          new ApprovalRequest({
            id: "request-1",
            operation: "operation",
            actor: "window-main",
            risk: "low",
            summary: "test",
            details: {}
          })
        )
      )

      expectFailure(exit, ApprovalBrokerInvalidArgumentError)
    })
  ))

test("ApprovalBroker ask rejects empty trace ids returned by the trace id callback", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let promptCalls = 0
      const rows: AuditEvent[] = []
      const prompt: ApprovalPromptPort = {
        prompt: (request) =>
          Effect.sync(() => {
            promptCalls += 1
            return outcome(request, "approved-once", 1_100)
          })
      }
      const broker = yield* makeApprovalBroker({
        prompt,
        audit: memoryAudit(rows),
        now: () => 1_000,
        traceId: () => ""
      })

      const exit = yield* Effect.exit(
        broker.ask(
          new ApprovalRequest({
            id: "request-1",
            operation: "operation",
            actor: "window-main",
            risk: "low",
            summary: "test",
            details: {}
          })
        )
      )

      expectFailure(exit, ApprovalBrokerInvalidArgumentError)
      expect(promptCalls).toBe(0)
      expect(rows).toEqual([])
    })
  ))

test("ApprovalBroker ask rejects prompt outcomes containing control bytes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const prompt: ApprovalPromptPort = {
        prompt: (request) =>
          Effect.succeed(
            new ApprovalOutcome({
              requestId: request.id,
              outcome: "approved-once",
              traceId: request.traceId ?? "trace-1",
              decidedAt: 1_100,
              source: "host"
            })
          ).pipe(
            Effect.map(
              (good) =>
                Object.assign({}, good, {
                  source: `host${String.fromCharCode(10)}forged`
                }) as ApprovalOutcome
            )
          )
      }
      const broker = yield* makeApprovalBroker({ prompt, now: () => 1_000 })

      const exit = yield* Effect.exit(
        broker.ask(approvalRequest("request-1", "operation", "window-main", "/tmp/app"))
      )

      expectFailure(exit, ApprovalBrokerInvalidArgumentError)
    })
  ))

test("ApprovalBroker ask rejects prompt outcomes with invalid decidedAt before decision audit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidTimestamps = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -1,
        1.5
      ]

      for (const decidedAt of invalidTimestamps) {
        const rows: AuditEvent[] = []
        const prompt: ApprovalPromptPort = {
          prompt: (request) =>
            Effect.succeed({
              requestId: request.id,
              outcome: "approved-once",
              traceId: request.traceId ?? "trace-1",
              decidedAt,
              source: "host"
            } as ApprovalOutcome)
        }
        const broker = yield* makeApprovalBroker({
          prompt,
          audit: memoryAudit(rows),
          now: () => 1_000
        })

        const exit = yield* Effect.exit(
          broker.ask(approvalRequest("request-1", "operation", "window-main", "/tmp/app"))
        )

        expectFailure(exit, ApprovalBrokerInvalidArgumentError)
        expect(rows.map((row) => row.kind)).toEqual(["approval-requested"])
      }
    })
  ))

const approvalRequest = (
  id: string,
  operation: string,
  actor: string,
  resource: string
): ApprovalRequest =>
  new ApprovalRequest({
    id,
    operation,
    actor,
    resource,
    risk: "high",
    summary: `${operation} ${resource}`,
    details: { resource },
    traceId: "trace-1"
  })

const copyRequest = (request: ApprovalRequest, id: string): ApprovalRequest =>
  new ApprovalRequest({
    id,
    operation: request.operation,
    actor: request.actor,
    ...(request.resource === undefined ? {} : { resource: request.resource }),
    risk: request.risk,
    summary: request.summary,
    details: request.details,
    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
  })

const outcome = (
  request: ApprovalRequest,
  result: ApprovalOutcome["outcome"],
  decidedAt: number
): ApprovalOutcome =>
  new ApprovalOutcome({
    requestId: request.id,
    outcome: result,
    traceId: request.traceId ?? "trace-1",
    decidedAt,
    source: "host"
  })

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
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

const expectFailure = <ErrorClass extends abstract new (...args: never[]) => unknown>(
  exit: Exit.Exit<unknown, unknown>,
  errorClass: ErrorClass,
  inspect?: (error: InstanceType<ErrorClass>) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(errorClass)
    if (failure?.error instanceof errorClass) {
      inspect?.(failure.error as InstanceType<ErrorClass>)
    }
  }
}
