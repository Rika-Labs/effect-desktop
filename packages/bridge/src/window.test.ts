import { expect, test } from "bun:test"
import { Cause, Clock, Effect, Exit, Schema, Stream } from "effect"

import {
  HostProtocolInvalidArgumentError,
  HostProtocolInvalidOutputError,
  HostProtocolNotFoundError,
  HostProtocolEventEnvelope,
  HostProtocolResponseEnvelope,
  WINDOW_CANCEL_ATTENTION_METHOD,
  WINDOW_CLEAR_VIBRANCY_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_CENTER_METHOD,
  WINDOW_CENTER_ON_DISPLAY_METHOD,
  WINDOW_DESTROY_METHOD,
  WINDOW_EVENT_METHOD,
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
  WINDOW_SET_ALWAYS_ON_TOP_METHOD,
  WINDOW_SET_BOUNDS_METHOD,
  WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
  WINDOW_SET_DECORATIONS_METHOD,
  WINDOW_SET_FULLSCREEN_METHOD,
  WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
  WINDOW_SET_PROGRESS_METHOD,
  WINDOW_SET_RESIZABLE_METHOD,
  WINDOW_SET_SHADOW_METHOD,
  WINDOW_SET_SKIP_TASKBAR_METHOD,
  WINDOW_SET_TITLE_BAR_STYLE_METHOD,
  WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
  WINDOW_SET_TITLE_METHOD,
  WINDOW_SET_TRANSPARENT_METHOD,
  WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
  WINDOW_SET_VIBRANCY_METHOD,
  WINDOW_SHOW_METHOD,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  type HostProtocolRequestEnvelope,
  type HostWindowExchange
} from "./index.js"

test("host window client requests Window.create and decodes the WindowId", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: () => "request-window-create",
        nextTraceId: () => "trace-window-create",
        now: () => 1710000000000
      })

      const response = yield* client.create({
        title: "Test",
        width: 320,
        height: 240
      })

      expect(response.windowId).toBe("window-1")
      expect(requests).toEqual([
        {
          kind: "request",
          id: "request-window-create",
          method: WINDOW_CREATE_METHOD,
          timestamp: 1710000000000,
          traceId: "trace-window-create",
          payload: {
            title: "Test",
            width: 320,
            height: 240
          }
        }
      ])
    })
  ))

test("host window client preserves macOS polish fields in Window.create", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: () => "request-window-create-polished",
        nextTraceId: () => "trace-window-create-polished",
        now: () => 1710000000003
      })

      yield* client.create({
        titleBarStyle: "hiddenInset",
        vibrancy: "windowBackground",
        trafficLights: { x: 12, y: 13 }
      })

      expect(requests[0]?.payload).toEqual({
        titleBarStyle: "hiddenInset",
        vibrancy: "windowBackground",
        trafficLights: { x: 12, y: 13 }
      })
    })
  ))

test("host window client requests owned child Window.create", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: () => "request-window-create-child",
        nextTraceId: () => "trace-window-create-child",
        now: () => 1710000000006
      })

      yield* client.create({
        title: "Child",
        parentWindowId: "window-parent"
      })

      expect(requests).toEqual([
        {
          kind: "request",
          id: "request-window-create-child",
          method: WINDOW_CREATE_METHOD,
          timestamp: 1710000000006,
          traceId: "trace-window-create-child",
          payload: {
            title: "Child",
            parentWindowId: "window-parent"
          }
        }
      ])
    })
  ))

test("host window client requests Window.destroy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_715_000_000_001
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: () => "request-window-destroy",
        nextTraceId: () => "trace-window-destroy"
      })

      yield* client
        .destroy("window-1")
        .pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))

      expect(requests).toEqual([
        {
          kind: "request",
          id: "request-window-destroy",
          method: WINDOW_DESTROY_METHOD,
          timestamp,
          traceId: "trace-window-destroy",
          payload: {
            windowId: "window-1"
          }
        }
      ])
    })
  ))

