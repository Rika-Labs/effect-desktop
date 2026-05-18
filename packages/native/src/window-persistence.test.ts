/** @effect-diagnostics strictEffectProvide:off */
import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolRequestEnvelope,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  WINDOW_GET_BOUNDS_METHOD,
  WINDOW_GET_STATE_METHOD,
  makeHostProtocolHostUnavailableError
} from "@effect-desktop/bridge"
import { ResourceRegistry, makeResourceId, makeResourceRegistry } from "@effect-desktop/core"
import { Effect, Exit, Fiber, Layer, Stream } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

import {
  ScreenBounds,
  ScreenDisplay,
  ScreenDisplaysResult,
  ScreenPoint,
  ScreenSupportedResult
} from "./contracts/screen.js"
import { WindowBounds, type WindowHandle, WindowState } from "./contracts/window.js"
import {
  WindowPersistence,
  WindowPersistenceError,
  WindowPersistenceRestoreResult,
  ScreenLive,
  WindowLive,
  makeScreenServiceLayer,
  makeWindowPersistenceLayer,
  makeWindowServiceLayer,
  type ScreenClientApi,
  type WindowClientApi
} from "./index.js"
import { makeScreenBridgeClientLayer } from "./screen.js"
import { makeWindowBridgeClientLayer } from "./window.js"

test("WindowPersistence saves and restores stale display state onto the current primary display", () => {
  const calls: WindowPersistenceCalls = { setBounds: [], fullscreen: [] }
  let displays = [primaryDisplay(), secondaryDisplay()]
  let bounds = new WindowBounds({ x: 1200, y: 40, width: 800, height: 600 })
  let hostFullscreen = false

  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* WindowPersistence

      yield* service.save(windowHandle, { zoom: 1.25, scrollPositions: { feed: 42 } })
      bounds = new WindowBounds({ x: 20, y: 20, width: 300, height: 300 })
      displays = [primaryDisplay()]
      hostFullscreen = true
      const restored = yield* service.restore(windowHandle)

      expect(restored).toBeInstanceOf(WindowPersistenceRestoreResult)
      expect(restored).toMatchObject({
        restored: true,
        state: {
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          displayId: "primary",
          isFullScreen: false,
          zoom: 1.25,
          scrollPositions: { feed: 42 }
        }
      })
      expect(calls.setBounds).toEqual([new WindowBounds({ x: 0, y: 0, width: 800, height: 600 })])
      expect(calls.fullscreen).toEqual([false])

      void bounds
    }).pipe(
      Effect.provide(
        fixtureLayer({
          calls,
          windowClient: () => ({
            getBounds: () => Effect.succeed(bounds),
            getState: () =>
              Effect.succeed(
                new WindowState({ minimized: false, maximized: false, fullscreen: hostFullscreen })
              ),
            setBounds: (_window, next) =>
              Effect.sync(() => {
                calls.setBounds.push(next)
                bounds = new WindowBounds(next)
              }),
            setFullscreen: (_window, fullscreen) =>
              Effect.sync(() => {
                calls.fullscreen.push(fullscreen)
                hostFullscreen = fullscreen
              })
          }),
          screenClient: () => ({
            getDisplays: () => Effect.succeed(new ScreenDisplaysResult({ displays }))
          })
        })
      )
    )
  )
})

test("WindowPersistence save uses the renderer bridge path for window and screen state", () => {
  const requests: HostProtocolRequestEnvelope[] = []

  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* WindowPersistence

      yield* service.save(windowHandle, { zoom: 1.5 })

      expect(requests.map((request) => request.method)).toEqual([
        WINDOW_GET_BOUNDS_METHOD,
        WINDOW_GET_STATE_METHOD,
        "Screen.getDisplays"
      ])
      expect(requests[0]?.payload).toMatchObject({ window: windowHandle })
      expect(requests[1]?.payload).toMatchObject({ window: windowHandle })
    }).pipe(Effect.provide(bridgeFixtureLayer({ requests })))
  )
})

