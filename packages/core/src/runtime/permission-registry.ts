import { randomUUID } from "node:crypto"

import { Clock, Context, Data, Deferred, Effect, Option, PubSub, Ref, Schema, Stream } from "effect"

import { makeSecretString } from "@effect-desktop/bridge"

import { emitAuditEvent, permissionAuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  ActorKind as ActorKindSchema,
  AuditPolicy as AuditPolicySchema,
  CapabilityKind as CapabilityKindSchema,
  GrantedCapability,
  NormalizedCapability,
  PermissionActor,
  PermissionContext,
  PermissionDeclaration,
  PermissionDecision,
  PermissionEffect as PermissionEffectSchema,
  PermissionGrantSnapshot,
  PermissionMetadataText,
  PermissionQuery,
  PermissionRule,
  PermissionTimestamp,
  type GrantStatus
} from "./permission-contracts.js"

const ActorKind = ActorKindSchema
const AuditPolicy = AuditPolicySchema
const CapabilityKind = CapabilityKindSchema
const PermissionEffect = PermissionEffectSchema

export {
  GrantedCapability,
  NormalizedCapability,
  PermissionActor,
  PermissionContext,
  PermissionDeclaration,
  PermissionDecision,
  PermissionGrantSnapshot,
  PermissionQuery,
  PermissionRule
} from "./permission-contracts.js"
export type ActorKind = typeof ActorKind.Type
export type AuditPolicy = typeof AuditPolicy.Type
export type CapabilityKind = typeof CapabilityKind.Type
export type PermissionEffect = typeof PermissionEffect.Type
export type { GrantStatus } from "./permission-contracts.js"

export class PermissionInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class PermissionDeniedError extends Data.TaggedError("PermissionDenied")<{
  readonly operation: string
  readonly reason:
    | "explicit-deny"
    | "approval-denied"
    | "revoked"
    | "expired"
    | "consumed"
    | "default-deny"
  readonly capability: NormalizedCapability
  readonly actor: PermissionActor
  readonly resource: Option.Option<string>
  readonly traceId: string
}> {}

export class PermissionAuditFailedError extends Data.TaggedError("PermissionAuditFailed")<{
  readonly operation: string
  readonly decision: PermissionDecision
  readonly cause: unknown
}> {}

export class PermissionGrantNotFoundError extends Data.TaggedError("PermissionGrantNotFound")<{
  readonly operation: string
  readonly token: string
}> {}

export class PermissionRevokedError extends Data.TaggedError("PermissionRevoked")<{
  readonly operation: string
  readonly reason: "revoked" | "expired" | "consumed"
  readonly token: string
  readonly capability: NormalizedCapability
  readonly actor: PermissionActor
  readonly traceId: string
  readonly revokedAt: number
}> {}

export type PermissionRegistryError =
  | PermissionInvalidArgumentError
  | PermissionDeniedError
  | PermissionAuditFailedError
  | PermissionGrantNotFoundError
  | PermissionRevokedError

export interface PermissionRegistryOptions {
  readonly audit?: AuditEventsApi
  readonly traceId?: () => string
  readonly nextToken?: () => string
  readonly now?: () => number
}

export interface PermissionGrantOptions {
  readonly expiresAt?: number
  readonly oneTime?: boolean
  readonly source?: string
}