test("host window client requests Window.show, Window.hide, and Window.focus", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: nextId([
          "request-window-show",
          "request-window-hide",
          "request-window-focus"
        ]),
        nextTraceId: nextId(["trace-window-show", "trace-window-hide", "trace-window-focus"]),
        now: nextNumber([1710000000010, 1710000000011, 1710000000012])
      })

      yield* client.show("window-1")
      yield* client.hide("window-1")
      yield* client.focus("window-1")

      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_SHOW_METHOD, { windowId: "window-1" }],
        [WINDOW_HIDE_METHOD, { windowId: "window-1" }],
        [WINDOW_FOCUS_METHOD, { windowId: "window-1" }]
      ])
    })
  ))

test("host window client requests Window.getCurrent, Window.getById, Window.list, Window.getParent, and Window.getChildren", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: nextId([
          "request-window-get-current",
          "request-window-get-by-id",
          "request-window-list",
          "request-window-get-parent",
          "request-window-get-children"
        ]),
        nextTraceId: nextId([
          "trace-window-get-current",
          "trace-window-get-by-id",
          "trace-window-list",
          "trace-window-get-parent",
          "trace-window-get-children"
        ]),
        now: nextNumber([
          1_710_000_000_013, 1_710_000_000_014, 1_710_000_000_015, 1_710_000_000_016,
          1_710_000_000_017
        ])
      })

      const current = yield* client.getCurrent()
      const byId = yield* client.getById("window-1")
      const listed = yield* client.list()
      const parent = yield* client.getParent("window-1")
      const children = yield* client.getChildren("window-1")

      expect(current.windowId).toBe("window-1")
      expect(byId.windowId).toBe("window-1")
      expect(listed.windows.map((window) => window.windowId)).toEqual(["window-1", "window-2"])
      expect(parent.parentWindowId).toBe("window-parent")
      expect(children.windows.map((window) => window.windowId)).toEqual([
        "window-child-1",
        "window-child-2"
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_GET_CURRENT_METHOD, undefined],
        [WINDOW_GET_BY_ID_METHOD, { windowId: "window-1" }],
        [WINDOW_LIST_METHOD, undefined],
        [WINDOW_GET_PARENT_METHOD, { windowId: "window-1" }],
        [WINDOW_GET_CHILDREN_METHOD, { windowId: "window-1" }]
      ])
    })
  ))

test("host window client decodes Window.Event subscriptions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeHostWindowClient(windowExchange([]))

      const events = yield* client.events().pipe(Stream.take(2), Stream.runCollect)

      expect(Array.from(events)).toEqual([
        {
          type: "window-registry-event",
          phase: "closed",
          windowId: "window-1",
          window: {
            kind: "window",
            id: "window-1",
            generation: 0,
            ownerScope: "window:window-1",
            state: "open"
          },
          terminal: true
        },
        {
          type: "window-state-event",
          windowId: "window-1",
          window: {
            kind: "window",
            id: "window-1",
            generation: 0,
            ownerScope: "window:window-1",
            state: "open"
          },
          state: {
            minimized: true,
            maximized: false,
            fullscreen: false,
            simpleFullscreen: false
          }
        }
      ])
    })
  ))

test("host window client fails Window.Event subscriptions when exchange cannot subscribe", () =>
  Effect.runPromise(
    expectEffectFailure(
      (() => {
        const client = makeHostWindowClient({
          request: windowExchange([]).request
        })
        return client.events().pipe(Stream.runDrain)
      })(),
      (error) =>
        Schema.is(HostProtocolInvalidOutputError)(error) && error.operation === WINDOW_EVENT_METHOD
    )
  ))

