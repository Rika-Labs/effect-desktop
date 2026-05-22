import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError,
  HostProtocolInternalError,
  type HostProtocolRequestEnvelope
} from "@orika/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  makeResourceRegistry,
  P
} from "@orika/core"
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  type Layer,
  ManagedRuntime,
  Schema,
  Stream
} from "effect"
import { EventJournal } from "effect/unstable/eventlog"

import {
  makeResidentLifecycleMemoryClient,
  makeResidentLifecycleBridgeClientLayer,
  makeResidentLifecycleServiceLayer,
  makeResidentLifecycleUnsupportedClient,
  ResidentLifecycle,
  ResidentLifecycleClient,
  type ResidentLifecycleClientApi
} from "./resident-lifecycle.js"
import {
  ResidentLifecycleEnableRequest,
  ResidentLifecycleEvent,
  ResidentLifecyclePolicy
} from "./contracts/resident-lifecycle.js"

test("ResidentLifecycle enables a scoped resident policy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const runtime = yield* configuredRuntime(rows)
      const client = yield* makeResidentLifecycleMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          const state = yield* resident.enable(enableRequest())
          const current = yield* resident.getState()
          const resources = yield* runtime.resources.list()
          return { current, resources, state }
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      expect(result.state.enabled).toBe(true)
      expect(result.current.enabled).toBe(true)
      expect(result.current.policy).toEqual(enableRequest().policy)
      expect(result.resources.entries).toHaveLength(1)
      expect(rows.some((row) => row.outcome === "enabled")).toBe(true)
    })
  ))

test("ResidentLifecycle keeps process, window, and background policy independent", () => {
  const policy = enableRequest().policy

  expect(policy.process).toBe("keep-running")
  expect(policy.windows).toBe("close-to-background")
  expect(policy.background).toBe("tray")
})

test("ResidentLifecycle bridge client validates before transport and decodes events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const event = new HostProtocolEventEnvelope({
        kind: "event",
        method: "ResidentLifecycle.Event",
        timestamp: 1,
        traceId: "trace-event",
        payload: {
          type: "resident-lifecycle-event",
          timestamp: 1,
          phase: "enabled",
          state: {
            enabled: true,
            policy: {
              process: "keep-running",
              windows: "close-to-background",
              background: "tray"
            }
          },
          traceId: "trace-event"
        }
      })
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: {
              enabled: true,
              policy: {
                process: "keep-running",
                windows: "close-to-background",
                background: "tray"
              }
            }
          })
        },
        subscribe: () => Stream.fromIterable([event])
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ResidentLifecycleClient
          const invalid = yield* decodeJsonString(
            '{"policy":{"process":"keep-running","windows":"close-to-background","background":"assistant"}}'
          )
          const invalidExit = yield* Effect.exit(
            client.enable(invalid as ResidentLifecycleEnableRequest)
          )
          const enabled = yield* client.enable(enableRequest())
          const events = yield* client.events().pipe(Stream.take(1), Stream.runCollect)
          return { enabled, events, invalidExit }
        }),
        makeResidentLifecycleBridgeClientLayer(exchange)
      )

      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [
          "ResidentLifecycle.enable",
          {
            policy: {
              process: "keep-running",
              windows: "close-to-background",
              background: "tray",
              launchAtLogin: true
            },
            traceId: "enable-1"
          }
        ]
      ])
      expect(result.enabled.enabled).toBe(true)
      expect(Array.from(result.events).map((item) => item.phase)).toEqual(["enabled"])
      expectExitFailure(result.invalidExit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ResidentLifecycle.enable"
        })
      })
    })
  ))

test("ResidentLifecycle events reject inconsistent failure reasons", () => {
  for (const payload of [
    {
      ...eventBase(),
      phase: "enabled",
      state: enabledState(),
      reason: "host failed"
    },
    {
      ...eventBase(),
      phase: "disabled",
      state: { enabled: false },
      reason: "host failed"
    },
    {
      ...eventBase(),
      phase: "changed",
      state: enabledState(),
      reason: "host failed"
    },
    {
      ...eventBase(),
      phase: "failed",
      state: enabledState()
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(ResidentLifecycleEvent)(payload))
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const payload of [
    {
      ...eventBase(),
      phase: "enabled",
      state: enabledState()
    },
    {
      ...eventBase(),
      phase: "disabled",
      state: { enabled: false }
    },
    {
      ...eventBase(),
      phase: "changed",
      state: enabledState()
    },
    {
      ...eventBase(),
      phase: "failed",
      state: enabledState(),
      reason: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(ResidentLifecycleEvent)(payload))
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("ResidentLifecycle bridge client rejects inconsistent event reasons as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const event = new HostProtocolEventEnvelope({
        kind: "event",
        method: "ResidentLifecycle.Event",
        timestamp: 1,
        traceId: "trace-event",
        payload: {
          ...eventBase(),
          phase: "failed",
          state: enabledState()
        }
      })
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: () => Stream.fromIterable([event])
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ResidentLifecycleClient
          return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        makeResidentLifecycleBridgeClientLayer(exchange)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toBeInstanceOf(HostProtocolInvalidOutputError)
      })
    })
  ))

