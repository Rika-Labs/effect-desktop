import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolAlreadyExistsError,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidStateError,
  makeHostProtocolNotFoundError,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  type NormalizedCapability,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  permissionAuditEvent
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import {
  ExtensionPackageActor,
  ExtensionPackageEvent,
  type ExtensionPackageEventPhase,
  ExtensionPackageInstallInput,
  ExtensionPackageInstallRequest,
  ExtensionPackageInstallResult,
  ExtensionPackageListResult,
  ExtensionPackageManifest,
  ExtensionPackageRemoveInput,
  ExtensionPackageRemoveRequest,
  ExtensionPackageRemoveResult,
  ExtensionPackageSource,
  ExtensionPackageState,
  ExtensionPackageSupportedResult,
  ExtensionPackageUpdateInput,
  ExtensionPackageUpdateRequest,
  ExtensionPackageUpdateResult
} from "./contracts/extension-package.js"

const Surface = "ExtensionPackage"
const UnsupportedReason = "host-adapter-unimplemented"
const ExtensionPackageEventMethod = "ExtensionPackage.Event"
const PackageNamePattern = /^[A-Za-z0-9._-]+$/
const SemverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const Sha256DigestPattern = /^sha256:[a-fA-F0-9]{64}$/

export type ExtensionPackageError = HostProtocolError

export const ExtensionPackageInstall = extensionPackageRpc(
  "install",
  ExtensionPackageInstallInput,
  ExtensionPackageInstallResult,
  P.nativeInvoke({ primitive: Surface, methods: ["install"] })
)
export const ExtensionPackageUpdate = extensionPackageRpc(
  "update",
  ExtensionPackageUpdateInput,
  ExtensionPackageUpdateResult,
  P.nativeInvoke({ primitive: Surface, methods: ["update"] })
)
export const ExtensionPackageRemove = extensionPackageRpc(
  "remove",
  ExtensionPackageRemoveInput,
  ExtensionPackageRemoveResult,
  P.nativeInvoke({ primitive: Surface, methods: ["remove"] })
)
export const ExtensionPackageList = NativeSurface.rpc(Surface, "list", {
  payload: Schema.Void,
  success: ExtensionPackageListResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})
export const ExtensionPackageIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: ExtensionPackageSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const ExtensionPackageRpcEvents = Object.freeze({
  Event: { payload: ExtensionPackageEvent }
})

export type ExtensionPackageRpcEvents = typeof ExtensionPackageRpcEvents

const ExtensionPackageRpcGroup = RpcGroup.make(
  ExtensionPackageInstall,
  ExtensionPackageUpdate,
  ExtensionPackageRemove,
  ExtensionPackageList,
  ExtensionPackageIsSupported
)

export const ExtensionPackageRpcs: RpcGroup.RpcGroup<ExtensionPackageRpc> = ExtensionPackageRpcGroup

export const ExtensionPackageMethodNames = Object.freeze([
  "install",
  "update",
  "remove",
  "list",
  "isSupported"
] as const)

const ExtensionPackageCapabilityMethods = Object.freeze([
  "install",
  "update",
  "remove"
] as const satisfies readonly (typeof ExtensionPackageMethodNames)[number][])

export interface ExtensionPackageClientApi {
  readonly install: (
    input: ExtensionPackageInstallInput
  ) => Effect.Effect<ExtensionPackageInstallResult, ExtensionPackageError, never>
  readonly update: (
    input: ExtensionPackageUpdateInput
  ) => Effect.Effect<ExtensionPackageUpdateResult, ExtensionPackageError, never>
  readonly remove: (
    input: ExtensionPackageRemoveInput
  ) => Effect.Effect<ExtensionPackageRemoveResult, ExtensionPackageError, never>
  readonly list: () => Effect.Effect<ExtensionPackageListResult, ExtensionPackageError, never>
  readonly isSupported: () => Effect.Effect<
    ExtensionPackageSupportedResult,
    ExtensionPackageError,
    never
  >
  readonly events: () => Stream.Stream<ExtensionPackageEvent, ExtensionPackageError, never>
}