test("host window client requests Window.getBounds, Window.setBounds, display bounds, Window.center, and Window.centerOnDisplay", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: nextId([
          "request-window-get-bounds",
          "request-window-set-bounds",
          "request-window-set-bounds-on-display",
          "request-window-center",
          "request-window-center-on-display"
        ]),
        nextTraceId: nextId([
          "trace-window-get-bounds",
          "trace-window-set-bounds",
          "trace-window-set-bounds-on-display",
          "trace-window-center",
          "trace-window-center-on-display"
        ]),
        now: nextNumber([
          1_710_000_000_013, 1_710_000_000_014, 1_710_000_000_015, 1_710_000_000_016,
          1_710_000_000_017
        ])
      })

      const current = yield* client.getBounds("window-1")
      const set = yield* client.setBounds("window-1", { x: 30, y: 40, width: 800, height: 600 })
      const displayed = yield* client.setBoundsOnDisplay("window-1", "display-1", {
        x: 15,
        y: 25,
        width: 700,
        height: 500
      })
      const centered = yield* client.center("window-1")
      const displayCentered = yield* client.centerOnDisplay("window-1", "display-1")

      expect({ centered, current, displayCentered, displayed, set }).toEqual({
        current: { x: 10, y: 20, width: 640, height: 480 },
        set: { x: 30, y: 40, width: 800, height: 600 },
        displayed: { x: 15, y: 25, width: 700, height: 500 },
        centered: { x: 50, y: 60, width: 640, height: 480 },
        displayCentered: { x: 70, y: 80, width: 640, height: 480 }
      })
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_GET_BOUNDS_METHOD, { windowId: "window-1" }],
        [
          WINDOW_SET_BOUNDS_METHOD,
          { windowId: "window-1", bounds: { x: 30, y: 40, width: 800, height: 600 } }
        ],
        [
          WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
          {
            windowId: "window-1",
            displayId: "display-1",
            bounds: { x: 15, y: 25, width: 700, height: 500 }
          }
        ],
        [WINDOW_CENTER_METHOD, { windowId: "window-1" }],
        [WINDOW_CENTER_ON_DISPLAY_METHOD, { windowId: "window-1", displayId: "display-1" }]
      ])
    })
  ))

test("host window client requests mutable chrome commands", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: nextId([
          "request-window-set-title",
          "request-window-set-resizable",
          "request-window-set-decorations",
          "request-window-set-traffic-lights",
          "request-window-set-vibrancy",
          "request-window-clear-vibrancy",
          "request-window-set-shadow",
          "request-window-set-title-bar-style",
          "request-window-set-title-bar-transparent",
          "request-window-set-transparent"
        ]),
        nextTraceId: nextId([
          "trace-window-set-title",
          "trace-window-set-resizable",
          "trace-window-set-decorations",
          "trace-window-set-traffic-lights",
          "trace-window-set-vibrancy",
          "trace-window-clear-vibrancy",
          "trace-window-set-shadow",
          "trace-window-set-title-bar-style",
          "trace-window-set-title-bar-transparent",
          "trace-window-set-transparent"
        ]),
        now: nextNumber([
          1_710_000_000_016, 1_710_000_000_017, 1_710_000_000_018, 1_710_000_000_019,
          1_710_000_000_020, 1_710_000_000_021, 1_710_000_000_022, 1_710_000_000_023,
          1_710_000_000_024, 1_710_000_000_025
        ])
      })

      yield* client.setTitle("window-1", "Renamed")
      yield* client.setResizable("window-1", false)
      yield* client.setDecorations("window-1", true)
      yield* client.setTrafficLights("window-1", { x: 12, y: 13 })
      yield* client.setVibrancy("window-1", "windowBackground")
      yield* client.clearVibrancy("window-1")
      yield* client.setShadow("window-1", false)
      yield* client.setTitleBarStyle("window-1", "hiddenInset")
      yield* client.setTitleBarTransparent("window-1", true)
      yield* client.setTransparent("window-1", true)

      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_SET_TITLE_METHOD, { windowId: "window-1", title: "Renamed" }],
        [WINDOW_SET_RESIZABLE_METHOD, { windowId: "window-1", resizable: false }],
        [WINDOW_SET_DECORATIONS_METHOD, { windowId: "window-1", decorations: true }],
        [
          WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
          { windowId: "window-1", trafficLights: { x: 12, y: 13 } }
        ],
        [WINDOW_SET_VIBRANCY_METHOD, { windowId: "window-1", material: "windowBackground" }],
        [WINDOW_CLEAR_VIBRANCY_METHOD, { windowId: "window-1" }],
        [WINDOW_SET_SHADOW_METHOD, { windowId: "window-1", hasShadow: false }],
        [WINDOW_SET_TITLE_BAR_STYLE_METHOD, { windowId: "window-1", titleBarStyle: "hiddenInset" }],
        [
          WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
          { windowId: "window-1", titleBarTransparent: true }
        ],
        [WINDOW_SET_TRANSPARENT_METHOD, { windowId: "window-1", transparent: true }]
      ])
    })
  ))

