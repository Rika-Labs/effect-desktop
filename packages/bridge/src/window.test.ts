import { expect, test } from "bun:test"
import { Clock, Effect, Stream } from "effect"

import {
  HostProtocolInvalidArgumentError,
  HostProtocolInvalidOutputError,
  HostProtocolNotFoundError,
  HostProtocolEventEnvelope,
  HostProtocolResponseEnvelope,
  WINDOW_CANCEL_ATTENTION_METHOD,
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
  WINDOW_SET_DECORATIONS_METHOD,
  WINDOW_SET_FULLSCREEN_METHOD,
  WINDOW_SET_PROGRESS_METHOD,
  WINDOW_SET_RESIZABLE_METHOD,
  WINDOW_SET_SKIP_TASKBAR_METHOD,
  WINDOW_SET_TITLE_METHOD,
  WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
  WINDOW_SHOW_METHOD,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  type HostProtocolRequestEnvelope,
  type HostWindowExchange
} from "./index.js"

test("host window client requests Window.create and decodes the WindowId", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: () => "request-window-create",
    nextTraceId: () => "trace-window-create",
    now: () => 1710000000000
  })

  const response = await Effect.runPromise(
    client.create({
      title: "Test",
      width: 320,
      height: 240
    })
  )

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

test("host window client preserves macOS polish fields in Window.create", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: () => "request-window-create-polished",
    nextTraceId: () => "trace-window-create-polished",
    now: () => 1710000000003
  })

  await Effect.runPromise(
    client.create({
      titleBarStyle: "hiddenInset",
      vibrancy: "windowBackground",
      trafficLights: { x: 12, y: 13 }
    })
  )

  expect(requests[0]?.payload).toEqual({
    titleBarStyle: "hiddenInset",
    vibrancy: "windowBackground",
    trafficLights: { x: 12, y: 13 }
  })
})

test("host window client requests owned child Window.create", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: () => "request-window-create-child",
    nextTraceId: () => "trace-window-create-child",
    now: () => 1710000000006
  })

  await Effect.runPromise(
    client.create({
      title: "Child",
      parentWindowId: "window-parent"
    })
  )

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

test("host window client requests Window.destroy", async () => {
  const timestamp = 1_715_000_000_001
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: () => "request-window-destroy",
    nextTraceId: () => "trace-window-destroy"
  })

  await Effect.runPromise(
    client.destroy("window-1").pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))
  )

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

test("host window client requests Window.show, Window.hide, and Window.focus", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: nextId(["request-window-show", "request-window-hide", "request-window-focus"]),
    nextTraceId: nextId(["trace-window-show", "trace-window-hide", "trace-window-focus"]),
    now: nextNumber([1710000000010, 1710000000011, 1710000000012])
  })

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* client.show("window-1")
      yield* client.hide("window-1")
      yield* client.focus("window-1")
    })
  )

  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    [WINDOW_SHOW_METHOD, { windowId: "window-1" }],
    [WINDOW_HIDE_METHOD, { windowId: "window-1" }],
    [WINDOW_FOCUS_METHOD, { windowId: "window-1" }]
  ])
})

test("host window client requests Window.getCurrent, Window.getById, Window.list, Window.getParent, and Window.getChildren", async () => {
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
      1_710_000_000_013, 1_710_000_000_014, 1_710_000_000_015, 1_710_000_000_016, 1_710_000_000_017
    ])
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const current = yield* client.getCurrent()
      const byId = yield* client.getById("window-1")
      const listed = yield* client.list()
      const parent = yield* client.getParent("window-1")
      const children = yield* client.getChildren("window-1")
      return { byId, children, current, listed, parent }
    })
  )

  expect(result.current.windowId).toBe("window-1")
  expect(result.byId.windowId).toBe("window-1")
  expect(result.listed.windows.map((window) => window.windowId)).toEqual(["window-1", "window-2"])
  expect(result.parent.parentWindowId).toBe("window-parent")
  expect(result.children.windows.map((window) => window.windowId)).toEqual([
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

test("host window client decodes Window.Event subscriptions", async () => {
  const client = makeHostWindowClient(windowExchange([]))

  const events = await Effect.runPromise(client.events().pipe(Stream.take(2), Stream.runCollect))

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
        fullscreen: false
      }
    }
  ])
})

test("host window client fails Window.Event subscriptions when exchange cannot subscribe", async () => {
  const client = makeHostWindowClient({
    request: windowExchange([]).request
  })

  await expectEffectFailure(
    client.events().pipe(Stream.runDrain),
    (error) =>
      error instanceof HostProtocolInvalidOutputError && error.operation === WINDOW_EVENT_METHOD
  )
})

