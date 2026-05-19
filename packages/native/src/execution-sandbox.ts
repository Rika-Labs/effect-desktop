import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
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

import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import {
  ExecutionSandboxActor,
  ExecutionSandboxCreateInput,
  ExecutionSandboxCreateRequest,
  ExecutionSandboxCreateResult,
  ExecutionSandboxDestroyInput,
  ExecutionSandboxDestroyRequest,
  ExecutionSandboxDestroyResult,
  ExecutionSandboxEvent,
  type ExecutionSandboxEventPhase,
  ExecutionSandboxFilesystemPolicy,
  ExecutionSandboxNetworkPolicy,
  ExecutionSandboxPolicy,
  ExecutionSandboxRunInput,
  ExecutionSandboxRunRequest,
  ExecutionSandboxRunResult,
  ExecutionSandboxSupportedResult,
  type ExecutionSandboxRunStatus
} from "./contracts/execution-sandbox.js"

const Surface = "ExecutionSandbox"
const UnsupportedReason = "host-adapter-unimplemented"
const ExecutionSandboxEventMethod = "ExecutionSandbox.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type ExecutionSandboxError = HostProtocolError

export const ExecutionSandboxCreate = executionSandboxRpc(
  "create",
  ExecutionSandboxCreateInput,
  ExecutionSandboxCreateResult,
  P.nativeInvoke({ primitive: Surface, methods: ["create"] })
)
export const ExecutionSandboxRun = executionSandboxRpc(
  "run",
  ExecutionSandboxRunInput,
  ExecutionSandboxRunResult,
  P.nativeInvoke({ primitive: Surface, methods: ["run"] })
)
export const ExecutionSandboxDestroy = executionSandboxRpc(
  "destroy",
  ExecutionSandboxDestroyInput,
  ExecutionSandboxDestroyResult,
  P.nativeInvoke({ primitive: Surface, methods: ["destroy"] })
)
export const ExecutionSandboxIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: ExecutionSandboxSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const ExecutionSandboxRpcEvents = Object.freeze({
  Event: { payload: ExecutionSandboxEvent }
})

export type ExecutionSandboxRpcEvents = typeof ExecutionSandboxRpcEvents

const ExecutionSandboxRpcGroup = RpcGroup.make(
  ExecutionSandboxCreate,
  ExecutionSandboxRun,
  ExecutionSandboxDestroy,
  ExecutionSandboxIsSupported
)

export const ExecutionSandboxRpcs: RpcGroup.RpcGroup<ExecutionSandboxRpc> = ExecutionSandboxRpcGroup

export const ExecutionSandboxMethodNames = Object.freeze([
  "create",
  "run",
  "destroy",
  "isSupported"
] as const)

const ExecutionSandboxCapabilityMethods = Object.freeze([
  "create",
  "run",
  "destroy"
] as const satisfies readonly (typeof ExecutionSandboxMethodNames)[number][])

export interface ExecutionSandboxClientApi {
  readonly create: (
    input: ExecutionSandboxCreateInput
  ) => Effect.Effect<ExecutionSandboxCreateResult, ExecutionSandboxError, never>
  readonly run: (
    input: ExecutionSandboxRunInput
  ) => Effect.Effect<ExecutionSandboxRunResult, ExecutionSandboxError, never>
  readonly destroy: (
    input: ExecutionSandboxDestroyInput
  ) => Effect.Effect<ExecutionSandboxDestroyResult, ExecutionSandboxError, never>
  readonly isSupported: () => Effect.Effect<
    ExecutionSandboxSupportedResult,
    ExecutionSandboxError,
    never
  >
  readonly events: () => Stream.Stream<ExecutionSandboxEvent, ExecutionSandboxError, never>
}

export class ExecutionSandboxClient extends Context.Service<
  ExecutionSandboxClient,
  ExecutionSandboxClientApi
>()("@effect-desktop/native/ExecutionSandboxClient") {}