test("host window client requests attention and z-order commands", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: nextId([
          "request-window-set-always-on-top",
          "request-window-set-skip-taskbar",
          "request-window-set-progress",
          "request-window-request-attention",
          "request-window-cancel-attention"
        ]),
        nextTraceId: nextId([
          "trace-window-set-always-on-top",
          "trace-window-set-skip-taskbar",
          "trace-window-set-progress",
          "trace-window-request-attention",
          "trace-window-cancel-attention"
        ]),
        now: nextNumber([
          1_710_000_000_021, 1_710_000_000_022, 1_710_000_000_023, 1_710_000_000_024,
          1_710_000_000_025
        ])
      })

      yield* client.setAlwaysOnTop("window-1", true)
      yield* client.setSkipTaskbar("window-1", true)
      yield* client.setProgress("window-1", {
        state: "normal",
        progress: 42,
        desktopFilename: "app.desktop"
      })
      yield* client.requestAttention("window-1", "critical")
      yield* client.cancelAttention("window-1")

      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_SET_ALWAYS_ON_TOP_METHOD, { windowId: "window-1", alwaysOnTop: true }],
        [WINDOW_SET_SKIP_TASKBAR_METHOD, { windowId: "window-1", skipTaskbar: true }],
        [
          WINDOW_SET_PROGRESS_METHOD,
          { windowId: "window-1", state: "normal", progress: 42, desktopFilename: "app.desktop" }
        ],
        [WINDOW_REQUEST_ATTENTION_METHOD, { windowId: "window-1", requestType: "critical" }],
        [WINDOW_CANCEL_ATTENTION_METHOD, { windowId: "window-1" }]
      ])
    })
  ))

test("host window client keeps explicit window id authoritative for progress", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests))

      yield* client.setProgress("window-1", {
        progress: 42,
        windowId: "window-2"
      } as Parameters<typeof client.setProgress>[1])

      expect(requests.map((request) => request.payload)).toEqual([
        {
          windowId: "window-1",
          progress: 42
        }
      ])
    })
  ))

test("host window client requests Window.minimize, Window.maximize, Window.restore, fullscreen, and state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests), {
        nextRequestId: nextId([
          "request-window-minimize",
          "request-window-maximize",
          "request-window-set-fullscreen",
          "request-window-set-simple-fullscreen",
          "request-window-get-state",
          "request-window-restore"
        ]),
        nextTraceId: nextId([
          "trace-window-minimize",
          "trace-window-maximize",
          "trace-window-set-fullscreen",
          "trace-window-set-simple-fullscreen",
          "trace-window-get-state",
          "trace-window-restore"
        ]),
        now: nextNumber([
          1_710_000_000_016, 1_710_000_000_017, 1_710_000_000_018, 1_710_000_000_019,
          1_710_000_000_020, 1_710_000_000_021
        ])
      })

      yield* client.minimize("window-1")
      yield* client.maximize("window-1")
      yield* client.setFullscreen("window-1", true)
      yield* client.setSimpleFullscreen("window-1", true)
      const state = yield* client.getState("window-1")
      yield* client.restore("window-1")

      expect(state).toEqual({
        minimized: false,
        maximized: true,
        fullscreen: true,
        simpleFullscreen: true
      })
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_MINIMIZE_METHOD, { windowId: "window-1" }],
        [WINDOW_MAXIMIZE_METHOD, { windowId: "window-1" }],
        [WINDOW_SET_FULLSCREEN_METHOD, { windowId: "window-1", fullscreen: true }],
        [WINDOW_SET_SIMPLE_FULLSCREEN_METHOD, { windowId: "window-1", simpleFullscreen: true }],
        [WINDOW_GET_STATE_METHOD, { windowId: "window-1" }],
        [WINDOW_RESTORE_METHOD, { windowId: "window-1" }]
      ])
    })
  ))