export class ExtensionPackageClient extends Context.Service<
  ExtensionPackageClient,
  ExtensionPackageClientApi
>()("@effect-desktop/native/ExtensionPackageClient") {}

export interface ExtensionPackageServiceApi {
  readonly install: (
    input: ExtensionPackageInstallRequest
  ) => Effect.Effect<ExtensionPackageInstallResult, ExtensionPackageError, never>
  readonly update: (
    input: ExtensionPackageUpdateRequest
  ) => Effect.Effect<ExtensionPackageUpdateResult, ExtensionPackageError, never>
  readonly remove: (
    input: ExtensionPackageRemoveRequest
  ) => Effect.Effect<ExtensionPackageRemoveResult, ExtensionPackageError, never>
  readonly list: () => Effect.Effect<ExtensionPackageListResult, ExtensionPackageError, never>
  readonly isSupported: () => Effect.Effect<
    ExtensionPackageSupportedResult,
    ExtensionPackageError,
    never
  >
  readonly events: () => Stream.Stream<ExtensionPackageEvent, ExtensionPackageError, never>
}

export interface ExtensionPackageServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly hostVersion?: string
  readonly nextTraceId?: () => string
}

export class ExtensionPackage extends Context.Service<
  ExtensionPackage,
  ExtensionPackageServiceApi
>()("@effect-desktop/native/ExtensionPackage") {
  static readonly layer = Layer.effect(ExtensionPackage)(
    Effect.gen(function* () {
      const client = yield* ExtensionPackageClient
      const permissions = yield* PermissionRegistry
      return yield* makeExtensionPackageService(client, { permissions })
    })
  )
}

export const ExtensionPackageLive = ExtensionPackage.layer

export const makeExtensionPackageClientLayer = (
  client: ExtensionPackageClientApi
): Layer.Layer<ExtensionPackageClient> => Layer.succeed(ExtensionPackageClient)(client)

export const makeExtensionPackageServiceLayer = (
  client: ExtensionPackageClientApi,
  options: ExtensionPackageServiceOptions
): Layer.Layer<ExtensionPackage> =>
  Layer.effect(ExtensionPackage)(makeExtensionPackageService(client, options))

export const makeExtensionPackageBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ExtensionPackageClient> =>
  ExtensionPackageSurface.bridgeClientLayer(exchange, options)

export type ExtensionPackageRpc = RpcGroup.Rpcs<typeof ExtensionPackageRpcGroup>

export type ExtensionPackageRpcHandlers = RpcGroup.HandlersFrom<ExtensionPackageRpc>

export const ExtensionPackageHandlersLive = ExtensionPackageRpcGroup.toLayer({
  "ExtensionPackage.install": (input) =>
    Effect.gen(function* () {
      const packages = yield* ExtensionPackage
      return yield* packages.install(input)
    }),
  "ExtensionPackage.update": (input) =>
    Effect.gen(function* () {
      const packages = yield* ExtensionPackage
      return yield* packages.update(input)
    }),
  "ExtensionPackage.remove": (input) =>
    Effect.gen(function* () {
      const packages = yield* ExtensionPackage
      return yield* packages.remove(input)
    }),
  "ExtensionPackage.list": () =>
    Effect.gen(function* () {
      const packages = yield* ExtensionPackage
      return yield* packages.list()
    }),
  "ExtensionPackage.isSupported": () =>
    Effect.gen(function* () {
      const packages = yield* ExtensionPackage
      return yield* packages.isSupported()
    })
})

export const ExtensionPackageSurface = NativeSurface.make(Surface, ExtensionPackageRpcGroup, {
  service: ExtensionPackageClient,
  capabilities: ExtensionPackageCapabilityMethods,
  handlers: ExtensionPackageHandlersLive,
  client: (client) => extensionPackageClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => extensionPackageClientFromRpcClient(client, exchange)
})

