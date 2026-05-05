import { afterEach, expect } from "bun:test"
import { Data, Effect, Exit } from "effect"

import {
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  HostProtocolResponseEnvelope,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  makeHostHandshakeClient,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  type HostHandshakeClient,
  type HostProtocolError,
  type HostProtocolRequestEnvelope,
  type HostWindowClient,
  type WindowCreateInput
} from "@effect-desktop/bridge"
import {
  ResourceRegistry,
  makeResourceRegistry,
  type RegistrySnapshot,
  type ResourceEntry,
  type ResourceHandle,
  type ResourceRegistryApi,
  type ResourceId,
  type ResourceKind
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

export interface HeadlessRuntime {
  readonly calls: () => readonly HeadlessHostCall[]
  readonly handshake: HostHandshakeClient
  readonly registry: ResourceRegistryApi
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
  readonly window: HostWindowClient
}

export const runHeadless = <A, E, R>(
  body: (runtime: HeadlessRuntime) => Effect.Effect<A, E, R>,
  options: HeadlessHarnessOptions = {}
): Effect.Effect<A, E | HostProtocolError | ResourceLeakError, R> =>
  Effect.gen(function* () {
    const registry = yield* makeResourceRegistry()
    const host = makeHeadlessHost(options)
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

const makeHeadlessHost = (options: HeadlessHarnessOptions): HeadlessHost => {
  const calls: HeadlessHostCall[] = []
  const windows = new Map<string, WindowCreateInput>()
  let nextWindowId = 1

  const state: HeadlessHostState = {
    windows
  }

  return {
    calls: () => calls,
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
  }
}

interface HeadlessHost {
  readonly calls: () => readonly HeadlessHostCall[]
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
}

const defaultFixture = (method: string): HeadlessFixture => {
  switch (method) {
    case HOST_PING_METHOD:
    case WINDOW_DESTROY_METHOD:
      return () => undefined
    case HOST_VERSION_METHOD:
      return () => ({ protocolVersion: HOST_PROTOCOL_VERSION })
    case WINDOW_CREATE_METHOD:
      return () => DEFAULT_WINDOW_CREATE_PAYLOAD
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

const isRegistrySnapshot = (value: unknown): value is RegistrySnapshot => {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries)
  )
}
