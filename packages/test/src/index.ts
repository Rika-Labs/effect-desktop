import { afterEach, expect } from "bun:test"
import { Context, Data, Effect, Exit, Layer, Stream } from "effect"

import {
  ApiStreamCompleteFrame,
  ApiStreamDataFrame,
  Client,
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolNotFoundError,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  HostProtocolUnsupportedError,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  hostProtocolErrorRecoverableDefault,
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
  type HostProtocolRequestEnvelope,
  type HostProtocolStreamEnvelope,
  type HostWindowClient,
  type WindowCreateInput
} from "@effect-desktop/bridge"
import {
  ResourceRegistry,
  SecretValue,
  makeResourceRegistry,
  type RegistrySnapshot,
  type ResourceEntry,
  type ResourceHandle,
  type ResourceRegistryApi,
  type ResourceId,
  type ResourceKind,
  type SecretsSafeStorageApi
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

export type HeadlessFixture = (
  request: HostProtocolRequestEnvelope,
  state: HeadlessHostState
) => Effect.Effect<unknown, HostProtocolError, never> | HeadlessFixturePayload

type HeadlessFixturePayload =
  | Readonly<Record<string, unknown>>
  | readonly unknown[]
  | string
  | number
  | boolean
  | symbol
  | null
  | undefined

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
    calls: () => calls.slice(),
    windows: () => new Map(windows),
    request: (request) =>
      Effect.gen(function* () {
        calls.push({
          method: request.method,
          request
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
  readonly succeed: (method: string, payload: unknown) => Effect.Effect<void, never, never>
  readonly fail: (method: string, error: unknown) => Effect.Effect<void, never, never>
  readonly resource: (
    method: string,
    handle: ApiResourceHandle
  ) => Effect.Effect<void, never, never>
  readonly streamChunks: (
    method: string,
    chunks: readonly unknown[]
  ) => Effect.Effect<void, never, never>
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
  ): Effect.Effect<void, never, never> =>
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
    calls: () => calls.slice(),
    cancels: () => cancels.slice(),
    disposedResources: () => disposedResources.slice(),
    succeed: (method, payload) => enqueue(method, { kind: "success", payload }),
    fail: (method, error) => enqueue(method, { kind: "failure", error }),
    resource: (method, handle) =>
      Effect.gen(function* () {
        if (options.registry === undefined) {
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
        yield* enqueue(method, { kind: "success", payload: coreHandleToBridgeHandle(registered) })
      }),
    streamChunks: (method, chunks) =>
      Effect.sync(() => {
        streams.set(method, chunks.slice())
      })
  } satisfies MockBridgeApi)
}

export const MockBridgeLive = (options: MockBridgeOptions = {}): Layer.Layer<MockBridge> =>
  Layer.succeed(MockBridge)(makeMockBridge(options))

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
): Effect.Effect<unknown, HostProtocolError, never> => {
  const result = fixture(request, state)

  return Effect.isEffect(result)
    ? (result as Effect.Effect<unknown, HostProtocolError, never>)
    : Effect.succeed(result)
}

const recordCall = (calls: MockBridgeCall[], request: HostProtocolRequestEnvelope): void => {
  calls.push({
    method: request.method,
    payload: request.payload,
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
const DEFAULT_WINDOW_CREATE_PAYLOAD = Symbol("DEFAULT_WINDOW_CREATE_PAYLOAD")
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