export const makeHostExtensionPackageRpcRuntime = (
  handlers: ExtensionPackageRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  ExtensionPackageSurface.hostRuntime(handlers, runtimeOptions)

export interface ExtensionPackageMemoryClientOptions {
  readonly failure?: Partial<
    Record<"install" | "update" | "remove" | "list", ExtensionPackageError>
  >
}

interface ExtensionPackageMemoryState {
  readonly packages: ReadonlyMap<string, ExtensionPackageState>
  readonly revision: number
}

export const makeExtensionPackageMemoryClient = (
  options: ExtensionPackageMemoryClientOptions = {}
): Effect.Effect<ExtensionPackageClientApi, never, never> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<ExtensionPackageMemoryState>({
      packages: new Map(),
      revision: 0
    })
    const pubsub = yield* PubSub.bounded<ExtensionPackageEvent>({ capacity: 256, replay: 64 })

    return Object.freeze({
      install: (input) =>
        validateInstallInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.install,
              Effect.gen(function* () {
                const current = yield* Ref.get(state)
                if (current.packages.has(valid.manifest.id)) {
                  return yield* alreadyExists(
                    `ExtensionPackage:${valid.manifest.id}`,
                    "ExtensionPackage.install"
                  )
                }
                const revision = yield* Ref.modify(state, (current) => {
                  const nextRevision = current.revision + 1
                  const nextPackage = new ExtensionPackageState({
                    packageId: valid.manifest.id,
                    manifest: valid.manifest,
                    source: valid.source,
                    revision: nextRevision
                  })
                  return [
                    nextRevision,
                    {
                      packages: new Map(current.packages).set(valid.manifest.id, nextPackage),
                      revision: nextRevision
                    }
                  ] as const
                })
                yield* publish(
                  pubsub,
                  valid.manifest.id,
                  "installed",
                  valid.manifest.version,
                  revision
                )
                return new ExtensionPackageInstallResult({
                  packageId: valid.manifest.id,
                  version: valid.manifest.version,
                  revision,
                  registeredCapabilities: declaredCapabilities(valid.manifest)
                })
              })
            )
          )
        ),
      update: (input) =>
        validateUpdateInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.update,
              Effect.gen(function* () {
                const previous = yield* Ref.get(state)
                const installed = previous.packages.get(valid.manifest.id)
                if (installed === undefined) {
                  return yield* Effect.fail(
                    makeHostProtocolNotFoundError(
                      `ExtensionPackage:${valid.manifest.id}`,
                      "ExtensionPackage.update"
                    )
                  )
                }
                const previousVersion = installed.manifest.version
                if (
                  valid.expectedVersion !== undefined &&
                  previousVersion !== valid.expectedVersion
                ) {
                  return yield* Effect.fail(
                    makeHostProtocolInvalidStateError(
                      `installed:${previousVersion}`,
                      `expected:${valid.expectedVersion}`,
                      "ExtensionPackage.update"
                    )
                  )
                }
                const revision = yield* Ref.modify(state, (current) => {
                  const nextRevision = current.revision + 1
                  const nextPackage = new ExtensionPackageState({
                    packageId: valid.manifest.id,
                    manifest: valid.manifest,
                    source: valid.source,
                    revision: nextRevision
                  })
                  return [
                    nextRevision,
                    {
                      packages: new Map(current.packages).set(valid.manifest.id, nextPackage),
                      revision: nextRevision
                    }
                  ] as const
                })
                yield* publish(
                  pubsub,
                  valid.manifest.id,
                  "updated",
                  valid.manifest.version,
                  revision
                )
                return new ExtensionPackageUpdateResult({
                  packageId: valid.manifest.id,
                  ...(previousVersion === undefined ? {} : { previousVersion }),
                  version: valid.manifest.version,
                  revision,
                  registeredCapabilities: declaredCapabilities(valid.manifest)
                })
              })
            )
          )
        ),
      remove: (input) =>
        validateRemoveInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.remove,
              Effect.gen(function* () {
                const revision = yield* Ref.modify(state, (current) => {
                  const next = new Map(current.packages)
                  const removed = next.delete(valid.packageId)
                  const nextRevision = current.revision + 1
                  return [
                    { removed, revision: nextRevision },
                    { packages: next, revision: nextRevision }
                  ] as const
                })
                yield* publish(pubsub, valid.packageId, "removed", undefined, revision.revision)
                return new ExtensionPackageRemoveResult({
                  packageId: valid.packageId,
                  removed: revision.removed,
                  revision: revision.revision
                })
              })
            )
          )
        ),
      list: () =>
        failOr(
          options.failure?.list,
          Ref.get(state).pipe(
            Effect.map(
              (current) =>
                new ExtensionPackageListResult({ packages: [...current.packages.values()] })
            )
          )
        ),
      isSupported: () => Effect.succeed(new ExtensionPackageSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies ExtensionPackageClientApi)
  })