export interface PermissionRegistryApi {
  readonly declare: (
    capability: NormalizedCapability,
    options?: {
      readonly effect?: PermissionEffect
      readonly actor?: PermissionActor
      readonly source?: string
    }
  ) => Effect.Effect<PermissionRule, PermissionInvalidArgumentError, never>
  readonly query: (
    kind: CapabilityKind,
    actor: PermissionActor
  ) => Effect.Effect<readonly PermissionRule[], PermissionInvalidArgumentError, never>
  readonly check: (
    capability: NormalizedCapability,
    context: unknown,
    options?: PermissionGrantOptions
  ) => Effect.Effect<GrantedCapability, PermissionRegistryError, never>
  readonly grant: (
    capability: NormalizedCapability,
    context: unknown,
    options?: PermissionGrantOptions
  ) => Effect.Effect<GrantedCapability, PermissionRegistryError, never>
  readonly revoke: (
    token: string
  ) => Effect.Effect<PermissionGrantSnapshot, PermissionRegistryError, never>
  readonly inspect: (
    token: string
  ) => Effect.Effect<PermissionGrantSnapshot, PermissionRegistryError, never>
  readonly use: <A, E, R>(
    grant: GrantedCapability,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PermissionRegistryError, R>
  readonly listDecisions: () => Effect.Effect<readonly PermissionDecision[], never, never>
  readonly observeDecisions: () => Stream.Stream<PermissionDecision, never, never>
}

export const makePermissionRegistry = (
  options: PermissionRegistryOptions = {}
): Effect.Effect<PermissionRegistryApi, never, never> =>
  Effect.gen(function* () {
    const rules = yield* Ref.make<readonly PermissionRule[]>([])
    const grants = yield* Ref.make<ReadonlyMap<string, TrackedGrant>>(new Map())
    const decisionRows = yield* Ref.make<readonly PermissionDecision[]>([])
    const decisions = yield* PubSub.sliding<PermissionDecision>({ capacity: 1024, replay: 0 })
    const traceId = options.traceId ?? randomUUID
    const nextToken = options.nextToken ?? randomUUID
    const clock = yield* Clock.Clock
    const now = options.now ?? (() => clock.currentTimeMillisUnsafe())

    return Object.freeze({
      declare: (capability, declarationOptions = {}) =>
        Effect.gen(function* () {
          const decoded = yield* decodeDeclaration(
            {
              capability,
              effect: declarationOptions.effect ?? "allow",
              ...(declarationOptions.actor === undefined
                ? {}
                : { actor: declarationOptions.actor }),
              source: declarationOptions.source ?? "declaration"
            },
            "PermissionRegistry.declare"
          )
          const rule = new PermissionRule({
            capability: decoded.capability,
            effect: decoded.effect,
            ...(decoded.actor === undefined ? {} : { actor: decoded.actor }),
            source: decoded.source ?? "declaration"
          })
          yield* Ref.update(rules, (current) => [...current, rule])
          return rule
        }).pipe(Effect.withSpan("PermissionRegistry.declare")),
      query: (kind, actor) =>
        Effect.gen(function* () {
          const decoded = yield* decodeQuery({ kind, actor }, "PermissionRegistry.query")
          const current = yield* Ref.get(rules)
          return current.filter(
            (rule) =>
              rule.capability.kind === decoded.kind &&
              (rule.actor === undefined || sameActor(rule.actor, decoded.actor))
          )
        }).pipe(Effect.withSpan("PermissionRegistry.query", { attributes: { kind } })),
      check: (capability, context, grantOptions = {}) =>
        Effect.gen(function* () {
          const decodedCapability = yield* decodeCapability(
            capability,
            "PermissionRegistry.check",
            "capability"
          )
          const decodedContext = yield* decodeContext(context, "PermissionRegistry.check")
          const current = yield* Ref.get(rules)
          const resolved = resolve(current, decodedCapability, decodedContext)
          const id = yield* resolveTraceId(
            decodedContext.traceId,
            traceId,
            "PermissionRegistry.check"
          )

          if (resolved._tag === "Denied") {
            const decision = new PermissionDecision({
              outcome: "denied",
              reason: resolved.reason,
              source: resolved.source,
              capability: decodedCapability,
              actor: decodedContext.actor,
              ...(decodedContext.resource === undefined
                ? {}
                : { resource: decodedContext.resource }),
              traceId: id
            })
            yield* auditDecision(options.audit, decision)
            yield* recordPermissionDecision(decisionRows, decisions, decision)
            return yield* Effect.fail(
              new PermissionDeniedError({
                operation: "PermissionRegistry.check",
                reason: resolved.reason,
                capability: decodedCapability,
                actor: decodedContext.actor,
                resource:
                  decodedContext.resource === undefined
                    ? Option.none<string>()
                    : Option.some(decodedContext.resource),
                traceId: id
              })
            )
          }

          const grantSource = yield* decodeOptionalAttribution(
            grantOptions.source,
            "PermissionRegistry.check",
            "grantSource"
          )
          const tracked = yield* prepareGrant(
            nextToken,
            now,
            decodedCapability,
            decodedContext,
            id,
            "PermissionRegistry.check",
            { ...grantOptions, source: grantSource ?? resolved.source }
          )
          const decision = new PermissionDecision({
            outcome: "granted",
            source: resolved.source,
            capability: decodedCapability,
            actor: decodedContext.actor,
            ...(decodedContext.resource === undefined ? {} : { resource: decodedContext.resource }),
            traceId: id
          })
          yield* auditGrantLifecycle(options.audit, tracked)
          yield* auditDecision(options.audit, decision)
          yield* recordPermissionDecision(decisionRows, decisions, decision)
          yield* publishGrant(grants, tracked)
          return tracked.grant
        }).pipe(
          Effect.withSpan("PermissionRegistry.check", {
            attributes: { kind: capability.kind }
          })
        ),
      grant: (capability, context, grantOptions = {}) =>
        Effect.gen(function* () {
          const decodedCapability = yield* decodeCapability(
            capability,
            "PermissionRegistry.grant",
            "capability"
          )
          const decodedContext = yield* decodeContext(context, "PermissionRegistry.grant")
          const id = yield* resolveTraceId(
            decodedContext.traceId,
            traceId,
            "PermissionRegistry.grant"
          )
          const grantSource = yield* decodeOptionalAttribution(
            grantOptions.source,
            "PermissionRegistry.grant",
            "grantSource"
          )
          return yield* issueGrant(
            grants,
            options.audit,
            nextToken,
            now,
            decodedCapability,
            decodedContext,
            id,
            "PermissionRegistry.grant",
            { ...grantOptions, source: grantSource ?? "grant" }
          )
        }).pipe(
          Effect.withSpan("PermissionRegistry.grant", {
            attributes: { kind: capability.kind }
          })
        ),
      revoke: (token) =>
        Effect.gen(function* () {
          const updatedAt = yield* resolveClockTimestamp("PermissionRegistry.revoke", now())
          return yield* transitionGrant(grants, options.audit, token, "revoked", updatedAt)
        }).pipe(Effect.withSpan("PermissionRegistry.revoke")),
      inspect: (token) =>
        Effect.gen(function* () {
          const inspectedAt = yield* resolveClockTimestamp("PermissionRegistry.inspect", now())
          return yield* inspectGrant(grants, options.audit, token, inspectedAt)
        }).pipe(Effect.withSpan("PermissionRegistry.inspect")),
      use: (grant, effect) =>
        Effect.gen(function* () {
          const usedAt = yield* resolveClockTimestamp("PermissionRegistry.use", now())
          const prepared = yield* prepareGrantUse(grants, options.audit, grant.token, usedAt)
          if (!prepared.track) {
            return yield* effect
          }
          const signal = yield* Deferred.make<PermissionRevokedError>()
          yield* Ref.update(grants, (current) => addWaiter(current, prepared.grant.token, signal))
          const revoke = Deferred.await(signal).pipe(Effect.flatMap((error) => Effect.fail(error)))
          return yield* Effect.raceFirst(effect, revoke).pipe(
            Effect.ensuring(
              Ref.update(grants, (current) => removeWaiter(current, prepared.grant.token, signal))
            )
          )
        }).pipe(
          Effect.withSpan("PermissionRegistry.use", {
            attributes: { token: redactedAuditToken(grant.token), kind: grant.capability.kind }
          })
        ),
      listDecisions: () => Ref.get(decisionRows),
      observeDecisions: () => Stream.fromPubSub(decisions)
    } satisfies PermissionRegistryApi)
  })

export class PermissionRegistry extends Context.Service<
  PermissionRegistry,
  PermissionRegistryApi
>()("PermissionRegistry", {
  make: makePermissionRegistry()
}) {}

type Resolved =
  | { readonly _tag: "Granted"; readonly source: string }
  | {
      readonly _tag: "Denied"
      readonly reason: PermissionDeniedError["reason"]
      readonly source: string
    }

interface TrackedGrant {
  readonly grant: GrantedCapability
  readonly status: GrantStatus
  readonly updatedAt: number
  readonly waiters: readonly Deferred.Deferred<PermissionRevokedError>[]
}

const resolve = (
  rules: readonly PermissionRule[],
  requested: NormalizedCapability,
  context: PermissionContext
): Resolved => {
  const matching = rules.filter(
    (rule) =>
      (rule.actor === undefined || sameActor(rule.actor, context.actor)) &&
      capabilityCovers(rule.capability, requested)
  )
  const deny = matching.find((rule) => rule.effect === "deny")
  if (deny !== undefined) {
    return { _tag: "Denied", reason: "explicit-deny", source: deny.source }
  }

  const revoked = matching.find(
    (rule) => rule.effect === "revoked" || rule.effect === "expired" || rule.effect === "consumed"
  )
  if (revoked !== undefined) {
    return { _tag: "Denied", reason: revocationReason(revoked.effect), source: revoked.source }
  }

  const approvalDenied = matching.find((rule) => rule.effect === "approval-denied")
  if (approvalDenied !== undefined) {
    return { _tag: "Denied", reason: "approval-denied", source: approvalDenied.source }
  }

  const approval = matching.find((rule) => rule.effect === "approval")
  if (approval !== undefined) {
    return { _tag: "Granted", source: approval.source }
  }

  const allow = matching.find((rule) => rule.effect === "allow")
  return allow === undefined
    ? { _tag: "Denied", reason: "default-deny", source: "default-deny" }
    : { _tag: "Granted", source: allow.source }
}

const revocationReason = (effect: PermissionEffect): "revoked" | "expired" | "consumed" => {
  switch (effect) {
    case "revoked":
    case "expired":
    case "consumed":
      return effect
    case "allow":
    case "deny":
    case "approval":
    case "approval-denied":
      return "revoked"
  }
}

export const capabilityCovers = (
  declared: NormalizedCapability,
  requested: NormalizedCapability
): boolean => {
  if (declared.kind !== requested.kind) {
    return false
  }
  switch (requested.kind) {
    case "filesystem.read":
    case "filesystem.write":
    case "filesystem.delete":
    case "sqlite.open":
      return (
        declared.kind === requested.kind &&
        requested.roots.every((root) =>
          declared.roots.some((declaredRoot) => rootCovers(declaredRoot, root))
        ) &&
        requested.roots.every(
          (root) => !(declared.deny ?? []).some((deniedRoot) => rootCovers(deniedRoot, root))
        )
      )
    case "process.spawn":
    case "pty.spawn":
      return (
        declared.kind === requested.kind &&
        requested.commands.every((command) => declared.commands.includes(command)) &&
        (requested.cwd ?? []).every((cwd) =>
          (declared.cwd ?? []).some((declaredCwd) => rootCovers(declaredCwd, cwd))
        ) &&
        environmentCovers(declared.environment, requested.environment) &&
        declared.shell === requested.shell &&
        declared.audit === requested.audit
      )
    case "network.connect":
      return (
        declared.kind === requested.kind &&
        declared.askUnknownHosts === requested.askUnknownHosts &&
        requested.hosts.every((host) => declared.hosts.includes(host))
      )
    case "secrets.read":
    case "secrets.write":
    case "safeStorage.read":
    case "safeStorage.write":
      return (
        declared.kind === requested.kind &&
        declared.audit === requested.audit &&
        requested.namespaces.every((namespace) => declared.namespaces.includes(namespace))
      )
    case "native.invoke":
      return (
        declared.kind === requested.kind &&
        declared.primitive === requested.primitive &&
        declared.audit === requested.audit &&
        requested.methods.every((method) => declared.methods.includes(method))
      )
  }
}

const environmentCovers = (
  declared: "none" | "allowlist",
  requested: "none" | "allowlist"
): boolean => declared === "allowlist" || requested === "none"

const rootCovers = (declaredRoot: string, requestedRoot: string): boolean => {
  const declared = normalizeRootPath(declaredRoot)
  const requested = normalizeRootPath(requestedRoot)
  const prefix = declared.endsWith("/") ? declared : `${declared}/`
  return requested === declared || requested.startsWith(prefix)
}

const normalizeRootPath = (path: string): string => path.replaceAll("\\", "/")

const issueGrant = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  audit: AuditEventsApi | undefined,
  nextToken: () => string,
  now: () => number,
  capability: NormalizedCapability,
  context: PermissionContext,
  traceId: string,
  operation: string,
  options: PermissionGrantOptions
): Effect.Effect<GrantedCapability, PermissionRegistryError, never> =>
  Effect.gen(function* () {
    const tracked = yield* prepareGrant(
      nextToken,
      now,
      capability,
      context,
      traceId,
      operation,
      options
    )
    yield* auditGrantLifecycle(audit, tracked)
    yield* publishGrant(grants, tracked)
    return tracked.grant
  })

