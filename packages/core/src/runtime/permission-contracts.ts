import { Schema } from "effect"

const NonEmptyString = Schema.NonEmptyString

export const PermissionMetadataText = NonEmptyString.check(
  // eslint-disable-next-line no-control-regex
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)
const CapabilityPath = PermissionMetadataText.check(
  Schema.makeFilter(
    (value) => isSafeCapabilityPath(value) || "must be an absolute path without dot segments"
  )
)
export const AuditPolicy = Schema.Literals(["always", "on-deny", "never"])
export type AuditPolicy = typeof AuditPolicy.Type
export const PermissionTimestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const CapabilityKind = Schema.Literals([
  "filesystem.read",
  "filesystem.write",
  "filesystem.delete",
  "sqlite.open",
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
export const PermissionEffect = Schema.Literals([
  "allow",
  "deny",
  "approval",
  "approval-denied",
  "revoked",
  "expired",
  "consumed"
])
export type PermissionEffect = typeof PermissionEffect.Type
export const ActorKind = Schema.Literals(["app", "window", "resource", "worker", "process"])
export type ActorKind = typeof ActorKind.Type

export const PermissionActorPayload = Schema.Struct({
  kind: ActorKind,
  id: PermissionMetadataText
})

const FilesystemCapability = Schema.Struct({
  kind: Schema.Literals(["filesystem.read", "filesystem.write", "filesystem.delete"]),
  roots: Schema.Array(CapabilityPath),
  deny: Schema.optionalKey(Schema.Array(CapabilityPath)),
  audit: AuditPolicy,
  allowCreate: Schema.optionalKey(Schema.Boolean),
  allowOverwrite: Schema.optionalKey(Schema.Boolean)
})

const SqliteCapability = Schema.Struct({
  kind: Schema.Literal("sqlite.open"),
  roots: Schema.Array(CapabilityPath),
  deny: Schema.optionalKey(Schema.Array(CapabilityPath)),
  audit: AuditPolicy
})

const ProcessCapability = Schema.Struct({
  kind: Schema.Literals(["process.spawn", "pty.spawn"]),
  commands: Schema.Array(NonEmptyString),
  cwd: Schema.optionalKey(Schema.Array(CapabilityPath)),
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
  SqliteCapability,
  ProcessCapability,
  NetworkCapability,
  SecretsCapability,
  NativeInvokeCapability
])
export type NormalizedCapability = typeof NormalizedCapability.Type

export class PermissionActor extends Schema.Class<PermissionActor>("PermissionActor")({
  kind: ActorKind,
  id: PermissionMetadataText
}) {}

export class PermissionContext extends Schema.Class<PermissionContext>("PermissionContext")({
  actor: PermissionActor,
  resource: Schema.optionalKey(PermissionMetadataText),
  traceId: Schema.optionalKey(PermissionMetadataText)
}) {}

export class PermissionDeclaration extends Schema.Class<PermissionDeclaration>(
  "PermissionDeclaration"
)({
  capability: NormalizedCapability,
  effect: PermissionEffect,
  actor: Schema.optionalKey(PermissionActor),
  source: Schema.optionalKey(PermissionMetadataText)
}) {}

export class PermissionQuery extends Schema.Class<PermissionQuery>("PermissionQuery")({
  kind: CapabilityKind,
  actor: PermissionActor
}) {}

export class PermissionRule extends Schema.Class<PermissionRule>("PermissionRule")({
  capability: NormalizedCapability,
  effect: PermissionEffect,
  actor: Schema.optionalKey(PermissionActor),
  source: PermissionMetadataText
}) {}

export class GrantedCapability extends Schema.Class<GrantedCapability>("GrantedCapability")({
  token: NonEmptyString,
  capability: NormalizedCapability,
  actor: PermissionActor,
  resource: Schema.optionalKey(PermissionMetadataText),
  source: PermissionMetadataText,
  traceId: PermissionMetadataText,
  grantedAt: PermissionTimestamp,
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
  source: PermissionMetadataText,
  capability: NormalizedCapability,
  actor: PermissionActor,
  resource: Schema.optionalKey(PermissionMetadataText),
  traceId: PermissionMetadataText
}) {}

const GrantStatus = Schema.Literals(["active", "revoked", "expired", "consumed"])
export type GrantStatus = typeof GrantStatus.Type

export class PermissionGrantSnapshot extends Schema.Class<PermissionGrantSnapshot>(
  "PermissionGrantSnapshot"
)({
  grant: GrantedCapability,
  status: GrantStatus,
  updatedAt: PermissionTimestamp
}) {}

const WindowsDriveAbsolutePathPattern = /^[A-Za-z]:[\\/]/u
const WindowsUncAbsolutePathPattern = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u

const isSafeCapabilityPath = (value: string): boolean => {
  if (value.startsWith("/")) {
    return !hasDotPathSegment(value, /\/+/u)
  }

  if (WindowsDriveAbsolutePathPattern.test(value) || WindowsUncAbsolutePathPattern.test(value)) {
    return !hasDotPathSegment(value, /[\\/]+/u)
  }

  return false
}

const hasDotPathSegment = (value: string, separator: RegExp): boolean =>
  value.split(separator).some((segment) => segment === "." || segment === "..")
