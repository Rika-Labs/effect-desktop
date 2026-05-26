import {
  type BridgeClientExchange,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@orika/bridge"
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
} from "@orika/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import { decodeNativeInput, runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import {
  WorkspaceIndexActor,
  WorkspaceIndexCloseInput,
  WorkspaceIndexCloseRequest,
  WorkspaceIndexCloseResult,
  WorkspaceIndexEvent,
  type WorkspaceIndexEventPhase,
  WorkspaceIndexOpenInput,
  WorkspaceIndexOpenRequest,
  WorkspaceIndexOpenResult,
  WorkspaceIndexRefreshInput,
  WorkspaceIndexRefreshRequest,
  WorkspaceIndexRefreshResult,
  WorkspaceIndexScope,
  WorkspaceIndexSupportedResult
} from "./contracts/workspace-index.js"

const Surface = "WorkspaceIndex"
const UnsupportedReason = "host-adapter-unimplemented"

const IdentifierPattern = /^[A-Za-z0-9._-]+$/
const WindowsAbsolutePath = /^[A-Za-z]:[\\/]/u

export type WorkspaceIndexError = HostProtocolError

export const WorkspaceIndexOpen = workspaceIndexRpc(
  "open",
  WorkspaceIndexOpenInput,
  WorkspaceIndexOpenResult,
  P.nativeInvoke({ primitive: Surface, methods: ["open"] })
)
export const WorkspaceIndexRefresh = workspaceIndexRpc(
  "refresh",
  WorkspaceIndexRefreshInput,
  WorkspaceIndexRefreshResult,
  P.nativeInvoke({ primitive: Surface, methods: ["refresh"] })
)
export const WorkspaceIndexClose = workspaceIndexRpc(
  "close",
  WorkspaceIndexCloseInput,
  WorkspaceIndexCloseResult,
  P.nativeInvoke({ primitive: Surface, methods: ["close"] })
)
export const WorkspaceIndexIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: WorkspaceIndexSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const WorkspaceIndexEventStream = NativeSurface.event(Surface, "Event", {
  payload: WorkspaceIndexEvent,
  support: NativeSurface.support.supported
})

const WorkspaceIndexRpcGroup = RpcGroup.make(
  WorkspaceIndexOpen,
  WorkspaceIndexRefresh,
  WorkspaceIndexClose,
  WorkspaceIndexIsSupported,
  WorkspaceIndexEventStream
)

export const WorkspaceIndexRpcs: RpcGroup.RpcGroup<WorkspaceIndexRpc> = WorkspaceIndexRpcGroup

export const WorkspaceIndexMethodNames = Object.freeze([
  "open",
  "refresh",
  "close",
  "isSupported"
] as const)

const WorkspaceIndexCapabilityMethods = Object.freeze([
  "open",
  "refresh",
  "close"
] as const satisfies readonly (typeof WorkspaceIndexMethodNames)[number][])

export interface WorkspaceIndexClientApi {
  readonly open: (
    input: WorkspaceIndexOpenInput
  ) => Effect.Effect<WorkspaceIndexOpenResult, WorkspaceIndexError, never>
  readonly refresh: (
    input: WorkspaceIndexRefreshInput
  ) => Effect.Effect<WorkspaceIndexRefreshResult, WorkspaceIndexError, never>
  readonly close: (
    input: WorkspaceIndexCloseInput
  ) => Effect.Effect<WorkspaceIndexCloseResult, WorkspaceIndexError, never>
  readonly isSupported: () => Effect.Effect<
    WorkspaceIndexSupportedResult,
    WorkspaceIndexError,
    never
  >
  readonly events: () => Stream.Stream<WorkspaceIndexEvent, WorkspaceIndexError, never>
}

export class WorkspaceIndexClient extends Context.Service<
  WorkspaceIndexClient,
  WorkspaceIndexClientApi
>()("@orika/native/WorkspaceIndexClient") {}

export interface WorkspaceIndexServiceApi {
  readonly open: (
    input: WorkspaceIndexOpenRequest
  ) => Effect.Effect<WorkspaceIndexOpenResult, WorkspaceIndexError, never>
  readonly refresh: (
    input: WorkspaceIndexRefreshRequest
  ) => Effect.Effect<WorkspaceIndexRefreshResult, WorkspaceIndexError, never>
  readonly close: (
    input: WorkspaceIndexCloseRequest
  ) => Effect.Effect<WorkspaceIndexCloseResult, WorkspaceIndexError, never>
  readonly isSupported: () => Effect.Effect<
    WorkspaceIndexSupportedResult,
    WorkspaceIndexError,
    never
  >
  readonly events: () => Stream.Stream<WorkspaceIndexEvent, WorkspaceIndexError, never>
}

