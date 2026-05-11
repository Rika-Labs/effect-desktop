import { afterEach, expect } from "bun:test"
import { posix, sep } from "node:path"
import { Context, Data, Effect, Exit, Layer, Option, Stream } from "effect"

import {
  ApiStreamCompleteFrame,
  ApiStreamDataFrame,
  Client,
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolNotFoundError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  HostProtocolUnsupportedError,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  hostProtocolErrorRecoverableDefault,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidStateError,
  makeHostHandshakeClient,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolNotFoundError,
  makeStaleHandleError,
  makeHostWindowClient,
  type ApiClient,
  type ApiClientExchange,
  type ApiClientOptions,
  type ApiClientResponse,
  type ApiContractClass,
  type ApiResourceHandle,
  type HostHandshakeClient,
  type HostProtocolError,
  type HostProtocolInvalidArgumentError,
  type HostProtocolStreamEnvelope,
  type HostWindowClient,
  type WindowCreateInput
} from "@effect-desktop/bridge"
import {
  ResourceRegistry,
  SecretValue,
  Filesystem,
  PermissionRegistry,
  Process,
  ProcessExitStatus,
  PTY,
  PtyExitStatus,
  Telemetry,
  makeResourceRegistry,
  makeFilesystem,
  makePermissionRegistry,
  makeProcess,
  makePty,
  makeTelemetry,
  type FilesystemAdapter,
  type FilesystemApi,
  type FilesystemOptions,
  type FilesystemPermissionPolicy,
  type FilesystemWatcher,
  type PermissionRegistryOptions,
  type ProcessAdapter,
  type ProcessApi,
  type ProcessBudgetPolicy,
  type ProcessChild,
  type ProcessPermissionPolicy,
  type ProcessSignalInput,
  type ProcessSpawnInput,
  type PtyAdapter,
  type PtyApi,
  type PtyBudgetPolicy,
  type PtyChild,
  type PtyOpenInput,
  type PtyPermissionPolicy,
  type PtyResizeInput,
  type PtySignalInput,
  type RawFilesystemEvent,
  type RegistrySnapshot,
  type ResourceEntry,
  type ResourceHandle,
  type ResourceRegistryApi,
  type ResourceId,
  type ResourceKind,
  type SecretsSafeStorageApi,
  type TelemetryInvalidArgumentError,
  type TelemetryOptions
} from "@effect-desktop/core"

export interface LeakDetectionOptions {
  readonly allowedResourceIds?: readonly ResourceId[]
  readonly allowedResourceKinds?: readonly ResourceKind[]
  readonly testName?: string
}

export class ResourceLeakError extends Data.TaggedError("ResourceLeakError")<{
  readonly leaks: readonly ResourceEntry[]
  readonly message: string
  readonly report: string
}> {}

export interface HeadlessHarnessOptions {
  readonly fixtures?: Readonly<Record<string, HeadlessFixture>>
  readonly leakDetection?: LeakDetectionOptions
  readonly nextRequestId?: () => string
  readonly nextTraceId?: () => string
  readonly now?: () => number
  readonly ownerScope?: string
}

export type MockHostOptions = Omit<HeadlessHarnessOptions, "leakDetection" | "ownerScope">

interface HeadlessFixturePayloadObject {
  readonly [key: string]: HeadlessFixturePayload
}

type HeadlessFixturePayload =
  | string
  | number
  | boolean
  | symbol
  | null
  | undefined
  | readonly HeadlessFixturePayload[]
  | HeadlessFixturePayloadObject

export type HeadlessFixture = (
  request: HostProtocolRequestEnvelope,
  state: HeadlessHostState
) => Effect.Effect<HeadlessFixturePayload, HostProtocolError, never> | HeadlessFixturePayload

export interface HeadlessHostCall {
  readonly method: string
  readonly request: HostProtocolRequestEnvelope
}

export interface HeadlessHostState {
  readonly windows: ReadonlyMap<string, WindowCreateInput>
}

export interface MockHostApi {
  readonly calls: () => readonly HeadlessHostCall[]
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
  readonly windows: () => ReadonlyMap<string, WindowCreateInput>
}

export class MockHost extends Context.Service<MockHost, MockHostApi>()(
  "@effect-desktop/test/MockHost"
) {}

export const makeMockHost = (options: MockHostOptions = {}): MockHostApi => {
  const calls: HeadlessHostCall[] = []
  const windows = new Map<string, WindowCreateInput>()
  let nextWindowId = 1

  const state: HeadlessHostState = {
    windows
  }

  return Object.freeze({
    calls: () =>
      calls.map((call) =>
        freezeJsonSnapshot({
          method: call.method,
          request: cloneHostRequest(call.request)
        })
      ),
    windows: () => new Map(windows),
    request: (request) =>
      Effect.gen(function* () {
        calls.push({
          method: request.method,
          request: cloneHostRequest(request)
        })

        const fixture = options.fixtures?.[request.method] ?? defaultFixture(request.method)
        const payload = yield* resolveFixture(fixture, request, state)
        const responsePayload =
          payload === DEFAULT_WINDOW_CREATE_PAYLOAD
            ? { windowId: `headless-window-${nextWindowId}` }
            : payload

        if (request.method === WINDOW_CREATE_METHOD) {
          const windowId = yield* readWindowId(responsePayload, request.method)
          windows.set(windowId, readWindowCreateInput(request.payload))
          nextWindowId += 1
        } else if (request.method === WINDOW_DESTROY_METHOD) {
          windows.delete(yield* readWindowId(request.payload, request.method))
        }

        return new HostProtocolResponseEnvelope({
          kind: "response",
          id: request.id,
          timestamp: options.now?.() ?? Date.now(),
          traceId: request.traceId,
          payload: responsePayload
        })
      })
  } satisfies MockHostApi)
}

export const MockHostLive = (options: MockHostOptions = {}): Layer.Layer<MockHost> =>
  Layer.succeed(MockHost)(makeMockHost(options))

export interface MockBridgeCall {
  readonly method: string
  readonly payload: unknown
  readonly traceId: string
  readonly timestamp: number
}