export interface ExecutionSandboxServiceApi {
  readonly create: (
    input: ExecutionSandboxCreateRequest
  ) => Effect.Effect<ExecutionSandboxCreateResult, ExecutionSandboxError, never>
  readonly run: (
    input: ExecutionSandboxRunRequest
  ) => Effect.Effect<ExecutionSandboxRunResult, ExecutionSandboxError, never>
  readonly destroy: (
    input: ExecutionSandboxDestroyRequest
  ) => Effect.Effect<ExecutionSandboxDestroyResult, ExecutionSandboxError, never>
  readonly isSupported: () => Effect.Effect<
    ExecutionSandboxSupportedResult,
    ExecutionSandboxError,
    never
  >
  readonly events: () => Stream.Stream<ExecutionSandboxEvent, ExecutionSandboxError, never>
}

export interface ExecutionSandboxServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly nextSandboxId?: () => string
  readonly nextRunId?: () => string
  readonly nextTraceId?: () => string
}

export class ExecutionSandbox extends Context.Service<
  ExecutionSandbox,
  ExecutionSandboxServiceApi
>()("@effect-desktop/native/ExecutionSandbox") {
  static readonly layer = Layer.effect(ExecutionSandbox)(
    Effect.gen(function* () {
      const client = yield* ExecutionSandboxClient
      const permissions = yield* PermissionRegistry
      return yield* makeExecutionSandboxService(client, { permissions })
    })
  )
}

export const ExecutionSandboxLive = ExecutionSandbox.layer

export const makeExecutionSandboxClientLayer = (
  client: ExecutionSandboxClientApi
): Layer.Layer<ExecutionSandboxClient> => Layer.succeed(ExecutionSandboxClient)(client)

export const makeExecutionSandboxServiceLayer = (
  client: ExecutionSandboxClientApi,
  options: ExecutionSandboxServiceOptions
): Layer.Layer<ExecutionSandbox> =>
  Layer.effect(ExecutionSandbox)(makeExecutionSandboxService(client, options))

export const makeExecutionSandboxBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ExecutionSandboxClient> =>
  ExecutionSandboxSurface.bridgeClientLayer(exchange, options)

export type ExecutionSandboxRpc = RpcGroup.Rpcs<typeof ExecutionSandboxRpcGroup>

export type ExecutionSandboxRpcHandlers = RpcGroup.HandlersFrom<ExecutionSandboxRpc>

export const ExecutionSandboxHandlersLive = ExecutionSandboxRpcGroup.toLayer({
  "ExecutionSandbox.create": (input) =>
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      return yield* sandbox.create(input)
    }),
  "ExecutionSandbox.run": (input) =>
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      return yield* sandbox.run(input)
    }),
  "ExecutionSandbox.destroy": (input) =>
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      return yield* sandbox.destroy(input)
    }),
  "ExecutionSandbox.isSupported": () =>
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      return yield* sandbox.isSupported()
    })
})

export const ExecutionSandboxSurface = NativeSurface.make(Surface, ExecutionSandboxRpcGroup, {
  service: ExecutionSandboxClient,
  capabilities: ExecutionSandboxCapabilityMethods,
  handlers: ExecutionSandboxHandlersLive,
  client: (client) => executionSandboxClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => executionSandboxClientFromRpcClient(client, exchange)
})