const prepareGrant = (
  nextToken: () => string,
  now: () => number,
  capability: NormalizedCapability,
  context: PermissionContext,
  traceId: string,
  operation: string,
  options: PermissionGrantOptions
): Effect.Effect<TrackedGrant, PermissionRegistryError, never> =>
  Effect.gen(function* () {
    const token = yield* resolveGeneratedIdentifier(operation, "token", nextToken())
    const grantedAt = yield* resolveClockTimestamp(operation, now())
    const grant = new GrantedCapability({
      token,
      capability,
      actor: context.actor,
      ...(context.resource === undefined ? {} : { resource: context.resource }),
      source: options.source ?? "grant",
      traceId,
      grantedAt,
      ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
      ...(options.oneTime === undefined ? {} : { oneTime: options.oneTime })
    })

    return {
      grant,
      status: grant.expiresAt !== undefined && grant.expiresAt <= grantedAt ? "expired" : "active",
      updatedAt: grantedAt,
      waiters: []
    }
  })

const auditGrantLifecycle = (
  audit: AuditEventsApi | undefined,
  tracked: TrackedGrant
): Effect.Effect<void, PermissionRegistryError, never> =>
  Effect.gen(function* () {
    yield* auditLifecycle(audit, "grant", tracked)
    if (tracked.status === "expired") {
      yield* auditLifecycle(audit, "expire", tracked)
    }
  })