export interface WorkspaceIndexServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly nextIndexId?: () => string
  readonly nextTraceId?: () => string
}

export class WorkspaceIndex extends Context.Service<WorkspaceIndex, WorkspaceIndexServiceApi>()(
  "@orika/native/WorkspaceIndex"
) {
  static readonly layer = Layer.effect(WorkspaceIndex)(
    Effect.gen(function* () {
      const client = yield* WorkspaceIndexClient
      const permissions = yield* PermissionRegistry
      return yield* makeWorkspaceIndexService(client, { permissions })
    })
  )
}

export const makeWorkspaceIndexServiceLayer = (
  client: WorkspaceIndexClientApi,
  options: WorkspaceIndexServiceOptions
): Layer.Layer<WorkspaceIndex> =>
  Layer.effect(WorkspaceIndex)(makeWorkspaceIndexService(client, options))

export type WorkspaceIndexRpc = RpcGroup.Rpcs<typeof WorkspaceIndexRpcGroup>

export type WorkspaceIndexRpcHandlers<R = never> = NativeRpcHandlers<
  typeof WorkspaceIndexRpcGroup,
  R
>

export const WorkspaceIndexHandlersLive = WorkspaceIndexRpcGroup.toLayer({
  "WorkspaceIndex.open": (input) =>
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      return yield* index.open(input)
    }),
  "WorkspaceIndex.refresh": (input) =>
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      return yield* index.refresh(input)
    }),
  "WorkspaceIndex.close": (input) =>
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      return yield* index.close(input)
    }),
  "WorkspaceIndex.isSupported": () =>
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      return yield* index.isSupported()
    }),
  "WorkspaceIndex.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const index = yield* WorkspaceIndex
        return index.events()
      })
    )
})

export const WorkspaceIndexSurface = NativeSurface.make(Surface, WorkspaceIndexRpcGroup, {
  service: WorkspaceIndexClient,
  capabilities: WorkspaceIndexCapabilityMethods,
  handlers: WorkspaceIndexHandlersLive,
  client: (client) => workspaceIndexClientFromRpcClient(client),
  bridgeClient: (client, exchange) => workspaceIndexBridgeClientFromRpcClient(client, exchange)
})

export interface WorkspaceIndexMemoryClientOptions {
  readonly failure?: Partial<Record<"open" | "refresh" | "close", WorkspaceIndexError>>
  readonly nextIndexId?: () => string
}

interface WorkspaceIndexState {
  readonly actor: WorkspaceIndexActor
  readonly scope: WorkspaceIndexScope
}