export interface MockBridgeApi {
  readonly exchange: ApiClientExchange
  readonly client: <Contracts extends Readonly<Record<string, ApiContractClass>>>(
    contracts: Contracts,
    options?: ApiClientOptions
  ) => ApiClient<Contracts>
  readonly calls: () => readonly MockBridgeCall[]
  readonly cancels: () => readonly HostProtocolCancelByRequestEnvelope[]
  readonly disposedResources: () => readonly ApiResourceHandle[]
  readonly succeed: (
    method: string,
    payload: unknown
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly fail: (method: string, error: unknown) => Effect.Effect<void, HostProtocolError, never>
  readonly resource: (
    method: string,
    handle: ApiResourceHandle
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly streamChunks: (
    method: string,
    chunks: readonly unknown[]
  ) => Effect.Effect<void, HostProtocolError, never>
}

export class MockBridge extends Context.Service<MockBridge, MockBridgeApi>()(
  "@effect-desktop/test/MockBridge"
) {}

export interface MockBridgeOptions {
  readonly now?: () => number
  readonly registry?: ResourceRegistryApi
}

export const makeMockBridge = (options: MockBridgeOptions = {}): MockBridgeApi => {
  const calls: MockBridgeCall[] = []
  const cancels: HostProtocolCancelByRequestEnvelope[] = []
  const disposedResources: ApiResourceHandle[] = []
  const responses = new Map<string, ApiClientResponse[]>()
  const streams = new Map<string, readonly unknown[]>()
  const now = options.now ?? Date.now

  const enqueue = (
    method: string,
    response: ApiClientResponse
  ): Effect.Effect<void, HostProtocolError, never> =>
    Effect.sync(() => {
      const queue = responses.get(method) ?? []
      queue.push(response)
      responses.set(method, queue)
    })

  const exchange: ApiClientExchange = Object.freeze({
    request: (request: HostProtocolRequestEnvelope) =>
      Effect.gen(function* () {
        recordCall(calls, request)
        const response = responses.get(request.method)?.shift()
        if (response === undefined) {
          return yield* Effect.fail(
            makeHostProtocolInvalidStateError(
              "missing pinned response",
              "MockBridge",
              request.method
            )
          )
        }

        return response
      }),
    stream: (request: HostProtocolRequestEnvelope) => {
      recordCall(calls, request)
      const chunks = streams.get(request.method)
      if (chunks === undefined) {
        return Stream.fail(
          makeHostProtocolInvalidStateError("missing pinned stream", "MockBridge", request.method)
        )
      }

      return Stream.fromIterable(chunks)
        .pipe(
          Stream.map((chunk) =>
            streamEnvelope(request, now(), new ApiStreamDataFrame({ type: "data", chunk }))
          )
        )
        .pipe(
          Stream.concat(
            Stream.succeed(
              streamEnvelope(request, now(), new ApiStreamCompleteFrame({ type: "complete" }))
            )
          )
        )
    },
    cancel: (request: HostProtocolCancelByRequestEnvelope) =>
      Effect.sync(() => {
        cancels.push(request)
      }),
    resource: {
      dispose: (handle: ApiResourceHandle) =>
        Effect.gen(function* () {
          disposedResources.push(handle)

          if (options.registry === undefined) {
            return
          }

          const coreHandle = bridgeHandleToCoreHandle(handle)
          const entry = yield* Effect.mapError(options.registry.assertFresh(coreHandle), (error) =>
            makeStaleHandleError("Resource.dispose", handle, error.actualGeneration)
          )

          yield* entry.handle.dispose()
        })
    }
  })

  return Object.freeze({
    exchange,
    client: (contracts, clientOptions = {}) => Client(contracts, exchange, clientOptions),
    calls: () =>
      calls.map((call) =>
        freezeJsonSnapshot({
          method: call.method,
          payload: cloneJsonPayload(call.payload),
          traceId: call.traceId,
          timestamp: call.timestamp
        })
      ),
    cancels: () => cancels.slice(),
    disposedResources: () => disposedResources.slice(),
    succeed: (method, payload) =>
      validateJsonPayload(method, payload).pipe(
        Effect.flatMap((validated) => enqueue(method, { kind: "success", payload: validated }))
      ),
    fail: (method, error) =>
      validateJsonPayload(method, error).pipe(
        Effect.flatMap((validated) => enqueue(method, { kind: "failure", error: validated }))
      ),
    resource: (method, handle) =>
      Effect.gen(function* () {
        if (options.registry === undefined) {
          yield* validateJsonPayload(method, handle)
          yield* enqueue(method, { kind: "success", payload: handle })
          return
        }

        const registered = yield* options.registry.register({
          kind: handle.kind,
          id: handle.id as ResourceId,
          ownerScope: handle.ownerScope,
          state: handle.state,
          reusableId: true
        })
        const payload = coreHandleToBridgeHandle(registered)
        yield* validateJsonPayload(method, payload)
        yield* enqueue(method, { kind: "success", payload })
      }),
    streamChunks: (method, chunks) =>
      Effect.gen(function* () {
        yield* Effect.forEach(chunks, (chunk) => validateJsonPayload(method, chunk))
        streams.set(method, chunks.slice())
        return yield* Effect.void
      })
  } satisfies MockBridgeApi)
}

export const MockBridgeLive = (options: MockBridgeOptions = {}): Layer.Layer<MockBridge> =>
  Layer.succeed(MockBridge)(makeMockBridge(options))

export interface MemoryFilesystemFile {
  readonly path: string
  readonly bytes: Uint8Array
}

export interface MemoryFilesystemSymlink {
  readonly path: string
  readonly target: string
}

export interface MemoryFilesystemOptions {
  readonly files?: readonly MemoryFilesystemFile[]
  readonly directories?: readonly string[]
  readonly symlinks?: readonly MemoryFilesystemSymlink[]
  readonly permissions?: FilesystemPermissionPolicy
  readonly now?: () => number
}

export const makeMemoryFilesystem = (
  registry: ResourceRegistryApi,
  options: MemoryFilesystemOptions = {}
): Effect.Effect<FilesystemApi, never, never> =>
  makeFilesystem(registry, memoryFilesystemOptions(options))

export const MemoryFilesystemLive = (
  options: MemoryFilesystemOptions = {}
): Layer.Layer<Filesystem, never, ResourceRegistry> =>
  Layer.effect(
    Filesystem,
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      return yield* makeMemoryFilesystem(registry, options)
    })
  )

export const MemoryFilesystem = Object.freeze({
  layer: MemoryFilesystemLive
})

export interface MockProcessFixture {
  readonly command?: string
  readonly args?: readonly string[]
  readonly pid?: number
  readonly childPids?: readonly number[]
  readonly stdout?: readonly Uint8Array[]
  readonly stderr?: readonly Uint8Array[]
  readonly exit?: ProcessExitStatus | { readonly code: number; readonly signal?: string } | false
}

export interface MockProcessSpawnRecord {
  readonly input: ProcessSpawnInput
  readonly pid: number
  readonly stdin: readonly Uint8Array[]
  readonly stdinClosed: boolean
  readonly killedWith: ProcessSignalInput | undefined
  readonly terminateTreeCalls: number
  readonly forceKillTreeCalls: number
}

export interface MockProcessOptions {
  readonly processes?: readonly MockProcessFixture[]
  readonly budgets?: ProcessBudgetPolicy
  readonly gracefulShutdownMs?: number
  readonly permissions?: ProcessPermissionPolicy
  readonly now?: () => number
}

export interface MockProcessApi extends ProcessApi {
  readonly calls: () => readonly MockProcessSpawnRecord[]
}

