import { randomUUID } from "node:crypto"

import { Context, Data, Effect, Option, Ref, Schema } from "effect"

import type { EventLogError, EventLogStore } from "./event-log.js"

const NonEmptyString = Schema.NonEmptyString
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
  traceId: Schema.optionalKey(Schema.String)
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
  traceId: NonEmptyString
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
  traceId: NonEmptyString
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

export type PermissionRegistryError =
  | PermissionInvalidArgumentError
  | PermissionDeniedError
  | PermissionAuditFailedError

export interface PermissionRegistryOptions {
  readonly audit?: EventLogStore
  readonly traceId?: () => string
  readonly nextToken?: () => string
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
    context: PermissionContext
  ) => Effect.Effect<GrantedCapability, PermissionRegistryError, never>
}

export const makePermissionRegistry = (
  options: PermissionRegistryOptions = {}
): Effect.Effect<PermissionRegistryApi, never, never> =>
  Effect.gen(function* () {
    const rules = yield* Ref.make<readonly PermissionRule[]>([])
    const traceId = options.traceId ?? randomUUID
    const nextToken = options.nextToken ?? randomUUID

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
      check: (capability, context) =>
        Effect.gen(function* () {
          const decodedCapability = yield* decodeCapability(
            capability,
            "PermissionRegistry.check",
            "capability"
          )
          const decodedContext = yield* decodeContext(context, "PermissionRegistry.check")
          const current = yield* Ref.get(rules)
          const resolved = resolve(current, decodedCapability, decodedContext)
          const id = decodedContext.traceId ?? traceId()

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

          const granted = new GrantedCapability({
            token: nextToken(),
            capability: decodedCapability,
            actor: decodedContext.actor,
            ...(decodedContext.resource === undefined ? {} : { resource: decodedContext.resource }),
            source: resolved.source,
            traceId: id
          })
          yield* auditDecision(
            options.audit,
            new PermissionDecision({
              outcome: "granted",
              source: resolved.source,
              capability: decodedCapability,
              actor: decodedContext.actor,
              ...(decodedContext.resource === undefined
                ? {}
                : { resource: decodedContext.resource }),
              traceId: id
            })
          )
          return granted
        }).pipe(
          Effect.withSpan("PermissionRegistry.check", {
            attributes: { kind: capability.kind }
          })
        )
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

const auditDecision = (
  audit: EventLogStore | undefined,
  decision: PermissionDecision
): Effect.Effect<void, PermissionAuditFailedError, never> =>
  audit === undefined
    ? Effect.void
    : audit
        .append(
          {
            type: "permission decision",
            payload: {
              outcome: decision.outcome,
              ...(decision.reason === undefined ? {} : { reason: decision.reason }),
              source: decision.source,
              capability: decision.capability,
              actor: decision.actor,
              ...(decision.resource === undefined ? {} : { resource: decision.resource }),
              traceId: decision.traceId
            }
          },
          { source: "PermissionRegistry" }
        )
        .pipe(
          Effect.asVoid,
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
