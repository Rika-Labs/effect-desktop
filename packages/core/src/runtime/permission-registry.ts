import { randomUUID } from "node:crypto"

import { Context, Data, Deferred, Effect, Option, PubSub, Ref, Schema, Stream } from "effect"

import { emitAuditEvent, permissionAuditEvent } from "./audit-events.js"
import type { EventLogError, EventLogStore } from "./event-log.js"

const NonEmptyString = Schema.NonEmptyString
const PermissionMetadataText = Schema.NonEmptyString.check(
  // eslint-disable-next-line no-control-regex
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)
const AuditPolicy = Schema.Literals(["always", "on-deny", "never"])
export type AuditPolicy = typeof AuditPolicy.Type
const CapabilityKind = Schema.Literals([
  "filesystem.read",
  "filesystem.write",
  "filesystem.delete",
  "process.spawn",
  "pty.spawn",
  "network.connect",
  "secrets.read",
  "secrets.write",
  "safeStorage.read",
  "safeStorage.write",
  "native.invoke"
])
export type CapabilityKind = typeof CapabilityKind.Type
const PermissionEffect = Schema.Literals([
  "allow",
  "deny",
  "approval",
  "approval-denied",
  "revoked",
  "expired",
  "consumed"
])
export type PermissionEffect = typeof PermissionEffect.Type
const ActorKind = Schema.Literals(["app", "window", "resource", "worker", "process"])
export type ActorKind = typeof ActorKind.Type

const FilesystemCapability = Schema.Struct({
  kind: Schema.Literals(["filesystem.read", "filesystem.write", "filesystem.delete"]),
  roots: Schema.Array(NonEmptyString),
  deny: Schema.optionalKey(Schema.Array(NonEmptyString)),
  audit: AuditPolicy,
  allowCreate: Schema.optionalKey(Schema.Boolean),
  allowOverwrite: Schema.optionalKey(Schema.Boolean)
})

const ProcessCapability = Schema.Struct({
  kind: Schema.Literals(["process.spawn", "pty.spawn"]),
  commands: Schema.Array(NonEmptyString),
  cwd: Schema.optionalKey(Schema.Array(NonEmptyString)),
  environment: Schema.Literals(["none", "allowlist"]),
  shell: Schema.Union([Schema.Literal(false), Schema.Literal("requires-explicit-approval")]),
  audit: Schema.Literals(["always", "on-deny"])
})

const NetworkCapability = Schema.Struct({
  kind: Schema.Literal("network.connect"),
  hosts: Schema.Array(NonEmptyString),
  askUnknownHosts: Schema.Boolean,
  audit: AuditPolicy
})

const SecretsCapability = Schema.Struct({
  kind: Schema.Literals(["secrets.read", "secrets.write", "safeStorage.read", "safeStorage.write"]),
  namespaces: Schema.Array(NonEmptyString),
  audit: Schema.Literals(["always", "on-deny"])
})

const NativeInvokeCapability = Schema.Struct({
  kind: Schema.Literal("native.invoke"),
  primitive: NonEmptyString,
  methods: Schema.Array(NonEmptyString),
  audit: AuditPolicy
})

export const NormalizedCapability = Schema.Union([
  FilesystemCapability,
  ProcessCapability,
  NetworkCapability,
  SecretsCapability,
  NativeInvokeCapability
])
export type NormalizedCapability = typeof NormalizedCapability.Type

export class PermissionActor extends Schema.Class<PermissionActor>("PermissionActor")({
  kind: ActorKind,
  id: NonEmptyString
}) {}

export class PermissionContext extends Schema.Class<PermissionContext>("PermissionContext")({
  actor: PermissionActor,
  resource: Schema.optionalKey(Schema.String),
  traceId: Schema.optionalKey(PermissionMetadataText)
}) {}

export class PermissionDeclaration extends Schema.Class<PermissionDeclaration>(
  "PermissionDeclaration"
)({
  capability: NormalizedCapability,
  effect: PermissionEffect,
  actor: Schema.optionalKey(PermissionActor),
  source: Schema.optionalKey(Schema.String)
}) {}

export class PermissionQuery extends Schema.Class<PermissionQuery>("PermissionQuery")({
  kind: CapabilityKind,
  actor: PermissionActor
}) {}

export class PermissionRule extends Schema.Class<PermissionRule>("PermissionRule")({
  capability: NormalizedCapability,
  effect: PermissionEffect,
  actor: Schema.optionalKey(PermissionActor),
  source: Schema.String
}) {}

export class GrantedCapability extends Schema.Class<GrantedCapability>("GrantedCapability")({
  token: NonEmptyString,
  capability: NormalizedCapability,
  actor: PermissionActor,
  resource: Schema.optionalKey(Schema.String),
  source: Schema.String,
  traceId: PermissionMetadataText,
  grantedAt: Schema.Number,
  expiresAt: Schema.optionalKey(Schema.Number),
  oneTime: Schema.optionalKey(Schema.Boolean)
}) {}

export class PermissionDecision extends Schema.Class<PermissionDecision>("PermissionDecision")({
  outcome: Schema.Literals(["granted", "denied"]),
  reason: Schema.optionalKey(
    Schema.Literals([
      "explicit-deny",
      "approval-denied",
      "revoked",
      "expired",
      "consumed",
      "default-deny"
    ])
  ),
  source: Schema.String,
  capability: NormalizedCapability,
  actor: PermissionActor,
  resource: Schema.optionalKey(Schema.String),
  traceId: PermissionMetadataText
}) {}

