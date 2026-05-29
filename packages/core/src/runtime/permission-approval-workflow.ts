import { Clock, Effect, Exit, Schema } from "effect"
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from "effect/unstable/workflow"

import { makeSecretString } from "@orika/bridge"

import { approvalAuditEvent, emitAuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  NormalizedCapability,
  PermissionActor,
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

const ApprovalFailed = Schema.TaggedStruct("PermissionApprovalFailed", {
  traceId: Schema.NonEmptyString,
  phase: Schema.Union([
    Schema.Literal("declare"),
    Schema.Literal("audit"),
    Schema.Literal("grant"),
    Schema.Literal("revoke")
  ]),
  cause: Schema.String
})

const PermissionDenied = Schema.TaggedStruct("PermissionDenied", {
  traceId: Schema.NonEmptyString,
  reason: Schema.Literal("user-denied")
})

const GrantToken = Schema.Struct({
  token: Schema.NonEmptyString,
  grantedAt: Schema.Number,
  expiresAt: Schema.optionalKey(Schema.Number)
})

export const PermissionApprovalWorkflow = Workflow.make({
  name: "PermissionApproval",
  payload: {
    traceId: Schema.NonEmptyString,
    capability: NormalizedCapability,
    actor: PermissionActor,
    resource: Schema.optionalKey(Schema.NonEmptyString),
    ttlMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0)))
  },
  idempotencyKey: (p) => p.traceId,
  success: Grant,
  error: Schema.Union([PermissionDenied, ApprovalFailed])
})

export interface PermissionApprovalWorkflowOptions {
  readonly registry: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly now?: () => number
  readonly notify?: (token: string, traceId: string) => Effect.Effect<void, never, never>
}

export const makePermissionApprovalWorkflowLayer = (options: PermissionApprovalWorkflowOptions) =>
  PermissionApprovalWorkflow.toLayer((payload, _executionId) =>
    Effect.gen(function* () {
      const capability = payload.capability
      const actor = payload.actor

      yield* Activity.make({
        name: `declare:${payload.traceId}`,
        error: ApprovalFailed,
        execute: Effect.gen(function* () {
          yield* options.registry
            .declare(capability, {
              effect: "approval",
              actor,
              source: `approval:${payload.traceId}`
            })
            .pipe(Effect.mapError((cause) => approvalFailed(payload.traceId, "declare", cause)))

          yield* emitAuditEvent(
            options.audit,
            approvalAuditEvent({
              kind: "approval-requested",
              source: "PermissionApprovalWorkflow",
              traceId: payload.traceId,
              outcome: "requested",
              actor,
              ...(payload.resource === undefined ? {} : { resource: payload.resource }),
              details: { capability }
            })
          ).pipe(Effect.mapError((cause) => approvalFailed(payload.traceId, "audit", cause)))
        })
      })

      const token = yield* DurableDeferred.token(approvalPrompt)

      if (options.notify !== undefined) {
        yield* options.notify(token, payload.traceId)
      }

      const approved = yield* DurableDeferred.await(approvalPrompt)

      if (!approved) {
        yield* Activity.make({
          name: `deny:${payload.traceId}`,
          error: ApprovalFailed,
          execute: emitAuditEvent(
            options.audit,
            approvalAuditEvent({
              kind: "approval-denied",
              source: "PermissionApprovalWorkflow",
              traceId: payload.traceId,
              outcome: "denied",
              actor,
              ...(payload.resource === undefined ? {} : { resource: payload.resource })
            })
          ).pipe(Effect.mapError((cause) => approvalFailed(payload.traceId, "audit", cause)))
        })

        return yield* Effect.fail({
          _tag: "PermissionDenied" as const,
          traceId: payload.traceId,
          reason: "user-denied" as const
        })
      }

      const granted = yield* Activity.make({
        name: `grant:${payload.traceId}`,
        success: GrantToken,
        error: ApprovalFailed,
        execute: Effect.gen(function* () {
          const grantedAt = yield* currentTimeMillis(options.now)
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
            .pipe(Effect.mapError((cause) => approvalFailed(payload.traceId, "grant", cause)))

          yield* emitAuditEvent(
            options.audit,
            approvalAuditEvent({
              kind: "approval-granted",
              source: "PermissionApprovalWorkflow",
              traceId: payload.traceId,
              outcome: "granted",
              actor,
              ...(payload.resource === undefined ? {} : { resource: payload.resource }),
              details: { token: grantAuditToken(grant.token), grantedAt, expiresAt }
            })
          ).pipe(Effect.mapError((cause) => approvalFailed(payload.traceId, "audit", cause)))

          return {
            token: grant.token,
            grantedAt,
            ...(expiresAt !== undefined ? { expiresAt } : {})
          }
        })
      })

      return new Grant({
        traceId: payload.traceId,
        token: granted.token,
        grantedAt: granted.grantedAt,
        ...(granted.expiresAt !== undefined ? { expiresAt: granted.expiresAt } : {})
      })
    })
  )

const currentTimeMillis = (now: (() => number) | undefined): Effect.Effect<number, never, never> =>
  now === undefined ? Clock.currentTimeMillis : Effect.sync(now)

const grantAuditToken = (token: string) =>
  makeSecretString(token, { label: "PermissionGrantToken" })

const approvalFailed = (
  traceId: string,
  phase: "declare" | "audit" | "grant" | "revoke",
  cause: unknown
): {
  readonly _tag: "PermissionApprovalFailed"
  readonly traceId: string
  readonly phase: "declare" | "audit" | "grant" | "revoke"
  readonly cause: string
} => ({
  _tag: "PermissionApprovalFailed" as const,
  traceId,
  phase,
  cause: String(cause)
})

export type ApprovalWorkflowLayer = ReturnType<typeof makePermissionApprovalWorkflowLayer>

export const resolveApprovalDeferred = (
  rawToken: string,
  approved: boolean
): Effect.Effect<void, never, WorkflowEngine.WorkflowEngine> =>
  DurableDeferred.done(approvalPrompt, {
    token: DurableDeferred.Token.make(rawToken),
    exit: Exit.succeed(approved)
  })
