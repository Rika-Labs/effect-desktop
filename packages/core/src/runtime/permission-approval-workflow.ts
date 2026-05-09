import { Effect, Exit, Schema } from "effect"
import { DurableClock, DurableDeferred, Workflow, WorkflowEngine } from "effect/unstable/workflow"

import { approvalAuditEvent, emitAuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  type NormalizedCapability,
  type PermissionActor,
  type PermissionRegistryApi
} from "./permission-registry.js"

export class Grant extends Schema.Class<Grant>("Grant")({
  traceId: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
  grantedAt: Schema.Number,
  expiresAt: Schema.optionalKey(Schema.Number)
}) {}

const approvalPrompt = DurableDeferred.make<typeof Schema.Boolean>("approval-prompt", {
  success: Schema.Boolean
})

export const PermissionApprovalWorkflow = Workflow.make({
  name: "PermissionApproval",
  payload: {
    traceId: Schema.NonEmptyString,
    capability: Schema.Unknown,
    actor: Schema.Unknown,
    resource: Schema.optionalKey(Schema.NonEmptyString),
    ttlMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0)))
  },
  idempotencyKey: (p) => p.traceId,
  success: Grant,
  error: Schema.TaggedStruct("PermissionDenied", {
    traceId: Schema.NonEmptyString,
    reason: Schema.Literal("user-denied")
  })
})

export interface PermissionApprovalWorkflowOptions {
  readonly registry: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly now?: () => number
  readonly notify?: (token: string, traceId: string) => Effect.Effect<void, never, never>
}

export const makePermissionApprovalWorkflowLayer = (options: PermissionApprovalWorkflowOptions) => {
  const now = options.now ?? Date.now

  return PermissionApprovalWorkflow.toLayer((payload, _executionId) =>
    Effect.gen(function* () {
      const capability = payload.capability as NormalizedCapability
      const actor = payload.actor as PermissionActor

      yield* options.registry
        .declare(capability, {
          effect: "approval",
          actor,
          source: `approval:${payload.traceId}`
        })
        .pipe(Effect.orDie)

      yield* emitAuditEvent(
        options.audit,
        approvalAuditEvent({
          kind: "approval-requested",
          source: "PermissionApprovalWorkflow",
          traceId: payload.traceId,
          outcome: "requested",
          actor: JSON.stringify(actor),
          ...(payload.resource === undefined ? {} : { resource: payload.resource }),
          details: { capability }
        })
      ).pipe(Effect.orDie)

      const token = yield* DurableDeferred.token(approvalPrompt)

      if (options.notify !== undefined) {
        yield* options.notify(token, payload.traceId)
      }

      const approved = yield* DurableDeferred.await(approvalPrompt)

      if (!approved) {
        yield* emitAuditEvent(
          options.audit,
          approvalAuditEvent({
            kind: "approval-denied",
            source: "PermissionApprovalWorkflow",
            traceId: payload.traceId,
            outcome: "denied",
            actor: JSON.stringify(actor),
            ...(payload.resource === undefined ? {} : { resource: payload.resource })
          })
        ).pipe(Effect.orDie)

        return yield* Effect.fail({
          _tag: "PermissionDenied" as const,
          traceId: payload.traceId,
          reason: "user-denied" as const
        })
      }

      const grantedAt = now()
      const expiresAt = payload.ttlMs !== undefined ? grantedAt + payload.ttlMs : undefined

      const grant = yield* options.registry
        .grant(
          capability,
          {
            actor,
            ...(payload.resource === undefined ? {} : { resource: payload.resource }),
            traceId: payload.traceId
          },
          {
            ...(expiresAt !== undefined ? { expiresAt } : {}),
            source: `approval:${payload.traceId}`
          }
        )
        .pipe(Effect.orDie)

      yield* emitAuditEvent(
        options.audit,
        approvalAuditEvent({
          kind: "approval-granted",
          source: "PermissionApprovalWorkflow",
          traceId: payload.traceId,
          outcome: "granted",
          actor: JSON.stringify(actor),
          ...(payload.resource === undefined ? {} : { resource: payload.resource }),
          details: { token: grant.token, grantedAt, expiresAt }
        })
      ).pipe(Effect.orDie)

      if (payload.ttlMs !== undefined && expiresAt !== undefined) {
        yield* DurableClock.sleep({
          name: `ttl:${payload.traceId}`,
          duration: `${payload.ttlMs} millis`
        })

        yield* options.registry.revoke(grant.token).pipe(Effect.ignore)

        yield* emitAuditEvent(
          options.audit,
          approvalAuditEvent({
            kind: "approval-denied",
            source: "PermissionApprovalWorkflow",
            traceId: payload.traceId,
            outcome: "expired",
            actor: JSON.stringify(actor),
            ...(payload.resource === undefined ? {} : { resource: payload.resource }),
            details: { token: grant.token, expiredAt: expiresAt }
          })
        ).pipe(Effect.orDie)
      }

      return new Grant({
        traceId: payload.traceId,
        token: grant.token,
        grantedAt,
        ...(expiresAt !== undefined ? { expiresAt } : {})
      })
    })
  )
}

export type ApprovalWorkflowLayer = ReturnType<typeof makePermissionApprovalWorkflowLayer>

export const resolveApprovalDeferred = (
  rawToken: string,
  approved: boolean
): Effect.Effect<void, never, WorkflowEngine.WorkflowEngine> =>
  DurableDeferred.done(approvalPrompt, {
    token: rawToken as DurableDeferred.Token,
    exit: Exit.succeed(approved)
  })