export const makeExtensionPackageUnsupportedClient = (): ExtensionPackageClientApi =>
  Object.freeze({
    install: (input) =>
      validateInstallInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExtensionPackage.install")))
      ),
    update: (input) =>
      validateUpdateInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExtensionPackage.update")))
      ),
    remove: (input) =>
      validateRemoveInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExtensionPackage.remove")))
      ),
    list: () => Effect.fail(unsupportedError("ExtensionPackage.list")),
    isSupported: () =>
      Effect.succeed(
        new ExtensionPackageSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("ExtensionPackage.events"))
  } satisfies ExtensionPackageClientApi)

const makeExtensionPackageService = (
  client: ExtensionPackageClientApi,
  options: ExtensionPackageServiceOptions
): Effect.Effect<ExtensionPackageServiceApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      install: (input) =>
        Effect.gen(function* () {
          const request = yield* validateInstallRequest(input)
          yield* validateCompatibility(request.manifest, options, "ExtensionPackage.install")
          yield* checkPackagePermission(
            options,
            "install",
            request.actor,
            request.manifest.id,
            request.traceId
          )
          yield* checkManifestCapabilityPermissions(
            options,
            "install",
            request.actor,
            request.manifest,
            request.traceId
          )
          const result = yield* client.install(toInstallInput(request))
          yield* registerManifestCapabilities(options, request.manifest, request.traceId)
          yield* emitPackageAudit(
            options,
            "permission-used",
            "install",
            request.actor,
            request.manifest.id,
            request.traceId,
            {
              source: request.source,
              version: request.manifest.version,
              registeredCapabilities: result.registeredCapabilities.length
            }
          )
          return result
        }),
      update: (input) =>
        Effect.gen(function* () {
          const request = yield* validateUpdateRequest(input)
          yield* validateCompatibility(request.manifest, options, "ExtensionPackage.update")
          yield* checkPackagePermission(
            options,
            "update",
            request.actor,
            request.manifest.id,
            request.traceId
          )
          yield* checkManifestCapabilityPermissions(
            options,
            "update",
            request.actor,
            request.manifest,
            request.traceId
          )
          const result = yield* client.update(toUpdateInput(request))
          yield* registerManifestCapabilities(options, request.manifest, request.traceId)
          yield* emitPackageAudit(
            options,
            "permission-used",
            "update",
            request.actor,
            request.manifest.id,
            request.traceId,
            {
              source: request.source,
              version: request.manifest.version,
              registeredCapabilities: result.registeredCapabilities.length
            }
          )
          return result
        }),
      remove: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRemoveRequest(input)
          yield* checkPackagePermission(
            options,
            "remove",
            request.actor,
            request.packageId,
            request.traceId
          )
          const result = yield* client.remove(toRemoveInput(request))
          yield* emitPackageAudit(
            options,
            "permission-used",
            "remove",
            request.actor,
            request.packageId,
            request.traceId,
            {
              removed: result.removed
            }
          )
          return result
        }),
      list: () => client.list(),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies ExtensionPackageServiceApi)
  )