export const makeMockProcess = (
  registry: ResourceRegistryApi,
  options: MockProcessOptions = {}
): Effect.Effect<MockProcessApi, HostProtocolInvalidArgumentError, never> => {
  const calls: MutableMockProcessSpawnRecord[] = []
  return makeProcess(registry, {
    adapter: makeMockProcessAdapter(options, calls),
    ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
    ...(options.gracefulShutdownMs === undefined
      ? {}
      : { gracefulShutdownMs: options.gracefulShutdownMs }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    ...(options.now === undefined ? {} : { now: options.now })
  }).pipe(Effect.map((api) => Object.freeze({ ...api, calls: () => cloneProcessCalls(calls) })))
}

export const MockProcessLive = (
  options: MockProcessOptions = {}
): Layer.Layer<Process, HostProtocolInvalidArgumentError, ResourceRegistry> =>
  Layer.effect(
    Process,
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      return yield* makeMockProcess(registry, options)
    })
  )

export const MockProcess = Object.freeze({
  layer: MockProcessLive
})

export interface MockPtyFixture {
  readonly command?: string
  readonly args?: readonly string[]
  readonly pid?: number | null
  readonly output?: readonly Uint8Array[]
  readonly exit?: PtyExitStatus | { readonly code: number; readonly signal?: string } | false
}

export interface MockPtyOpenRecord {
  readonly input: PtyOpenInput
  readonly pid: number | undefined
  readonly writes: readonly Uint8Array[]
  readonly resizes: readonly PtyResizeInput[]
  readonly killedWith: PtySignalInput | undefined
  readonly terminateTreeCalls: number
  readonly forceKillTreeCalls: number
}

export interface MockPtyOptions {
  readonly ptys?: readonly MockPtyFixture[]
  readonly budgets?: PtyBudgetPolicy
  readonly gracefulShutdownMs?: number
  readonly permissions?: PtyPermissionPolicy
}

export interface MockPtyApi extends PtyApi {
  readonly calls: () => readonly MockPtyOpenRecord[]
}

export const makeMockPty = (
  registry: ResourceRegistryApi,
  options: MockPtyOptions = {}
): Effect.Effect<MockPtyApi, never, never> => {
  const calls: MutableMockPtyOpenRecord[] = []
  return makePty(registry, {
    adapter: makeMockPtyAdapter(options, calls),
    ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
    ...(options.gracefulShutdownMs === undefined
      ? {}
      : { gracefulShutdownMs: options.gracefulShutdownMs }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions })
  }).pipe(Effect.map((api) => Object.freeze({ ...api, calls: () => clonePtyCalls(calls) })))
}

export const MockPtyLive = (
  options: MockPtyOptions = {}
): Layer.Layer<PTY, never, ResourceRegistry> =>
  Layer.effect(
    PTY,
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      return yield* makeMockPty(registry, options)
    })
  )

export const MockPTY = Object.freeze({
  layer: MockPtyLive
})

export interface HeadlessRuntimeLayerOptions {
  readonly bridge?: Omit<MockBridgeOptions, "registry">
  readonly filesystem?: MemoryFilesystemOptions
  readonly host?: MockHostOptions
  readonly leakDetection?: false | LeakDetectionOptions
  readonly permissions?: PermissionRegistryOptions
  readonly process?: MockProcessOptions
  readonly pty?: MockPtyOptions
  readonly registry?: Parameters<typeof makeResourceRegistry>[0]
  readonly telemetry?: TelemetryOptions
}

type HeadlessRuntimeServices =
  | MockHost
  | MockBridge
  | Filesystem
  | Process
  | PTY
  | ResourceRegistry
  | Telemetry
  | PermissionRegistry

export const HeadlessRuntimeLive = (
  options: HeadlessRuntimeLayerOptions = {}
): Layer.Layer<
  HeadlessRuntimeServices,
  TelemetryInvalidArgumentError | HostProtocolInvalidArgumentError
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry(options.registry)
      return yield* makeHeadlessRuntimeContext(options, registry)
    })
  )

export const runHeadlessRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: HeadlessRuntimeLayerOptions = {}
) =>
  Effect.gen(function* () {
    const registry = yield* makeResourceRegistry(options.registry)
    const layer = Layer.effectContext(makeHeadlessRuntimeContext(options, registry))
    const result = yield* Effect.exit(effect.pipe(Effect.provide(layer)))
    if (options.leakDetection !== false) {
      yield* assertNoOpenResourcesIn(registry, {
        testName: "HeadlessRuntime.run",
        ...options.leakDetection
      })
    }
    if (Exit.isFailure(result)) {
      return yield* Effect.failCause(result.cause)
    }

    return result.value
  })

const makeHeadlessRuntimeContext = (
  options: HeadlessRuntimeLayerOptions,
  registry: ResourceRegistryApi
): Effect.Effect<
  Context.Context<HeadlessRuntimeServices>,
  TelemetryInvalidArgumentError | HostProtocolInvalidArgumentError,
  never
> =>
  Effect.gen(function* () {
    const telemetry = yield* makeTelemetry(options.telemetry)
    const permissions = yield* makePermissionRegistry(options.permissions)
    const host = makeMockHost(options.host)
    const bridge = makeMockBridge({ ...options.bridge, registry })
    const filesystem = yield* makeMemoryFilesystem(registry, options.filesystem)
    const process = yield* makeMockProcess(registry, options.process)
    const pty = yield* makeMockPty(registry, options.pty)

    return Context.add(
      PermissionRegistry,
      permissions
    )(
      Context.add(
        Telemetry,
        telemetry
      )(
        Context.add(
          ResourceRegistry,
          registry
        )(
          Context.add(
            PTY,
            pty
          )(
            Context.add(
              Process,
              process
            )(
              Context.add(
                Filesystem,
                filesystem
              )(Context.add(MockBridge, bridge)(Context.make(MockHost, host)))
            )
          )
        )
      )
    )
  })

export const HeadlessRuntime = Object.freeze({
  layer: HeadlessRuntimeLive,
  run: runHeadlessRuntime
})

export interface HeadlessRuntime {
  readonly calls: () => readonly HeadlessHostCall[]
  readonly handshake: HostHandshakeClient
  readonly registry: ResourceRegistryApi
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
  readonly window: HostWindowClient
}

export interface MemorySecretsOptions {
  readonly available?: boolean
}

export interface MemorySecretsSafeStorage extends SecretsSafeStorageApi {
  readonly snapshot: () => Effect.Effect<ReadonlyMap<string, Uint8Array>, never, never>
}

export const makeMemorySecretsSafeStorage = (
  options: MemorySecretsOptions = {}
): MemorySecretsSafeStorage => {
  const values = new Map<string, Uint8Array>()
  const available = options.available ?? true

  return {
    isAvailable: () => Effect.succeed(available),
    set: (key, value) =>
      available
        ? Effect.sync(() => {
            values.set(key, value.unsafeBytes())
          })
        : Effect.fail(unsupportedSafeStorage("SafeStorage.set")),
    get: (key) =>
      available
        ? Effect.gen(function* () {
            const value = values.get(key)
            if (value === undefined) {
              return yield* Effect.fail(secretNotFound(key, "SafeStorage.get"))
            }

            return SecretValue.fromBytes(value)
          })
        : Effect.fail(unsupportedSafeStorage("SafeStorage.get")),
    delete: (key) =>
      available
        ? Effect.sync(() => {
            values.delete(key)
          })
        : Effect.fail(unsupportedSafeStorage("SafeStorage.delete")),
    list: () =>
      available
        ? Effect.sync(() => [...values.keys()].sort())
        : Effect.fail(unsupportedSafeStorage("SafeStorage.list")),
    snapshot: () =>
      Effect.sync(
        () => new Map([...values.entries()].map(([key, value]) => [key, new Uint8Array(value)]))
      )
  }
}

