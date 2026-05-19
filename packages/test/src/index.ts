import { afterEach, expect } from "bun:test"
import { posix, sep } from "node:path"
import {
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Queue,
  Sink,
  Stream
} from "effect"
import * as PlatformError from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import {
  BridgeStreamCompleteFrame,
  BridgeStreamDataFrame,
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
  WINDOW_CENTER_METHOD,
  WINDOW_CANCEL_ATTENTION_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  WINDOW_FOCUS_METHOD,
  WINDOW_GET_BOUNDS_METHOD,
  WINDOW_GET_BY_ID_METHOD,
  WINDOW_GET_CHILDREN_METHOD,
  WINDOW_GET_CURRENT_METHOD,
  WINDOW_GET_PARENT_METHOD,
  WINDOW_GET_STATE_METHOD,
  WINDOW_HIDE_METHOD,
  WINDOW_LIST_METHOD,
  WINDOW_MAXIMIZE_METHOD,
  WINDOW_MINIMIZE_METHOD,
  WINDOW_RESTORE_METHOD,
  WINDOW_REQUEST_ATTENTION_METHOD,
  WINDOW_CLEAR_VIBRANCY_METHOD,
  WINDOW_SET_ALWAYS_ON_TOP_METHOD,
  WINDOW_SET_BOUNDS_METHOD,
  WINDOW_SET_DECORATIONS_METHOD,
  WINDOW_SET_FULLSCREEN_METHOD,
  WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
  WINDOW_SET_PROGRESS_METHOD,
  WINDOW_SET_RESIZABLE_METHOD,
  WINDOW_SET_SHADOW_METHOD,
  WINDOW_SET_TITLE_METHOD,
  WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
  WINDOW_SET_VIBRANCY_METHOD,
  WINDOW_SHOW_METHOD,
  hostProtocolErrorRecoverableDefault,
  makeHostProtocolInvalidStateError,
  makeHostHandshakeClient,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  type BridgeClient,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeClientResponse,
  type BridgeContract,
  type HostHandshakeClient,
  type HostProtocolError,
  type HostProtocolInvalidArgumentError,
  type HostProtocolStreamEnvelope,
  type HostWindowClient,
  type WindowCreateInput
} from "@effect-desktop/bridge"
import {
  ResourceRegistry,
  Filesystem,
  PermissionRegistry,
  PermissionActor,
  Process,
  ProcessExitStatus,
  ProcessSpawnInput,
  PTY,
  PtyExitStatus,
  Telemetry,
  makeSecretBytes,
  makeResourceRegistry,
  makeFilesystem,
  makePermissionRegistry,
  makeProcess,
  makePty,
  makeTelemetry,
  ResourceOwner,
  type FilesystemApi,
  type FilesystemOptions,
  type FilesystemPermissionPolicy,
  type PermissionRegistryOptions,
  type ProcessApi,
  type ProcessBudgetPolicy,
  type ProcessPermissionPolicy,
  type ProcessSignalInput,
  unsafeSecretBytes,
  type PtyAdapter,
  type PtyApi,
  type PtyBudgetPolicy,
  type PtyChild,
  type PtyOpenInput,
  type PtyPermissionPolicy,
  type PtyResizeInput,
  type PtySignalInput,
  type RegistrySnapshot,
  type ResourceEntry,
  type ManagedResourceHandle,
  type ResourceRegistryApi,
  type ResourceId,
  type ResourceKind,
  type ResourceOwnerApi,
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
  readonly focusedWindowId: () => string | undefined
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

const currentTimeMillis = (now: (() => number) | undefined): Effect.Effect<number, never, never> =>
  now === undefined ? Clock.currentTimeMillis : Effect.sync(now)

export const makeMockHost = (options: MockHostOptions = {}): MockHostApi => {
  const calls: HeadlessHostCall[] = []
  const windows = new Map<string, WindowCreateInput>()
  let focusedWindowId: string | undefined
  let nextWindowId = 1

  const state: HeadlessHostState = {
    windows,
    focusedWindowId: () => focusedWindowId
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
          focusedWindowId ??= windowId
          nextWindowId += 1
        } else if (request.method === WINDOW_DESTROY_METHOD) {
          const windowId = yield* readWindowId(request.payload, request.method)
          windows.delete(windowId)
          if (focusedWindowId === windowId) {
            focusedWindowId = windows.keys().next().value
          }
        } else if (request.method === WINDOW_FOCUS_METHOD) {
          focusedWindowId = yield* readWindowId(request.payload, request.method)
        } else if (
          request.method === WINDOW_SHOW_METHOD ||
          request.method === WINDOW_HIDE_METHOD ||
          request.method === WINDOW_FOCUS_METHOD ||
          request.method === WINDOW_GET_BY_ID_METHOD ||
          request.method === WINDOW_GET_PARENT_METHOD ||
          request.method === WINDOW_GET_CHILDREN_METHOD ||
          request.method === WINDOW_GET_BOUNDS_METHOD ||
          request.method === WINDOW_CENTER_METHOD ||
          request.method === WINDOW_SET_TITLE_METHOD ||
          request.method === WINDOW_SET_RESIZABLE_METHOD ||
          request.method === WINDOW_SET_DECORATIONS_METHOD ||
          request.method === WINDOW_SET_TRAFFIC_LIGHTS_METHOD ||
          request.method === WINDOW_SET_VIBRANCY_METHOD ||
          request.method === WINDOW_CLEAR_VIBRANCY_METHOD ||
          request.method === WINDOW_SET_SHADOW_METHOD ||
          request.method === WINDOW_SET_ALWAYS_ON_TOP_METHOD ||
          request.method === WINDOW_SET_PROGRESS_METHOD ||
          request.method === WINDOW_REQUEST_ATTENTION_METHOD ||
          request.method === WINDOW_CANCEL_ATTENTION_METHOD ||
          request.method === WINDOW_MINIMIZE_METHOD ||
          request.method === WINDOW_MAXIMIZE_METHOD ||
          request.method === WINDOW_RESTORE_METHOD ||
          request.method === WINDOW_GET_STATE_METHOD
        ) {
          yield* readWindowId(request.payload, request.method)
        } else if (
          request.method === WINDOW_SET_BOUNDS_METHOD ||
          request.method === WINDOW_SET_FULLSCREEN_METHOD
        ) {
          yield* readWindowId(request.payload, request.method)
        }

        const timestamp = yield* currentTimeMillis(options.now)

        return new HostProtocolResponseEnvelope({
          kind: "response",
          id: request.id,
          timestamp,
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
  readonly exchange: BridgeClientExchange
  readonly client: <Contracts extends Readonly<Record<string, BridgeContract>>>(
    contracts: Contracts,
    options?: BridgeClientOptions
  ) => BridgeClient<Contracts>
  readonly calls: () => readonly MockBridgeCall[]
  readonly cancels: () => readonly HostProtocolCancelByRequestEnvelope[]
  readonly succeed: (
    method: string,
    payload: unknown
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly fail: (method: string, error: unknown) => Effect.Effect<void, HostProtocolError, never>
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
}

export const makeMockBridge = (options: MockBridgeOptions = {}): MockBridgeApi => {
  const calls: MockBridgeCall[] = []
  const cancels: HostProtocolCancelByRequestEnvelope[] = []
  const responses = new Map<string, BridgeClientResponse[]>()
  const streams = new Map<string, readonly unknown[]>()

  const enqueue = (
    method: string,
    response: BridgeClientResponse
  ): Effect.Effect<void, HostProtocolError, never> =>
    Effect.sync(() => {
      const queue = responses.get(method) ?? []
      queue.push(response)
      responses.set(method, queue)
    })

  const exchange: BridgeClientExchange = Object.freeze({
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
          Stream.mapEffect((chunk) =>
            currentTimeMillis(options.now).pipe(
              Effect.map((timestamp) =>
                streamEnvelope(
                  request,
                  timestamp,
                  new BridgeStreamDataFrame({ type: "data", chunk })
                )
              )
            )
          )
        )
        .pipe(
          Stream.concat(
            Stream.fromEffect(
              currentTimeMillis(options.now).pipe(
                Effect.map((timestamp) =>
                  streamEnvelope(
                    request,
                    timestamp,
                    new BridgeStreamCompleteFrame({ type: "complete" })
                  )
                )
              )
            )
          )
        )
    },
    cancel: (request: HostProtocolCancelByRequestEnvelope) =>
      Effect.sync(() => {
        cancels.push(request)
      })
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
    succeed: (method, payload) =>
      validateJsonPayload(method, payload).pipe(
        Effect.flatMap((validated) => enqueue(method, { kind: "success", payload: validated }))
      ),
    fail: (method, error) =>
      validateJsonPayload(method, error).pipe(
        Effect.flatMap((validated) => enqueue(method, { kind: "failure", error: validated }))
      ),
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
  owner: ResourceOwnerApi,
  options: MemoryFilesystemOptions = {}
): Effect.Effect<FilesystemApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const now = options.now ?? (() => clock.currentTimeMillisUnsafe())
    const memory = makeMemoryFilesystemRuntime(options, now)
    return yield* makeFilesystem(registry, owner, memory.options).pipe(
      Effect.provide(memory.fileSystem)
    )
  })

export const MemoryFilesystemLive = (
  options: MemoryFilesystemOptions = {}
): Layer.Layer<Filesystem, never, ResourceOwner | ResourceRegistry> =>
  Layer.effect(
    Filesystem,
    Effect.gen(function* () {
      const owner = yield* ResourceOwner
      const registry = yield* ResourceRegistry
      return yield* makeMemoryFilesystem(registry, owner, options)
    })
  )

export const MemoryFilesystem = Object.freeze({
  layer: MemoryFilesystemLive
})

export interface MockProcessFixture {
  readonly command?: string
  readonly args?: readonly string[]
  readonly pid?: number
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
  owner: ResourceOwnerApi,
  options: MockProcessOptions = {}
): Effect.Effect<MockProcessApi, HostProtocolInvalidArgumentError, never> => {
  const calls: MutableMockProcessSpawnRecord[] = []
  return makeProcess(registry, owner, {
    ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
    ...(options.gracefulShutdownMs === undefined
      ? {}
      : { gracefulShutdownMs: options.gracefulShutdownMs }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    ...(options.now === undefined ? {} : { now: options.now })
  }).pipe(
    Effect.provideService(
      ChildProcessSpawner.ChildProcessSpawner,
      makeMockProcessSpawner(options, calls)
    ),
    Effect.map((api) => Object.freeze({ ...api, calls: () => cloneProcessCalls(calls) }))
  )
}

export const MockProcessLive = (
  options: MockProcessOptions = {}
): Layer.Layer<Process, HostProtocolInvalidArgumentError, ResourceOwner | ResourceRegistry> =>
  Layer.effect(
    Process,
    Effect.gen(function* () {
      const owner = yield* ResourceOwner
      const registry = yield* ResourceRegistry
      return yield* makeMockProcess(registry, owner, options)
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
  owner: ResourceOwnerApi,
  options: MockPtyOptions = {}
): Effect.Effect<MockPtyApi, HostProtocolInvalidArgumentError, never> => {
  const calls: MutableMockPtyOpenRecord[] = []
  return makePty(registry, owner, {
    adapter: makeMockPtyAdapter(options, calls),
    ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
    ...(options.gracefulShutdownMs === undefined
      ? {}
      : { gracefulShutdownMs: options.gracefulShutdownMs }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions })
  }).pipe(Effect.map((api) => Object.freeze({ ...api, calls: () => clonePtyCalls(calls) })))
}

export const MockPtyLayer = (
  options: MockPtyOptions = {}
): Layer.Layer<PTY, HostProtocolInvalidArgumentError, ResourceOwner | ResourceRegistry> =>
  Layer.effect(
    PTY,
    Effect.gen(function* () {
      const owner = yield* ResourceOwner
      const registry = yield* ResourceRegistry
      return yield* makeMockPty(registry, owner, options)
    })
  )

export const MockPTY = Object.freeze({
  layer: MockPtyLayer
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
  | ResourceOwner
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
    const bridge = makeMockBridge(options.bridge)
    const owner = makeTestResourceOwner(DEFAULT_HEADLESS_SCOPE)
    const filesystem = yield* makeMemoryFilesystem(registry, owner, options.filesystem)
    const process = yield* makeMockProcess(registry, owner, options.process)
    const pty = yield* makeMockPty(registry, owner, options.pty)

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
              )(
                Context.add(
                  ResourceOwner,
                  owner
                )(Context.add(MockBridge, bridge)(Context.make(MockHost, host)))
              )
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
            values.set(key, unsafeSecretBytes(value))
          })
        : Effect.fail(unsupportedSafeStorage("SafeStorage.set")),
    get: (key) =>
      available
        ? Effect.gen(function* () {
            const value = values.get(key)
            if (value === undefined) {
              return yield* Effect.fail(secretNotFound(key, "SafeStorage.get"))
            }

            return makeSecretBytes(value)
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
    const windowResources = new Map<string, ManagedResourceHandle<"window", "open">>()
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
            const handle = yield* registry
              .register({
                kind: "window",
                ownerScope: options.ownerScope ?? DEFAULT_HEADLESS_SCOPE,
                state: "open",
                dispose: Effect.void
              })
              .pipe(Effect.orDie)
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
          }),
        show: (windowId) => rawWindow.show(windowId),
        hide: (windowId) => rawWindow.hide(windowId),
        focus: (windowId) => rawWindow.focus(windowId),
        getCurrent: () => rawWindow.getCurrent(),
        getById: (windowId) => rawWindow.getById(windowId),
        list: () => rawWindow.list(),
        getParent: (windowId) => rawWindow.getParent(windowId),
        getChildren: (windowId) => rawWindow.getChildren(windowId),
        getBounds: (windowId) => rawWindow.getBounds(windowId),
        setBounds: (windowId, bounds) => rawWindow.setBounds(windowId, bounds),
        center: (windowId) => rawWindow.center(windowId),
        centerOnDisplay: (windowId, displayId) => rawWindow.centerOnDisplay(windowId, displayId),
        setTitle: (windowId, title) => rawWindow.setTitle(windowId, title),
        setResizable: (windowId, resizable) => rawWindow.setResizable(windowId, resizable),
        setDecorations: (windowId, decorations) => rawWindow.setDecorations(windowId, decorations),
        setTrafficLights: (windowId, trafficLights) =>
          rawWindow.setTrafficLights(windowId, trafficLights),
        setVibrancy: (windowId, material) => rawWindow.setVibrancy(windowId, material),
        clearVibrancy: (windowId) => rawWindow.clearVibrancy(windowId),
        setShadow: (windowId, hasShadow) => rawWindow.setShadow(windowId, hasShadow),
        setTitleBarTransparent: (windowId, titleBarTransparent) =>
          rawWindow.setTitleBarTransparent(windowId, titleBarTransparent),
        setAlwaysOnTop: (windowId, alwaysOnTop) => rawWindow.setAlwaysOnTop(windowId, alwaysOnTop),
        setSkipTaskbar: (windowId, skipTaskbar) => rawWindow.setSkipTaskbar(windowId, skipTaskbar),
        setProgress: (windowId, input) => rawWindow.setProgress(windowId, input),
        requestAttention: (windowId, requestType) =>
          rawWindow.requestAttention(windowId, requestType),
        cancelAttention: (windowId) => rawWindow.cancelAttention(windowId),
        minimize: (windowId) => rawWindow.minimize(windowId),
        maximize: (windowId) => rawWindow.maximize(windowId),
        restore: (windowId) => rawWindow.restore(windowId),
        setFullscreen: (windowId, fullscreen) => rawWindow.setFullscreen(windowId, fullscreen),
        setSimpleFullscreen: (windowId, simpleFullscreen) =>
          rawWindow.setSimpleFullscreen(windowId, simpleFullscreen),
        getState: (windowId) => rawWindow.getState(windowId),
        events: () => rawWindow.events()
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
    case WINDOW_SHOW_METHOD:
    case WINDOW_HIDE_METHOD:
    case WINDOW_FOCUS_METHOD:
    case WINDOW_GET_BY_ID_METHOD:
    case WINDOW_GET_PARENT_METHOD:
    case WINDOW_GET_CHILDREN_METHOD:
    case WINDOW_CENTER_METHOD:
    case WINDOW_SET_TITLE_METHOD:
    case WINDOW_SET_RESIZABLE_METHOD:
    case WINDOW_SET_DECORATIONS_METHOD:
    case WINDOW_SET_TRAFFIC_LIGHTS_METHOD:
    case WINDOW_SET_VIBRANCY_METHOD:
    case WINDOW_CLEAR_VIBRANCY_METHOD:
    case WINDOW_SET_SHADOW_METHOD:
    case WINDOW_SET_ALWAYS_ON_TOP_METHOD:
    case WINDOW_SET_PROGRESS_METHOD:
    case WINDOW_REQUEST_ATTENTION_METHOD:
    case WINDOW_CANCEL_ATTENTION_METHOD:
    case WINDOW_MINIMIZE_METHOD:
    case WINDOW_MAXIMIZE_METHOD:
    case WINDOW_RESTORE_METHOD:
      return (request, state) =>
        Effect.gen(function* () {
          const windowId = yield* readWindowId(request.payload, request.method)
          if (!state.windows.has(windowId)) {
            return yield* Effect.fail(makeHostProtocolNotFoundError(windowId, request.method))
          }
          if (request.method === WINDOW_GET_BY_ID_METHOD) {
            return { windowId }
          }
          if (request.method === WINDOW_GET_PARENT_METHOD) {
            const parentWindowId = state.windows.get(windowId)?.parentWindowId
            return parentWindowId === undefined ? {} : { parentWindowId }
          }
          if (request.method === WINDOW_GET_CHILDREN_METHOD) {
            return {
              windows: Array.from(state.windows.entries())
                .filter(([, input]) => input.parentWindowId === windowId)
                .map(([childWindowId]) => ({ windowId: childWindowId }))
            }
          }
          return undefined
        })
    case WINDOW_GET_CURRENT_METHOD:
      return (_request, state) =>
        Effect.gen(function* () {
          const windowId = state.focusedWindowId()
          if (windowId === undefined) {
            return yield* Effect.fail(
              makeHostProtocolNotFoundError("Window:current", WINDOW_GET_CURRENT_METHOD)
            )
          }
          return { windowId }
        })
    case WINDOW_LIST_METHOD:
      return (_request, state) => ({
        windows: Array.from(state.windows.keys(), (windowId) => ({ windowId }))
      })
    case WINDOW_GET_BOUNDS_METHOD:
      return (request, state) =>
        Effect.gen(function* () {
          const windowId = yield* readWindowId(request.payload, request.method)
          if (!state.windows.has(windowId)) {
            return yield* Effect.fail(makeHostProtocolNotFoundError(windowId, request.method))
          }
          return { x: 0, y: 0, width: 640, height: 480 }
        })
    case WINDOW_GET_STATE_METHOD:
      return (request, state) =>
        Effect.gen(function* () {
          const windowId = yield* readWindowId(request.payload, request.method)
          if (!state.windows.has(windowId)) {
            return yield* Effect.fail(makeHostProtocolNotFoundError(windowId, request.method))
          }
          return { minimized: false, maximized: false, fullscreen: false, simpleFullscreen: false }
        })
    case WINDOW_SET_BOUNDS_METHOD:
    case WINDOW_SET_FULLSCREEN_METHOD:
    case WINDOW_SET_SIMPLE_FULLSCREEN_METHOD:
      return (request, state) =>
        Effect.gen(function* () {
          const windowId = yield* readWindowId(request.payload, request.method)
          if (!state.windows.has(windowId)) {
            return yield* Effect.fail(makeHostProtocolNotFoundError(windowId, request.method))
          }
        })
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
  if (seen.has(value)) {
    return false
  }

  if (Array.isArray(value)) {
    seen.add(value)
    return value.every((item) => isJsonPayload(item, seen, false))
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false
  }
  seen.add(value)
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

const makeMockProcessSpawner = (
  options: MockProcessOptions,
  calls: MutableMockProcessSpawnRecord[]
): ChildProcessSpawner.ChildProcessSpawner["Service"] => {
  let nextPid = 10_000
  const fixtures = [...(options.processes ?? [])]

  return ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const input = processSpawnInputFromCommand(command)
      const fixture = takeProcessFixture(fixtures, input)
      if (fixture === undefined) {
        return yield* Effect.fail(
          PlatformError.badArgument({
            description: `missing MockProcess fixture for ${input.command}`,
            method: "spawn",
            module: "MockProcess"
          })
        )
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
    })
  )
}

const makeMockProcessChild = (
  fixture: MockProcessFixture,
  record: MutableMockProcessSpawnRecord
): ChildProcessSpawner.ChildProcessHandle => {
  let running = true
  const exitState = Effect.runSync(Deferred.make<ProcessExitStatus, never>())
  const finish = (status: ProcessExitStatus): Effect.Effect<void, never, never> =>
    Effect.sync(() => {
      if (!running) {
        return
      }
      running = false
    }).pipe(Effect.andThen(Deferred.succeed(exitState, status)), Effect.asVoid)

  if (fixture.exit !== false) {
    setTimeout(() => {
      Effect.runFork(finish(processExitStatus(fixture.exit)))
    }, 0)
  }

  return ChildProcessSpawner.makeHandle({
    all: streamBytes(fixture.stdout ?? []),
    exitCode: Deferred.await(exitState).pipe(
      Effect.flatMap((status) =>
        status.signal === undefined
          ? Effect.succeed(ChildProcessSpawner.ExitCode(status.code))
          : Effect.fail(
              PlatformError.systemError({
                _tag: "Unknown",
                description: `Process interrupted due to receipt of signal: '${status.signal}'`,
                method: "exitCode",
                module: "MockProcess"
              })
            )
      )
    ),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.sync(() => running),
    kill: (options) => {
      const signal = options?.killSignal ?? "SIGTERM"
      if (signal === "SIGTERM") {
        record.terminateTreeCalls += 1
      }
      if (signal === "SIGKILL") {
        record.forceKillTreeCalls += 1
      }
      record.killedWith = signal
      return finish(processExitStatus(undefined, signal))
    },
    pid: ChildProcessSpawner.ProcessId(record.pid),
    stderr: streamBytes(fixture.stderr ?? []),
    stdin: Sink.forEach((chunk: Uint8Array) =>
      running
        ? Effect.sync(() => {
            record.stdin.push(copyBytes(chunk))
          })
        : Effect.fail(
            PlatformError.badArgument({
              description: `MockProcess ${record.input.command} is not running`,
              method: "stdin",
              module: "MockProcess"
            })
          )
    ).pipe(
      Sink.ensuring(
        Effect.sync(() => {
          record.stdinClosed = true
        })
      )
    ),
    stdout: streamBytes(fixture.stdout ?? []),
    unref: Effect.succeed(Effect.void)
  })
}

const processSpawnInputFromCommand = (command: ChildProcess.Command): ProcessSpawnInput => {
  if (!ChildProcess.isStandardCommand(command)) {
    return new ProcessSpawnInput({
      args: [],
      command: "mock-piped-process",
      ownerScope: "mock-process"
    })
  }

  return new ProcessSpawnInput({
    args: [...command.args],
    command: command.command,
    ownerScope: "mock-process",
    ...(command.options.cwd === undefined ? {} : { cwd: command.options.cwd }),
    ...(command.options.env === undefined ? {} : { env: definedEnv(command.options.env) }),
    ...(typeof command.options.shell === "boolean" ? { shell: command.options.shell } : {})
  })
}

const definedEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> => {
  const defined: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      defined[key] = value
    }
  }
  return defined
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