const GrantStatus = Schema.Literals(["active", "revoked", "expired", "consumed"])
export type GrantStatus = typeof GrantStatus.Type

export class PermissionGrantSnapshot extends Schema.Class<PermissionGrantSnapshot>(
  "PermissionGrantSnapshot"
)({
  grant: GrantedCapability,
  status: GrantStatus,
  updatedAt: Schema.Number
}) {}

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
  readonly cause: EventLogError
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
  readonly audit?: EventLogStore
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
    context: PermissionContext,
    options?: PermissionGrantOptions
  ) => Effect.Effect<GrantedCapability, PermissionRegistryError, never>
  readonly grant: (
    capability: NormalizedCapability,
    context: PermissionContext,
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
    const now = options.now ?? Date.now

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

          const granted = yield* issueGrant(
            grants,
            options.audit,
            nextToken,
            now,
            decodedCapability,
            decodedContext,
            id,
            { ...grantOptions, source: grantOptions.source ?? resolved.source }
          )
          const decision = new PermissionDecision({
            outcome: "granted",
            source: resolved.source,
            capability: decodedCapability,
            actor: decodedContext.actor,
            ...(decodedContext.resource === undefined ? {} : { resource: decodedContext.resource }),
            traceId: id
          })
          yield* auditDecision(options.audit, decision)
          yield* recordPermissionDecision(decisionRows, decisions, decision)
          return granted
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
          return yield* issueGrant(
            grants,
            options.audit,
            nextToken,
            now,
            decodedCapability,
            decodedContext,
            id,
            { ...grantOptions, source: grantOptions.source ?? "grant" }
          )
        }).pipe(
          Effect.withSpan("PermissionRegistry.grant", {
            attributes: { kind: capability.kind }
          })
        ),
      revoke: (token) =>
        transitionGrant(grants, options.audit, token, "revoked", now()).pipe(
          Effect.withSpan("PermissionRegistry.revoke")
        ),
      inspect: (token) =>
        inspectGrant(grants, options.audit, token, now()).pipe(
          Effect.withSpan("PermissionRegistry.inspect")
        ),
      use: (grant, effect) =>
        Effect.gen(function* () {
          const prepared = yield* prepareGrantUse(grants, options.audit, grant.token, now())
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
            attributes: { token: grant.token, kind: grant.capability.kind }
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

const capabilityCovers = (
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
        requested.commands.every((command) => declared.commands.includes(command))
      )
    case "network.connect":
      return (
        declared.kind === requested.kind &&
        requested.hosts.every((host) => declared.hosts.includes(host))
      )
    case "secrets.read":
    case "secrets.write":
    case "safeStorage.read":
    case "safeStorage.write":
      return (
        declared.kind === requested.kind &&
        requested.namespaces.every((namespace) => declared.namespaces.includes(namespace))
      )
    case "native.invoke":
      return (
        declared.kind === requested.kind &&
        declared.primitive === requested.primitive &&
        requested.methods.every((method) => declared.methods.includes(method))
      )
  }
}

const rootCovers = (declaredRoot: string, requestedRoot: string): boolean => {
  const prefix = declaredRoot.endsWith("/") ? declaredRoot : `${declaredRoot}/`
  return requestedRoot === declaredRoot || requestedRoot.startsWith(prefix)
}

const issueGrant = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  audit: EventLogStore | undefined,
  nextToken: () => string,
  now: () => number,
  capability: NormalizedCapability,
  context: PermissionContext,
  traceId: string,
  options: PermissionGrantOptions
): Effect.Effect<GrantedCapability, PermissionRegistryError, never> =>
  Effect.gen(function* () {
    const grantedAt = now()
    const grant = new GrantedCapability({
      token: nextToken(),
      capability,
      actor: context.actor,
      ...(context.resource === undefined ? {} : { resource: context.resource }),
      source: options.source ?? "grant",
      traceId,
      grantedAt,
      ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
      ...(options.oneTime === undefined ? {} : { oneTime: options.oneTime })
    })
    const tracked: TrackedGrant = {
      grant,
      status: grant.expiresAt !== undefined && grant.expiresAt <= grantedAt ? "expired" : "active",
      updatedAt: grantedAt,
      waiters: []
    }

    yield* auditLifecycle(audit, "grant", tracked)
    if (tracked.status === "expired") {
      yield* auditLifecycle(audit, "expire", tracked)
    }
    yield* Ref.update(grants, (current) => withTracked(current, tracked))
    return grant
  })

const inspectGrant = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  audit: EventLogStore | undefined,
  token: string,
  now: number
): Effect.Effect<PermissionGrantSnapshot, PermissionRegistryError, never> =>
  Effect.gen(function* () {
    const active = yield* expireIfNeeded(grants, audit, token, now)
    return snapshot(active)
  })

const prepareGrantUse = (
  grants: Ref.Ref<ReadonlyMap<string, TrackedGrant>>,
  audit: EventLogStore | undefined,
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
  audit: EventLogStore | undefined,
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
  audit: EventLogStore | undefined,
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
  audit: EventLogStore | undefined,
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
        token: tracked.grant.token,
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
  audit: EventLogStore | undefined,
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
    ? Schema.decodeUnknownEffect(PermissionMetadataText)(fallback()).pipe(
        Effect.mapError((cause) => invalidArgument(operation, "traceId", cause))
      )
    : Effect.succeed(contextTraceId)

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