const publishGrant = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  tracked: TrackedGrant
): Effect.Effect<void, never, never> =>
  Ref.update(grants, (current) => withTracked(current, tracked))

const inspectGrant = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  audit: AuditEventsApi | undefined,
  token: string,
  now: number
): Effect.Effect<PermissionGrantSnapshot, PermissionRegistryError, never> =>
  Effect.gen(function* () {
    const active = yield* expireIfNeeded(grants, audit, token, now)
    return snapshot(active)
  })

const prepareGrantUse = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  audit: AuditEventsApi | undefined,
  token: string,
  now: number
): Effect.Effect<
  { readonly grant: GrantedCapability; readonly track: boolean },
  PermissionRegistryError,
  never
> =>
  Effect.gen(function* () {
    const active = yield* expireIfNeeded(grants, audit, token, now)
    if (active.status === "active") {
      if (active.grant.oneTime === true) {
        const consumed = yield* transitionGrant(grants, audit, token, "consumed", now)
        yield* auditLifecycle(audit, "use", active)
        return { grant: consumed.grant, track: false }
      }
      yield* auditLifecycle(audit, "use", active)
      return { grant: active.grant, track: true }
    }

    return yield* Effect.fail(revokedError("PermissionRegistry.use", snapshot(active)))
  })

const expireIfNeeded = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  audit: AuditEventsApi | undefined,
  token: string,
  now: number
): Effect.Effect<TrackedGrant, PermissionRegistryError, never> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(grants)
    const tracked = current.get(token)
    if (tracked === undefined) {
      return yield* Effect.fail(
        new PermissionGrantNotFoundError({ operation: "PermissionRegistry.inspect", token })
      )
    }
    if (tracked.status !== "active") {
      return tracked
    }
    if (tracked.grant.expiresAt === undefined || tracked.grant.expiresAt > now) {
      return tracked
    }
    yield* transitionGrant(grants, audit, token, "expired", now)
    const updated = yield* Ref.get(grants)
    const expired = updated.get(token)
    if (expired === undefined) {
      return yield* Effect.fail(
        new PermissionGrantNotFoundError({ operation: "PermissionRegistry.inspect", token })
      )
    }
    return expired
  })