export const makeWorkspaceIndexMemoryClient = (
  options: WorkspaceIndexMemoryClientOptions = {}
): Effect.Effect<WorkspaceIndexClientApi, never, never> =>
  Effect.gen(function* () {
    const indexes = yield* Ref.make<ReadonlyMap<string, WorkspaceIndexScope>>(new Map())
    const pubsub = yield* PubSub.bounded<WorkspaceIndexEvent>({ capacity: 256, replay: 64 })
    const nextIndexId = yield* makeIdGenerator(options.nextIndexId, "workspace-index")

    return Object.freeze({
      open: (input) =>
        validateOpenInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.open,
              Effect.gen(function* () {
                const indexId = valid.indexId ?? (yield* nextIndexId())
                const scope = normalizeScope(valid.scope)
                yield* Ref.update(indexes, (current) => new Map(current).set(indexId, scope))
                yield* publishEvent(pubsub, indexId, "opened", {
                  root: scope.root,
                  state: "opened"
                })
                return new WorkspaceIndexOpenResult({
                  indexId,
                  root: scope.root,
                  state: "opened"
                })
              })
            )
          )
        ),
      refresh: (input) =>
        validateRefreshInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.refresh,
              Effect.gen(function* () {
                const current = yield* Ref.get(indexes)
                const scope = current.get(valid.indexId)
                if (scope === undefined) {
                  return yield* invalid(
                    "indexId",
                    "must reference an opened workspace index",
                    "WorkspaceIndex.refresh"
                  )
                }
                const indexed = valid.changedPaths?.length ?? 0
                yield* publishEvent(pubsub, valid.indexId, "refresh-started", {
                  root: scope.root,
                  state: "refreshing"
                })
                for (const path of valid.changedPaths ?? []) {
                  yield* publishEvent(pubsub, valid.indexId, "entry-indexed", { path })
                }
                yield* publishEvent(pubsub, valid.indexId, "refresh-completed", {
                  root: scope.root,
                  state: "opened",
                  indexed,
                  invalidated: 0,
                  ignored: 0
                })
                return new WorkspaceIndexRefreshResult({
                  indexId: valid.indexId,
                  state: "opened",
                  indexed,
                  invalidated: 0,
                  ignored: 0
                })
              })
            )
          )
        ),
      close: (input) =>
        validateCloseInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.close,
              Effect.gen(function* () {
                const removed = yield* Ref.modify(indexes, (current) => {
                  const next = new Map(current)
                  const existed = next.delete(valid.indexId)
                  return [existed, next] as const
                })
                yield* publishEvent(pubsub, valid.indexId, "closed", { state: "closed" })
                return new WorkspaceIndexCloseResult({ indexId: valid.indexId, closed: removed })
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new WorkspaceIndexSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies WorkspaceIndexClientApi)
  })

export const makeWorkspaceIndexUnsupportedClient = (): WorkspaceIndexClientApi =>
  Object.freeze({
    open: (input) =>
      validateOpenInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("WorkspaceIndex.open")))
      ),
    refresh: (input) =>
      validateRefreshInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("WorkspaceIndex.refresh")))
      ),
    close: (input) =>
      validateCloseInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("WorkspaceIndex.close")))
      ),
    isSupported: () =>
      Effect.succeed(
        new WorkspaceIndexSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("WorkspaceIndex.events"))
  } satisfies WorkspaceIndexClientApi)

const makeWorkspaceIndexService = (
  client: WorkspaceIndexClientApi,
  options: WorkspaceIndexServiceOptions
): Effect.Effect<WorkspaceIndexServiceApi, never, never> =>
  Effect.gen(function* () {
    const indexes = yield* Ref.make<ReadonlyMap<string, WorkspaceIndexState>>(new Map())
    const nextIndexId = yield* makeIdGenerator(options.nextIndexId, "workspace-index")

    return Object.freeze({
      open: (input) =>
        Effect.gen(function* () {
          const request = yield* validateOpenRequest(input)
          const indexId = request.indexId ?? (yield* nextIndexId())
          const scope = normalizeScope(request.scope)
          yield* authorizeOpen(options, request.actor, scope, request.traceId)
          yield* emitIndexAudit(
            options,
            "permission-used",
            filesystemReadCapability(scope.root),
            request.actor,
            indexId,
            request.traceId ?? indexId,
            "WorkspaceIndex.open",
            { root: scope.root, ignoreRules: scope.ignoreRules.length }
          )
          const result = yield* client.open(
            new WorkspaceIndexOpenInput({
              actor: request.actor,
              scope,
              indexId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(indexes, (current) =>
            new Map(current).set(result.indexId, { actor: request.actor, scope })
          )
          return result
        }),
      refresh: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRefreshRequest(input)
          const current = yield* Ref.get(indexes)
          const state = current.get(request.indexId)
          if (state === undefined) {
            return yield* invalid(
              "indexId",
              "must reference an opened workspace index",
              "WorkspaceIndex.refresh"
            )
          }
          const filtered = yield* filterChangedPaths(state.scope, request.changedPaths)
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["refresh"] }),
            state.actor,
            `index:${request.indexId}:refresh`,
            request.indexId,
            "WorkspaceIndex.refresh",
            request.traceId
          )
          yield* checkPermission(
            options,
            filesystemReadCapability(state.scope.root),
            state.actor,
            state.scope.root,
            state.scope.root,
            "WorkspaceIndex.refresh",
            request.traceId
          )
          yield* emitIndexAudit(
            options,
            "permission-used",
            filesystemReadCapability(state.scope.root),
            state.actor,
            state.scope.root,
            request.traceId ?? request.indexId,
            "WorkspaceIndex.refresh",
            { root: state.scope.root }
          )
          yield* emitIndexAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["refresh"] }),
            state.actor,
            request.indexId,
            request.traceId ?? request.indexId,
            "WorkspaceIndex.refresh",
            { changedPaths: filtered.changedPaths?.length ?? "all", ignored: filtered.ignored }
          )
          const result =
            filtered.changedPaths?.length === 0
              ? new WorkspaceIndexRefreshResult({
                  indexId: request.indexId,
                  state: "opened",
                  indexed: 0,
                  invalidated: 0,
                  ignored: 0
                })
              : yield* client.refresh(
                  new WorkspaceIndexRefreshInput({
                    indexId: request.indexId,
                    ...(filtered.changedPaths === undefined
                      ? {}
                      : { changedPaths: filtered.changedPaths }),
                    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
                  })
                )
          const merged = new WorkspaceIndexRefreshResult({
            indexId: result.indexId,
            state: result.state,
            indexed: result.indexed,
            invalidated: result.invalidated,
            ignored: result.ignored + filtered.ignored
          })
          return merged
        }),
      close: (input) =>
        Effect.gen(function* () {
          const request = yield* validateCloseRequest(input)
          const current = yield* Ref.get(indexes)
          const state = current.get(request.indexId)
          if (state === undefined) {
            return yield* invalid(
              "indexId",
              "must reference an opened workspace index",
              "WorkspaceIndex.close"
            )
          }
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["close"] }),
            state.actor,
            `index:${request.indexId}:close`,
            request.indexId,
            "WorkspaceIndex.close",
            request.traceId
          )
          yield* emitIndexAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["close"] }),
            state.actor,
            request.indexId,
            request.traceId ?? request.indexId,
            "WorkspaceIndex.close",
            { indexId: request.indexId }
          )
          const result = yield* client.close(
            new WorkspaceIndexCloseInput({
              indexId: request.indexId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(indexes, (stateMap) => {
            const next = new Map(stateMap)
            next.delete(request.indexId)
            return next
          })
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies WorkspaceIndexServiceApi)
  })

