import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Option } from "effect"
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

const provideEngine = <A, E, R>(
  effect: Effect.Effect<A, E, R | WorkflowEngine.WorkflowEngine>
): Effect.Effect<A, E, Exclude<R, WorkflowEngine.WorkflowEngine>> =>
  effect.pipe(Effect.provide(WorkflowEngine.layerMemory))

test("PermissionApproval workflow grants when user approves", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  const capability = {
    kind: "filesystem.read" as const,
    roots: ["/tmp"],
    audit: "on-deny" as const
  }
  const actor = { kind: "app" as const, id: "test-app" }
  const traceId = "trace-approve-1"
  const auditRows: AuditEvent[] = []

  let capturedToken: string | undefined

  const layer = makePermissionApprovalWorkflowLayer({
    registry,
    audit: memoryAudit(auditRows),
    notify: (token, _traceId) =>
      Effect.sync(() => {
        capturedToken = token
      })
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        PermissionApprovalWorkflow.execute({ traceId, capability, actor }).pipe(
          Effect.provide(layer)
        )
      )
      const token = yield* waitForToken(() => capturedToken)
      yield* resolveApprovalDeferred(token, true)
      return yield* Fiber.join(fiber)
    }).pipe(provideEngine)
  )

  expect(result).toBeInstanceOf(Grant)
  expect(result.traceId).toBe(traceId)
  expect(result.token).toBeDefined()
  expect(result.grantedAt).toBeGreaterThan(0)
  expect(auditRows.map((row) => row.kind)).toContain("approval-requested")
  expect(auditRows.map((row) => row.kind)).toContain("approval-granted")
  expect(auditRows[0]?.actor).toMatchObject(actor)
  expect(JSON.stringify(auditRows[0]?.actor)).toBe(JSON.stringify(actor))
  expect(JSON.stringify(auditRows)).not.toContain(result.token)
  expect(JSON.stringify(auditRows)).toContain("<redacted:PermissionGrantToken>")
})

test("PermissionApproval workflow fails with PermissionDenied when user denies", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  const capability = {
    kind: "network.connect" as const,
    hosts: ["example.com"],
    askUnknownHosts: false,
    audit: "on-deny" as const
  }
  const actor = { kind: "app" as const, id: "test-app" }
  const traceId = "trace-deny-1"

  let capturedToken: string | undefined

  const layer = makePermissionApprovalWorkflowLayer({
    registry,
    notify: (token, _traceId) =>
      Effect.sync(() => {
        capturedToken = token
      })
  })

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        PermissionApprovalWorkflow.execute({ traceId, capability, actor }).pipe(
          Effect.provide(layer)
        )
      )
      const token = yield* waitForToken(() => capturedToken)
      yield* resolveApprovalDeferred(token, false)
      return yield* Effect.exit(Fiber.join(fiber))
    }).pipe(provideEngine)
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

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    })
})

const waitForToken = (read: () => string | undefined): Effect.Effect<string, never, never> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const token = read()
      if (token !== undefined) {
        return token
      }
      yield* Effect.sleep("1 millis")
    }
    expect(read()).toBeDefined()
    return read()!
  })

test("resolveApprovalDeferred constructs an Effect for the branded token", () => {
  const effect = resolveApprovalDeferred("workflow-token-example", true)
  expect(effect).toBeDefined()
})

test("PermissionApproval workflow records a grant with ttl when ttlMs provided", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  const capability = {
    kind: "secrets.read" as const,
    namespaces: ["vault"],
    audit: "always" as const
  }
  const actor = { kind: "app" as const, id: "test-app" }
  const traceId = "trace-ttl-1"
  const ttlMs = 50

  let capturedToken: string | undefined

  const layer = makePermissionApprovalWorkflowLayer({
    registry,
    notify: (token, _traceId) =>
      Effect.sync(() => {
        capturedToken = token
      })
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        PermissionApprovalWorkflow.execute({ traceId, capability, actor, ttlMs }).pipe(
          Effect.provide(layer)
        )
      )
      const token = yield* waitForToken(() => capturedToken)
      yield* resolveApprovalDeferred(token, true)
      return yield* Fiber.join(fiber)
    }).pipe(provideEngine)
  )

  expect(result).toBeInstanceOf(Grant)
  expect(result.expiresAt).toBeDefined()
  expect(result.expiresAt! - result.grantedAt).toBe(ttlMs)
})

test("PermissionApproval workflow reports registry declaration failures as typed workflow errors", async () => {
  const baseRegistry = await Effect.runPromise(makePermissionRegistry())
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

  const exit = await Effect.runPromise(
    Effect.exit(
      PermissionApprovalWorkflow.execute({
        traceId: "trace-invalid-capability",
        capability: { kind: "filesystem.read", roots: [], audit: "on-deny" },
        actor
      }).pipe(Effect.provide(makePermissionApprovalWorkflowLayer({ registry })), provideEngine)
    )
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
