import { randomUUID } from "node:crypto"

import { Data, Effect, Layer, Option, Schema } from "effect"
import { Rpc, RpcMiddleware } from "effect/unstable/rpc"

import { rpcCapability, type RpcCapabilityMetadata } from "@effect-desktop/bridge"

import {
  capabilityCovers,
  NormalizedCapability,
  type NormalizedCapability as NormalizedCapabilityType,
  NormalizedCapability as NormalizedCapabilitySchema,
  PermissionActor,
  PermissionContext,
  PermissionAuditFailedError,
  PermissionDeniedError,
  PermissionGrantNotFoundError,
  PermissionInvalidArgumentError,
  PermissionRegistry,
  type PermissionRegistryError,
  PermissionRevokedError
} from "./permission-registry.js"

export class DesktopConfigError extends Data.TaggedError("DesktopConfigError")<{
  readonly reason: "undeclared-capability"
  readonly contract: string
  readonly capability: NormalizedCapabilityType
  readonly message: string
}> {}

const PermissionDeniedCapability = Schema.Union([
  NormalizedCapability,
  Schema.Struct({ kind: Schema.String })
])
type PermissionDeniedCapability = typeof PermissionDeniedCapability.Type
type NativeInvokeCapability = Extract<NormalizedCapabilityType, { readonly kind: "native.invoke" }>

const PermissionDeniedSchema = Schema.TaggedStruct("PermissionDenied", {
  reason: Schema.String,
  capability: PermissionDeniedCapability,
  actor: PermissionActor,
  traceId: Schema.String,
  message: Schema.String
})

export class PermissionDenied extends Data.TaggedError("PermissionDenied")<{
  readonly reason: string
  readonly capability: PermissionDeniedCapability
  readonly actor: PermissionActor
  readonly traceId: string
  readonly message: string
}> {}

export const P = Object.freeze({
  filesystemRead: (options: {
    readonly roots: readonly string[]
    readonly deny?: readonly string[]
    readonly allowCreate?: boolean
    readonly allowOverwrite?: boolean
  }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "filesystem.read" as const,
      roots: [...options.roots],
      audit: "always" as const,
      ...(options.deny === undefined ? {} : { deny: [...options.deny] }),
      ...(options.allowCreate === undefined ? {} : { allowCreate: options.allowCreate }),
      ...(options.allowOverwrite === undefined ? {} : { allowOverwrite: options.allowOverwrite })
    }),

  filesystemWrite: (options: {
    readonly roots: readonly string[]
    readonly deny?: readonly string[]
    readonly allowCreate?: boolean
    readonly allowOverwrite?: boolean
  }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "filesystem.write" as const,
      roots: [...options.roots],
      audit: "always" as const,
      ...(options.deny === undefined ? {} : { deny: [...options.deny] }),
      ...(options.allowCreate === undefined ? {} : { allowCreate: options.allowCreate }),
      ...(options.allowOverwrite === undefined ? {} : { allowOverwrite: options.allowOverwrite })
    }),

  filesystemDelete: (options: {
    readonly roots: readonly string[]
    readonly deny?: readonly string[]
  }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "filesystem.delete" as const,
      roots: [...options.roots],
      audit: "always" as const,
      ...(options.deny === undefined ? {} : { deny: [...options.deny] })
    }),

  processSpawn: (options: {
    readonly commands: readonly string[]
    readonly cwd?: readonly string[]
    readonly environment?: "none" | "allowlist"
  }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "process.spawn" as const,
      commands: [...options.commands],
      environment: options.environment ?? ("none" as const),
      shell: false as const,
      audit: "always" as const,
      ...(options.cwd === undefined ? {} : { cwd: [...options.cwd] })
    }),

  ptySpawn: (options: {
    readonly commands: readonly string[]
    readonly cwd?: readonly string[]
    readonly environment?: "none" | "allowlist"
  }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "pty.spawn" as const,
      commands: [...options.commands],
      environment: options.environment ?? ("none" as const),
      shell: false as const,
      audit: "always" as const,
      ...(options.cwd === undefined ? {} : { cwd: [...options.cwd] })
    }),

  networkConnect: (options: {
    readonly hosts: readonly string[]
    readonly askUnknownHosts?: boolean
  }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "network.connect" as const,
      hosts: [...options.hosts],
      askUnknownHosts: options.askUnknownHosts ?? false,
      audit: "always" as const
    }),

  secretsRead: (options: { readonly namespaces: readonly string[] }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "secrets.read" as const,
      namespaces: [...options.namespaces],
      audit: "always" as const
    }),

  secretsWrite: (options: { readonly namespaces: readonly string[] }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "secrets.write" as const,
      namespaces: [...options.namespaces],
      audit: "always" as const
    }),

  safeStorageRead: (options: {
    readonly namespaces: readonly string[]
  }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "safeStorage.read" as const,
      namespaces: [...options.namespaces],
      audit: "always" as const
    }),

  safeStorageWrite: (options: {
    readonly namespaces: readonly string[]
  }): NormalizedCapabilityType =>
    Object.freeze({
      kind: "safeStorage.write" as const,
      namespaces: [...options.namespaces],
      audit: "always" as const
    }),

  nativeInvoke: (options: {
    readonly primitive: string
    readonly methods: readonly string[]
  }): NativeInvokeCapability =>
    Object.freeze({
      kind: "native.invoke" as const,
      primitive: options.primitive,
      methods: [...options.methods],
      audit: "always" as const
    })
})