export const makeHostExecutionSandboxRpcRuntime = (
  handlers: ExecutionSandboxRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  ExecutionSandboxSurface.hostRuntime(handlers, runtimeOptions)

export interface ExecutionSandboxMemoryClientOptions {
  readonly failure?: Partial<Record<"create" | "run" | "destroy", ExecutionSandboxError>>
  readonly nextSandboxId?: () => string
  readonly nextRunId?: () => string
  readonly stdout?: string
  readonly stderr?: string
  readonly status?: ExecutionSandboxRunStatus
}

interface ExecutionSandboxState {
  readonly actor: ExecutionSandboxActor
  readonly created: ExecutionSandboxCreateResult
}

export const makeExecutionSandboxMemoryClient = (
  options: ExecutionSandboxMemoryClientOptions = {}
): Effect.Effect<ExecutionSandboxClientApi, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<ExecutionSandboxEvent>({ capacity: 256, replay: 64 })
    const nextSandboxId = yield* makeIdGenerator(options.nextSandboxId, "execution-sandbox")
    const nextRunId = yield* makeIdGenerator(options.nextRunId, "execution-sandbox-run")

    const publish = (
      sandboxId: string,
      phase: ExecutionSandboxEventPhase,
      options: {
        readonly runId?: string
        readonly status?: ExecutionSandboxRunStatus
        readonly reason?: string
      } = {}
    ): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const timestamp = yield* Clock.currentTimeMillis
        yield* PubSub.publish(
          pubsub,
          new ExecutionSandboxEvent({
            type: "sandbox-event",
            timestamp,
            sandboxId,
            phase,
            ...(options.runId === undefined ? {} : { runId: options.runId }),
            ...(options.status === undefined ? {} : { status: options.status }),
            ...(options.reason === undefined ? {} : { reason: options.reason })
          })
        )
      }).pipe(Effect.asVoid)

    return Object.freeze({
      create: (input) =>
        validateCreateInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.create,
              Effect.gen(function* () {
                const sandboxId = valid.sandboxId ?? (yield* nextSandboxId())
                const result = new ExecutionSandboxCreateResult({
                  sandboxId,
                  policy: normalizePolicy(valid.policy),
                  state: "created"
                })
                yield* publish(sandboxId, "created")
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
                const runId = valid.runId ?? (yield* nextRunId())
                const status = options.status ?? "completed"
                yield* publish(valid.sandboxId, "run-started", { runId })
                const result = new ExecutionSandboxRunResult({
                  sandboxId: valid.sandboxId,
                  runId,
                  status,
                  ...(status === "completed" ? { exitCode: 0 } : {}),
                  stdout: options.stdout ?? "",
                  stderr: options.stderr ?? ""
                })
                yield* publish(valid.sandboxId, "run-completed", { runId, status })
                return result
              })
            )
          )
        ),
      destroy: (input) =>
        validateDestroyInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.destroy,
              publish(valid.sandboxId, "destroyed").pipe(
                Effect.as(
                  new ExecutionSandboxDestroyResult({
                    sandboxId: valid.sandboxId,
                    destroyed: true
                  })
                )
              )
            )
          )
        ),
      isSupported: () => Effect.succeed(new ExecutionSandboxSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies ExecutionSandboxClientApi)
  })

export const makeExecutionSandboxUnsupportedClient = (): ExecutionSandboxClientApi =>
  Object.freeze({
    create: (input) =>
      validateCreateInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExecutionSandbox.create")))
      ),
    run: (input) =>
      validateRunInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExecutionSandbox.run")))
      ),
    destroy: (input) =>
      validateDestroyInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ExecutionSandbox.destroy")))
      ),
    isSupported: () =>
      Effect.succeed(
        new ExecutionSandboxSupportedResult({
          supported: false,
          reason: UnsupportedReason
        })
      ),
    events: () => Stream.fail(unsupportedError(ExecutionSandboxEventMethod))
  } satisfies ExecutionSandboxClientApi)