const streamBytes = (chunks: readonly Uint8Array[]): Stream.Stream<Uint8Array> =>
  Stream.fromIterable(chunks).pipe(Stream.map(copyBytes))

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
  const exitState = Effect.runSync(Deferred.make<PtyExitStatus>())
  const exited = Effect.runPromise(Deferred.await(exitState))
  const finish = (status: PtyExitStatus): void => {
    if (!running) {
      return
    }
    running = false
    Effect.runSync(Deferred.succeed(exitState, status).pipe(Effect.asVoid))
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
      if (!running) {
        throw mockNodeError("EINVAL", `MockPTY ${record.input.command} is not running`)
      }

      await yieldMockHostTurn()
      record.writes.push(copyBytes(chunk))
    },
    resize: async (size: PtyResizeInput) => {
      if (!running) {
        throw mockNodeError("EINVAL", `MockPTY ${record.input.command} is not running`)
      }

      await yieldMockHostTurn()
      record.resizes.push({ rows: size.rows, cols: size.cols })
    },
    isRunning: () => running,
    terminateTree: async () => {
      await yieldMockHostTurn()
      record.terminateTreeCalls += 1
      record.killedWith = "SIGTERM"
      finish(ptyExitStatus(undefined, "SIGTERM"))
    },
    forceKillTree: async () => {
      await yieldMockHostTurn()
      record.forceKillTreeCalls += 1
      record.killedWith = "SIGKILL"
      finish(ptyExitStatus(undefined, "SIGKILL"))
    },
    kill: async (signal?: PtySignalInput) => {
      await yieldMockHostTurn()
      record.killedWith = signal
      finish(ptyExitStatus(undefined, signalNameForMock(signal)))
    }
  })
}