const extensionPackageClientFromRpcClient = (
  client: DesktopRpcClient<ExtensionPackageRpc>,
  exchange: BridgeClientExchange | undefined
): ExtensionPackageClientApi =>
  Object.freeze({
    install: (input) =>
      validateInstallInput(input).pipe(
        Effect.flatMap((valid) =>
          runExtensionPackageRpc(
            client["ExtensionPackage.install"](valid),
            "ExtensionPackage.install"
          )
        )
      ),
    update: (input) =>
      validateUpdateInput(input).pipe(
        Effect.flatMap((valid) =>
          runExtensionPackageRpc(
            client["ExtensionPackage.update"](valid),
            "ExtensionPackage.update"
          )
        )
      ),
    remove: (input) =>
      validateRemoveInput(input).pipe(
        Effect.flatMap((valid) =>
          runExtensionPackageRpc(
            client["ExtensionPackage.remove"](valid),
            "ExtensionPackage.remove"
          )
        )
      ),
    list: () =>
      runExtensionPackageRpc(client["ExtensionPackage.list"](undefined), "ExtensionPackage.list"),
    isSupported: () =>
      runExtensionPackageRpc(
        client["ExtensionPackage.isSupported"](undefined),
        "ExtensionPackage.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, ExtensionPackageEventMethod, ExtensionPackageEvent)
  } satisfies ExtensionPackageClientApi)

function extensionPackageRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runExtensionPackageRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ExtensionPackageError, never> => runNativeRpc(effect, operation, Surface)

const validateInstallRequest = (
  input: unknown
): Effect.Effect<ExtensionPackageInstallRequest, ExtensionPackageError, never> =>
  decodeNativeInput(ExtensionPackageInstallRequest, input, "ExtensionPackage.install").pipe(
    Effect.tap(validateInstallPayload("ExtensionPackage.install"))
  )

const validateInstallInput = (
  input: unknown
): Effect.Effect<ExtensionPackageInstallInput, ExtensionPackageError, never> =>
  decodeNativeInput(ExtensionPackageInstallInput, input, "ExtensionPackage.install").pipe(
    Effect.tap(validateInstallPayload("ExtensionPackage.install"))
  )

const validateUpdateRequest = (
  input: unknown
): Effect.Effect<ExtensionPackageUpdateRequest, ExtensionPackageError, never> =>
  decodeNativeInput(ExtensionPackageUpdateRequest, input, "ExtensionPackage.update").pipe(
    Effect.tap(validateUpdatePayload("ExtensionPackage.update"))
  )

const validateUpdateInput = (
  input: unknown
): Effect.Effect<ExtensionPackageUpdateInput, ExtensionPackageError, never> =>
  decodeNativeInput(ExtensionPackageUpdateInput, input, "ExtensionPackage.update").pipe(
    Effect.tap(validateUpdatePayload("ExtensionPackage.update"))
  )

const validateRemoveRequest = (
  input: unknown
): Effect.Effect<ExtensionPackageRemoveRequest, ExtensionPackageError, never> =>
  decodeNativeInput(ExtensionPackageRemoveRequest, input, "ExtensionPackage.remove").pipe(
    Effect.tap(validateRemovePayload("ExtensionPackage.remove"))
  )

const validateRemoveInput = (
  input: unknown
): Effect.Effect<ExtensionPackageRemoveInput, ExtensionPackageError, never> =>
  decodeNativeInput(ExtensionPackageRemoveInput, input, "ExtensionPackage.remove").pipe(
    Effect.tap(validateRemovePayload("ExtensionPackage.remove"))
  )

const validateInstallPayload =
  (operation: string) =>
  (
    input: ExtensionPackageInstallRequest | ExtensionPackageInstallInput
  ): Effect.Effect<void, ExtensionPackageError, never> =>
    Effect.gen(function* () {
      yield* validateActor(input.actor, operation)
      yield* validateSource(input.source, operation)
      yield* validateManifest(input.manifest, operation)
    })

const validateUpdatePayload =
  (operation: string) =>
  (
    input: ExtensionPackageUpdateRequest | ExtensionPackageUpdateInput
  ): Effect.Effect<void, ExtensionPackageError, never> =>
    Effect.gen(function* () {
      yield* validateActor(input.actor, operation)
      yield* validateSource(input.source, operation)
      yield* validateManifest(input.manifest, operation)
      if (input.expectedVersion !== undefined) {
        yield* validateVersion("expectedVersion", input.expectedVersion, operation)
      }
    })

const validateRemovePayload =
  (operation: string) =>
  (
    input: ExtensionPackageRemoveRequest | ExtensionPackageRemoveInput
  ): Effect.Effect<void, ExtensionPackageError, never> =>
    Effect.gen(function* () {
      yield* validateActor(input.actor, operation)
      yield* validateName("packageId", input.packageId, operation)
    })

const validateActor = (
  actor: ExtensionPackageActor,
  operation: string
): Effect.Effect<void, ExtensionPackageError, never> =>
  validateName("actor.id", actor.id, operation)

const validateSource = (
  source: ExtensionPackageSource,
  operation: string
): Effect.Effect<void, ExtensionPackageError, never> =>
  Effect.gen(function* () {
    if (source.uri.trim() !== source.uri) {
      return yield* invalid(
        "source.uri",
        "must not include leading or trailing whitespace",
        operation
      )
    }
    if (source.digest !== undefined && !Sha256DigestPattern.test(source.digest)) {
      return yield* invalid("source.digest", "must be a sha256 digest", operation)
    }
  })

const validateManifest = (
  manifest: ExtensionPackageManifest,
  operation: string
): Effect.Effect<void, ExtensionPackageError, never> =>
  Effect.gen(function* () {
    yield* validateName("manifest.id", manifest.id, operation)
    yield* validateVersion("manifest.version", manifest.version, operation)
    yield* validateEntrypoint(manifest.entrypoint, operation)
    if (manifest.capabilities.length === 0) {
      return yield* invalid(
        "manifest.capabilities",
        "must declare at least one capability",
        operation
      )
    }
    const seenCapabilities = new Set<string>()
    for (const declaration of manifest.capabilities) {
      const key = capabilityKey(declaration.capability)
      if (seenCapabilities.has(key)) {
        return yield* invalid("manifest.capabilities", "must be unique", operation)
      }
      seenCapabilities.add(key)
    }
    if (manifest.compatibility.minHostVersion !== undefined) {
      yield* validateVersion(
        "manifest.compatibility.minHostVersion",
        manifest.compatibility.minHostVersion,
        operation
      )
    }
    if (manifest.compatibility.maxHostVersion !== undefined) {
      yield* validateVersion(
        "manifest.compatibility.maxHostVersion",
        manifest.compatibility.maxHostVersion,
        operation
      )
    }
    if (
      manifest.compatibility.minHostVersion !== undefined &&
      manifest.compatibility.maxHostVersion !== undefined &&
      compareSemver(manifest.compatibility.minHostVersion, manifest.compatibility.maxHostVersion) >
        0
    ) {
      return yield* invalid(
        "manifest.compatibility",
        "minHostVersion must be less than or equal to maxHostVersion",
        operation
      )
    }
  })

const validateCompatibility = (
  manifest: ExtensionPackageManifest,
  options: ExtensionPackageServiceOptions,
  operation: string
): Effect.Effect<void, ExtensionPackageError, never> => {
  if (options.hostVersion === undefined) {
    return Effect.void
  }
  if (manifest.compatibility.minHostVersion !== undefined) {
    const minResult = compareSemver(options.hostVersion, manifest.compatibility.minHostVersion)
    if (minResult < 0) {
      return invalid(
        "manifest.compatibility.minHostVersion",
        "requires a newer host version",
        operation
      )
    }
  }
  if (manifest.compatibility.maxHostVersion !== undefined) {
    const maxResult = compareSemver(options.hostVersion, manifest.compatibility.maxHostVersion)
    if (maxResult > 0) {
      return invalid(
        "manifest.compatibility.maxHostVersion",
        "does not support this host version",
        operation
      )
    }
  }
  return Effect.void
}

const validateEntrypoint = (
  entrypoint: string,
  operation: string
): Effect.Effect<void, ExtensionPackageError, never> => {
  if (entrypoint.startsWith("/") || entrypoint.includes("\\") || entrypoint.includes("://")) {
    return invalid("manifest.entrypoint", "must be a relative package path", operation)
  }
  const parts = entrypoint.split("/")
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    return invalid("manifest.entrypoint", "must stay inside the package", operation)
  }
  return Effect.void
}

