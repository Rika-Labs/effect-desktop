import { expect, test } from "bun:test"
import { Clock, Effect } from "effect"

import {
  HostProtocolInvalidArgumentError,
  HostProtocolInvalidOutputError,
  HostProtocolNotFoundError,
  HostProtocolResponseEnvelope,
  WINDOW_CREATE_METHOD,
  WINDOW_CENTER_METHOD,
  WINDOW_DESTROY_METHOD,
  WINDOW_FOCUS_METHOD,
  WINDOW_GET_BOUNDS_METHOD,
  WINDOW_GET_STATE_METHOD,
  WINDOW_HIDE_METHOD,
  WINDOW_MAXIMIZE_METHOD,
  WINDOW_MINIMIZE_METHOD,
  WINDOW_RESTORE_METHOD,
  WINDOW_SET_BOUNDS_METHOD,
  WINDOW_SET_FULLSCREEN_METHOD,
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

test("host window client requests Window.getBounds, Window.setBounds, and Window.center", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: nextId([
      "request-window-get-bounds",
      "request-window-set-bounds",
      "request-window-center"
    ]),
    nextTraceId: nextId([
      "trace-window-get-bounds",
      "trace-window-set-bounds",
      "trace-window-center"
    ]),
    now: nextNumber([1710000000013, 1710000000014, 1710000000015])
  })

  const bounds = await Effect.runPromise(
    Effect.gen(function* () {
      const current = yield* client.getBounds("window-1")
      yield* client.setBounds("window-1", { x: 30, y: 40, width: 800, height: 600 })
      yield* client.center("window-1")
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
    [WINDOW_CENTER_METHOD, { windowId: "window-1" }]
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
  }
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