export const runHeadless = <A, E, R>(
  body: (runtime: HeadlessRuntime) => Effect.Effect<A, E, R>,
  options: HeadlessHarnessOptions = {}
): Effect.Effect<A, E | HostProtocolError | ResourceLeakError, R> =>
  Effect.gen(function* () {
    const registry = yield* makeResourceRegistry()
    const host = makeMockHost(options)
    const windowResources = new Map<string, ResourceHandle<"window", "open">>()
    const rawWindow = makeHostWindowClient(host, hostClientOptions(options))
    const runtime: HeadlessRuntime = {
      calls: host.calls,
      handshake: makeHostHandshakeClient(host, hostClientOptions(options)),
      registry,
      request: host.request,
      window: {
        create: (input = {}) =>
          Effect.gen(function* () {
            const response = yield* rawWindow.create(input)
            const handle = yield* registry.register({
              kind: "window",
              ownerScope: options.ownerScope ?? DEFAULT_HEADLESS_SCOPE,
              state: "open",
              dispose: Effect.void
            })
            windowResources.set(response.windowId, handle)

            return response
          }),
        destroy: (windowId) =>
          Effect.gen(function* () {
            const handle = windowResources.get(windowId)
            if (handle === undefined) {
              return yield* Effect.fail(
                makeHostProtocolNotFoundError(windowId, WINDOW_DESTROY_METHOD)
              )
            }

            windowResources.delete(windowId)
            yield* rawWindow.destroy(windowId)
            yield* handle.dispose()
          })
      }
    }

    const result = yield* Effect.exit(body(runtime))
    const leaks = yield* Effect.exit(
      assertNoOpenResourcesIn(registry, {
        testName: "runHeadless",
        ...options.leakDetection
      })
    )

    if (Exit.isFailure(leaks)) {
      return yield* Effect.failCause(leaks.cause)
    }

    if (Exit.isFailure(result)) {
      return yield* Effect.failCause(result.cause)
    }

    return result.value
  })

export const assertNoOpenResources = (
  options: LeakDetectionOptions = {}
): Effect.Effect<void, ResourceLeakError, ResourceRegistry> =>
  Effect.gen(function* () {
    const registry = yield* Effect.service(ResourceRegistry)
    const snapshot = yield* registry.list()
    const leaks = leakedHandles(snapshot, options)

    if (leaks.length > 0) {
      const report = formatLeakedHandleReport(leaks, options.testName)

      return yield* Effect.fail(
        new ResourceLeakError({
          leaks,
          message: report,
          report
        })
      )
    }
  })

export const assertNoOpenResourcesIn = (
  registry: ResourceRegistryApi,
  options: LeakDetectionOptions = {}
): Effect.Effect<void, ResourceLeakError, never> =>
  Effect.gen(function* () {
    const snapshot = yield* registry.list()
    const leaks = leakedHandles(snapshot, options)

    if (leaks.length > 0) {
      const report = formatLeakedHandleReport(leaks, options.testName)

      return yield* Effect.fail(
        new ResourceLeakError({
          leaks,
          message: report,
          report
        })
      )
    }
  })

export const installResourceLeakDetection = (
  registry: ResourceRegistryApi,
  options: LeakDetectionOptions = {}
): void => {
  registerLeakMatchers()
  afterEach(async () => {
    await Effect.runPromise(assertNoOpenResourcesIn(registry, options))
  })
}

const defaultFixture = (method: string): HeadlessFixture => {
  switch (method) {
    case HOST_PING_METHOD:
      return () => undefined
    case HOST_VERSION_METHOD:
      return () => ({ protocolVersion: HOST_PROTOCOL_VERSION })
    case WINDOW_CREATE_METHOD:
      return () => DEFAULT_WINDOW_CREATE_PAYLOAD
    case WINDOW_DESTROY_METHOD:
      return (request, state) =>
        Effect.gen(function* () {
          const windowId = yield* readWindowId(request.payload, request.method)
          if (!state.windows.has(windowId)) {
            return yield* Effect.fail(makeHostProtocolNotFoundError(windowId, request.method))
          }
        })
    default:
      return () => Effect.fail(makeHostProtocolNotFoundError(method, method))
  }
}

const resolveFixture = (
  fixture: HeadlessFixture,
  request: HostProtocolRequestEnvelope,
  state: HeadlessHostState
): Effect.Effect<HeadlessFixturePayload, HostProtocolError, never> => {
  const result = fixture(request, state)

  return Effect.gen(function* () {
    const payload = yield* Effect.isEffect(result) ? result : Effect.succeed(result)
    return yield* validateJsonPayload(request.method, payload)
  })
}

const isJsonPayload = (
  value: unknown,
  seen = new Set<object>(),
  allowUndefined = true
): boolean => {
  if (value === undefined) {
    return allowUndefined
  }
  if (value === null) {
    return true
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return true
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
  }
  if (typeof value !== "object") {
    return false
  }
  if (seen.has(value as object)) {
    return false
  }

  if (Array.isArray(value)) {
    seen.add(value)
    return value.every((item) => isJsonPayload(item, seen, false))
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false
  }
  seen.add(value as object)
  return Object.values(value).every((item) => isJsonPayload(item, seen, false))
}

const validateJsonPayload = (
  operation: string,
  payload: unknown
): Effect.Effect<HeadlessFixturePayload, HostProtocolError, never> =>
  isJsonPayload(payload)
    ? Effect.succeed(payload as HeadlessFixturePayload)
    : Effect.fail(
        makeHostProtocolInvalidOutputError(
          operation,
          `${operation} payload is not JSON-serializable`
        )
      )

const cloneJsonPayload = (payload: unknown): HeadlessFixturePayload =>
  structuredClone(payload) as HeadlessFixturePayload

const freezeJsonSnapshot = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object") {
    return value
  }

  if (ArrayBuffer.isView(value)) {
    return value
  }

  for (const child of Object.values(value)) {
    freezeJsonSnapshot(child)
  }

  return Object.freeze(value)
}

const cloneHostRequest = (request: HostProtocolRequestEnvelope): HostProtocolRequestEnvelope =>
  new HostProtocolRequestEnvelope({
    kind: request.kind,
    id: request.id,
    timestamp: request.timestamp,
    traceId: request.traceId,
    method: request.method,
    payload: cloneJsonPayload(request.payload)
  })

const recordCall = (calls: MockBridgeCall[], request: HostProtocolRequestEnvelope): void => {
  calls.push({
    method: request.method,
    payload: cloneJsonPayload(request.payload),
    traceId: request.traceId,
    timestamp: request.timestamp
  })
}

