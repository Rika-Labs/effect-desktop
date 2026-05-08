import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Stream } from "effect"

import { EventLogFullError, type EventLogStore } from "./event-log.js"
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

test("ApprovalBroker coalesces identical concurrent requests into one host prompt", async () => {
  const rows: unknown[] = []
  let promptCount = 0
  const prompt: ApprovalPromptPort = {
    prompt: (request) =>
      Effect.gen(function* () {
        promptCount += 1
        yield* Effect.sleep("10 millis")
        return outcome(request, "denied-for-scope", 1_100)
      })
  }
  const broker = await Effect.runPromise(
    makeApprovalBroker({ prompt, audit: memoryAudit(rows), now: () => 1_000 })
  )
  const request = approvalRequest("request-1", "filesystem.write", "window-main", "/tmp/app")

  const program = Effect.gen(function* () {
    return yield* Effect.all(
      [
        broker.ask(request),
        broker.ask(copyRequest(request, "request-2")),
        broker.ask(copyRequest(request, "request-3"))
      ],
      { concurrency: "unbounded" }
    )
  })
  const outcomes = await Effect.runPromise(program)
  const fourth = await Effect.runPromise(broker.ask(copyRequest(request, "request-4")))

  expect(promptCount).toBe(1)
  expect(outcomes.map((current) => current.outcome)).toEqual([
    "denied-for-scope",
    "denied-for-scope",
    "denied-for-scope"
  ])
  expect(fourth.outcome).toBe("denied-for-scope")
  expect(fourth.source).toBe("scope-cache")
  expect(rows.map((row) => eventType(row))).toEqual([
    "audit/approval-requested",
    "audit/approval-requested",
    "audit/approval-requested",
    "audit/approval-denied",
    "audit/approval-requested"
  ])
})

test("ApprovalBroker rejects the ninth distinct queued request for one actor", async () => {
  const release = await Effect.runPromise(Deferred.make<void>())
  const prompt: ApprovalPromptPort = {
    prompt: (request) =>
      Deferred.await(release).pipe(Effect.as(outcome(request, "approved-once", 1_100)))
  }
  const broker = await Effect.runPromise(
    makeApprovalBroker({ prompt, maxQueueDepthPerActor: 8, now: () => 1_000 })
  )

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const active = yield* broker
        .ask(approvalRequest("active", "operation.active", "window-main", "active"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.sleep("1 millis")
      const queued = Array.from({ length: 8 }, (_value, index) =>
        broker
          .ask(approvalRequest(`queued-${index}`, `operation.${index}`, "window-main", `${index}`))
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

test("ApprovalBroker dev bypass grants without touching the host prompt", async () => {
  const rows: unknown[] = []
  let promptCount = 0
  const broker = await Effect.runPromise(
    makeApprovalBroker({
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
  )

  const result = await Effect.runPromise(
    broker.ask(approvalRequest("request-1", "process.spawn", "window-main", "git"))
  )

  expect(result.outcome).toBe("approved-once")
  expect(result.source).toBe("dev-bypass")
  expect(result.traceId).toBe("trace-1")
  expect(promptCount).toBe(0)
  expect(rows.map((row) => eventType(row))).toEqual([
    "audit/approval-requested",
    "audit/approval-granted"
  ])
})

test("ApprovalBroker returns typed failures for invalid input and audit failure", async () => {
  const broker = await Effect.runPromise(
    makeApprovalBroker({
      prompt: { prompt: (request) => Effect.succeed(outcome(request, "approved-once", 1_000)) },
      audit: failingAudit()
    })
  )

  const invalid = await Effect.runPromiseExit(
    broker.ask({ id: "", operation: "x", actor: "window-main" } as never)
  )
  const audit = await Effect.runPromiseExit(
    broker.ask(approvalRequest("request-1", "network.connect", "window-main", "api.example.com"))
  )

  expectFailure(invalid, ApprovalBrokerInvalidArgumentError)
  expectFailure(audit, ApprovalBrokerAuditFailedError)
})

test("ApprovalBroker propagates host prompt failure as a typed value", async () => {
  const broker = await Effect.runPromise(
    makeApprovalBroker({
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
  )

  const exit = await Effect.runPromiseExit(
    broker.ask(approvalRequest("request-1", "native.invoke", "window-main", "primitive.method"))
  )

  expectFailure(exit, ApprovalBrokerPromptFailedError)
})

test("ApprovalBroker rejects empty explicit trace ids", async () => {
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

const eventType = (row: unknown): string | undefined =>
  typeof row === "object" && row !== null && "type" in row && typeof row.type === "string"
    ? row.type
    : undefined