const makeExecutionSandboxService = (
  client: ExecutionSandboxClientApi,
  options: ExecutionSandboxServiceOptions
): Effect.Effect<ExecutionSandboxServiceApi, never, never> =>
  Effect.gen(function* () {
    const sandboxes = yield* Ref.make<ReadonlyMap<string, ExecutionSandboxState>>(new Map())
    const events = yield* PubSub.bounded<ExecutionSandboxEvent>({ capacity: 256, replay: 64 })
    const nextSandboxId = yield* makeIdGenerator(options.nextSandboxId, "execution-sandbox")
    const nextRunId = yield* makeIdGenerator(options.nextRunId, "execution-sandbox-run")

    return Object.freeze({
      create: (input) =>
        Effect.gen(function* () {
          const request = yield* validateCreateRequest(input)
          const sandboxId = request.sandboxId ?? (yield* nextSandboxId())
          const valid = new ExecutionSandboxCreateInput({
            actor: request.actor,
            policy: normalizePolicy(request.policy),
            sandboxId,
            ...(request.traceId === undefined ? {} : { traceId: request.traceId })
          })
          yield* authorizePolicy(
            options,
            valid.actor,
            valid.policy,
            "ExecutionSandbox.create",
            valid.traceId
          )
          const result = yield* client.create(valid)
          yield* Ref.update(sandboxes, (current) =>
            new Map(current).set(result.sandboxId, {
              actor: valid.actor,
              created: result
            })
          )
          yield* publishEvent(events, result.sandboxId, "created")
          yield* emitSandboxAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["create"] }),
            valid.actor,
            result.sandboxId,
            valid.traceId ?? result.sandboxId,
            "ExecutionSandbox.create",
            { policy: result.policy }
          )
          return result
        }),
      run: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRunRequest(input)
          const current = yield* Ref.get(sandboxes)
          const sandbox = current.get(request.sandboxId)
          if (sandbox === undefined) {
            return yield* Effect.fail(
              makeHostProtocolInvalidArgumentError(
                "sandboxId",
                "must reference a created execution sandbox",
                "ExecutionSandbox.run"
              )
            )
          }
          const runId = request.runId ?? (yield* nextRunId())
          const valid = new ExecutionSandboxRunInput({
            sandboxId: request.sandboxId,
            command: request.command,
            ...(request.args === undefined ? {} : { args: request.args }),
            runId,
            ...(request.traceId === undefined ? {} : { traceId: request.traceId })
          })
          yield* authorizeRun(options, sandbox, valid)
          yield* publishEvent(events, valid.sandboxId, "run-started", { runId })
          const result = yield* client.run(valid)
          yield* publishEvent(events, valid.sandboxId, "run-completed", {
            runId: result.runId,
            status: result.status
          })
          yield* emitSandboxAudit(
            options,
            "permission-used",
            processCapability(sandbox.created.policy, valid.command),
            sandbox.actor,
            valid.sandboxId,
            valid.traceId ?? runId,
            "ExecutionSandbox.run",
            {
              command: valid.command,
              args: valid.args ?? [],
              policy: sandbox.created.policy,
              status: result.status
            }
          )
          return result
        }),
      destroy: (input) =>
        Effect.gen(function* () {
          const valid = yield* validateDestroyRequest(input)
          const current = yield* Ref.get(sandboxes)
          if (!current.has(valid.sandboxId)) {
            return yield* Effect.fail(
              makeHostProtocolInvalidArgumentError(
                "sandboxId",
                "must reference a created execution sandbox",
                "ExecutionSandbox.destroy"
              )
            )
          }
          const result = yield* client.destroy(
            new ExecutionSandboxDestroyInput({
              sandboxId: valid.sandboxId,
              ...(valid.traceId === undefined ? {} : { traceId: valid.traceId })
            })
          )
          yield* Ref.update(sandboxes, (state) => {
            const next = new Map(state)
            next.delete(valid.sandboxId)
            return next
          })
          yield* publishEvent(events, valid.sandboxId, "destroyed")
          yield* emitSandboxAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["destroy"] }),
            current.get(valid.sandboxId)?.actor ?? fallbackSandboxActor(),
            valid.sandboxId,
            valid.traceId ?? valid.sandboxId,
            "ExecutionSandbox.destroy",
            { destroyed: result.destroyed }
          )
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => Stream.fromPubSub(events)
    } satisfies ExecutionSandboxServiceApi)
  })