test("ResidentLifecycle rejects malformed policy before client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* configuredRuntime([])
      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let calls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        enable: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.enable(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          const invalid = yield* decodeJsonString(
            '{"policy":{"process":"keep-running","windows":"close-to-background","background":"assistant","launchAtLogin":true}}'
          )
          return yield* Effect.exit(resident.enable(invalid as ResidentLifecycleEnableRequest))
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ResidentLifecycle.enable"
        })
      })
    })
  ))

test("ResidentLifecycle rejects control-byte trace ids before permission and client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const runtime = yield* configuredRuntime(rows)
      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let calls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        enable: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.enable(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          const invalid = yield* decodeJsonString(
            '{"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true},"traceId":"trace\\nforged"}'
          )
          return yield* Effect.exit(resident.enable(invalid as ResidentLifecycleEnableRequest))
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      expect(calls).toBe(0)
      expect(rows).toHaveLength(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ResidentLifecycle.enable"
        })
      })
    })
  ))

test("ResidentLifecycle rejects invalid resource ownership before client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* configuredRuntime([])
      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let calls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        enable: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.enable(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          const invalid = yield* decodeJsonString(
            '{"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true},"ownerScope":"   ","traceId":"enable-1"}'
          )
          return yield* Effect.exit(resident.enable(invalid as ResidentLifecycleEnableRequest))
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      expect(calls).toBe(0)
      const resources = yield* runtime.resources.list()
      expect(resources.entries).toHaveLength(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ResidentLifecycle.enable"
        })
      })
    })
  ))

test("ResidentLifecycle denies before resource registration and client calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const runtime = yield* configuredRuntime(rows, { declareResident: false })
      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let calls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        enable: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.enable(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          return yield* Effect.exit(resident.enable(enableRequest()))
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      const resources = yield* runtime.resources.list()
      expect(calls).toBe(0)
      expect(resources.entries).toHaveLength(0)
      expect(rows.some((row) => row.kind === "permission-denied")).toBe(true)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "ResidentLifecycle.enable"
        })
      })
    })
  ))

test("ResidentLifecycle returns typed unsupported failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* configuredRuntime([])

      const result = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          const enable = yield* Effect.exit(resident.enable(enableRequest()))
          const disable = yield* Effect.exit(resident.disable({ traceId: "disable-1" }))
          const state = yield* Effect.exit(resident.getState())
          return { disable, enable, state }
        }),
        makeResidentLifecycleServiceLayer(makeResidentLifecycleUnsupportedClient(), runtime)
      )

      expectExitFailure(result.enable, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "ResidentLifecycle.enable" })
      })
      expectExitFailure(result.disable, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "ResidentLifecycle.disable" })
      })
      expectExitFailure(result.state, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "ResidentLifecycle.getState" })
      })
    })
  ))

test("ResidentLifecycle rejects repeated enable without creating duplicate resources", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* configuredRuntime([])
      const client = yield* makeResidentLifecycleMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          yield* resident.enable(enableRequest())
          const repeated = yield* Effect.exit(resident.enable(enableRequest()))
          const resources = yield* runtime.resources.list()
          return { repeated, resources }
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      expect(result.resources.entries).toHaveLength(1)
      expectExitFailure(result.repeated, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ResidentLifecycle.enable"
        })
      })
    })
  ))

test("ResidentLifecycle concurrent enable creates one resource and one host call", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* configuredRuntime([])
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let enableCalls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        enable: (input) =>
          Effect.gen(function* () {
            enableCalls += 1
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            return yield* baseClient.enable(input)
          })
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          const fiber = yield* Effect.all(
            [
              Effect.exit(resident.enable(enableRequest())),
              Effect.exit(resident.enable(enableRequest()))
            ],
            { concurrency: "unbounded" }
          ).pipe(Effect.forkChild({ startImmediately: true }))
          yield* Deferred.await(started)
          yield* Deferred.succeed(release, undefined)
          const exits = yield* Fiber.join(fiber)
          const resources = yield* runtime.resources.list()
          return { exits, resources }
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      expect(enableCalls).toBe(1)
      expect(result.resources.entries).toHaveLength(1)
      expect(Exit.isSuccess(result.exits[0])).toBe(true)
      expectExitFailure(result.exits[1], (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ResidentLifecycle.enable"
        })
      })
    })
  ))

test("ResidentLifecycle disable reaches host without a local handle", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* configuredRuntime([])
      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let disableCalls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        disable: (input) =>
          Effect.sync(() => {
            disableCalls += 1
          }).pipe(Effect.andThen(baseClient.disable(input)))
      }

      const resources = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          yield* resident.enable(enableRequest())
          yield* resident.disable({ traceId: "disable-1" })
          yield* resident.disable({ traceId: "disable-2" })
          return yield* runtime.resources.list()
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      expect(disableCalls).toBe(2)
      expect(resources.entries).toHaveLength(0)
    })
  ))

