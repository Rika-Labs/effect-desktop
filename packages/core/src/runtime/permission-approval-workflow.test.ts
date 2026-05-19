import { expect, test } from "bun:test"
import {
  Cause,
  Clock,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
  Schedule,
  Stream
} from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"

import { type AuditEventsApi, type AuditEvent } from "./audit-events.js"
import {
  Grant,
  makePermissionApprovalWorkflowLayer,
  PermissionApprovalWorkflow,
  resolveApprovalDeferred
} from "./permission-approval-workflow.js"
import {
  makePermissionRegistry,
  PermissionInvalidArgumentError,
  type PermissionRegistryApi
} from "./permission-registry.js"

const now = 1_715_000_000_000

const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

class WaitingForApprovalToken extends Schema.TaggedErrorClass<WaitingForApprovalToken>()(
  "WaitingForApprovalToken",
  {}
) {}

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

test("PermissionApproval workflow grants when user approves", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry()

      const capability = {
        kind: "filesystem.read" as const,
        roots: ["/tmp"],
        audit: "on-deny" as const
      }
      const actor = { kind: "app" as const, id: "test-app" }
      const traceId = "trace-approve-1"
      const auditRows: AuditEvent[] = []

      let capturedToken: string | undefined

      const layer = Layer.provideMerge(
        makePermissionApprovalWorkflowLayer({
          registry,
          audit: memoryAudit(auditRows),
          notify: (token, _traceId) =>
            Effect.sync(() => {
              capturedToken = token
            })
        }),
        WorkflowEngine.layerMemory
      )

      const result = yield* runScoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(
            PermissionApprovalWorkflow.execute({ traceId, capability, actor }),
            { startImmediately: true }
          )
          const token = yield* waitForToken(() => capturedToken)
          yield* resolveApprovalDeferred(token, true)
          return yield* Fiber.join(fiber)
        }),
        layer
      )

      expect(result).toBeInstanceOf(Grant)
      expect(result.traceId).toBe(traceId)
      expect(result.token).toBeDefined()
      expect(result.grantedAt).toBeGreaterThan(0)
      expect(auditRows.map((row) => row.kind)).toContain("approval-requested")
      expect(auditRows.map((row) => row.kind)).toContain("approval-granted")
      expect(auditRows[0]?.actor).toMatchObject(actor)
      expect(encodeUnknownJson(auditRows[0]?.actor)).toBe(encodeUnknownJson(actor))
      expect(encodeUnknownJson(auditRows)).not.toContain(result.token)
      expect(encodeUnknownJson(auditRows)).toContain("<redacted:PermissionGrantToken>")
    })
  ))

test("PermissionApproval workflow fails with PermissionDenied when user denies", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry()

      const capability = {
        kind: "network.connect" as const,
        hosts: ["example.com"],
        askUnknownHosts: false,
        audit: "on-deny" as const
      }
      const actor = { kind: "app" as const, id: "test-app" }
      const traceId = "trace-deny-1"

      let capturedToken: string | undefined

      const layer = Layer.provideMerge(
        makePermissionApprovalWorkflowLayer({
          registry,
          notify: (token, _traceId) =>
            Effect.sync(() => {
              capturedToken = token
            })
        }),
        WorkflowEngine.layerMemory
      )

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(
            PermissionApprovalWorkflow.execute({ traceId, capability, actor }),
            { startImmediately: true }
          )
          const token = yield* waitForToken(() => capturedToken)
          yield* resolveApprovalDeferred(token, false)
          return yield* Effect.exit(Fiber.join(fiber))
        }),
        layer
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failReason = exit.cause.reasons.find(Cause.isFailReason)
        expect(failReason).toBeDefined()
        if (failReason !== undefined) {
          expect((failReason.error as { _tag: string })._tag).toBe("PermissionDenied")
        }
      }
    })
  ))

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.empty
})

const waitForToken = (read: () => string | undefined): Effect.Effect<string, never, never> =>
  Effect.gen(function* () {
    const token = read()
    if (token === undefined) {
      return yield* new WaitingForApprovalToken()
    }
    return token
  }).pipe(
    Effect.retry(Schedule.spaced("1 millis").pipe(Schedule.both(Schedule.recurs(100)))),
    Effect.orDie
  )

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})

test("resolveApprovalDeferred constructs an Effect for the branded token", () => {
  const effect = resolveApprovalDeferred("workflow-token-example", true)
  expect(effect).toBeDefined()
})

test("PermissionApproval workflow records a grant with ttl when ttlMs provided", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry()

      const capability = {
        kind: "secrets.read" as const,
        namespaces: ["vault"],
        audit: "always" as const
      }
      const actor = { kind: "app" as const, id: "test-app" }
      const traceId = "trace-ttl-1"
      const ttlMs = 50

      let capturedToken: string | undefined

      const layer = Layer.provideMerge(
        makePermissionApprovalWorkflowLayer({
          registry,
          notify: (token, _traceId) =>
            Effect.sync(() => {
              capturedToken = token
            })
        }),
        WorkflowEngine.layerMemory
      )

      const result = yield* runScoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(
            PermissionApprovalWorkflow.execute({ traceId, capability, actor, ttlMs }),
            { startImmediately: true }
          )
          const token = yield* waitForToken(() => capturedToken)
          yield* resolveApprovalDeferred(token, true)
          return yield* Fiber.join(fiber)
        }).pipe(Effect.provideService(Clock.Clock, fixedClock(now))),
        layer
      )

      expect(result).toBeInstanceOf(Grant)
      expect(result.grantedAt).toBe(now)
      expect(result.expiresAt).toBeDefined()
      expect(result.expiresAt! - result.grantedAt).toBe(ttlMs)
    })
  ))

test("PermissionApproval workflow reports registry declaration failures as typed workflow errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const baseRegistry = yield* makePermissionRegistry()
      const registry: PermissionRegistryApi = {
        ...baseRegistry,
        declare: (_capability, _options) =>
          Effect.fail(
            new PermissionInvalidArgumentError({
              operation: "PermissionRegistry.declare",
              field: "capability",
              message: "invalid",
              cause: Option.none()
            })
          )
      }
      const actor = { kind: "app" as const, id: "test-app" }
      const layer = Layer.provideMerge(
        makePermissionApprovalWorkflowLayer({ registry }),
        WorkflowEngine.layerMemory
      )

      const exit = yield* runScoped(
        Effect.exit(
          PermissionApprovalWorkflow.execute({
            traceId: "trace-invalid-capability",
            capability: { kind: "filesystem.read", roots: [], audit: "on-deny" },
            actor
          })
        ),
        layer
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failReason = exit.cause.reasons.find(Cause.isFailReason)
        expect(failReason).toBeDefined()
        if (failReason !== undefined) {
          const error = failReason.error as { readonly _tag: string; readonly phase?: string }
          expect(error._tag).toBe("PermissionApprovalFailed")
          expect(error.phase).toBe("declare")
        }
      }
    })
  ))