const validateName = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<void, ExtensionPackageError, never> =>
  value === "." || value === ".."
    ? invalid(field, "must not be a dot segment", operation)
    : PackageNamePattern.test(value)
      ? Effect.void
      : invalid(
          field,
          "must contain only letters, numbers, dots, underscores, or dashes",
          operation
        )

const validateVersion = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<void, ExtensionPackageError, never> =>
  SemverPattern.test(value) ? Effect.void : invalid(field, "must be SemVer", operation)

const compareSemver = (left: string, right: string): number => {
  const leftParts = left.split(/[+-]/u)[0]?.split(".").map(Number) ?? []
  const rightParts = right.split(/[+-]/u)[0]?.split(".").map(Number) ?? []
  for (const index of [0, 1, 2]) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (delta !== 0) {
      return delta
    }
  }
  return 0
}

const invalid = (
  field: string,
  message: string,
  operation: string
): Effect.Effect<never, ExtensionPackageError, never> =>
  Effect.fail(makeHostProtocolInvalidArgumentError(field, message, operation))

const alreadyExists = (
  resource: string,
  operation: string
): Effect.Effect<never, ExtensionPackageError, never> =>
  Effect.fail(
    new HostProtocolAlreadyExistsError({
      tag: "AlreadyExists",
      resource,
      message: `resource already exists: ${resource}`,
      operation,
      recoverable: false
    })
  )