const recordPermissionDecision = (
  rows: Ref.Ref<readonly PermissionDecision[]>,
  decisions: PubSub.PubSub<PermissionDecision>,
  decision: PermissionDecision
): Effect.Effect<void, never, never> =>
  Ref.update(rows, (current) => [...current, decision].slice(-1_024)).pipe(
    Effect.andThen(PubSub.publish(decisions, decision)),
    Effect.asVoid
  )

const transitionGrant = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  audit: AuditEventsApi | undefined,
  token: string,
  status: Exclude<GrantStatus, "active">,
  updatedAt: number
): Effect.Effect<PermissionGrantSnapshot, PermissionRegistryError, never> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(grants)
    const found = current.get(token)
    if (found === undefined) {
      return yield* Effect.fail(
        new PermissionGrantNotFoundError({
          operation: "PermissionRegistry.revoke",
          token
        })
      )
    }
    if (found.status !== "active") {
      return snapshot(found)
    }
    const tracked: TrackedGrant = { ...found, status, updatedAt }
    yield* Ref.set(grants, withTracked(current, tracked))
    yield* Effect.forEach(tracked.waiters, (waiter) =>
      Deferred.succeed(waiter, revokedError("PermissionRegistry.revoke", snapshot(tracked)))
    )
    yield* auditLifecycle(audit, lifecycleTransition(status), tracked)
    return snapshot(tracked)
  })