test("WindowPersistence rejects malformed save options before bridge transport", () => {
  const requests: HostProtocolRequestEnvelope[] = []

  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* WindowPersistence
      const exit = yield* Effect.exit(service.save(windowHandle, { zoom: Number.NaN }))

      expectWindowPersistenceFailure(exit, "invalid-input", "WindowPersistence.save")
      expect(requests).toEqual([])
    }).pipe(Effect.provide(bridgeFixtureLayer({ requests })))
  )
})

test("WindowPersistence emits persisted and cleared events from the shared state service", () => {
  const calls: WindowPersistenceCalls = { setBounds: [], fullscreen: [] }

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* WindowPersistence
        const fiber = yield* Effect.forkScoped(
          service.events(windowHandle).pipe(Stream.take(2), Stream.runCollect)
        )

        yield* Effect.yieldNow
        yield* service.save(windowHandle)
        yield* service.clear(windowHandle)
        const events = Array.from(yield* Fiber.join(fiber))

        expect(events.map((event) => event.kind)).toEqual(["persisted", "cleared"])
        expect(events.map((event) => event.windowId)).toEqual(["main", "main"])
      })
    ).pipe(Effect.provide(fixtureLayer({ calls })))
  )
})

test("WindowPersistence validates window access before clear and events", () => {
  const calls: WindowPersistenceCalls = { setBounds: [], fullscreen: [] }
  const deniedGetById = () =>
    Effect.fail(
      new HostProtocolPermissionDeniedError({
        tag: "PermissionDenied",
        capability: "native.invoke",
        resource: "Window.getById",
        message: "denied",
        operation: "Window.getById",
        recoverable: false
      })
    )

  return Effect.runPromise(
    Effect.gen(function* () {
      const clearDenied = yield* Effect.gen(function* () {
        const service = yield* WindowPersistence
        return yield* service.clear(windowHandle).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          fixtureLayer({
            calls,
            windowClient: () => ({ getById: deniedGetById })
          })
        )
      )
      const eventsDenied = yield* Effect.gen(function* () {
        const service = yield* WindowPersistence
        return yield* service.events(windowHandle).pipe(Stream.runDrain, Effect.flip)
      }).pipe(
        Effect.provide(
          fixtureLayer({
            calls,
            windowClient: () => ({ getById: deniedGetById })
          })
        )
      )

      expect(clearDenied).toMatchObject({ reason: "denied", operation: "WindowPersistence.clear" })
      expect(eventsDenied).toMatchObject({
        reason: "denied",
        operation: "WindowPersistence.events"
      })
    })
  )
})

test("WindowPersistence serializes saves for different windows in one store", () => {
  const calls: WindowPersistenceCalls = { setBounds: [], fullscreen: [] }
  const paletteHandle: WindowHandle = {
    ...windowHandle,
    id: makeResourceId("palette")
  }

  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* WindowPersistence
      yield* Effect.all([service.save(windowHandle), service.save(paletteHandle)], {
        concurrency: "unbounded"
      })
      const main = yield* service.restore(windowHandle)
      const palette = yield* service.restore(paletteHandle)

      expect(main.restored).toBe(true)
      expect(palette.restored).toBe(true)
    }).pipe(Effect.provide(fixtureLayer({ calls })))
  )
})

test("WindowPersistence maps host permission denial, unsupported, and host failure", () => {
  const calls: WindowPersistenceCalls = { setBounds: [], fullscreen: [] }

  return Effect.runPromise(
    Effect.gen(function* () {
      const denied = yield* Effect.gen(function* () {
        const service = yield* WindowPersistence
        return yield* service.save(windowHandle).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          fixtureLayer({
            calls,
            windowClient: () => ({
              getBounds: () =>
                Effect.fail(
                  new HostProtocolPermissionDeniedError({
                    tag: "PermissionDenied",
                    capability: "native.invoke",
                    resource: "Window.getBounds",
                    message: "denied",
                    operation: "Window.getBounds",
                    recoverable: false
                  })
                )
            })
          })
        )
      )
      const unsupported = yield* Effect.gen(function* () {
        const service = yield* WindowPersistence
        return yield* service.save(windowHandle).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          fixtureLayer({
            calls,
            screenClient: () => ({
              getDisplays: () =>
                Effect.fail(
                  new HostProtocolUnsupportedError({
                    tag: "Unsupported",
                    reason: "screen unavailable",
                    message: "unsupported",
                    operation: "Screen.getDisplays",
                    recoverable: false
                  })
                )
            })
          })
        )
      )
      const hostFailed = yield* Effect.gen(function* () {
        const service = yield* WindowPersistence
        yield* service.save(windowHandle)
        return yield* service.restore(windowHandle).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          fixtureLayer({
            calls,
            windowClient: () => ({
              setBounds: () => Effect.fail(makeHostProtocolHostUnavailableError("Window.setBounds"))
            })
          })
        )
      )

      expect(denied).toMatchObject({ reason: "denied", operation: "WindowPersistence.save" })
      expect(unsupported).toMatchObject({
        reason: "unsupported",
        operation: "WindowPersistence.save"
      })
      expect(hostFailed).toMatchObject({
        reason: "host-failed",
        operation: "WindowPersistence.restore"
      })
    })
  )
})