const workspaceIndexClientFromRpcClient = (
  client: DesktopRpcClient<WorkspaceIndexRpc>
): WorkspaceIndexClientApi =>
  Object.freeze({
    open: (input) =>
      validateOpenInput(input).pipe(
        Effect.flatMap((valid) =>
          runWorkspaceIndexRpc(client["WorkspaceIndex.open"](valid), "WorkspaceIndex.open")
        )
      ),
    refresh: (input) =>
      validateRefreshInput(input).pipe(
        Effect.flatMap((valid) =>
          runWorkspaceIndexRpc(client["WorkspaceIndex.refresh"](valid), "WorkspaceIndex.refresh")
        )
      ),
    close: (input) =>
      validateCloseInput(input).pipe(
        Effect.flatMap((valid) =>
          runWorkspaceIndexRpc(client["WorkspaceIndex.close"](valid), "WorkspaceIndex.close")
        )
      ),
    isSupported: () =>
      runWorkspaceIndexRpc(
        client["WorkspaceIndex.isSupported"](undefined),
        "WorkspaceIndex.isSupported"
      ),
    events: () =>
      runWorkspaceIndexRpcStream(
        client["WorkspaceIndex.events.Event"](undefined),
        "WorkspaceIndex.events.Event"
      )
  } satisfies WorkspaceIndexClientApi)

const workspaceIndexBridgeClientFromRpcClient = (
  client: DesktopRpcClient<WorkspaceIndexRpc>,
  exchange: BridgeClientExchange
): WorkspaceIndexClientApi =>
  Object.freeze({
    ...workspaceIndexClientFromRpcClient(client),
    events: () => NativeSurface.subscribeEvent(exchange, WorkspaceIndexEventStream)
  } satisfies WorkspaceIndexClientApi)

function workspaceIndexRpc<
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

const runWorkspaceIndexRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, WorkspaceIndexError, never> => runNativeRpc(effect, operation, Surface)

const runWorkspaceIndexRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, WorkspaceIndexError, never> => runNativeRpcStream(stream, operation, Surface)

const validateOpenRequest = (
  input: unknown
): Effect.Effect<WorkspaceIndexOpenRequest, WorkspaceIndexError, never> =>
  decodeNativeInput(WorkspaceIndexOpenRequest, input, "WorkspaceIndex.open").pipe(
    Effect.tap(validateOpenPayload("WorkspaceIndex.open"))
  )