const withTracked = (
  current: ReadonlyMap<string, TrackedGrant>,
  tracked: TrackedGrant
): ReadonlyMap<string, TrackedGrant> => {
  const next = new Map(current)
  next.set(tracked.grant.token, tracked)
  return next
}

const addWaiter = (
  current: ReadonlyMap<string, TrackedGrant>,
  token: string,
  waiter: Deferred.Deferred<PermissionRevokedError>
): ReadonlyMap<string, TrackedGrant> => {
  const tracked = current.get(token)
  if (tracked === undefined) {
    return current
  }
  return withTracked(current, { ...tracked, waiters: [...tracked.waiters, waiter] })
}

const removeWaiter = (
  current: ReadonlyMap<string, TrackedGrant>,
  token: string,
  waiter: Deferred.Deferred<PermissionRevokedError>
): ReadonlyMap<string, TrackedGrant> => {
  const tracked = current.get(token)
  if (tracked === undefined) {
    return current
  }
  return withTracked(current, {
    ...tracked,
    waiters: tracked.waiters.filter((currentWaiter) => currentWaiter !== waiter)
  })
}

const snapshot = (tracked: TrackedGrant): PermissionGrantSnapshot =>
  new PermissionGrantSnapshot({
    grant: tracked.grant,
    status: tracked.status,
    updatedAt: tracked.updatedAt
  })

const revokedError = (
  operation: string,
  current: PermissionGrantSnapshot
): PermissionRevokedError =>
  new PermissionRevokedError({
    operation,
    reason: current.status === "active" ? "revoked" : current.status,
    token: current.grant.token,
    capability: current.grant.capability,
    actor: current.grant.actor,
    traceId: current.grant.traceId,
    revokedAt: current.updatedAt
  })