const failOr = <A>(
  error: ExtensionPackageError | undefined,
  effect: Effect.Effect<A, ExtensionPackageError, never>
): Effect.Effect<A, ExtensionPackageError, never> =>
  error === undefined ? effect : Effect.fail(error)

const toInstallInput = (request: ExtensionPackageInstallRequest): ExtensionPackageInstallInput =>
  new ExtensionPackageInstallInput({
    actor: request.actor,
    source: request.source,
    manifest: request.manifest,
    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
  })

const toUpdateInput = (request: ExtensionPackageUpdateRequest): ExtensionPackageUpdateInput =>
  new ExtensionPackageUpdateInput({
    actor: request.actor,
    source: request.source,
    manifest: request.manifest,
    ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
  })

const toRemoveInput = (request: ExtensionPackageRemoveRequest): ExtensionPackageRemoveInput =>
  new ExtensionPackageRemoveInput({
    actor: request.actor,
    packageId: request.packageId,
    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
  })

const declaredCapabilities = (
  manifest: ExtensionPackageManifest
): readonly NormalizedCapability[] => manifest.capabilities.map((entry) => entry.capability)

const capabilityKey = (capability: NormalizedCapability): string => JSON.stringify(capability)

const registerManifestCapabilities = (
  options: ExtensionPackageServiceOptions,
  manifest: ExtensionPackageManifest,
  traceId: string | undefined
): Effect.Effect<void, ExtensionPackageError, never> =>
  Effect.forEach(
    manifest.capabilities,
    (declaration) =>
      options.permissions
        .declare(declaration.capability, {
          actor: extensionPermissionActor(manifest.id),
          source: `extension-package:${manifest.id}@${manifest.version}`
        })
        .pipe(
          Effect.tap(() =>
            emitPackageGrantAudit(options, manifest, declaration.capability, traceId)
          ),
          Effect.mapError((error) =>
            makeHostProtocolInternalError(
              `extension package capability registration failed: ${error._tag}`,
              "ExtensionPackage.registerCapabilities"
            )
          )
        ),
    { discard: true }
  )

const checkPackagePermission = (
  options: ExtensionPackageServiceOptions,
  method: "install" | "update" | "remove",
  actor: ExtensionPackageActor,
  packageId: string,
  traceId: string | undefined
): Effect.Effect<void, ExtensionPackageError, never> =>
  checkPermission(
    options,
    method,
    actor,
    packageId,
    P.nativeInvoke({ primitive: Surface, methods: [method] }),
    "native invoke",
    traceId
  )

const checkManifestCapabilityPermissions = (
  options: ExtensionPackageServiceOptions,
  method: "install" | "update",
  actor: ExtensionPackageActor,
  manifest: ExtensionPackageManifest,
  traceId: string | undefined
): Effect.Effect<void, ExtensionPackageError, never> =>
  Effect.forEach(
    manifest.capabilities,
    (declaration) =>
      checkPermission(
        options,
        method,
        actor,
        manifest.id,
        declaration.capability,
        "manifest capability",
        traceId
      ),
    { discard: true }
  )