test("host window client rejects invalid create bounds before crossing the host boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidInputs: ReadonlyArray<unknown> = [
        { width: 0 },
        { title: "" },
        { parentWindowId: "" },
        { vibrancy: "not-a-material" },
        { trafficLights: { x: -1, y: 0 } },
        { trafficLights: { x: 0, y: -1 } }
      ]

      for (const input of invalidInputs) {
        const requests: HostProtocolRequestEnvelope[] = []
        const client = makeHostWindowClient(windowExchange(requests))

        yield* expectEffectFailure(
          client.create(input as Parameters<typeof client.create>[0]),
          (error) => Schema.is(HostProtocolInvalidArgumentError)(error) && error.field === "payload"
        )
        expect(requests).toEqual([])
      }
    })
  ))

test("host window client rejects empty destroy window ids before crossing the host boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests))

      yield* expectEffectFailure(client.destroy(""), (error) =>
        Schema.is(HostProtocolInvalidArgumentError)(error)
      )
      expect(requests).toEqual([])
    })
  ))

test("host window client rejects empty lifecycle window ids before crossing the host boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests))

      yield* expectEffectFailure(client.show(""), (error) =>
        Schema.is(HostProtocolInvalidArgumentError)(error)
      )
      yield* expectEffectFailure(client.hide(""), (error) =>
        Schema.is(HostProtocolInvalidArgumentError)(error)
      )
      yield* expectEffectFailure(client.focus(""), (error) =>
        Schema.is(HostProtocolInvalidArgumentError)(error)
      )
      expect(requests).toEqual([])
    })
  ))

test("host window client rejects invalid setBounds payload before crossing the host boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests))

      yield* expectEffectFailure(
        client.setBounds("window-1", { x: 0, y: 0, width: 0, height: 100 }),
        (error) => Schema.is(HostProtocolInvalidArgumentError)(error)
      )
      expect(requests).toEqual([])
    })
  ))

test("host window client rejects invalid attention payloads before crossing the host boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostWindowClient(windowExchange(requests))

      yield* expectEffectFailure(client.setProgress("window-1", { progress: 101 }), (error) =>
        Schema.is(HostProtocolInvalidArgumentError)(error)
      )
      yield* expectEffectFailure(
        client.requestAttention(
          "window-1",
          "urgent" as Parameters<typeof client.requestAttention>[1]
        ),
        (error) => Schema.is(HostProtocolInvalidArgumentError)(error)
      )
      expect(requests).toEqual([])
    })
  ))

test("host window client propagates destroy response errors", () =>
  Effect.runPromise(
    expectEffectFailure(
      makeHostWindowClient(notFoundExchange(), {
        nextRequestId: () => "request-window-destroy",
        nextTraceId: () => "trace-window-destroy",
        now: () => 1710000000002
      }).destroy("missing"),
      (error) => Schema.is(HostProtocolNotFoundError)(error) && error.resource === "Window:missing"
    )
  ))

test("host window client rejects malformed create output", () =>
  Effect.runPromise(
    expectEffectFailure(makeHostWindowClient(malformedCreateExchange()).create(), (error) =>
      Schema.is(HostProtocolInvalidOutputError)(error)
    )
  ))