export interface PermissionInterceptorOptions {
  readonly nextTraceId?: () => string
  readonly actorId?: string
  readonly actorKind?: "app" | "window" | "resource" | "worker" | "process"
}

const ActorKind = Schema.Literals(["app", "window", "resource", "worker", "process"])
type ActorKind = typeof ActorKind.Type

export class PermissionInterceptor extends RpcMiddleware.Service<PermissionInterceptor>()<
  "PermissionInterceptor",
  typeof PermissionDeniedSchema
>("PermissionInterceptor", { error: PermissionDeniedSchema }) {}

export const makePermissionInterceptorLayer = (
  options: PermissionInterceptorOptions = {}
): Layer.Layer<PermissionInterceptor, never, PermissionRegistry> =>
  Layer.effect(
    PermissionInterceptor,
    Effect.gen(function* () {
      const registry = yield* PermissionRegistry
      const nextTraceId = options.nextTraceId ?? randomUUID
      const fallbackActorId = options.actorId ?? "app"
      const fallbackActorKind = options.actorKind ?? ("app" as const)

      return (effect, { rpc, headers }) => {
        const capabilityDecision = decodeRpcCapabilityForMiddleware(rpc)

        if (capabilityDecision._tag === "none") {
          return effect
        }

        return Effect.gen(function* () {
          const actor = rpcActor(headers, fallbackActorKind, fallbackActorId)
          const deniedCapability = permissionDeniedCapability(capabilityDecision)
          const context = yield* decodePermissionContext(
            {
              actor,
              traceId: rpcHeader(headers, "x-effect-desktop-trace-id") ?? nextTraceId()
            },
            deniedCapability,
            rpc._tag
          )
          if (capabilityDecision._tag === "invalid") {
            return yield* new PermissionDenied({
              reason: "invalid-capability",
              capability: deniedCapability,
              actor: context.actor,
              traceId: context.traceId ?? nextTraceId(),
              message: `invalid capability metadata for RPC ${rpc._tag}`
            })
          }
          const capability = capabilityDecision.capability
          const grant = yield* registry
            .check(capability, context)
            .pipe(Effect.mapError((error) => toPermissionDenied(error, capability)))
          return yield* registry
            .use(grant, effect)
            .pipe(
              Effect.mapError((error) =>
                isPermissionRegistryError(error) ? toPermissionDenied(error, capability) : error
              )
            )
        })
      }
    })
  )

