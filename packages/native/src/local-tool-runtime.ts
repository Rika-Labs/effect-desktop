import {
  type BridgeClientExchange,
  type BridgeHandlerRuntimeOptions,
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

import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import {
  LocalToolRuntimeActor,
  LocalToolRuntimeBudgetPolicy,
  LocalToolRuntimeCleanupPolicy,
  LocalToolRuntimeCommand,
  LocalToolRuntimeCwdPolicy,
  LocalToolRuntimeEnvironmentPolicy,
  LocalToolRuntimeEvent,
  type LocalToolRuntimeEventPhase,
  LocalToolRuntimeFilesystemPolicy,
  LocalToolRuntimeHealthInput,
  LocalToolRuntimeHealthRequest,
  LocalToolRuntimeHealthResult,
  type LocalToolRuntimeHealthStatus,
  LocalToolRuntimeManifest,
  LocalToolRuntimeNetworkPolicy,
  LocalToolRuntimePolicy,
  LocalToolRuntimeRegisterInput,
  LocalToolRuntimeRegisterRequest,
  LocalToolRuntimeRegisterResult,
  LocalToolRuntimeRunInput,
  LocalToolRuntimeRunRequest,
  LocalToolRuntimeRunResult,
  type LocalToolRuntimeRunStatus,
  LocalToolRuntimeStdioPolicy,
  LocalToolRuntimeStopInput,
  LocalToolRuntimeStopRequest,
  LocalToolRuntimeStopResult,
  LocalToolRuntimeSupportedResult
} from "./contracts/local-tool-runtime.js"

const Surface = "LocalToolRuntime"
const UnsupportedReason = "host-adapter-unimplemented"
const LocalToolRuntimeSupport = NativeSurface.support.supported
const LocalToolRuntimeEventMethod = "LocalToolRuntime.Event"

const IdentifierPattern = /^[A-Za-z0-9._-]+$/
const SemverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const SHELL_METACHARACTER = /[;|&><`\n]|\$\(/u

export type LocalToolRuntimeError = HostProtocolError

export const LocalToolRuntimeRegister = localToolRuntimeRpc(
  "register",
  LocalToolRuntimeRegisterInput,
  LocalToolRuntimeRegisterResult,
  P.nativeInvoke({ primitive: Surface, methods: ["register"] })
)
export const LocalToolRuntimeRun = localToolRuntimeRpc(
  "run",
  LocalToolRuntimeRunInput,
  LocalToolRuntimeRunResult,
  P.nativeInvoke({ primitive: Surface, methods: ["run"] })
)
export const LocalToolRuntimeStop = localToolRuntimeRpc(
  "stop",
  LocalToolRuntimeStopInput,
  LocalToolRuntimeStopResult,
  P.nativeInvoke({ primitive: Surface, methods: ["stop"] })
)
export const LocalToolRuntimeHealth = NativeSurface.rpc(Surface, "health", {
  payload: LocalToolRuntimeHealthInput,
  success: LocalToolRuntimeHealthResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["health"] })
  ),
  endpoint: "query",
  support: LocalToolRuntimeSupport
})
export const LocalToolRuntimeIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: LocalToolRuntimeSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const LocalToolRuntimeRpcEvents = Object.freeze({
  Event: { payload: LocalToolRuntimeEvent }
})

export type LocalToolRuntimeRpcEvents = typeof LocalToolRuntimeRpcEvents

const LocalToolRuntimeRpcGroup = RpcGroup.make(
  LocalToolRuntimeRegister,
  LocalToolRuntimeRun,
  LocalToolRuntimeStop,
  LocalToolRuntimeHealth,
  LocalToolRuntimeIsSupported
)

export const LocalToolRuntimeRpcs: RpcGroup.RpcGroup<LocalToolRuntimeRpc> = LocalToolRuntimeRpcGroup

export const LocalToolRuntimeMethodNames = Object.freeze([
  "register",
  "run",
  "stop",
  "health",
  "isSupported"
] as const)

const LocalToolRuntimeCapabilityMethods = Object.freeze([
  "register",
  "run",
  "stop",
  "health"
] as const satisfies readonly (typeof LocalToolRuntimeMethodNames)[number][])

export interface LocalToolRuntimeClientApi {
  readonly register: (
    input: LocalToolRuntimeRegisterInput
  ) => Effect.Effect<LocalToolRuntimeRegisterResult, LocalToolRuntimeError, never>
  readonly run: (
    input: LocalToolRuntimeRunInput
  ) => Effect.Effect<LocalToolRuntimeRunResult, LocalToolRuntimeError, never>
  readonly stop: (
    input: LocalToolRuntimeStopInput
  ) => Effect.Effect<LocalToolRuntimeStopResult, LocalToolRuntimeError, never>
  readonly health: (
    input: LocalToolRuntimeHealthInput
  ) => Effect.Effect<LocalToolRuntimeHealthResult, LocalToolRuntimeError, never>
  readonly isSupported: () => Effect.Effect<
    LocalToolRuntimeSupportedResult,
    LocalToolRuntimeError,
    never
  >
  readonly events: () => Stream.Stream<LocalToolRuntimeEvent, LocalToolRuntimeError, never>
}

export class LocalToolRuntimeClient extends Context.Service<
  LocalToolRuntimeClient,
  LocalToolRuntimeClientApi
>()("@orika/native/LocalToolRuntimeClient") {}

export interface LocalToolRuntimeServiceApi {
  readonly register: (
    input: LocalToolRuntimeRegisterRequest
  ) => Effect.Effect<LocalToolRuntimeRegisterResult, LocalToolRuntimeError, never>
  readonly run: (
    input: LocalToolRuntimeRunRequest
  ) => Effect.Effect<LocalToolRuntimeRunResult, LocalToolRuntimeError, never>
  readonly stop: (
    input: LocalToolRuntimeStopRequest
  ) => Effect.Effect<LocalToolRuntimeStopResult, LocalToolRuntimeError, never>
  readonly health: (
    input: LocalToolRuntimeHealthRequest
  ) => Effect.Effect<LocalToolRuntimeHealthResult, LocalToolRuntimeError, never>
  readonly isSupported: () => Effect.Effect<
    LocalToolRuntimeSupportedResult,
    LocalToolRuntimeError,
    never
  >
  readonly events: () => Stream.Stream<LocalToolRuntimeEvent, LocalToolRuntimeError, never>
}

export interface LocalToolRuntimeServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly nextRuntimeId?: () => string
  readonly nextRunId?: () => string
  readonly nextTraceId?: () => string
}

export class LocalToolRuntime extends Context.Service<
  LocalToolRuntime,
  LocalToolRuntimeServiceApi
>()("@orika/native/LocalToolRuntime") {
  static readonly layer = Layer.effect(LocalToolRuntime)(
    Effect.gen(function* () {
      const client = yield* LocalToolRuntimeClient
      const permissions = yield* PermissionRegistry
      return yield* makeLocalToolRuntimeService(client, { permissions })
    })
  )
}

export const LocalToolRuntimeLive = LocalToolRuntime.layer

export const makeLocalToolRuntimeServiceLayer = (
  client: LocalToolRuntimeClientApi,
  options: LocalToolRuntimeServiceOptions
): Layer.Layer<LocalToolRuntime> =>
  Layer.effect(LocalToolRuntime)(makeLocalToolRuntimeService(client, options))

export type LocalToolRuntimeRpc = RpcGroup.Rpcs<typeof LocalToolRuntimeRpcGroup>

export type LocalToolRuntimeRpcHandlers<R = never> = NativeRpcHandlers<
  typeof LocalToolRuntimeRpcGroup,
  R
>

export const LocalToolRuntimeHandlersLive = LocalToolRuntimeRpcGroup.toLayer({
  "LocalToolRuntime.register": (input) =>
    Effect.gen(function* () {
      const runtime = yield* LocalToolRuntime
      return yield* runtime.register(input)
    }),
  "LocalToolRuntime.run": (input) =>
    Effect.gen(function* () {
      const runtime = yield* LocalToolRuntime
      return yield* runtime.run(input)
    }),
  "LocalToolRuntime.stop": (input) =>
    Effect.gen(function* () {
      const runtime = yield* LocalToolRuntime
      return yield* runtime.stop(input)
    }),
  "LocalToolRuntime.health": (input) =>
    Effect.gen(function* () {
      const runtime = yield* LocalToolRuntime
      return yield* runtime.health(input)
    }),
  "LocalToolRuntime.isSupported": () =>
    Effect.gen(function* () {
      const runtime = yield* LocalToolRuntime
      return yield* runtime.isSupported()
    })
})

export const LocalToolRuntimeSurface = NativeSurface.make(Surface, LocalToolRuntimeRpcGroup, {
  service: LocalToolRuntimeClient,
  capabilities: LocalToolRuntimeCapabilityMethods,
  handlers: LocalToolRuntimeHandlersLive,
  client: (client) => localToolRuntimeClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => localToolRuntimeClientFromRpcClient(client, exchange)
})

export const makeHostLocalToolRuntimeRpcRuntime = <R = never>(
  handlers: LocalToolRuntimeRpcHandlers<R>,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
) => LocalToolRuntimeSurface.hostRuntime(handlers, runtimeOptions)

export interface LocalToolRuntimeMemoryClientOptions {
  readonly failure?: Partial<Record<"register" | "run" | "stop" | "health", LocalToolRuntimeError>>
  readonly nextRuntimeId?: () => string
  readonly nextRunId?: () => string
  readonly stdout?: string
  readonly stderr?: string
  readonly status?: LocalToolRuntimeRunStatus
  readonly health?: LocalToolRuntimeHealthStatus
}

interface LocalToolRuntimeState {
  readonly actor: LocalToolRuntimeActor
  readonly registered: LocalToolRuntimeRegisterResult
}

export const makeLocalToolRuntimeMemoryClient = (
  options: LocalToolRuntimeMemoryClientOptions = {}
): Effect.Effect<LocalToolRuntimeClientApi, never, never> =>
  Effect.gen(function* () {
    const runtimes = yield* Ref.make<ReadonlyMap<string, LocalToolRuntimeRegisterResult>>(new Map())
    const pubsub = yield* PubSub.bounded<LocalToolRuntimeEvent>({ capacity: 256, replay: 64 })
    const nextRuntimeId = yield* makeIdGenerator(options.nextRuntimeId, "local-tool-runtime")
    const nextRunId = yield* makeIdGenerator(options.nextRunId, "local-tool-run")

    return Object.freeze({
      register: (input) =>
        validateRegisterInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.register,
              Effect.gen(function* () {
                const runtimeId = valid.runtimeId ?? (yield* nextRuntimeId())
                const result = new LocalToolRuntimeRegisterResult({
                  runtimeId,
                  toolId: valid.manifest.toolId,
                  manifest: normalizeManifest(valid.manifest),
                  state: "registered"
                })
                yield* Ref.update(runtimes, (current) => new Map(current).set(runtimeId, result))
                yield* publishEvent(pubsub, runtimeId, "registered", { toolId: result.toolId })
                return result
              })
            )
          )
        ),
      run: (input) =>
        validateRunInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.run,
              Effect.gen(function* () {
                const current = yield* Ref.get(runtimes)
                const registered = current.get(valid.runtimeId)
                if (registered === undefined) {
                  return yield* invalid(
                    "runtimeId",
                    "must reference a registered local tool runtime",
                    "LocalToolRuntime.run"
                  )
                }
                const command = commandById(registered.manifest, valid.commandId)
                if (command === undefined) {
                  return yield* invalid(
                    "commandId",
                    "must reference a manifest command",
                    "LocalToolRuntime.run"
                  )
                }
                const runId = valid.runId ?? (yield* nextRunId())
                const status = options.status ?? "completed"
                yield* publishEvent(pubsub, valid.runtimeId, "run-started", {
                  toolId: registered.toolId,
                  commandId: valid.commandId,
                  runId
                })
                const result = new LocalToolRuntimeRunResult({
                  runtimeId: valid.runtimeId,
                  commandId: valid.commandId,
                  runId,
                  status,
                  ...(status === "completed" ? { exitCode: 0 } : {}),
                  stdout: options.stdout ?? "",
                  stderr: options.stderr ?? ""
                })
                yield* publishEvent(pubsub, valid.runtimeId, "run-completed", {
                  toolId: registered.toolId,
                  commandId: valid.commandId,
                  runId,
                  status
                })
                return result
              })
            )
          )
        ),
      stop: (input) =>
        validateStopInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.stop,
              Effect.gen(function* () {
                const removed = yield* Ref.modify(runtimes, (current) => {
                  const next = new Map(current)
                  const wasRegistered = next.delete(valid.runtimeId)
                  return [wasRegistered, next] as const
                })
                yield* publishEvent(pubsub, valid.runtimeId, "stopped")
                return new LocalToolRuntimeStopResult({
                  runtimeId: valid.runtimeId,
                  stopped: removed
                })
              })
            )
          )
        ),
      health: (input) =>
        validateHealthInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.health,
              Effect.gen(function* () {
                const current = yield* Ref.get(runtimes)
                const registered = current.get(valid.runtimeId)
                if (registered === undefined) {
                  return yield* invalid(
                    "runtimeId",
                    "must reference a registered local tool runtime",
                    "LocalToolRuntime.health"
                  )
                }
                const timestamp = yield* Clock.currentTimeMillis
                const status = options.health ?? "healthy"
                yield* publishEvent(pubsub, valid.runtimeId, "health-checked", {
                  toolId: registered.toolId,
                  health: status
                })
                return new LocalToolRuntimeHealthResult({
                  runtimeId: valid.runtimeId,
                  status,
                  checkedAt: timestamp
                })
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new LocalToolRuntimeSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies LocalToolRuntimeClientApi)
  })

export const makeLocalToolRuntimeUnsupportedClient = (): LocalToolRuntimeClientApi =>
  Object.freeze({
    register: (input) =>
      validateRegisterInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("LocalToolRuntime.register")))
      ),
    run: (input) =>
      validateRunInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("LocalToolRuntime.run")))
      ),
    stop: (input) =>
      validateStopInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("LocalToolRuntime.stop")))
      ),
    health: (input) =>
      validateHealthInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("LocalToolRuntime.health")))
      ),
    isSupported: () =>
      Effect.succeed(
        new LocalToolRuntimeSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("LocalToolRuntime.events"))
  } satisfies LocalToolRuntimeClientApi)

const makeLocalToolRuntimeService = (
  client: LocalToolRuntimeClientApi,
  options: LocalToolRuntimeServiceOptions
): Effect.Effect<LocalToolRuntimeServiceApi, never, never> =>
  Effect.gen(function* () {
    const runtimes = yield* Ref.make<ReadonlyMap<string, LocalToolRuntimeState>>(new Map())
    const nextRuntimeId = yield* makeIdGenerator(options.nextRuntimeId, "local-tool-runtime")
    const nextRunId = yield* makeIdGenerator(options.nextRunId, "local-tool-run")

    return Object.freeze({
      register: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRegisterRequest(input)
          const runtimeId = request.runtimeId ?? (yield* nextRuntimeId())
          const manifest = normalizeManifest(request.manifest)
          yield* authorizeRegister(options, request.actor, manifest, request.traceId)
          const result = yield* client.register(
            new LocalToolRuntimeRegisterInput({
              actor: request.actor,
              manifest,
              runtimeId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(runtimes, (current) =>
            new Map(current).set(result.runtimeId, {
              actor: request.actor,
              registered: result
            })
          )
          yield* emitRuntimeAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["register"] }),
            request.actor,
            result.runtimeId,
            request.traceId ?? result.runtimeId,
            "LocalToolRuntime.register",
            {
              toolId: result.toolId,
              commandIds: result.manifest.commands.map((command) => command.commandId)
            }
          )
          return result
        }),
      run: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRunRequest(input)
          const current = yield* Ref.get(runtimes)
          const runtime = current.get(request.runtimeId)
          if (runtime === undefined) {
            return yield* invalid(
              "runtimeId",
              "must reference a registered local tool runtime",
              "LocalToolRuntime.run"
            )
          }
          const command = commandById(runtime.registered.manifest, request.commandId)
          if (command === undefined) {
            return yield* invalid(
              "commandId",
              "must reference a manifest command",
              "LocalToolRuntime.run"
            )
          }
          const runId = request.runId ?? (yield* nextRunId())
          yield* authorizeRun(options, runtime, command, request.traceId)
          const result = yield* client.run(
            new LocalToolRuntimeRunInput({
              runtimeId: request.runtimeId,
              commandId: request.commandId,
              ...(request.args === undefined ? {} : { args: request.args }),
              runId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* emitRuntimeAudit(
            options,
            "permission-used",
            processCapability(runtime.registered.manifest, command),
            runtime.actor,
            request.runtimeId,
            request.traceId ?? result.runId,
            "LocalToolRuntime.run",
            { commandId: request.commandId, status: result.status }
          )
          return result
        }),
      stop: (input) =>
        Effect.gen(function* () {
          const request = yield* validateStopRequest(input)
          const current = yield* Ref.get(runtimes)
          const runtime = current.get(request.runtimeId)
          if (runtime === undefined) {
            return yield* invalid(
              "runtimeId",
              "must reference a registered local tool runtime",
              "LocalToolRuntime.stop"
            )
          }
          const result = yield* client.stop(
            new LocalToolRuntimeStopInput({
              runtimeId: request.runtimeId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(runtimes, (state) => {
            const next = new Map(state)
            next.delete(request.runtimeId)
            return next
          })
          yield* emitRuntimeAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["stop"] }),
            runtime.actor,
            request.runtimeId,
            request.traceId ?? request.runtimeId,
            "LocalToolRuntime.stop",
            { stopped: result.stopped }
          )
          return result
        }),
      health: (input) =>
        Effect.gen(function* () {
          const request = yield* validateHealthRequest(input)
          const current = yield* Ref.get(runtimes)
          const runtime = current.get(request.runtimeId)
          if (runtime === undefined) {
            return yield* invalid(
              "runtimeId",
              "must reference a registered local tool runtime",
              "LocalToolRuntime.health"
            )
          }
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["health"] }),
            runtime.actor,
            `runtime:${request.runtimeId}:health`,
            request.runtimeId,
            "LocalToolRuntime.health",
            request.traceId
          )
          const result = yield* client.health(
            new LocalToolRuntimeHealthInput({
              runtimeId: request.runtimeId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies LocalToolRuntimeServiceApi)
  })

const localToolRuntimeClientFromRpcClient = (
  client: DesktopRpcClient<LocalToolRuntimeRpc>,
  exchange: BridgeClientExchange | undefined
): LocalToolRuntimeClientApi =>
  Object.freeze({
    register: (input) =>
      validateRegisterInput(input).pipe(
        Effect.flatMap((valid) =>
          runLocalToolRuntimeRpc(
            client["LocalToolRuntime.register"](valid),
            "LocalToolRuntime.register"
          )
        )
      ),
    run: (input) =>
      validateRunInput(input).pipe(
        Effect.flatMap((valid) =>
          runLocalToolRuntimeRpc(client["LocalToolRuntime.run"](valid), "LocalToolRuntime.run")
        )
      ),
    stop: (input) =>
      validateStopInput(input).pipe(
        Effect.flatMap((valid) =>
          runLocalToolRuntimeRpc(client["LocalToolRuntime.stop"](valid), "LocalToolRuntime.stop")
        )
      ),
    health: (input) =>
      validateHealthInput(input).pipe(
        Effect.flatMap((valid) =>
          runLocalToolRuntimeRpc(
            client["LocalToolRuntime.health"](valid),
            "LocalToolRuntime.health"
          )
        )
      ),
    isSupported: () =>
      runLocalToolRuntimeRpc(
        client["LocalToolRuntime.isSupported"](undefined),
        "LocalToolRuntime.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, LocalToolRuntimeEventMethod, LocalToolRuntimeEvent)
  } satisfies LocalToolRuntimeClientApi)

function localToolRuntimeRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: LocalToolRuntimeSupport
  })
}

const runLocalToolRuntimeRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, LocalToolRuntimeError, never> => runNativeRpc(effect, operation, Surface)

const validateRegisterRequest = (
  input: unknown
): Effect.Effect<LocalToolRuntimeRegisterRequest, LocalToolRuntimeError, never> =>
  decodeNativeInput(LocalToolRuntimeRegisterRequest, input, "LocalToolRuntime.register").pipe(
    Effect.tap(validateRegisterPayload("LocalToolRuntime.register"))
  )

const validateRegisterInput = (
  input: unknown
): Effect.Effect<LocalToolRuntimeRegisterInput, LocalToolRuntimeError, never> =>
  decodeNativeInput(LocalToolRuntimeRegisterInput, input, "LocalToolRuntime.register").pipe(
    Effect.tap(validateRegisterPayload("LocalToolRuntime.register"))
  )

const validateRunRequest = (
  input: unknown
): Effect.Effect<LocalToolRuntimeRunRequest, LocalToolRuntimeError, never> =>
  decodeNativeInput(LocalToolRuntimeRunRequest, input, "LocalToolRuntime.run")

const validateRunInput = (
  input: unknown
): Effect.Effect<LocalToolRuntimeRunInput, LocalToolRuntimeError, never> =>
  decodeNativeInput(LocalToolRuntimeRunInput, input, "LocalToolRuntime.run")

const validateStopRequest = (
  input: unknown
): Effect.Effect<LocalToolRuntimeStopRequest, LocalToolRuntimeError, never> =>
  decodeNativeInput(LocalToolRuntimeStopRequest, input, "LocalToolRuntime.stop")

const validateStopInput = (
  input: unknown
): Effect.Effect<LocalToolRuntimeStopInput, LocalToolRuntimeError, never> =>
  decodeNativeInput(LocalToolRuntimeStopInput, input, "LocalToolRuntime.stop")

const validateHealthRequest = (
  input: unknown
): Effect.Effect<LocalToolRuntimeHealthRequest, LocalToolRuntimeError, never> =>
  decodeNativeInput(LocalToolRuntimeHealthRequest, input, "LocalToolRuntime.health")

const validateHealthInput = (
  input: unknown
): Effect.Effect<LocalToolRuntimeHealthInput, LocalToolRuntimeError, never> =>
  decodeNativeInput(LocalToolRuntimeHealthInput, input, "LocalToolRuntime.health")

const validateRegisterPayload =
  (operation: string) =>
  (
    input: LocalToolRuntimeRegisterRequest | LocalToolRuntimeRegisterInput
  ): Effect.Effect<void, LocalToolRuntimeError, never> =>
    Effect.gen(function* () {
      yield* validateIdentifier("actor.id", input.actor.id, operation)
      yield* validateManifest(input.manifest, operation)
    })

const validateManifest = (
  manifest: LocalToolRuntimeManifest,
  operation: string
): Effect.Effect<void, LocalToolRuntimeError, never> =>
  Effect.gen(function* () {
    yield* validateIdentifier("manifest.toolId", manifest.toolId, operation)
    yield* validateVersion("manifest.version", manifest.version, operation)
    if (manifest.commands.length === 0) {
      return yield* invalid("manifest.commands", "must declare at least one command", operation)
    }
    if (manifest.permissions.length === 0) {
      return yield* invalid(
        "manifest.permissions",
        "must declare at least one permission",
        operation
      )
    }
    if (manifest.policy.cwd.roots.length === 0) {
      return yield* invalid("manifest.policy.cwd.roots", "must not be empty", operation)
    }
    const seenCommands = new Set<string>()
    for (const command of manifest.commands) {
      yield* validateIdentifier("manifest.commands.commandId", command.commandId, operation)
      yield* validateExecutable(command.executable, operation)
      const cwd = command.cwd ?? primaryCwd(manifest)
      if (!isWithinRoots(cwd, manifest.policy.cwd.roots)) {
        return yield* invalid(
          "manifest.commands.cwd",
          "must be within manifest cwd roots",
          operation
        )
      }
      if (seenCommands.has(command.commandId)) {
        return yield* invalid("manifest.commands", "must have unique commandIds", operation)
      }
      seenCommands.add(command.commandId)
    }
    if (manifest.health !== undefined && !seenCommands.has(manifest.health.commandId)) {
      return yield* invalid(
        "manifest.health.commandId",
        "must reference a manifest command",
        operation
      )
    }
  })

const validateExecutable = (
  executable: string,
  operation: string
): Effect.Effect<void, LocalToolRuntimeError, never> =>
  SHELL_METACHARACTER.test(executable)
    ? invalid("manifest.commands.executable", "contains shell metacharacters", operation)
    : Effect.void

const validateIdentifier = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<void, LocalToolRuntimeError, never> => {
  if (!IdentifierPattern.test(value)) {
    return invalid(field, "must contain only letters, numbers, dot, underscore, or dash", operation)
  }
  return Effect.void
}

const validateVersion = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<void, LocalToolRuntimeError, never> =>
  SemverPattern.test(value) ? Effect.void : invalid(field, "must be SemVer", operation)

const failOr = <A>(
  error: LocalToolRuntimeError | undefined,
  effect: Effect.Effect<A, LocalToolRuntimeError, never>
): Effect.Effect<A, LocalToolRuntimeError, never> =>
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

const normalizeManifest = (manifest: LocalToolRuntimeManifest): LocalToolRuntimeManifest =>
  new LocalToolRuntimeManifest({
    toolId: manifest.toolId,
    name: manifest.name,
    version: manifest.version,
    commands: manifest.commands.map(
      (command) =>
        new LocalToolRuntimeCommand({
          commandId: command.commandId,
          executable: command.executable,
          defaultArgs: command.defaultArgs ?? [],
          cwd: command.cwd ?? primaryCwd(manifest),
          environment: command.environment ?? [],
          ...(command.timeoutMillis === undefined ? {} : { timeoutMillis: command.timeoutMillis })
        })
    ),
    permissions: manifest.permissions,
    policy: new LocalToolRuntimePolicy({
      cwd: new LocalToolRuntimeCwdPolicy({ roots: manifest.policy.cwd.roots }),
      environment: new LocalToolRuntimeEnvironmentPolicy({
        variables: manifest.policy.environment.variables
      }),
      filesystem: new LocalToolRuntimeFilesystemPolicy({
        readRoots: manifest.policy.filesystem.readRoots ?? [],
        writeRoots: manifest.policy.filesystem.writeRoots ?? []
      }),
      network: new LocalToolRuntimeNetworkPolicy({
        hosts: manifest.policy.network.hosts ?? []
      }),
      budgets: new LocalToolRuntimeBudgetPolicy({
        cpuMillis: manifest.policy.budgets.cpuMillis,
        memoryBytes: manifest.policy.budgets.memoryBytes,
        wallClockMillis: manifest.policy.budgets.wallClockMillis,
        stdoutBytes: manifest.policy.budgets.stdoutBytes,
        stderrBytes: manifest.policy.budgets.stderrBytes
      }),
      stdio: new LocalToolRuntimeStdioPolicy({
        stdout: manifest.policy.stdio.stdout,
        stderr: manifest.policy.stdio.stderr
      }),
      cleanup: new LocalToolRuntimeCleanupPolicy({
        killProcessTree: manifest.policy.cleanup.killProcessTree,
        removeWorkingDirectory: manifest.policy.cleanup.removeWorkingDirectory
      })
    }),
    ...(manifest.health === undefined ? {} : { health: manifest.health })
  })

const authorizeRegister = (
  options: LocalToolRuntimeServiceOptions,
  actor: LocalToolRuntimeActor,
  manifest: LocalToolRuntimeManifest,
  traceId: string | undefined
): Effect.Effect<void, LocalToolRuntimeError, never> =>
  Effect.gen(function* () {
    yield* checkPermission(
      options,
      P.nativeInvoke({ primitive: Surface, methods: ["register"] }),
      actor,
      `tool:${manifest.toolId}:register`,
      manifest.toolId,
      "LocalToolRuntime.register",
      traceId
    )
    for (const capability of manifest.permissions) {
      yield* checkPermission(
        options,
        capability,
        actor,
        `tool:${manifest.toolId}:permission`,
        manifest.toolId,
        "LocalToolRuntime.register",
        traceId
      )
    }
    const readRoots = manifest.policy.filesystem.readRoots ?? []
    const writeRoots = manifest.policy.filesystem.writeRoots ?? []
    const hosts = manifest.policy.network.hosts ?? []
    if (readRoots.length > 0) {
      yield* checkPermission(
        options,
        P.filesystemRead({ roots: readRoots }),
        actor,
        `tool:${manifest.toolId}:read`,
        manifest.toolId,
        "LocalToolRuntime.register",
        traceId
      )
    }
    if (writeRoots.length > 0) {
      yield* checkPermission(
        options,
        P.filesystemWrite({ roots: writeRoots }),
        actor,
        `tool:${manifest.toolId}:write`,
        manifest.toolId,
        "LocalToolRuntime.register",
        traceId
      )
    }
    if (hosts.length > 0) {
      yield* checkPermission(
        options,
        P.networkConnect({ hosts, askUnknownHosts: false }),
        actor,
        `tool:${manifest.toolId}:network`,
        manifest.toolId,
        "LocalToolRuntime.register",
        traceId
      )
    }
  })

const authorizeRun = (
  options: LocalToolRuntimeServiceOptions,
  runtime: LocalToolRuntimeState,
  command: LocalToolRuntimeCommand,
  traceId: string | undefined
): Effect.Effect<void, LocalToolRuntimeError, never> =>
  checkPermission(
    options,
    processCapability(runtime.registered.manifest, command),
    runtime.actor,
    `runtime:${runtime.registered.runtimeId}:${command.commandId}`,
    runtime.registered.runtimeId,
    "LocalToolRuntime.run",
    traceId
  )

const checkPermission = (
  options: LocalToolRuntimeServiceOptions,
  capability: NormalizedCapability,
  actor: LocalToolRuntimeActor,
  resource: string,
  auditResource: string,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, LocalToolRuntimeError, never> =>
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
              `local tool runtime permission registry failure: ${error._tag}`,
              operation
            )
          )
        }
        return emitRuntimeAudit(
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

const processCapability = (
  manifest: LocalToolRuntimeManifest,
  command: LocalToolRuntimeCommand
): NormalizedCapability =>
  P.processSpawn({
    commands: [command.executable],
    cwd: [command.cwd ?? primaryCwd(manifest)],
    environment:
      manifest.policy.environment.variables.length === 0 && (command.environment ?? []).length === 0
        ? "none"
        : "allowlist"
  })

const commandById = (
  manifest: LocalToolRuntimeManifest,
  commandId: string
): LocalToolRuntimeCommand | undefined =>
  manifest.commands.find((command) => command.commandId === commandId)

const primaryCwd = (manifest: LocalToolRuntimeManifest): string =>
  manifest.policy.cwd.roots[0] ?? ""

const isWithinRoots = (cwd: string, roots: readonly string[]): boolean =>
  roots.some((root) => cwd === root || cwd.startsWith(`${root}/`))

const publishEvent = (
  events: PubSub.PubSub<LocalToolRuntimeEvent>,
  runtimeId: string,
  phase: LocalToolRuntimeEventPhase,
  options: {
    readonly toolId?: string
    readonly commandId?: string
    readonly runId?: string
    readonly status?: LocalToolRuntimeRunStatus
    readonly health?: LocalToolRuntimeHealthStatus
    readonly reason?: string
  } = {}
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis
    yield* PubSub.publish(
      events,
      new LocalToolRuntimeEvent({
        type: "local-tool-runtime-event",
        timestamp,
        runtimeId,
        phase,
        ...(options.toolId === undefined ? {} : { toolId: options.toolId }),
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
        ...(options.runId === undefined ? {} : { runId: options.runId }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.health === undefined ? {} : { health: options.health }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      })
    )
  }).pipe(Effect.asVoid)

const emitRuntimeAudit = (
  options: LocalToolRuntimeServiceOptions,
  kind: "permission-denied" | "permission-used",
  capability: NormalizedCapability,
  actor: LocalToolRuntimeActor,
  resource: string,
  traceId: string,
  operation: string,
  details: unknown
): Effect.Effect<void, LocalToolRuntimeError, never> => {
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
        `failed to write local tool runtime audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: LocalToolRuntimeActor): PermissionActor =>
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
): Effect.Effect<never, LocalToolRuntimeError, never> =>
  Effect.fail(makeHostProtocolInvalidArgumentError(field, message, operation))

const permissionDeniedError = (
  capability: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: capability.kind,
    message: `local tool runtime denied ${capability.kind}: ${error.reason}`,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported LocalToolRuntime method: ${operation}`,
    operation,
    recoverable: false
  })