test("host window client requests Window.getBounds, Window.setBounds, Window.center, and Window.centerOnDisplay", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: nextId([
      "request-window-get-bounds",
      "request-window-set-bounds",
      "request-window-center",
      "request-window-center-on-display"
    ]),
    nextTraceId: nextId([
      "trace-window-get-bounds",
      "trace-window-set-bounds",
      "trace-window-center",
      "trace-window-center-on-display"
    ]),
    now: nextNumber([1710000000013, 1710000000014, 1710000000015, 1710000000016])
  })

  const bounds = await Effect.runPromise(
    Effect.gen(function* () {
      const current = yield* client.getBounds("window-1")
      yield* client.setBounds("window-1", { x: 30, y: 40, width: 800, height: 600 })
      yield* client.center("window-1")
      yield* client.centerOnDisplay("window-1", "display-1")
      return current
    })
  )

  expect(bounds).toEqual({ x: 10, y: 20, width: 640, height: 480 })
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    [WINDOW_GET_BOUNDS_METHOD, { windowId: "window-1" }],
    [
      WINDOW_SET_BOUNDS_METHOD,
      { windowId: "window-1", bounds: { x: 30, y: 40, width: 800, height: 600 } }
    ],
    [WINDOW_CENTER_METHOD, { windowId: "window-1" }],
    [WINDOW_CENTER_ON_DISPLAY_METHOD, { windowId: "window-1", displayId: "display-1" }]
  ])
})

test("host window client requests mutable chrome commands", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: nextId([
      "request-window-set-title",
      "request-window-set-resizable",
      "request-window-set-decorations",
      "request-window-set-traffic-lights"
    ]),
    nextTraceId: nextId([
      "trace-window-set-title",
      "trace-window-set-resizable",
      "trace-window-set-decorations",
      "trace-window-set-traffic-lights"
    ]),
    now: nextNumber([1_710_000_000_016, 1_710_000_000_017, 1_710_000_000_018, 1_710_000_000_019])
  })

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* client.setTitle("window-1", "Renamed")
      yield* client.setResizable("window-1", false)
      yield* client.setDecorations("window-1", true)
      yield* client.setTrafficLights("window-1", { x: 12, y: 13 })
    })
  )

  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    [WINDOW_SET_TITLE_METHOD, { windowId: "window-1", title: "Renamed" }],
    [WINDOW_SET_RESIZABLE_METHOD, { windowId: "window-1", resizable: false }],
    [WINDOW_SET_DECORATIONS_METHOD, { windowId: "window-1", decorations: true }],
    [WINDOW_SET_TRAFFIC_LIGHTS_METHOD, { windowId: "window-1", trafficLights: { x: 12, y: 13 } }]
  ])
})

test("host window client requests attention and z-order commands", async () => {
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
      1_710_000_000_021, 1_710_000_000_022, 1_710_000_000_023, 1_710_000_000_024, 1_710_000_000_025
    ])
  })

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* client.setAlwaysOnTop("window-1", true)
      yield* client.setSkipTaskbar("window-1", true)
      yield* client.setProgress("window-1", {
        state: "normal",
        progress: 42,
        desktopFilename: "app.desktop"
      })
      yield* client.requestAttention("window-1", "critical")
      yield* client.cancelAttention("window-1")
    })
  )

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

test("host window client keeps explicit window id authoritative for progress", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests))

  await Effect.runPromise(
    client.setProgress("window-1", {
      progress: 42,
      windowId: "window-2"
    } as Parameters<typeof client.setProgress>[1])
  )

  expect(requests.map((request) => request.payload)).toEqual([
    {
      windowId: "window-1",
      progress: 42
    }
  ])
})

test("host window client requests Window.minimize, Window.maximize, Window.restore, fullscreen, and state", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: nextId([
      "request-window-minimize",
      "request-window-maximize",
      "request-window-set-fullscreen",
      "request-window-get-state",
      "request-window-restore"
    ]),
    nextTraceId: nextId([
      "trace-window-minimize",
      "trace-window-maximize",
      "trace-window-set-fullscreen",
      "trace-window-get-state",
      "trace-window-restore"
    ]),
    now: nextNumber([
      1_710_000_000_016, 1_710_000_000_017, 1_710_000_000_018, 1_710_000_000_019, 1_710_000_000_020
    ])
  })

  const state = await Effect.runPromise(
    Effect.gen(function* () {
      yield* client.minimize("window-1")
      yield* client.maximize("window-1")
      yield* client.setFullscreen("window-1", true)
      const current = yield* client.getState("window-1")
      yield* client.restore("window-1")
      return current
    })
  )

  expect(state).toEqual({ minimized: false, maximized: true, fullscreen: true })
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    [WINDOW_MINIMIZE_METHOD, { windowId: "window-1" }],
    [WINDOW_MAXIMIZE_METHOD, { windowId: "window-1" }],
    [WINDOW_SET_FULLSCREEN_METHOD, { windowId: "window-1", fullscreen: true }],
    [WINDOW_GET_STATE_METHOD, { windowId: "window-1" }],
    [WINDOW_RESTORE_METHOD, { windowId: "window-1" }]
  ])
})