const streamEnvelope = (
  request: HostProtocolRequestEnvelope,
  timestamp: number,
  payload: unknown
): HostProtocolStreamEnvelope =>
  new HostProtocolStreamByRequestEnvelope({
    kind: "stream",
    id: request.id,
    timestamp,
    traceId: request.traceId,
    payload
  })

const bridgeHandleToCoreHandle = (handle: ApiResourceHandle): ResourceHandle =>
  Object.freeze({
    ...handle,
    id: handle.id as ResourceId,
    dispose: () => Effect.void
  })

const coreHandleToBridgeHandle = (handle: ResourceHandle): ApiResourceHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  })

interface MutableMockProcessSpawnRecord {
  readonly input: ProcessSpawnInput
  readonly pid: number
  readonly stdin: Uint8Array[]
  stdinClosed: boolean
  killedWith: ProcessSignalInput | undefined
  terminateTreeCalls: number
  forceKillTreeCalls: number
}

interface MutableMockPtyOpenRecord {
  readonly input: PtyOpenInput
  readonly pid: number | undefined
  readonly writes: Uint8Array[]
  readonly resizes: PtyResizeInput[]
  killedWith: PtySignalInput | undefined
  terminateTreeCalls: number
  forceKillTreeCalls: number
}

const makeMockProcessAdapter = (
  options: MockProcessOptions,
  calls: MutableMockProcessSpawnRecord[]
): ProcessAdapter => {
  let nextPid = 10_000
  const fixtures = [...(options.processes ?? [])]

  return {
    spawn: (input) => {
      const fixture = takeProcessFixture(fixtures, input)
      if (fixture === undefined) {
        throw mockNodeError("EINVAL", `missing MockProcess fixture for ${input.command}`)
      }
      const pid = fixture.pid ?? nextPid++
      const record: MutableMockProcessSpawnRecord = {
        input,
        pid,
        stdin: [],
        stdinClosed: false,
        killedWith: undefined,
        terminateTreeCalls: 0,
        forceKillTreeCalls: 0
      }
      calls.push(record)

      return makeMockProcessChild(fixture, record)
    }
  }
}

const makeMockProcessChild = (
  fixture: MockProcessFixture,
  record: MutableMockProcessSpawnRecord
): ProcessChild => {
  let running = true
  let resolveExit: (status: ProcessExitStatus) => void
  const exited = new Promise<ProcessExitStatus>((resolve) => {
    resolveExit = resolve
  })
  const finish = (status: ProcessExitStatus): void => {
    if (!running) {
      return
    }
    running = false
    resolveExit(status)
  }

  if (fixture.exit !== false) {
    setTimeout(() => {
      finish(processExitStatus(fixture.exit))
    }, 0)
  }

  return Object.freeze({
    pid: record.pid,
    stdout: readableBytes(fixture.stdout ?? []),
    stderr: readableBytes(fixture.stderr ?? []),
    exited,
    writeStdin: async (chunk: Uint8Array) => {
      await Promise.resolve()
      if (!running) {
        throw mockNodeError("EINVAL", `MockProcess ${record.input.command} is not running`)
      }

      record.stdin.push(copyBytes(chunk))
    },
    closeStdin: async () => {
      await Promise.resolve()
      if (!running) {
        return
      }

      record.stdinClosed = true
    },
    isRunning: () => running,
    terminateTree: () =>
      Promise.resolve().then(() => {
        record.terminateTreeCalls += 1
        record.killedWith = "SIGTERM"
        finish(processExitStatus(undefined, "SIGTERM"))
      }),
    forceKillTree: () =>
      Promise.resolve().then(() => {
        record.forceKillTreeCalls += 1
        record.killedWith = "SIGKILL"
        finish(processExitStatus(undefined, "SIGKILL"))
      }),
    kill: (signal?: ProcessSignalInput) => {
      record.killedWith = signal
      finish(processExitStatus(undefined, signalNameForMock(signal)))
    },
    childPids: fixture.childPids ?? []
  })
}

const takeProcessFixture = (
  fixtures: MockProcessFixture[],
  input: ProcessSpawnInput
): MockProcessFixture | undefined => {
  const index = fixtures.findIndex(
    (fixture) =>
      (fixture.command === undefined || fixture.command === input.command) &&
      (fixture.args === undefined || stringArraysEqual(fixture.args, input.args))
  )
  if (index < 0) {
    return undefined
  }

  return fixtures.splice(index, 1)[0]
}

const cloneProcessCalls = (
  calls: readonly MutableMockProcessSpawnRecord[]
): readonly MockProcessSpawnRecord[] =>
  calls.map((call) => ({
    input: call.input,
    pid: call.pid,
    stdin: call.stdin.map(copyBytes),
    stdinClosed: call.stdinClosed,
    killedWith: call.killedWith,
    terminateTreeCalls: call.terminateTreeCalls,
    forceKillTreeCalls: call.forceKillTreeCalls
  }))

const processExitStatus = (
  exit: MockProcessFixture["exit"] | undefined,
  fallbackSignal?: string
): ProcessExitStatus =>
  exit instanceof ProcessExitStatus
    ? exit
    : new ProcessExitStatus({
        code: exit === false || exit === undefined ? 0 : exit.code,
        ...(fallbackSignal === undefined
          ? exit !== false && exit !== undefined && exit.signal !== undefined
            ? { signal: exit.signal }
            : {}
          : { signal: fallbackSignal })
      })

const makeMockPtyAdapter = (
  options: MockPtyOptions,
  calls: MutableMockPtyOpenRecord[]
): PtyAdapter => {
  let nextPid = 20_000
  const fixtures = [...(options.ptys ?? [])]

  return {
    open: (input) => {
      const fixture = takePtyFixture(fixtures, input)
      if (fixture === undefined) {
        throw mockNodeError("EINVAL", `missing MockPTY fixture for ${input.command}`)
      }
      const pid = fixture.pid === null ? undefined : (fixture.pid ?? nextPid++)
      const record: MutableMockPtyOpenRecord = {
        input,
        pid,
        writes: [],
        resizes: [],
        killedWith: undefined,
        terminateTreeCalls: 0,
        forceKillTreeCalls: 0
      }
      calls.push(record)

      return makeMockPtyChild(fixture, record)
    }
  }
}