test("WindowPersistence maps invalid screen display payloads to invalid-output", () => {
  const calls: WindowPersistenceCalls = { setBounds: [], fullscreen: [] }

  return Effect.runPromise(
    Effect.gen(function* () {
      const invalidOutput = yield* Effect.gen(function* () {
        const service = yield* WindowPersistence
        return yield* service.save(windowHandle).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          fixtureLayer({
            calls,
            screenClient: () => ({
              getDisplays: () =>
                Effect.succeed(
                  new ScreenDisplaysResult({
                    displays: [
                      new ScreenDisplay({
                        id: "invalid",
                        bounds: new ScreenBounds({ x: 0, y: 0, width: 1024, height: 768 }),
                        workArea: new ScreenBounds({ x: 0, y: 0, width: 0, height: 768 }),
                        scaleFactor: 1,
                        primary: true
                      })
                    ]
                  })
                )
            })
          })
        )
      )

      expect(invalidOutput).toMatchObject({
        reason: "invalid-output",
        operation: "WindowPersistence.save"
      })
    })
  )
})

test("WindowPersistence rejects invalid save options before host work", () => {
  const calls: WindowPersistenceCalls = { setBounds: [], fullscreen: [] }

  return Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.gen(function* () {
        const service = yield* WindowPersistence
        return yield* Effect.exit(service.save(windowHandle, { zoom: Number.NaN }))
      }).pipe(Effect.provide(fixtureLayer({ calls })))

      expectWindowPersistenceFailure(exit, "invalid-input", "WindowPersistence.save")
      expect(calls.setBounds).toEqual([])
      expect(calls.fullscreen).toEqual([])
    })
  )
})

interface WindowPersistenceCalls {
  readonly setBounds: WindowBounds[]
  readonly fullscreen: boolean[]
}

const windowHandle: WindowHandle = {
  kind: "window",
  id: makeResourceId("main"),
  generation: 0,
  ownerScope: "test",
  state: "open"
}

let fixtureSequence = 0

const fixtureLayer = (options: {
  readonly calls: WindowPersistenceCalls
  readonly windowClient?: () => Partial<WindowClientApi>
  readonly screenClient?: () => Partial<ScreenClientApi>
}): Layer.Layer<WindowPersistence, never, never> => {
  const windowClient = makeWindowClient(options.calls, options.windowClient?.() ?? {})
  const screenClient = makeScreenClient(options.screenClient?.() ?? {})
  fixtureSequence += 1
  return Layer.provide(
    makeWindowPersistenceLayer({ path: `window-persistence-test-${String(fixtureSequence)}.json` }),
    Layer.mergeAll(
      makeWindowServiceLayer(windowClient),
      makeScreenServiceLayer(screenClient),
      KeyValueStore.layerMemory
    )
  )
}

const bridgeFixtureLayer = (options: {
  readonly requests: HostProtocolRequestEnvelope[]
}): Layer.Layer<WindowPersistence, never, never> => {
  const exchange = windowPersistenceBridgeExchange(options.requests)
  const registry = Effect.runSync(makeResourceRegistry())
  fixtureSequence += 1
  return Layer.provide(
    makeWindowPersistenceLayer({
      path: `window-persistence-bridge-test-${String(fixtureSequence)}.json`
    }),
    Layer.mergeAll(
      Layer.provide(
        WindowLive,
        Layer.provide(
          makeWindowBridgeClientLayer(exchange),
          Layer.succeed(ResourceRegistry)(registry)
        )
      ),
      Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange)),
      KeyValueStore.layerMemory
    )
  )
}

