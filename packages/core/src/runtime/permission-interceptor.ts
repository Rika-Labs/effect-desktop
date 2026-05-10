import { randomUUID } from "node:crypto"

import { Context, Data, Effect, Layer, Option } from "effect"
import { RpcMiddleware } from "effect/unstable/rpc"

import {
  capabilityCovers,
  type NormalizedCapability,
  PermissionActor,
  PermissionContext,
  PermissionRegistry
} from "./permission-registry.js"

export class DesktopConfigError extends Data.TaggedError("DesktopConfigError")<{
  readonly reason: "undeclared-capability"
  readonly contract: string
  readonly capability: NormalizedCapability
  readonly message: string
}> {}

export const CapabilityAnnotation = Context.Service<NormalizedCapability>(
  "@effect-desktop/core/CapabilityAnnotation"
)

export const P = Object.freeze({
  filesystemRead: (options: {
    readonly roots: readonly string[]
    readonly deny?: readonly string[]
    readonly allowCreate?: boolean
    readonly allowOverwrite?: boolean
  }): NormalizedCapability =>
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
  }): NormalizedCapability =>
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
  }): NormalizedCapability =>
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
  }): NormalizedCapability =>
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
  }): NormalizedCapability =>
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
  }): NormalizedCapability =>
    Object.freeze({
      kind: "network.connect" as const,
      hosts: [...options.hosts],
      askUnknownHosts: options.askUnknownHosts ?? false,
      audit: "always" as const
    }),

  secretsRead: (options: { readonly namespaces: readonly string[] }): NormalizedCapability =>
    Object.freeze({
      kind: "secrets.read" as const,
      namespaces: [...options.namespaces],
      audit: "always" as const
    }),

  secretsWrite: (options: { readonly namespaces: readonly string[] }): NormalizedCapability =>
    Object.freeze({
      kind: "secrets.write" as const,
      namespaces: [...options.namespaces],
      audit: "always" as const
    }),

  safeStorageRead: (options: { readonly namespaces: readonly string[] }): NormalizedCapability =>
    Object.freeze({
      kind: "safeStorage.read" as const,
      namespaces: [...options.namespaces],
      audit: "always" as const
    }),

  safeStorageWrite: (options: { readonly namespaces: readonly string[] }): NormalizedCapability =>
    Object.freeze({
      kind: "safeStorage.write" as const,
      namespaces: [...options.namespaces],
      audit: "always" as const
    }),

  nativeInvoke: (options: {
    readonly primitive: string
    readonly methods: readonly string[]
  }): NormalizedCapability =>
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

export class PermissionInterceptor extends RpcMiddleware.Service<PermissionInterceptor>()<"PermissionInterceptor">(
  "PermissionInterceptor"
) {}

export const makePermissionInterceptorLayer = (
  options: PermissionInterceptorOptions = {}
): Layer.Layer<PermissionInterceptor, never, PermissionRegistry> =>
  Layer.effect(
    PermissionInterceptor,
    Effect.gen(function* () {
      const registry = yield* PermissionRegistry
      const nextTraceId = options.nextTraceId ?? randomUUID
      const actorId = options.actorId ?? "app"
      const actorKind = options.actorKind ?? ("app" as const)

      return (effect, { rpc }) => {
        const capabilityOption = Context.getOption(rpc.annotations, CapabilityAnnotation)

        if (Option.isNone(capabilityOption)) {
          return effect
        }

        const capability = capabilityOption.value
        return Effect.gen(function* () {
          const context = new PermissionContext({
            actor: new PermissionActor({ kind: actorKind, id: actorId }),
            traceId: nextTraceId()
          })
          yield* registry.check(capability, context).pipe(Effect.orDie)
          return yield* effect
        })
      }
    })
  )

export const validatePermissions = (
  declared: readonly NormalizedCapability[],
  required: readonly NormalizedCapability[]
): Effect.Effect<void, DesktopConfigError, never> =>
  Effect.gen(function* () {
    for (const req of required) {
      const found = declared.some((cap) => capabilityCovers(cap, req))
      if (!found) {
        return yield* Effect.fail(
          new DesktopConfigError({
            reason: "undeclared-capability",
            contract: req.kind,
            capability: req,
            message: `capability "${req.kind}" is required by a contract but was not declared in Desktop.app({ permissions })`
          })
        )
      }
    }
  })