const makeMockPtyChild = (fixture: MockPtyFixture, record: MutableMockPtyOpenRecord): PtyChild => {
  let running = true
  let resolveExit: (status: PtyExitStatus) => void
  const exited = new Promise<PtyExitStatus>((resolve) => {
    resolveExit = resolve
  })
  const finish = (status: PtyExitStatus): void => {
    if (!running) {
      return
    }
    running = false
    resolveExit(status)
  }

  if (fixture.exit !== false) {
    setTimeout(() => {
      finish(ptyExitStatus(fixture.exit))
    }, 0)
  }

  return Object.freeze({
    pid: record.pid === undefined ? Option.none() : Option.some(record.pid),
    output: readableBytes(fixture.output ?? []),
    exited,
    write: async (chunk: Uint8Array) => {
      await Promise.resolve()
      if (!running) {
        throw mockNodeError("EINVAL", `MockPTY ${record.input.command} is not running`)
      }

      record.writes.push(copyBytes(chunk))
    },
    resize: async (size: PtyResizeInput) => {
      await Promise.resolve()
      if (!running) {
        throw mockNodeError("EINVAL", `MockPTY ${record.input.command} is not running`)
      }

      record.resizes.push({ rows: size.rows, cols: size.cols })
    },
    isRunning: () => running,
    terminateTree: () =>
      Promise.resolve().then(() => {
        record.terminateTreeCalls += 1
        record.killedWith = "SIGTERM"
        finish(ptyExitStatus(undefined, "SIGTERM"))
      }),
    forceKillTree: () =>
      Promise.resolve().then(() => {
        record.forceKillTreeCalls += 1
        record.killedWith = "SIGKILL"
        finish(ptyExitStatus(undefined, "SIGKILL"))
      }),
    kill: (signal?: PtySignalInput) =>
      Promise.resolve().then(() => {
        record.killedWith = signal
        finish(ptyExitStatus(undefined, signalNameForMock(signal)))
      })
  })
}

const takePtyFixture = (
  fixtures: MockPtyFixture[],
  input: PtyOpenInput
): MockPtyFixture | undefined => {
  const index = fixtures.findIndex(
    (fixture) =>
      (fixture.command === undefined || fixture.command === input.command) &&
      (fixture.args === undefined || stringArraysEqual(fixture.args, input.args))
  )
  if (index < 0) {
    return undefined
  }

  return fixtures.splice(index, 1)[0]
}

const clonePtyCalls = (calls: readonly MutableMockPtyOpenRecord[]): readonly MockPtyOpenRecord[] =>
  calls.map((call) => ({
    input: call.input,
    pid: call.pid,
    writes: call.writes.map(copyBytes),
    resizes: call.resizes.map((resize) => ({ rows: resize.rows, cols: resize.cols })),
    killedWith: call.killedWith,
    terminateTreeCalls: call.terminateTreeCalls,
    forceKillTreeCalls: call.forceKillTreeCalls
  }))

const ptyExitStatus = (
  exit: MockPtyFixture["exit"] | undefined,
  fallbackSignal?: string
): PtyExitStatus =>
  exit instanceof PtyExitStatus
    ? exit
    : new PtyExitStatus({
        code: exit === false || exit === undefined ? 0 : exit.code,
        ...(fallbackSignal === undefined
          ? exit !== false && exit !== undefined && exit.signal !== undefined
            ? { signal: exit.signal }
            : {}
          : { signal: fallbackSignal })
      })

const readableBytes = (chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of chunks) {
        controller.enqueue(copyBytes(chunk))
      }
      controller.close()
    }
  })

const stringArraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const signalNameForMock = (signal: ProcessSignalInput | undefined): string =>
  typeof signal === "string" ? signal : signal === undefined ? "SIGTERM" : String(signal)

const mockNodeError = (code: string, message: string): NodeJS.ErrnoException =>
  Object.assign(new Error(message), { code })

type MemoryNode = MemoryDirectory | MemoryFile | MemorySymlink

interface MemoryDirectory {
  readonly kind: "directory"
  readonly modifiedAtMs: number
}

interface MemoryFile {
  readonly kind: "file"
  readonly bytes: Uint8Array
  readonly modifiedAtMs: number
}

interface MemorySymlink {
  readonly kind: "symlink"
  readonly target: string
  readonly modifiedAtMs: number
}

interface MemoryWatchRegistration {
  readonly directory: string
  readonly listener: (event: RawFilesystemEvent) => void
  closed: boolean
}

const ROOT_PATH = "/"

const memoryFilesystemOptions = (options: MemoryFilesystemOptions): FilesystemOptions => ({
  adapter: makeMemoryFilesystemAdapter(options),
  ...(options.permissions === undefined ? {} : { permissions: options.permissions })
})

const makeMemoryFilesystemAdapter = (options: MemoryFilesystemOptions = {}): FilesystemAdapter => {
  const now = options.now ?? Date.now
  const nodes = new Map<string, MemoryNode>([
    [ROOT_PATH, { kind: "directory", modifiedAtMs: now() }]
  ])
  const watchers: MemoryWatchRegistration[] = []

  for (const directory of options.directories ?? []) {
    ensureDirectory(nodes, normalizeMemoryPath(directory), now())
  }
  for (const file of options.files ?? []) {
    const path = normalizeMemoryPath(file.path)
    ensureDirectory(nodes, posix.dirname(path), now())
    nodes.set(path, { kind: "file", bytes: copyBytes(file.bytes), modifiedAtMs: now() })
  }
  for (const symlink of options.symlinks ?? []) {
    const path = normalizeMemoryPath(symlink.path)
    ensureDirectory(nodes, posix.dirname(path), now())
    nodes.set(path, {
      kind: "symlink",
      target: normalizeMemorySymlinkTarget(symlink.target),
      modifiedAtMs: now()
    })
  }

  const adapter: FilesystemAdapter = {
    readFile: ((path) =>
      Promise.resolve().then(() => {
        const canonicalPath = resolveExistingPath(nodes, memoryPathLikeToString(path))
        const node = nodes.get(canonicalPath)
        if (node?.kind !== "file") {
          return Promise.reject(nodeError("EISDIR", canonicalPath))
        }
        return Buffer.from(copyBytes(node.bytes))
      })) as FilesystemAdapter["readFile"],
    realpath: ((path) =>
      Promise.resolve(
        toPlatformMemoryPath(resolveExistingPath(nodes, memoryPathLikeToString(path)))
      )) as FilesystemAdapter["realpath"],
    rename: (from, to) => {
      const fromPath = resolveExistingPath(nodes, memoryPathLikeToString(from))
      const toPath = normalizeMemoryPath(memoryPathLikeToString(to))
      const node = nodes.get(fromPath)
      if (node === undefined) {
        return Promise.reject(nodeError("ENOENT", fromPath))
      }
      const parentPath = posix.dirname(toPath)
      const parent = nodes.get(parentPath)
      if (parent?.kind !== "directory") {
        return Promise.reject(nodeError("ENOENT", parentPath))
      }
      const destination = nodes.get(toPath)
      if (destination?.kind === "directory") {
        return Promise.reject(nodeError("EISDIR", toPath))
      }
      const descendants = childPaths(nodes, toPath)
      if (descendants.length > 0) {
        return Promise.reject(nodeError("ENOTEMPTY", toPath))
      }
      if (node.kind === "directory" && isDescendant(toPath, fromPath)) {
        return Promise.reject(nodeError("EINVAL", toPath))
      }

      nodes.delete(fromPath)
      nodes.set(toPath, cloneNode(node))
      if (node.kind === "directory") {
        for (const childPath of childPaths(nodes, fromPath)) {
          const child = nodes.get(childPath)
          if (child !== undefined) {
            nodes.delete(childPath)
            nodes.set(`${toPath}${childPath.slice(fromPath.length)}`, cloneNode(child))
          }
        }
      }
      emitMemoryWatch(watchers, fromPath, "rename")
      emitMemoryWatch(watchers, toPath, "rename")
      return Promise.resolve()
    },
    writeFile: ((path, bytes) =>
      writeMemoryFile(
        nodes,
        watchers,
        memoryPathLikeToString(path),
        normalizeWriteBytes(bytes),
        now()
      )) as FilesystemAdapter["writeFile"],
    writeFileSynced: (path, bytes) => writeMemoryFile(nodes, watchers, path, bytes, now()),
    stat: ((path) => {
      const canonicalPath = lookupPath(nodes, memoryPathLikeToString(path), "nofollow")
      const node = nodes.get(canonicalPath)
      if (node === undefined) {
        return Promise.reject(nodeError("ENOENT", canonicalPath))
      }
      return Promise.resolve(memoryStats(node, canonicalPath))
    }) as FilesystemAdapter["stat"],
    mkdir: (path, mkdirOptions) => {
      const target = normalizeMemoryPath(path)
      const parent = nodes.get(posix.dirname(target))
      if (parent?.kind !== "directory" && mkdirOptions?.recursive !== true) {
        return Promise.reject(nodeError("ENOENT", posix.dirname(target)))
      }

      if (mkdirOptions?.recursive === true) {
        return createDirectoryRecursive(nodes, watchers, target, now())
      } else {
        if (nodes.has(target)) {
          return Promise.reject(nodeError("EEXIST", target))
        }
        nodes.set(target, { kind: "directory", modifiedAtMs: now() })
      }
      emitMemoryWatch(watchers, target, "rename")
      return Promise.resolve()
    },
    remove: (path, removeOptions) => {
      const target = normalizeMemoryPath(path)
      const node = nodes.get(target)
      if (node === undefined) {
        return Promise.reject(nodeError("ENOENT", target))
      }
      if (node.kind === "directory") {
        const children = childPaths(nodes, target)
        if (children.length > 0 && removeOptions?.recursive !== true) {
          return Promise.reject(nodeError("ENOTEMPTY", target))
        }
        for (const child of children) {
          nodes.delete(child)
        }
      }
      nodes.delete(target)
      emitMemoryWatch(watchers, target, "rename")
      return Promise.resolve()
    },
    watch: (path, listener) =>
      Effect.try({
        try: () => {
          const directory = resolveExistingPath(nodes, path)
          const node = nodes.get(directory)
          if (node?.kind !== "directory") {
            throw nodeError("ENOTDIR", directory)
          }

          const registration: MemoryWatchRegistration = {
            directory,
            listener,
            closed: false
          }
          watchers.push(registration)

          return {
            close: () => {
              registration.closed = true
            }
          } satisfies FilesystemWatcher
        },
        catch: (error) =>
          makeHostProtocolInvalidArgumentError(
            "path",
            formatMemoryFilesystemError(error),
            "Filesystem.watch"
          )
      })
  }

  return adapter
}