test("host window client rejects empty create response window ids", () =>
  Effect.runPromise(
    expectEffectFailure(makeHostWindowClient(emptyWindowIdExchange()).create(), (error) =>
      Schema.is(HostProtocolInvalidOutputError)(error)
    )
  ))

test("host window client rejects mismatched response ids", () =>
  Effect.runPromise(
    expectEffectFailure(
      makeHostWindowClient(mismatchedResponseExchange({ id: "request-window-other" }), {
        nextRequestId: () => "request-window-create",
        nextTraceId: () => "trace-window-create",
        now: () => 1710000000004
      }).create(),
      (error) =>
        Schema.is(HostProtocolInvalidOutputError)(error) && error.operation === WINDOW_CREATE_METHOD
    )
  ))

test("host window client rejects mismatched response trace ids", () =>
  Effect.runPromise(
    expectEffectFailure(
      makeHostWindowClient(mismatchedResponseExchange({ traceId: "trace-window-other" }), {
        nextRequestId: () => "request-window-create",
        nextTraceId: () => "trace-window-create",
        now: () => 1710000000005
      }).create(),
      (error) =>
        Schema.is(HostProtocolInvalidOutputError)(error) && error.operation === WINDOW_CREATE_METHOD
    )
  ))

const windowExchange = (requests: HostProtocolRequestEnvelope[]): HostWindowExchange => ({
  request: (request) => {
    requests.push(request)
    const base = {
      kind: "response",
      id: request.id,
      timestamp: request.timestamp + 1,
      traceId: request.traceId
    } as const

    return Effect.succeed(
      new HostProtocolResponseEnvelope(
        request.method === WINDOW_CREATE_METHOD
          ? {
              ...base,
              payload: {
                windowId: "window-1"
              }
            }
          : request.method === WINDOW_GET_CURRENT_METHOD ||
              request.method === WINDOW_GET_BY_ID_METHOD
            ? {
                ...base,
                payload: {
                  windowId: "window-1"
                }
              }
            : request.method === WINDOW_LIST_METHOD
              ? {
                  ...base,
                  payload: {
                    windows: [{ windowId: "window-1" }, { windowId: "window-2" }]
                  }
                }
              : request.method === WINDOW_GET_PARENT_METHOD
                ? {
                    ...base,
                    payload: {
                      parentWindowId: "window-parent"
                    }
                  }
                : request.method === WINDOW_GET_CHILDREN_METHOD
                  ? {
                      ...base,
                      payload: {
                        windows: [{ windowId: "window-child-1" }, { windowId: "window-child-2" }]
                      }
                    }
                  : request.method === WINDOW_GET_BOUNDS_METHOD ||
                      request.method === WINDOW_SET_BOUNDS_METHOD ||
                      request.method === WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD ||
                      request.method === WINDOW_CENTER_METHOD ||
                      request.method === WINDOW_CENTER_ON_DISPLAY_METHOD
                    ? {
                        ...base,
                        payload: boundsResponseForRequest(request)
                      }
                    : request.method === WINDOW_GET_STATE_METHOD ||
                        request.method === WINDOW_MINIMIZE_METHOD ||
                        request.method === WINDOW_MAXIMIZE_METHOD ||
                        request.method === WINDOW_RESTORE_METHOD ||
                        request.method === WINDOW_SET_FULLSCREEN_METHOD ||
                        request.method === WINDOW_SET_SIMPLE_FULLSCREEN_METHOD
                      ? {
                          ...base,
                          payload: {
                            minimized: false,
                            maximized: true,
                            fullscreen: true,
                            simpleFullscreen: true
                          }
                        }
                      : base
      )
    )
  },
  subscribe: (method) =>
    method === WINDOW_EVENT_METHOD
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            method,
            timestamp: 1_710_000_000_100,
            traceId: "trace-window-event",
            payload: {
              type: "window-registry-event",
              phase: "closed",
              windowId: "window-1",
              window: {
                kind: "window",
                id: "window-1",
                generation: 0,
                ownerScope: "window:window-1",
                state: "open"
              },
              terminal: true
            }
          }),
          new HostProtocolEventEnvelope({
            kind: "event",
            method,
            timestamp: 1_710_000_000_101,
            traceId: "trace-window-state-event",
            payload: {
              type: "window-state-event",
              windowId: "window-1",
              window: {
                kind: "window",
                id: "window-1",
                generation: 0,
                ownerScope: "window:window-1",
                state: "open"
              },
              state: {
                minimized: true,
                maximized: false,
                fullscreen: false,
                simpleFullscreen: false
              }
            }
          })
        )
      : Stream.empty
})