test("host window client rejects invalid create bounds before crossing the host boundary", async () => {
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

    await expectEffectFailure(
      client.create(input as Parameters<typeof client.create>[0]),
      (error) => error instanceof HostProtocolInvalidArgumentError && error.field === "payload"
    )
    expect(requests).toEqual([])
  }
})

test("host window client rejects empty destroy window ids before crossing the host boundary", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests))

  await expectEffectFailure(
    client.destroy(""),
    (error) => error instanceof HostProtocolInvalidArgumentError
  )
  expect(requests).toEqual([])
})

test("host window client rejects empty lifecycle window ids before crossing the host boundary", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests))

  await expectEffectFailure(
    client.show(""),
    (error) => error instanceof HostProtocolInvalidArgumentError
  )
  await expectEffectFailure(
    client.hide(""),
    (error) => error instanceof HostProtocolInvalidArgumentError
  )
  await expectEffectFailure(
    client.focus(""),
    (error) => error instanceof HostProtocolInvalidArgumentError
  )
  expect(requests).toEqual([])
})

test("host window client rejects invalid setBounds payload before crossing the host boundary", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests))

  await expectEffectFailure(
    client.setBounds("window-1", { x: 0, y: 0, width: 0, height: 100 }),
    (error) => error instanceof HostProtocolInvalidArgumentError
  )
  expect(requests).toEqual([])
})

test("host window client rejects invalid attention payloads before crossing the host boundary", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests))

  await expectEffectFailure(
    client.setProgress("window-1", { progress: 101 }),
    (error) => error instanceof HostProtocolInvalidArgumentError
  )
  await expectEffectFailure(
    client.requestAttention("window-1", "urgent" as Parameters<typeof client.requestAttention>[1]),
    (error) => error instanceof HostProtocolInvalidArgumentError
  )
  expect(requests).toEqual([])
})

test("host window client propagates destroy response errors", async () => {
  const client = makeHostWindowClient(notFoundExchange(), {
    nextRequestId: () => "request-window-destroy",
    nextTraceId: () => "trace-window-destroy",
    now: () => 1710000000002
  })

  await expectEffectFailure(
    client.destroy("missing"),
    (error) => error instanceof HostProtocolNotFoundError && error.resource === "Window:missing"
  )
})

test("host window client rejects malformed create output", async () => {
  const client = makeHostWindowClient(malformedCreateExchange())

  await expectEffectFailure(
    client.create(),
    (error) => error instanceof HostProtocolInvalidOutputError
  )
})

test("host window client rejects empty create response window ids", async () => {
  const client = makeHostWindowClient(emptyWindowIdExchange())

  await expectEffectFailure(
    client.create(),
    (error) => error instanceof HostProtocolInvalidOutputError
  )
})

test("host window client rejects mismatched response ids", async () => {
  const client = makeHostWindowClient(mismatchedResponseExchange({ id: "request-window-other" }), {
    nextRequestId: () => "request-window-create",
    nextTraceId: () => "trace-window-create",
    now: () => 1710000000004
  })

  await expectEffectFailure(
    client.create(),
    (error) =>
      error instanceof HostProtocolInvalidOutputError && error.operation === WINDOW_CREATE_METHOD
  )
})

test("host window client rejects mismatched response trace ids", async () => {
  const client = makeHostWindowClient(
    mismatchedResponseExchange({ traceId: "trace-window-other" }),
    {
      nextRequestId: () => "request-window-create",
      nextTraceId: () => "trace-window-create",
      now: () => 1710000000005
    }
  )

  await expectEffectFailure(
    client.create(),
    (error) =>
      error instanceof HostProtocolInvalidOutputError && error.operation === WINDOW_CREATE_METHOD
  )
})

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
                  : request.method === WINDOW_GET_BOUNDS_METHOD
                    ? {
                        ...base,
                        payload: {
                          x: 10,
                          y: 20,
                          width: 640,
                          height: 480
                        }
                      }
                    : request.method === WINDOW_GET_STATE_METHOD
                      ? {
                          ...base,
                          payload: {
                            minimized: false,
                            maximized: true,
                            fullscreen: true
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
                fullscreen: false
              }
            }
          })
        )
      : Stream.empty
})

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

const expectEffectFailure = async (
  effect: Effect.Effect<unknown, unknown, never>,
  predicate: (error: unknown) => boolean
): Promise<void> => {
  try {
    await Effect.runPromise(effect)
  } catch (error) {
    expect(predicate(error)).toBe(true)
    return
  }

  throw new Error("expected Effect to fail")
}

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