const writeMemoryFile = (
  nodes: Map<string, MemoryNode>,
  watchers: readonly MemoryWatchRegistration[],
  path: string,
  bytes: Uint8Array,
  modifiedAtMs: number
): Promise<void> => {
  const target = normalizeMemoryPath(path)
  const parentPath = posix.dirname(target)
  const parent = nodes.get(parentPath)
  if (parent?.kind !== "directory") {
    return Promise.reject(nodeError("ENOENT", parentPath))
  }
  const existing = nodes.get(target)
  if (existing?.kind === "directory") {
    return Promise.reject(nodeError("EISDIR", target))
  }

  const existed = nodes.has(target)
  nodes.set(target, { kind: "file", bytes: copyBytes(bytes), modifiedAtMs })
  emitMemoryWatch(watchers, target, existed ? "change" : "rename")
  return Promise.resolve()
}

const ensureDirectory = (
  nodes: Map<string, MemoryNode>,
  path: string,
  modifiedAtMs: number
): void => {
  const normalized = normalizeMemoryPath(path)
  if (normalized !== ROOT_PATH) {
    ensureDirectory(nodes, posix.dirname(normalized), modifiedAtMs)
  }
  nodes.set(normalized, { kind: "directory", modifiedAtMs })
}

const createDirectoryRecursive = (
  nodes: Map<string, MemoryNode>,
  watchers: readonly MemoryWatchRegistration[],
  path: string,
  modifiedAtMs: number
): Promise<void> => {
  const normalized = normalizeMemoryPath(path)
  const segments = normalized.split("/").filter((segment) => segment.length > 0)
  let current = ROOT_PATH

  for (const segment of segments) {
    current = current === ROOT_PATH ? `/${segment}` : `${current}/${segment}`
    const node = nodes.get(current)
    if (node?.kind === "directory") {
      continue
    }
    if (node !== undefined) {
      return Promise.reject(nodeError("ENOTDIR", current))
    }

    nodes.set(current, { kind: "directory", modifiedAtMs })
    emitMemoryWatch(watchers, current, "rename")
  }

  return Promise.resolve()
}

type LookupMode = "follow" | "nofollow"

const lookupPath = (
  nodes: ReadonlyMap<string, MemoryNode>,
  path: string,
  mode: LookupMode = "follow",
  seen: ReadonlySet<string> = new Set()
): string => {
  const normalized = normalizeMemoryPath(path)
  const segments = normalized.split("/").filter((segment) => segment.length > 0)
  let current = ROOT_PATH

  for (const [index, segment] of segments.entries()) {
    current = current === ROOT_PATH ? `/${segment}` : `${current}/${segment}`
    const node = nodes.get(current)
    if (node === undefined) {
      throw nodeError("ENOENT", current)
    }

    const isFinalSegment = index === segments.length - 1

    if (node.kind === "symlink") {
      if (mode === "nofollow" && isFinalSegment) {
        return current
      }
      if (seen.has(current)) {
        throw nodeError("ELOOP", current)
      }

      const remaining = segments.slice(index + 1)
      const target = node.target.startsWith("/")
        ? node.target
        : normalizeMemoryPath(posix.join(posix.dirname(current), node.target))
      return lookupPath(nodes, posix.join(target, ...remaining), mode, new Set([...seen, current]))
    }
    if (node.kind !== "directory" && !isFinalSegment) {
      throw nodeError("ENOTDIR", current)
    }
  }

  const node = nodes.get(normalized)
  if (node === undefined) {
    throw nodeError("ENOENT", normalized)
  }
  return normalized
}

const resolveExistingPath = (
  nodes: ReadonlyMap<string, MemoryNode>,
  path: string,
  seen: ReadonlySet<string> = new Set()
): string => lookupPath(nodes, path, "follow", seen)

const normalizeMemoryPath = (path: string): string => {
  const withoutDrive = path.replaceAll("\\", "/").replace(/^\/?[A-Za-z]:/, "")
  const normalized = posix.normalize(withoutDrive)
  return normalized.startsWith("/") ? normalized : `/${normalized}`
}