const yieldMockHostTurn = (): Promise<void> => Effect.runPromise(Effect.yieldNow)

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

const signalNameForMock = (signal: string | number | undefined): string =>
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
  readonly listener: (event: FileSystem.WatchEvent) => void
  closed: boolean
}

const ROOT_PATH = "/"

interface MemoryFilesystemRuntime {
  readonly fileSystem: Layer.Layer<FileSystem.FileSystem>
  readonly options: FilesystemOptions
}

const makeMemoryFilesystemRuntime = (
  options: MemoryFilesystemOptions,
  now: () => number
): MemoryFilesystemRuntime => {
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

  const fileSystem = FileSystem.layerNoop({
    readFile: (path) =>
      Effect.try({
        try: () => {
          const canonicalPath = resolveExistingPath(nodes, memoryPathLikeToString(path))
          const node = nodes.get(canonicalPath)
          if (node?.kind !== "file") {
            throw nodeError("EISDIR", canonicalPath)
          }
          return copyBytes(node.bytes)
        },
        catch: (error) => memoryPlatformError("readFile", error)
      }),
    realPath: (path) =>
      Effect.try({
        try: () => toPlatformMemoryPath(resolveExistingPath(nodes, memoryPathLikeToString(path))),
        catch: (error) => memoryPlatformError("realPath", error)
      }),
    rename: (from, to) =>
      Effect.try({
        try: () => {
          const fromPath = resolveExistingPath(nodes, memoryPathLikeToString(from))
          const toPath = normalizeMemoryPath(memoryPathLikeToString(to))
          const node = nodes.get(fromPath)
          if (node === undefined) {
            throw nodeError("ENOENT", fromPath)
          }
          const parentPath = posix.dirname(toPath)
          const parent = nodes.get(parentPath)
          if (parent?.kind !== "directory") {
            throw nodeError("ENOENT", parentPath)
          }
          const destination = nodes.get(toPath)
          if (destination?.kind === "directory") {
            throw nodeError("EISDIR", toPath)
          }
          const descendants = childPaths(nodes, toPath)
          if (descendants.length > 0) {
            throw nodeError("ENOTEMPTY", toPath)
          }
          if (node.kind === "directory" && isDescendant(toPath, fromPath)) {
            throw nodeError("EINVAL", toPath)
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
          emitMemoryWatch(watchers, fromPath, "remove")
          emitMemoryWatch(watchers, toPath, "create")
        },
        catch: (error) => memoryPlatformError("rename", error)
      }),
    writeFile: (path, bytes) =>
      Effect.try({
        try: () => {
          writeMemoryFile(
            nodes,
            watchers,
            memoryPathLikeToString(path),
            normalizeWriteBytes(bytes),
            now()
          )
        },
        catch: (error) => memoryPlatformError("writeFile", error)
      }),
    open: (path) =>
      Effect.try({
        try: () => {
          const target = normalizeMemoryPath(memoryPathLikeToString(path))
          const parentPath = posix.dirname(target)
          const parent = nodes.get(parentPath)
          if (parent?.kind !== "directory") {
            throw nodeError("ENOENT", parentPath)
          }
          if (nodes.get(target)?.kind === "directory") {
            throw nodeError("EISDIR", target)
          }
          return memoryFile(target, (bytes) =>
            writeMemoryFile(nodes, watchers, target, bytes, now())
          )
        },
        catch: (error) => memoryPlatformError("open", error)
      }),
    stat: (path) =>
      Effect.try({
        try: () => {
          const canonicalPath = resolveExistingPath(nodes, memoryPathLikeToString(path))
          const node = nodes.get(canonicalPath)
          if (node === undefined) {
            throw nodeError("ENOENT", canonicalPath)
          }
          return memoryStats(node)
        },
        catch: (error) => memoryPlatformError("stat", error)
      }),
    readLink: (path) =>
      Effect.try({
        try: () => {
          const canonicalPath = lookupPath(nodes, memoryPathLikeToString(path), "nofollow")
          const node = nodes.get(canonicalPath)
          if (node === undefined) {
            throw nodeError("ENOENT", canonicalPath)
          }
          if (node.kind !== "symlink") {
            throw nodeError("EINVAL", canonicalPath)
          }
          return node.target
        },
        catch: (error) => memoryPlatformError("readLink", error)
      }),
    makeDirectory: (path, mkdirOptions) =>
      Effect.try({
        try: () => {
          const target = normalizeMemoryPath(path)
          const parent = nodes.get(posix.dirname(target))
          if (parent?.kind !== "directory" && mkdirOptions?.recursive !== true) {
            throw nodeError("ENOENT", posix.dirname(target))
          }

          if (mkdirOptions?.recursive === true) {
            return createDirectoryRecursive(nodes, watchers, target, now())
          }
          if (nodes.has(target)) {
            throw nodeError("EEXIST", target)
          }
          nodes.set(target, { kind: "directory", modifiedAtMs: now() })
          emitMemoryWatch(watchers, target, "create")
        },
        catch: (error) => memoryPlatformError("makeDirectory", error)
      }),
    remove: (path, removeOptions) =>
      Effect.try({
        try: () => {
          const target = normalizeMemoryPath(path)
          const node = nodes.get(target)
          if (node === undefined) {
            if (removeOptions?.force === true) {
              return
            }
            throw nodeError("ENOENT", target)
          }
          if (node.kind === "directory") {
            const children = childPaths(nodes, target)
            if (children.length > 0 && removeOptions?.recursive !== true) {
              throw nodeError("ENOTEMPTY", target)
            }
            for (const child of children) {
              nodes.delete(child)
            }
          }
          nodes.delete(target)
          emitMemoryWatch(watchers, target, "remove")
        },
        catch: (error) => memoryPlatformError("remove", error)
      }),
    watch: (path) =>
      Stream.callback<FileSystem.WatchEvent, PlatformError.PlatformError>((queue) =>
        Effect.acquireRelease(
          Effect.try({
            try: () => {
              const directory = resolveExistingPath(nodes, path)
              const node = nodes.get(directory)
              if (node?.kind !== "directory") {
                throw nodeError("ENOTDIR", directory)
              }

              const registration: MemoryWatchRegistration = {
                directory,
                listener: (event) => {
                  Queue.offerUnsafe(queue, event)
                },
                closed: false
              }
              watchers.push(registration)

              return registration
            },
            catch: (error) => memoryPlatformError("watch", error)
          }),
          (registration) =>
            Effect.sync(() => {
              registration.closed = true
            })
        )
      )
  })

  return {
    fileSystem,
    options: options.permissions === undefined ? {} : { permissions: options.permissions }
  }
}

const writeMemoryFile = (
  nodes: Map<string, MemoryNode>,
  watchers: readonly MemoryWatchRegistration[],
  path: string,
  bytes: Uint8Array,
  modifiedAtMs: number
): void => {
  const target = normalizeMemoryPath(path)
  const parentPath = posix.dirname(target)
  const parent = nodes.get(parentPath)
  if (parent?.kind !== "directory") {
    throw nodeError("ENOENT", parentPath)
  }
  const existing = nodes.get(target)
  if (existing?.kind === "directory") {
    throw nodeError("EISDIR", target)
  }

  const existed = nodes.has(target)
  nodes.set(target, { kind: "file", bytes: copyBytes(bytes), modifiedAtMs })
  emitMemoryWatch(watchers, target, existed ? "update" : "create")
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
): void => {
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
      throw nodeError("ENOTDIR", current)
    }

    nodes.set(current, { kind: "directory", modifiedAtMs })
    emitMemoryWatch(watchers, current, "create")
  }
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
  type: "create" | "remove" | "update"
): void => {
  const directory = posix.dirname(path)
  for (const watcher of watchers) {
    if (!watcher.closed && watcher.directory === directory) {
      watcher.listener(memoryWatchEvent(type, path))
    }
  }
}