const executionSandboxClientFromRpcClient = (
  client: DesktopRpcClient<ExecutionSandboxRpc>,
  _exchange: BridgeClientExchange | undefined
): ExecutionSandboxClientApi =>
  Object.freeze({
    create: (input) =>
      validateCreateInput(input).pipe(
        Effect.flatMap((valid) =>
          runExecutionSandboxRpc(
            client["ExecutionSandbox.create"](valid),
            "ExecutionSandbox.create"
          )
        )
      ),
    run: (input) =>
      validateRunInput(input).pipe(
        Effect.flatMap((valid) =>
          runExecutionSandboxRpc(client["ExecutionSandbox.run"](valid), "ExecutionSandbox.run")
        )
      ),
    destroy: (input) =>
      validateDestroyInput(input).pipe(
        Effect.flatMap((valid) =>
          runExecutionSandboxRpc(
            client["ExecutionSandbox.destroy"](valid),
            "ExecutionSandbox.destroy"
          )
        )
      ),
    isSupported: () =>
      runExecutionSandboxRpc(
        client["ExecutionSandbox.isSupported"](undefined),
        "ExecutionSandbox.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(ExecutionSandboxEventMethod))
  } satisfies ExecutionSandboxClientApi)

function executionSandboxRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: UnsupportedSupport
  })
}

const runExecutionSandboxRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ExecutionSandboxError, never> => runNativeRpc(effect, operation, Surface)

const validateCreateRequest = (
  input: unknown
): Effect.Effect<ExecutionSandboxCreateRequest, ExecutionSandboxError, never> =>
  decodeNativeInput(ExecutionSandboxCreateRequest, input, "ExecutionSandbox.create")

const validateCreateInput = (
  input: unknown
): Effect.Effect<ExecutionSandboxCreateInput, ExecutionSandboxError, never> =>
  decodeNativeInput(ExecutionSandboxCreateInput, input, "ExecutionSandbox.create")

const validateRunRequest = (
  input: unknown
): Effect.Effect<ExecutionSandboxRunRequest, ExecutionSandboxError, never> =>
  decodeNativeInput(ExecutionSandboxRunRequest, input, "ExecutionSandbox.run").pipe(
    Effect.tap((valid) => validateCommand(valid.command, "ExecutionSandbox.run"))
  )

const validateRunInput = (
  input: unknown
): Effect.Effect<ExecutionSandboxRunInput, ExecutionSandboxError, never> =>
  decodeNativeInput(ExecutionSandboxRunInput, input, "ExecutionSandbox.run").pipe(
    Effect.tap((valid) => validateCommand(valid.command, "ExecutionSandbox.run"))
  )

const validateDestroyRequest = (
  input: unknown
): Effect.Effect<ExecutionSandboxDestroyRequest, ExecutionSandboxError, never> =>
  decodeNativeInput(ExecutionSandboxDestroyRequest, input, "ExecutionSandbox.destroy")

const validateDestroyInput = (
  input: unknown
): Effect.Effect<ExecutionSandboxDestroyInput, ExecutionSandboxError, never> =>
  decodeNativeInput(ExecutionSandboxDestroyInput, input, "ExecutionSandbox.destroy")

const failOr = <A>(
  error: ExecutionSandboxError | undefined,
  effect: Effect.Effect<A, ExecutionSandboxError, never>
): Effect.Effect<A, ExecutionSandboxError, never> =>
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

const normalizePolicy = (policy: ExecutionSandboxPolicy): ExecutionSandboxPolicy =>
  new ExecutionSandboxPolicy({
    cwd: policy.cwd,
    environment: policy.environment ?? [],
    filesystem: new ExecutionSandboxFilesystemPolicy({
      readRoots: policy.filesystem?.readRoots ?? [],
      writeRoots: policy.filesystem?.writeRoots ?? []
    }),
    network: new ExecutionSandboxNetworkPolicy({
      hosts: policy.network?.hosts ?? []
    }),
    budgets: policy.budgets,
    cleanup: policy.cleanup
  })