const validateOpenInput = (
  input: unknown
): Effect.Effect<WorkspaceIndexOpenInput, WorkspaceIndexError, never> =>
  decodeNativeInput(WorkspaceIndexOpenInput, input, "WorkspaceIndex.open").pipe(
    Effect.tap(validateOpenPayload("WorkspaceIndex.open"))
  )

const validateRefreshRequest = (
  input: unknown
): Effect.Effect<WorkspaceIndexRefreshRequest, WorkspaceIndexError, never> =>
  decodeNativeInput(WorkspaceIndexRefreshRequest, input, "WorkspaceIndex.refresh")

const validateRefreshInput = (
  input: unknown
): Effect.Effect<WorkspaceIndexRefreshInput, WorkspaceIndexError, never> =>
  decodeNativeInput(WorkspaceIndexRefreshInput, input, "WorkspaceIndex.refresh")

const validateCloseRequest = (
  input: unknown
): Effect.Effect<WorkspaceIndexCloseRequest, WorkspaceIndexError, never> =>
  decodeNativeInput(WorkspaceIndexCloseRequest, input, "WorkspaceIndex.close")

const validateCloseInput = (
  input: unknown
): Effect.Effect<WorkspaceIndexCloseInput, WorkspaceIndexError, never> =>
  decodeNativeInput(WorkspaceIndexCloseInput, input, "WorkspaceIndex.close")

const validateOpenPayload =
  (operation: string) =>
  (
    input: WorkspaceIndexOpenRequest | WorkspaceIndexOpenInput
  ): Effect.Effect<void, WorkspaceIndexError, never> =>
    Effect.gen(function* () {
      yield* validateIdentifier("actor.id", input.actor.id, operation)
      yield* validateScope(input.scope, operation)
    })

const validateScope = (
  scope: WorkspaceIndexScope,
  operation: string
): Effect.Effect<void, WorkspaceIndexError, never> =>
  Effect.gen(function* () {
    if (!isAbsolutePath(scope.root)) {
      return yield* invalid("scope.root", "must be an absolute path", operation)
    }
    if (hasDotPathSegment(scope.root)) {
      return yield* invalid("scope.root", "must not include dot path segments", operation)
    }
    if (scope.grants.length === 0) {
      return yield* invalid(
        "scope.grants",
        "must include a scoped filesystem read grant",
        operation
      )
    }
    if (
      scope.grants.some(
        (grant) => grant.kind === "filesystem.read" && grant.roots.some(hasDotPathSegment)
      )
    ) {
      return yield* invalid(
        "scope.grants",
        "filesystem.read roots must not include dot path segments",
        operation
      )
    }
    if (!hasReadGrantForRoot(scope.grants, scope.root)) {
      return yield* invalid(
        "scope.grants",
        "must include a filesystem.read grant covering the workspace root",
        operation
      )
    }
    for (const [index, rule] of scope.ignoreRules.entries()) {
      const pattern = normalizedRelativePath(rule.pattern)
      if (
        isAbsolutePath(rule.pattern) ||
        pattern === ".." ||
        pattern.startsWith("../") ||
        pattern.includes("/../")
      ) {
        return yield* invalid(
          `scope.ignoreRules[${index}].pattern`,
          "must be relative to the workspace root",
          operation
        )
      }
    }
  })

const authorizeOpen = (
  options: WorkspaceIndexServiceOptions,
  actor: WorkspaceIndexActor,
  scope: WorkspaceIndexScope,
  traceId: string | undefined
): Effect.Effect<void, WorkspaceIndexError, never> =>
  Effect.gen(function* () {
    yield* checkPermission(
      options,
      P.nativeInvoke({ primitive: Surface, methods: ["open"] }),
      actor,
      `workspace:${scope.root}:index`,
      scope.root,
      "WorkspaceIndex.open",
      traceId
    )
    yield* checkPermission(
      options,
      filesystemReadCapability(scope.root),
      actor,
      scope.root,
      scope.root,
      "WorkspaceIndex.open",
      traceId
    )
  })