const memoryWatchEvent = (
  type: "create" | "remove" | "update",
  path: string
): FileSystem.WatchEvent => {
  switch (type) {
    case "create":
      return { _tag: "Create", path }
    case "remove":
      return { _tag: "Remove", path }
    case "update":
      return { _tag: "Update", path }
  }
}

const memoryFile = (path: string, writeAllBytes: (bytes: Uint8Array) => void): FileSystem.File => ({
  [FileSystem.FileTypeId]: FileSystem.FileTypeId,
  fd: FileSystem.FileDescriptor(1),
  stat: Effect.fail(memoryPlatformError("stat", nodeError("ENOENT", path))),
  seek: () => Effect.void,
  sync: Effect.void,
  read: () => Effect.succeed(FileSystem.Size(0)),
  readAlloc: () => Effect.succeed(Option.none()),
  truncate: () => Effect.void,
  write: (buffer) =>
    Effect.try({
      try: () => {
        writeAllBytes(buffer)
        return FileSystem.Size(buffer.byteLength)
      },
      catch: (error) => memoryPlatformError("write", error)
    }),
  writeAll: (buffer) =>
    Effect.try({
      try: () => writeAllBytes(buffer),
      catch: (error) => memoryPlatformError("writeAll", error)
    })
})

const memoryStats = (node: MemoryNode): FileSystem.File.Info => ({
  type: node.kind === "file" ? "File" : node.kind === "directory" ? "Directory" : "SymbolicLink",
  mtime: Option.some(new Date(node.modifiedAtMs)),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 1,
  ino: Option.some(1),
  mode: node.kind === "directory" ? 0o755 : 0o644,
  nlink: Option.some(1),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(node.kind === "file" ? node.bytes.byteLength : 0),
  blksize: Option.none(),
  blocks: Option.none()
})

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