const normalizeMemorySymlinkTarget = (target: string): string => {
  const normalized = target.replaceAll("\\", "/")
  return normalized.startsWith("/") ? normalizeMemoryPath(normalized) : posix.normalize(normalized)
}

const toPlatformMemoryPath = (path: string): string =>
  sep === "/" ? path : path.replaceAll("/", sep)

const memoryPathLikeToString = (path: unknown): string => {
  if (typeof path === "string") {
    return path
  }
  if (path instanceof URL) {
    return path.pathname
  }
  if (path instanceof Uint8Array) {
    return new TextDecoder().decode(path)
  }
  return JSON.stringify(path)
}

const childPaths = (nodes: ReadonlyMap<string, MemoryNode>, path: string): readonly string[] =>
  [...nodes.keys()].filter((candidate) => candidate !== path && isDescendant(candidate, path))

const isDescendant = (candidate: string, parent: string): boolean =>
  candidate.startsWith(parent.endsWith("/") ? parent : `${parent}/`)

const emitMemoryWatch = (
  watchers: readonly MemoryWatchRegistration[],
  path: string,
  type: RawFilesystemEvent["type"]
): void => {
  const directory = posix.dirname(path)
  const filename = path.slice(directory.length + (directory.endsWith("/") ? 0 : 1))
  for (const watcher of watchers) {
    if (!watcher.closed && watcher.directory === directory) {
      watcher.listener({ type, filename })
    }
  }
}

const memoryStats = (
  node: MemoryNode,
  path: string
): Awaited<ReturnType<FilesystemAdapter["stat"]>> =>
  ({
    size: node.kind === "file" ? node.bytes.byteLength : 0,
    mtimeMs: node.modifiedAtMs,
    nlink: 1,
    isFile: () => node.kind === "file",
    isDirectory: () => node.kind === "directory",
    isSymbolicLink: () => node.kind === "symlink",
    path
  }) as unknown as Awaited<ReturnType<FilesystemAdapter["stat"]>>

const cloneNode = (node: MemoryNode): MemoryNode => {
  switch (node.kind) {
    case "file":
      return { ...node, bytes: copyBytes(node.bytes) }
    case "directory":
    case "symlink":
      return { ...node }
  }
}

const copyBytes = (bytes: Uint8Array): Uint8Array => new Uint8Array(bytes)

const normalizeWriteBytes = (bytes: unknown): Uint8Array => {
  if (bytes instanceof Uint8Array) {
    return bytes
  }
  if (typeof bytes === "string") {
    return new TextEncoder().encode(bytes)
  }
  return new TextEncoder().encode(String(bytes))
}

const nodeError = (code: string, path: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: ${path}`), {
    name: "MemoryFilesystemError",
    code,
    path
  })

const formatMemoryFilesystemError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const hostClientOptions = (options: HeadlessHarnessOptions): HeadlessClientOptions => {
  const resolved: Partial<MutableHeadlessClientOptions> = {}
  if (options.nextRequestId !== undefined) {
    resolved.nextRequestId = options.nextRequestId
  }
  if (options.nextTraceId !== undefined) {
    resolved.nextTraceId = options.nextTraceId
  }
  if (options.now !== undefined) {
    resolved.now = options.now
  }

  return resolved
}

interface HeadlessClientOptions {
  readonly nextRequestId?: () => string
  readonly nextTraceId?: () => string
  readonly now?: () => number
}

interface MutableHeadlessClientOptions {
  nextRequestId?: () => string
  nextTraceId?: () => string
  now?: () => number
}

const readWindowId = (
  payload: unknown,
  operation: string
): Effect.Effect<string, HostProtocolError, never> => {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "windowId" in payload &&
    typeof payload.windowId === "string"
  ) {
    return Effect.succeed(payload.windowId)
  }

  return Effect.fail(makeHostProtocolInvalidOutputError(operation, "missing string windowId"))
}

const readWindowCreateInput = (payload: unknown): WindowCreateInput => {
  if (typeof payload === "object" && payload !== null) {
    return payload as WindowCreateInput
  }

  return {}
}

export const leakedHandles = (
  snapshot: RegistrySnapshot,
  options: LeakDetectionOptions = {}
): readonly ResourceEntry[] => {
  const allowedIds = new Set<ResourceId>(options.allowedResourceIds ?? [])
  const allowedKinds = new Set<ResourceKind>(options.allowedResourceKinds ?? DEFAULT_ALLOWED_KINDS)

  return snapshot.entries.filter(
    (entry) => !allowedIds.has(entry.handle.id) && !allowedKinds.has(entry.handle.kind)
  )
}

export const formatLeakedHandleReport = (
  leaks: readonly ResourceEntry[],
  testName?: string
): string => {
  if (leaks.length === 0) {
    return "No leaked resource handles."
  }

  const header =
    testName === undefined
      ? `Leaked resource handles (${leaks.length})`
      : `Leaked resource handles (${leaks.length}) in ${testName}`
  const rows = leaks.map((entry) => {
    const { handle } = entry

    return [
      `- kind: ${handle.kind}`,
      `  id: ${handle.id}`,
      `  generation: ${handle.generation}`,
      `  ownerScope: ${handle.ownerScope}`,
      `  createdAt: ${entry.createdAt}`
    ].join("\n")
  })

  return [header, ...rows].join("\n")
}

export const registerLeakMatchers = (): void => {
  if (matchersRegistered) {
    return
  }

  expect.extend({
    toHaveNoLeakedHandles(actual: unknown, options?: LeakDetectionOptions) {
      if (!isRegistrySnapshot(actual)) {
        throw new TypeError("toHaveNoLeakedHandles expects a ResourceRegistry snapshot")
      }

      const leaks = leakedHandles(actual, options)
      const pass = leaks.length === 0

      return {
        pass,
        message: () =>
          pass
            ? "Expected resource snapshot to contain leaked handles."
            : formatLeakedHandleReport(leaks, options?.testName)
      }
    }
  })
  matchersRegistered = true
}

declare module "bun:test" {
  interface Matchers<T> {
    toHaveNoLeakedHandles(options?: LeakDetectionOptions): void
  }
}

let matchersRegistered = false

const DEFAULT_HEADLESS_SCOPE = "headless"
const DEFAULT_WINDOW_CREATE_PAYLOAD = undefined
const DEFAULT_ALLOWED_KINDS = ["app"] as const satisfies readonly ResourceKind[]

const secretNotFound = (key: string, operation: string): HostProtocolNotFoundError =>
  new HostProtocolNotFoundError({
    tag: "NotFound",
    resource: key,
    message: `secret not found: ${key}`,
    operation,
    recoverable: hostProtocolErrorRecoverableDefault("NotFound")
  })

const unsupportedSafeStorage = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "memory secrets safe storage is unavailable",
    message: `unsupported SafeStorage method: ${operation}`,
    operation,
    recoverable: hostProtocolErrorRecoverableDefault("Unsupported")
  })

const isRegistrySnapshot = (value: unknown): value is RegistrySnapshot => {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries)
  )
}

export * from "./native.js"