type RpcCapabilityDecision =
  | { readonly _tag: "none" }
  | { readonly _tag: "valid"; readonly capability: NormalizedCapabilityType }
  | { readonly _tag: "invalid"; readonly capability: RpcCapabilityMetadata }

const permissionDeniedCapability = (
  decision: Exclude<RpcCapabilityDecision, { readonly _tag: "none" }>
): PermissionDeniedCapability =>
  decision._tag === "valid" ? decision.capability : { kind: decision.capability.kind }

const decodeRpcCapabilityForMiddleware = (rpc: Rpc.AnyWithProps): RpcCapabilityDecision => {
  const capability = rpcCapability(rpc)
  if (Option.isNone(capability) || capability.value.kind === "none") {
    return { _tag: "none" }
  }
  const decoded = Schema.decodeUnknownOption(NormalizedCapabilitySchema)(capability.value)
  return Option.isSome(decoded)
    ? { _tag: "valid", capability: decoded.value }
    : { _tag: "invalid", capability: capability.value }
}

const rpcHeader = (headers: Readonly<Record<string, string>>, name: string): string | undefined => {
  const value = headers[name]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const rpcActor = (
  headers: Readonly<Record<string, string>>,
  fallbackKind: ActorKind,
  fallbackId: string
): { readonly kind: ActorKind; readonly id: string } => {
  const explicitKind = Schema.decodeUnknownOption(ActorKind)(
    rpcHeader(headers, "x-effect-desktop-actor-kind")
  )
  const explicitId = rpcHeader(headers, "x-effect-desktop-actor-id")
  if (Option.isSome(explicitKind) && explicitId !== undefined) {
    return { kind: explicitKind.value, id: explicitId }
  }

  const windowId = rpcHeader(headers, "x-effect-desktop-window-id")
  if (windowId !== undefined) {
    return { kind: "window", id: windowId }
  }

  return { kind: fallbackKind, id: fallbackId }
}

const decodePermissionContext = (
  input: unknown,
  capability: PermissionDeniedCapability,
  rpcTag: string
): Effect.Effect<PermissionContext, PermissionDenied, never> => {
  const decoded = Schema.decodeUnknownOption(PermissionContext)(input)
  if (Option.isSome(decoded)) {
    return Effect.succeed(decoded.value)
  }
  return Effect.fail(
    new PermissionDenied({
      reason: "invalid-context",
      capability,
      actor: new PermissionActor({ kind: "app", id: "unknown" }),
      traceId: "unknown",
      message: `invalid permission context for RPC ${rpcTag}`
    })
  )
}

const toPermissionDenied = (
  error: PermissionRegistryError,
  capability: NormalizedCapabilityType
): PermissionDenied => {
  if (error._tag === "PermissionDenied") {
    return new PermissionDenied({
      reason: error.reason,
      capability: error.capability,
      actor: error.actor,
      traceId: error.traceId,
      message: `permission denied: ${error.reason}`
    })
  }

  return new PermissionDenied({
    reason: error._tag,
    capability,
    actor: new PermissionActor({ kind: "app", id: "unknown" }),
    traceId: "unknown",
    message: error instanceof Error ? error.message : String(error)
  })
}

const isPermissionRegistryError = (error: unknown): error is PermissionRegistryError =>
  error instanceof PermissionInvalidArgumentError ||
  error instanceof PermissionDeniedError ||
  error instanceof PermissionAuditFailedError ||
  error instanceof PermissionGrantNotFoundError ||
  error instanceof PermissionRevokedError

export const validatePermissions = (
  declared: readonly NormalizedCapabilityType[],
  required: readonly NormalizedCapabilityType[]
): Effect.Effect<void, DesktopConfigError, never> =>
  Effect.gen(function* () {
    for (const req of required) {
      const found = declared.some((cap) => capabilityCovers(cap, req))
      if (!found) {
        return yield* new DesktopConfigError({
          reason: "undeclared-capability",
          contract: req.kind,
          capability: req,
          message: `capability "${req.kind}" is required by a contract but was not declared with Desktop.permission(...)`
        })
      }
    }
  })