const windowPersistenceBridgeExchange = (
  requests: HostProtocolRequestEnvelope[]
): BridgeClientExchange => ({
  request: (request) =>
    Effect.sync(() => {
      requests.push(request)
      switch (request.method) {
        case WINDOW_GET_BOUNDS_METHOD:
          return { kind: "success", payload: { x: 100, y: 120, width: 800, height: 600 } }
        case WINDOW_GET_STATE_METHOD:
          return {
            kind: "success",
            payload: { minimized: false, maximized: false, fullscreen: false }
          }
        case "Screen.getDisplays":
          return {
            kind: "success",
            payload: { displays: [primaryDisplay()] }
          }
        default:
          throw new Error(`unexpected bridge request: ${request.method}`)
      }
    }),
  subscribe: () => Stream.empty
})

const makeWindowClient = (
  calls: WindowPersistenceCalls,
  overrides: Partial<WindowClientApi>
): WindowClientApi => ({
  create: () => Effect.succeed(windowHandle),
  close: () => Effect.void,
  show: () => Effect.void,
  hide: () => Effect.void,
  focus: () => Effect.void,
  getCurrent: () => Effect.succeed(windowHandle),
  getById: () => Effect.succeed(windowHandle),
  list: () => Effect.succeed([windowHandle]),
  getBounds: () => Effect.succeed(new WindowBounds({ x: 100, y: 100, width: 800, height: 600 })),
  setBounds: (_window, bounds) =>
    Effect.sync(() => {
      calls.setBounds.push(bounds)
    }),
  center: () => Effect.void,
  setTitle: () => Effect.void,
  setResizable: () => Effect.void,
  setDecorations: () => Effect.void,
  setAlwaysOnTop: () => Effect.void,
  setProgress: () => Effect.void,
  requestAttention: () => Effect.void,
  cancelAttention: () => Effect.void,
  minimize: () => Effect.void,
  maximize: () => Effect.void,
  restore: () => Effect.void,
  setFullscreen: (_window, fullscreen) =>
    Effect.sync(() => {
      calls.fullscreen.push(fullscreen)
    }),
  getState: () =>
    Effect.succeed(new WindowState({ minimized: false, maximized: false, fullscreen: false })),
  events: () => Stream.empty,
  ...overrides
})

const makeScreenClient = (overrides: Partial<ScreenClientApi>): ScreenClientApi => ({
  getDisplays: () =>
    Effect.succeed(new ScreenDisplaysResult({ displays: [primaryDisplay(), secondaryDisplay()] })),
  getPrimaryDisplay: () => Effect.succeed(primaryDisplay()),
  getPointerPoint: () => Effect.succeed(new ScreenPoint({ x: 0, y: 0 })),
  onDisplaysChanged: () => Stream.empty,
  isSupported: () => Effect.succeed(new ScreenSupportedResult({ supported: true })),
  ...overrides
})

const primaryDisplay = (): ScreenDisplay =>
  new ScreenDisplay({
    id: "primary",
    bounds: new ScreenBounds({ x: 0, y: 0, width: 1024, height: 768 }),
    workArea: new ScreenBounds({ x: 0, y: 0, width: 1024, height: 768 }),
    scaleFactor: 2,
    primary: true
  })

const secondaryDisplay = (): ScreenDisplay =>
  new ScreenDisplay({
    id: "secondary",
    bounds: new ScreenBounds({ x: 1024, y: 0, width: 1024, height: 768 }),
    workArea: new ScreenBounds({ x: 1024, y: 0, width: 1024, height: 768 }),
    scaleFactor: 1,
    primary: false
  })

function expectWindowPersistenceFailure(
  exit: Exit.Exit<unknown, WindowPersistenceError>,
  reason: WindowPersistenceError["reason"],
  operation: string
): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((entry) => entry._tag === "Fail")
    expect(fail?.error).toMatchObject({ reason, operation })
  }
}