const auditLifecycle = (
  audit: AuditEventsApi | undefined,
  transition: "grant" | "use" | "revoke" | "expire" | "consumed",
  tracked: TrackedGrant
): Effect.Effect<void, PermissionAuditFailedError, never> =>
  emitAuditEvent(
    audit,
    permissionAuditEvent({
      kind: permissionLifecycleKind(transition),
      source: tracked.grant.source,
      traceId: tracked.grant.traceId,
      outcome: tracked.status,
      normalizedCapability: tracked.grant.capability,
      actor: tracked.grant.actor,
      ...(tracked.grant.resource === undefined ? {} : { resource: tracked.grant.resource }),
      timestamp: tracked.updatedAt,
      details: {
        transition,
        token: grantAuditToken(tracked.grant.token),
        grantedAt: tracked.grant.grantedAt,
        ...(tracked.grant.expiresAt === undefined ? {} : { expiresAt: tracked.grant.expiresAt }),
        ...(tracked.grant.oneTime === undefined ? {} : { oneTime: tracked.grant.oneTime })
      }
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new PermissionAuditFailedError({
          operation: "PermissionRegistry.lifecycle",
          decision: new PermissionDecision({
            outcome: tracked.status === "active" ? "granted" : "denied",
            ...(tracked.status === "active" ? {} : { reason: tracked.status }),
            source: tracked.grant.source,
            capability: tracked.grant.capability,
            actor: tracked.grant.actor,
            ...(tracked.grant.resource === undefined ? {} : { resource: tracked.grant.resource }),
            traceId: tracked.grant.traceId
          }),
          cause
        })
    )
  )

const grantAuditToken = (token: string) =>
  makeSecretString(token, { label: "PermissionGrantToken" })

const redactedAuditToken = (_token: string): string => "<redacted:PermissionGrantToken>"

const lifecycleTransition = (
  status: Exclude<GrantStatus, "active">
): "revoke" | "expire" | "consumed" => {
  switch (status) {
    case "revoked":
      return "revoke"
    case "expired":
      return "expire"
    case "consumed":
      return "consumed"
  }
}

const permissionLifecycleKind = (
  transition: "grant" | "use" | "revoke" | "expire" | "consumed"
):
  | "permission-granted"
  | "permission-used"
  | "permission-revoked"
  | "permission-expired"
  | "permission-consumed" => {
  switch (transition) {
    case "grant":
      return "permission-granted"
    case "use":
      return "permission-used"
    case "revoke":
      return "permission-revoked"
    case "expire":
      return "permission-expired"
    case "consumed":
      return "permission-consumed"
  }
}

const auditDecision = (
  audit: AuditEventsApi | undefined,
  decision: PermissionDecision
): Effect.Effect<void, PermissionAuditFailedError, never> =>
  emitAuditEvent(
    audit,
    permissionAuditEvent({
      kind: decision.outcome === "granted" ? "permission-granted" : "permission-denied",
      source: decision.source,
      traceId: decision.traceId,
      outcome: decision.outcome,
      normalizedCapability: decision.capability,
      actor: decision.actor,
      ...(decision.resource === undefined ? {} : { resource: decision.resource }),
      ...(decision.reason === undefined ? {} : { details: { reason: decision.reason } })
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new PermissionAuditFailedError({
          operation: "PermissionRegistry.check",
          decision,
          cause
        })
    )
  )

const decodeDeclaration = (
  input: unknown,
  operation: string
): Effect.Effect<PermissionDeclaration, PermissionInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PermissionDeclaration)(input).pipe(
    Effect.mapError((cause) => invalidArgument(operation, "declaration", cause))
  )

const decodeQuery = (
  input: unknown,
  operation: string
): Effect.Effect<PermissionQuery, PermissionInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PermissionQuery)(input).pipe(
    Effect.mapError((cause) => invalidArgument(operation, "query", cause))
  )

const decodeCapability = (
  input: unknown,
  operation: string,
  field: string
): Effect.Effect<NormalizedCapability, PermissionInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(NormalizedCapability)(input).pipe(
    Effect.mapError((cause) => invalidArgument(operation, field, cause))
  )

const decodeContext = (
  input: unknown,
  operation: string
): Effect.Effect<PermissionContext, PermissionInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PermissionContext)(input).pipe(
    Effect.mapError((cause) => invalidArgument(operation, "context", cause))
  )

const resolveTraceId = (
  contextTraceId: string | undefined,
  fallback: () => string,
  operation: string
): Effect.Effect<string, PermissionInvalidArgumentError, never> =>
  contextTraceId === undefined
    ? resolveGeneratedIdentifier(operation, "traceId", fallback())
    : Effect.succeed(contextTraceId)

const resolveGeneratedIdentifier = (
  operation: string,
  field: string,
  value: string
): Effect.Effect<string, PermissionInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PermissionMetadataText)(value).pipe(
    Effect.mapError((cause) => invalidArgument(operation, field, cause))
  )

const resolveClockTimestamp = (
  operation: string,
  value: number
): Effect.Effect<number, PermissionInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PermissionTimestamp)(value).pipe(
    Effect.mapError((cause) => invalidArgument(operation, "now", cause))
  )

const decodeOptionalAttribution = (
  value: string | undefined,
  operation: string,
  field: string
): Effect.Effect<string | undefined, PermissionInvalidArgumentError, never> =>
  value === undefined
    ? Effect.succeed(undefined)
    : Schema.decodeUnknownEffect(PermissionMetadataText)(value).pipe(
        Effect.mapError((cause) => invalidArgument(operation, field, cause))
      )

const invalidArgument = (
  operation: string,
  field: string,
  cause: unknown
): PermissionInvalidArgumentError =>
  new PermissionInvalidArgumentError({
    operation,
    field,
    message: formatUnknownError(cause),
    cause: Option.some(cause)
  })

const sameActor = (left: PermissionActor, right: PermissionActor): boolean =>
  left.kind === right.kind && left.id === right.id

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