const checkPermission = (
  options: ExtensionPackageServiceOptions,
  method: "install" | "update" | "remove",
  actor: ExtensionPackageActor,
  packageId: string,
  capability: NormalizedCapability,
  purpose: string,
  traceId?: string
): Effect.Effect<void, ExtensionPackageError, never> =>
  options.permissions
    .check(
      capability,
      new PermissionContext({
        actor: permissionActor(actor),
        resource: packageId,
        traceId: traceId ?? options.nextTraceId?.() ?? `ExtensionPackage.${method}`
      }),
      { source: `ExtensionPackage.${method}:${purpose}` }
    )
    .pipe(Effect.asVoid, Effect.catch(mapPermissionFailure(options, method, actor, packageId)))

const mapPermissionFailure =
  (
    options: ExtensionPackageServiceOptions,
    method: "install" | "update" | "remove",
    actor: ExtensionPackageActor,
    packageId: string
  ) =>
  (error: PermissionRegistryError): Effect.Effect<never, ExtensionPackageError, never> => {
    if (!(error instanceof PermissionDeniedError)) {
      return Effect.fail(
        makeHostProtocolInternalError(
          `extension package permission registry failure: ${error._tag}`,
          `ExtensionPackage.${method}`
        )
      )
    }
    return emitPackageAudit(options, "permission-denied", method, actor, packageId, error.traceId, {
      capability: error.capability,
      reason: error.reason
    }).pipe(
      Effect.andThen(
        Effect.fail(
          new HostProtocolPermissionDeniedError({
            tag: "PermissionDenied",
            capability: error.capability.kind,
            message: `extension package denied ${error.capability.kind}: ${error.reason}`,
            operation: `ExtensionPackage.${method}`,
            recoverable: false
          })
        )
      )
    )
  }

const publish = (
  pubsub: PubSub.PubSub<ExtensionPackageEvent>,
  packageId: string,
  phase: ExtensionPackageEventPhase,
  version: string | undefined,
  revision: number
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis
    yield* PubSub.publish(
      pubsub,
      new ExtensionPackageEvent({
        type: "extension-package-event",
        timestamp,
        packageId,
        phase,
        ...(version === undefined ? {} : { version }),
        revision
      })
    )
  }).pipe(Effect.asVoid)

const emitPackageGrantAudit = (
  options: ExtensionPackageServiceOptions,
  manifest: ExtensionPackageManifest,
  capability: NormalizedCapability,
  traceId: string | undefined
): Effect.Effect<void, ExtensionPackageError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-granted",
      source: "ExtensionPackage.registerCapabilities",
      traceId: traceId ?? options.nextTraceId?.() ?? "ExtensionPackage.registerCapabilities",
      outcome: "granted",
      normalizedCapability: capability,
      actor: extensionPermissionActor(manifest.id),
      resource: manifest.id,
      details: { version: manifest.version }
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write extension package grant audit event: ${error.message}`,
        "ExtensionPackage.registerCapabilities"
      )
    )
  )
}

const emitPackageAudit = (
  options: ExtensionPackageServiceOptions,
  kind: "permission-denied" | "permission-used",
  method: "install" | "update" | "remove",
  actor: ExtensionPackageActor,
  packageId: string,
  traceId: string | undefined,
  details: unknown
): Effect.Effect<void, ExtensionPackageError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  const operation = `ExtensionPackage.${method}`
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind,
      source: operation,
      traceId: traceId ?? options.nextTraceId?.() ?? operation,
      outcome: kind === "permission-denied" ? "denied" : "used",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: permissionActor(actor),
      resource: packageId,
      details
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write extension package audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: ExtensionPackageActor): PermissionActor =>
  new PermissionActor({
    kind:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.kind
        : "resource",
    id:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.id
        : `${actor.kind}:${actor.id}`
  })

const extensionPermissionActor = (packageId: string): PermissionActor =>
  new PermissionActor({ kind: "resource", id: `extension:${packageId}` })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ExtensionPackage method: ${operation}`,
    operation,
    recoverable: false
  })