const checkPermission = (
  options: WorkspaceIndexServiceOptions,
  capability: NormalizedCapability,
  actor: WorkspaceIndexActor,
  resource: string,
  auditResource: string,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, WorkspaceIndexError, never> =>
  options.permissions
    .check(
      capability,
      new PermissionContext({
        actor: permissionActor(actor),
        resource,
        traceId: traceId ?? options.nextTraceId?.() ?? operation
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) => {
        if (!(error instanceof PermissionDeniedError)) {
          return Effect.fail(
            makeHostProtocolInternalError(
              `workspace index permission registry failure: ${error._tag}`,
              operation
            )
          )
        }
        return emitIndexAudit(
          options,
          "permission-denied",
          capability,
          actor,
          auditResource,
          error.traceId,
          operation,
          { reason: error.reason }
        ).pipe(Effect.andThen(Effect.fail(permissionDeniedError(capability, error, operation))))
      })
    )

const filterChangedPaths = (
  scope: WorkspaceIndexScope,
  changedPaths: readonly string[] | undefined
): Effect.Effect<
  { readonly changedPaths: readonly string[] | undefined; readonly ignored: number },
  WorkspaceIndexError,
  never
> => {
  if (changedPaths === undefined) {
    return Effect.succeed({ changedPaths: undefined, ignored: 0 })
  }
  const forwarded: string[] = []
  let ignored = 0
  for (const path of changedPaths) {
    if (!isAbsolutePath(path) || hasDotPathSegment(path) || !isWithinRoot(path, scope.root)) {
      return invalid(
        "changedPaths",
        "must stay inside the workspace root",
        "WorkspaceIndex.refresh"
      )
    }
    if (isIgnored(scope, path)) {
      ignored += 1
    } else {
      forwarded.push(path)
    }
  }
  return Effect.succeed({ changedPaths: forwarded, ignored })
}

const normalizeScope = (scope: WorkspaceIndexScope): WorkspaceIndexScope =>
  new WorkspaceIndexScope({
    root: normalizeRoot(scope.root),
    ignoreRules: scope.ignoreRules,
    grants: scope.grants,
    watch: scope.watch ?? false
  })

const filesystemReadCapability = (root: string): NormalizedCapability =>
  P.filesystemRead({ roots: [normalizeRoot(root)] })

const hasReadGrantForRoot = (grants: readonly NormalizedCapability[], root: string): boolean =>
  grants.some(
    (grant) =>
      grant.kind === "filesystem.read" &&
      grant.roots.some((grantRoot) => pathContains(normalizeRoot(grantRoot), normalizeRoot(root)))
  )

const isWithinRoot = (path: string, root: string): boolean =>
  pathContains(normalizeRoot(root), canonicalPath(path))

// This is a pre-transport syntax guard. Host adapters must resolve native
// canonical paths before reading files so symlinks and hard links cannot escape.
const pathContains = (parent: string, child: string): boolean => {
  const isWindowsPath = WindowsAbsolutePath.test(parent) || WindowsAbsolutePath.test(child)
  const parentKey = isWindowsPath ? parent.toLowerCase() : parent
  const childKey = isWindowsPath ? child.toLowerCase() : child
  if (parent === "/") {
    return child.startsWith("/")
  }
  if (WindowsRootPath.test(parent)) {
    return childKey.startsWith(parentKey)
  }
  return childKey === parentKey || childKey.startsWith(`${parentKey}/`)
}

const isIgnored = (scope: WorkspaceIndexScope, path: string): boolean => {
  const relative = relativeToRoot(scope.root, path)
  return scope.ignoreRules.some((rule) => matchesIgnoreRule(rule.pattern, relative))
}

const matchesIgnoreRule = (pattern: string, relativePath: string): boolean => {
  const normalizedPattern = normalizedRelativePath(pattern)
  if (normalizedPattern.endsWith("/**")) {
    const base = normalizedPattern.slice(0, -3)
    return relativePath === base || relativePath.startsWith(`${base}/`)
  }
  if (normalizedPattern.endsWith("/")) {
    return relativePath.startsWith(normalizedPattern)
  }
  if (normalizedPattern.startsWith("*")) {
    return relativePath.endsWith(normalizedPattern.slice(1))
  }
  return relativePath === normalizedPattern || relativePath.startsWith(`${normalizedPattern}/`)
}

const relativeToRoot = (root: string, path: string): string =>
  canonicalPath(path).slice(normalizeRoot(root).length).replace(/^\/+/u, "")

const normalizedRelativePath = (path: string): string => normalizePath(path).replace(/^\/+/u, "")

const normalizeRoot = (path: string): string => {
  const normalized = canonicalPath(path)
  if (normalized === "/" || WindowsRootPath.test(normalized)) {
    return normalized
  }
  return normalized.replace(/\/+$/u, "")
}

const normalizePath = (path: string): string => path.replaceAll("\\", "/").replace(/\/+/gu, "/")

const hasDotPathSegment = (path: string): boolean =>
  normalizePath(path)
    .split("/")
    .some((segment) => segment === "." || segment === "..")

const canonicalPath = (path: string): string => {
  const normalized = normalizePath(path)
  const prefix = WindowsAbsolutePath.test(normalized) ? normalized.slice(0, 3) : "/"
  const rest = prefix === "/" ? normalized.slice(1) : normalized.slice(3)
  const segments: string[] = []
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") {
      continue
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return `${prefix}..`
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (prefix === "/") {
    return `/${segments.join("/")}`.replace(/\/$/u, "") || "/"
  }
  return `${prefix}${segments.join("/")}`
}

const isAbsolutePath = (path: string): boolean =>
  path.startsWith("/") || WindowsAbsolutePath.test(path)

const WindowsRootPath = /^[A-Za-z]:\/$/u

const validateIdentifier = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<void, WorkspaceIndexError, never> => {
  if (!IdentifierPattern.test(value)) {
    return invalid(field, "must contain only letters, numbers, dot, underscore, or dash", operation)
  }
  return Effect.void
}

const failOr = <A>(
  error: WorkspaceIndexError | undefined,
  effect: Effect.Effect<A, WorkspaceIndexError, never>
): Effect.Effect<A, WorkspaceIndexError, never> =>
  error === undefined ? effect : Effect.fail(error)

const makeIdGenerator = (
  nextId: (() => string) | undefined,
  prefix: string
): Effect.Effect<() => Effect.Effect<string, never, never>, never, never> =>
  Effect.gen(function* () {
    const sequence = yield* Ref.make(0)
    if (nextId !== undefined) {
      return () => Effect.sync(nextId)
    }
    return () =>
      Ref.updateAndGet(sequence, (current) => current + 1).pipe(
        Effect.map((current) => `${prefix}-${current}`)
      )
  })

const publishEvent = (
  events: PubSub.PubSub<WorkspaceIndexEvent>,
  indexId: string,
  phase: WorkspaceIndexEventPhase,
  options: {
    readonly root?: string
    readonly path?: string
    readonly state?: "opened" | "refreshing" | "closed"
    readonly indexed?: number
    readonly invalidated?: number
    readonly ignored?: number
  } = {}
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis
    yield* PubSub.publish(
      events,
      new WorkspaceIndexEvent({
        type: "workspace-index-event",
        timestamp,
        indexId,
        phase,
        ...(options.root === undefined ? {} : { root: options.root }),
        ...(options.path === undefined ? {} : { path: options.path }),
        ...(options.state === undefined ? {} : { state: options.state }),
        ...(options.indexed === undefined ? {} : { indexed: options.indexed }),
        ...(options.invalidated === undefined ? {} : { invalidated: options.invalidated }),
        ...(options.ignored === undefined ? {} : { ignored: options.ignored })
      })
    )
  }).pipe(Effect.asVoid)

const emitIndexAudit = (
  options: WorkspaceIndexServiceOptions,
  kind: "permission-denied" | "permission-used",
  capability: NormalizedCapability,
  actor: WorkspaceIndexActor,
  resource: string,
  traceId: string,
  operation: string,
  details: unknown
): Effect.Effect<void, WorkspaceIndexError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind,
      source: operation,
      traceId,
      outcome: kind === "permission-denied" ? "denied" : "used",
      normalizedCapability: capability,
      actor: permissionActor(actor),
      resource,
      details
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write workspace index audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: WorkspaceIndexActor): PermissionActor =>
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

const invalid = (
  field: string,
  message: string,
  operation: string
): Effect.Effect<never, WorkspaceIndexError, never> =>
  Effect.fail(makeHostProtocolInvalidArgumentError(field, message, operation))

const permissionDeniedError = (
  capability: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: capability.kind,
    message: `workspace index denied ${capability.kind}: ${error.reason}`,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported WorkspaceIndex method: ${operation}`,
    operation,
    recoverable: false
  })