interface BoundsPayload {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const boundsResponseForRequest = (request: HostProtocolRequestEnvelope): BoundsPayload => {
  if (request.method === WINDOW_SET_BOUNDS_METHOD && isBoundsPayload(request.payload)) {
    return request.payload.bounds
  }
  if (
    request.method === WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD &&
    isDisplayBoundsPayload(request.payload)
  ) {
    return request.payload.bounds
  }
  if (request.method === WINDOW_CENTER_METHOD) {
    return { x: 50, y: 60, width: 640, height: 480 }
  }
  if (request.method === WINDOW_CENTER_ON_DISPLAY_METHOD) {
    return { x: 70, y: 80, width: 640, height: 480 }
  }
  return { x: 10, y: 20, width: 640, height: 480 }
}

const isBoundsPayload = (
  payload: HostProtocolRequestEnvelope["payload"]
): payload is { readonly bounds: BoundsPayload } =>
  typeof payload === "object" &&
  payload !== null &&
  "bounds" in payload &&
  typeof payload.bounds === "object" &&
  payload.bounds !== null

const isDisplayBoundsPayload = (
  payload: HostProtocolRequestEnvelope["payload"]
): payload is { readonly bounds: BoundsPayload; readonly displayId: string } =>
  isBoundsPayload(payload) && "displayId" in payload

const notFoundExchange = (): HostWindowExchange => ({
  request: (request) =>
    Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        error: makeHostProtocolNotFoundError("Window:missing", WINDOW_DESTROY_METHOD)
      })
    )
})

const malformedCreateExchange = (): HostWindowExchange => ({
  request: (request) =>
    Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        payload: {}
      })
    )
})

const emptyWindowIdExchange = (): HostWindowExchange => ({
  request: (request) =>
    Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        payload: { windowId: "" }
      })
    )
})

const mismatchedResponseExchange = (
  fields: Partial<Pick<HostProtocolResponseEnvelope, "id" | "traceId">>
): HostWindowExchange => ({
  request: (request) =>
    Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: fields.id ?? request.id,
        timestamp: request.timestamp + 1,
        traceId: fields.traceId ?? request.traceId,
        payload: { windowId: "window-1" }
      })
    )
})

class ExpectedFailureMissing extends Schema.TaggedErrorClass<ExpectedFailureMissing>()(
  "ExpectedFailureMissing",
  {}
) {}

const expectEffectFailure = <A, E>(
  effect: Effect.Effect<A, E, never>,
  predicate: (error: unknown) => boolean
): Effect.Effect<void, ExpectedFailureMissing, never> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause.reasons.find(Cause.isFailReason)
      expect(predicate(failure?.error)).toBe(true)
      return
    }
    return yield* new ExpectedFailureMissing()
  })

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})

const nextId = (values: ReadonlyArray<string>): (() => string) => {
  let index = 0
  return () => {
    const value = values[index]
    if (value === undefined) {
      throw new Error("next id exhausted")
    }
    index += 1
    return value
  }
}

const nextNumber = (values: ReadonlyArray<number>): (() => number) => {
  let index = 0
  return () => {
    const value = values[index]
    if (value === undefined) {
      throw new Error("next number exhausted")
    }
    index += 1
    return value
  }
}