test("ResidentLifecycle concurrent disable serializes cleanup and reaches host for both calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* configuredRuntime([])
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let disableCalls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        disable: (input) =>
          Effect.gen(function* () {
            disableCalls += 1
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            return yield* baseClient.disable(input)
          })
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          yield* resident.enable(enableRequest())
          const fiber = yield* Effect.all(
            [
              Effect.exit(resident.disable({ traceId: "disable-1" })),
              Effect.exit(resident.disable({ traceId: "disable-2" }))
            ],
            { concurrency: "unbounded" }
          ).pipe(Effect.forkChild({ startImmediately: true }))
          yield* Deferred.await(started)
          yield* Deferred.succeed(release, undefined)
          const exits = yield* Fiber.join(fiber)
          const resources = yield* runtime.resources.list()
          return { exits, resources }
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )

      expect(disableCalls).toBe(2)
      expect(result.exits.every(Exit.isSuccess)).toBe(true)
      expect(result.resources.entries).toHaveLength(0)
    })
  ))

test("ResidentLifecycle audit failure rolls back enabled host state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* configuredRuntime([])
      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let disableCalls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        disable: (input) =>
          Effect.sync(() => {
            disableCalls += 1
          }).pipe(Effect.andThen(baseClient.disable(input)))
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          const exit = yield* Effect.exit(resident.enable(enableRequest()))
          const state = yield* client.getState()
          const resources = yield* runtime.resources.list()
          return { exit, resources, state }
        }),
        makeResidentLifecycleServiceLayer(client, { ...runtime, audit: failingAudit() })
      )

      expect(disableCalls).toBe(1)
      expect(result.state.enabled).toBe(false)
      expect(result.resources.entries).toHaveLength(0)
      expectExitFailure(result.exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "ResidentLifecycle.audit"
        })
      })
    })
  ))

test("ResidentLifecycle cleans resource on host failure and scope disposal", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const runtime = yield* configuredRuntime(rows)
      const failure = new HostProtocolInternalError({
        tag: "Internal",
        message: "host failed",
        operation: "ResidentLifecycle.enable",
        recoverable: false
      })
      const failing = yield* makeResidentLifecycleMemoryClient({ failure: { enable: failure } })

      const failed = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          return yield* Effect.exit(resident.enable(enableRequest()))
        }),
        makeResidentLifecycleServiceLayer(failing, runtime)
      )
      const failedResources = yield* runtime.resources.list()
      expect(failedResources.entries).toHaveLength(0)
      expect(rows.some((row) => row.outcome === "failed")).toBe(true)
      expectExitFailure(failed, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "ResidentLifecycle.enable" })
      })

      const baseClient = yield* makeResidentLifecycleMemoryClient()
      let disableCalls = 0
      const client: ResidentLifecycleClientApi = {
        ...baseClient,
        disable: (input) =>
          Effect.sync(() => {
            disableCalls += 1
          }).pipe(Effect.andThen(baseClient.disable(input)))
      }
      const enabled = yield* runScoped(
        Effect.gen(function* () {
          const resident = yield* ResidentLifecycle
          yield* resident.enable(enableRequest())
          const resources = yield* runtime.resources.list()
          const resource = resources.entries[0]
          if (resource !== undefined) {
            yield* runtime.resources.dispose(resource.handle.id)
          }
          return yield* runtime.resources.list()
        }),
        makeResidentLifecycleServiceLayer(client, runtime)
      )
      expect(disableCalls).toBe(1)
      expect(enabled.entries).toHaveLength(0)
    })
  ))

const configuredRuntime = (
  rows: AuditEvent[],
  options: { readonly declareResident?: boolean } = {}
) =>
  Effect.gen(function* () {
    const audit = memoryAudit(rows)
    const permissions = yield* makePermissionRegistry({ audit })
    const resources = yield* makeResourceRegistry()
    const declareResident = options.declareResident ?? true
    if (declareResident) {
      yield* Effect.all([
        permissions.declare(
          P.nativeInvoke({ primitive: "ResidentLifecycle", methods: ["enable"] })
        ),
        permissions.declare(
          P.nativeInvoke({ primitive: "ResidentLifecycle", methods: ["disable"] })
        )
      ])
    }
    rows.length = 0
    return { audit, permissions, resources }
  })

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const failingAudit = (): AuditEventsApi => ({
  emit: () =>
    Effect.fail(
      new EventJournal.EventJournalError({
        method: "EventJournal.write",
        cause: new Error("journal full")
      })
    ),
  observe: () => Stream.empty
})

const enableRequest = () =>
  new ResidentLifecycleEnableRequest({
    policy: new ResidentLifecyclePolicy({
      process: "keep-running",
      windows: "close-to-background",
      background: "tray",
      launchAtLogin: true
    }),
    traceId: "enable-1"
  })

const eventBase = () => ({
  type: "resident-lifecycle-event",
  timestamp: 1,
  traceId: "trace-event"
})

const enabledState = () => ({
  enabled: true,
  policy: {
    process: "keep-running",
    windows: "close-to-background",
    background: "tray",
    launchAtLogin: true
  }
})

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

const decodeJsonString = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))

const expectExitFailure = <A>(exit: Exit.Exit<A, unknown>, assert: (error: unknown) => void) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