const authorizePolicy = (
  options: ExecutionSandboxServiceOptions,
  actor: ExecutionSandboxActor,
  policy: ExecutionSandboxPolicy,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, ExecutionSandboxError, never> =>
  Effect.gen(function* () {
    const readRoots = policy.filesystem?.readRoots ?? []
    const writeRoots = policy.filesystem?.writeRoots ?? []
    const hosts = policy.network?.hosts ?? []
    if (readRoots.length > 0) {
      yield* checkPermission(
        options,
        P.filesystemRead({ roots: readRoots }),
        actor,
        `sandbox:${policy.cwd}:read`,
        policy.cwd,
        operation,
        traceId
      )
    }
    if (writeRoots.length > 0) {
      yield* checkPermission(
        options,
        P.filesystemWrite({ roots: writeRoots }),
        actor,
        `sandbox:${policy.cwd}:write`,
        policy.cwd,
        operation,
        traceId
      )
    }
    if (hosts.length > 0) {
      yield* checkPermission(
        options,
        P.networkConnect({ hosts, askUnknownHosts: false }),
        actor,
        `sandbox:${policy.cwd}:network`,
        policy.cwd,
        operation,
        traceId
      )
    }
  })

const authorizeRun = (
  options: ExecutionSandboxServiceOptions,
  sandbox: ExecutionSandboxState,
  input: ExecutionSandboxRunInput
): Effect.Effect<void, ExecutionSandboxError, never> =>
  checkPermission(
    options,
    processCapability(sandbox.created.policy, input.command),
    sandbox.actor,
    `sandbox:${input.sandboxId}:${input.command}`,
    input.sandboxId,
    "ExecutionSandbox.run",
    input.traceId
  )

const checkPermission = (
  options: ExecutionSandboxServiceOptions,
  capability: NormalizedCapability,
  actor: ExecutionSandboxActor,
  resource: string,
  auditResource: string,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, ExecutionSandboxError, never> =>
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
              `execution sandbox permission registry failure: ${error._tag}`,
              operation
            )
          )
        }
        return emitSandboxAudit(
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

const validateCommand = (
  command: string,
  operation: string
): Effect.Effect<void, ExecutionSandboxError, never> =>
  containsShellMetacharacter(command)
    ? Effect.fail(
        makeHostProtocolInvalidArgumentError("command", "contains shell metacharacters", operation)
      )
    : Effect.void

const processCapability = (policy: ExecutionSandboxPolicy, command: string): NormalizedCapability =>
  P.processSpawn({
    commands: [command],
    cwd: [policy.cwd],
    environment: (policy.environment ?? []).length === 0 ? "none" : "allowlist"
  })

const containsShellMetacharacter = (command: string): boolean => SHELL_METACHARACTER.test(command)

const SHELL_METACHARACTER = /[;|&><`\n]|\$\(/

const fallbackSandboxActor = (): ExecutionSandboxActor =>
  new ExecutionSandboxActor({ kind: "native", id: Surface })

const publishEvent = (
  events: PubSub.PubSub<ExecutionSandboxEvent>,
  sandboxId: string,
  phase: ExecutionSandboxEventPhase,
  options: {
    readonly runId?: string
    readonly status?: ExecutionSandboxRunStatus
    readonly reason?: string
  } = {}
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis
    yield* PubSub.publish(
      events,
      new ExecutionSandboxEvent({
        type: "sandbox-event",
        timestamp,
        sandboxId,
        phase,
        ...(options.runId === undefined ? {} : { runId: options.runId }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      })
    )
  }).pipe(Effect.asVoid)

const emitSandboxAudit = (
  options: ExecutionSandboxServiceOptions,
  kind: "permission-denied" | "permission-used",
  capability: NormalizedCapability,
  actor: ExecutionSandboxActor,
  resource: string,
  traceId: string,
  operation: string,
  details: unknown
): Effect.Effect<void, ExecutionSandboxError, never> => {
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
        `failed to write execution sandbox audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: ExecutionSandboxActor): PermissionActor =>
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

const permissionDeniedError = (
  capability: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: capability.kind,
    message: `execution sandbox denied ${capability.kind}: ${error.reason}`,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ExecutionSandbox method: ${operation}`,
    operation,
    recoverable: false
  })