const memoryPlatformError = (method: string, error: unknown): PlatformError.PlatformError => {
  const node = isNodeError(error) ? error : nodeError("EINVAL", formatMemoryFilesystemError(error))
  return PlatformError.systemError({
    _tag: memoryPlatformErrorTag(node.code),
    module: "FileSystem",
    method,
    pathOrDescriptor: typeof node.path === "string" ? node.path : undefined,
    description: node.message,
    cause: node
  })
}

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error

const memoryPlatformErrorTag = (code: string | undefined): PlatformError.SystemErrorTag => {
  switch (code) {
    case undefined:
      return "Unknown"
    case "EEXIST":
      return "AlreadyExists"
    case "ENOENT":
      return "NotFound"
    case "EACCES":
    case "EPERM":
      return "PermissionDenied"
    case "EBUSY":
      return "Busy"
    case "EINVAL":
    case "EISDIR":
    case "ELOOP":
    case "ENOTDIR":
    case "ENOTEMPTY":
      return "BadResource"
    default:
      return "Unknown"
  }
}

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

const makeTestResourceOwner = (scopeId: string): ResourceOwnerApi =>
  Object.freeze({
    kind: "test",
    scopeId,
    actor: new PermissionActor({ kind: "resource", id: scopeId }),
    attributes: Object.freeze({ scopeId })
  })

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

// oxlint-disable-next-line import/no-cycle -- package barrel intentionally includes the native harness.
export * from "./native.js"
export * from "./capability-laws.js"
