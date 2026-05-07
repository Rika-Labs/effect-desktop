import { expect, test } from "bun:test"
import { Effect } from "effect"

import {
  HostProtocolInvalidArgumentError,
  HostProtocolInvalidOutputError,
  HostProtocolNotFoundError,
  HostProtocolResponseEnvelope,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
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
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostWindowClient(windowExchange(requests), {
    nextRequestId: () => "request-window-destroy",
    nextTraceId: () => "trace-window-destroy",
    now: () => 1710000000001
  })

  await Effect.runPromise(client.destroy("window-1"))

  expect(requests).toEqual([
    {
      kind: "request",
      id: "request-window-destroy",
      method: WINDOW_DESTROY_METHOD,
      timestamp: 1710000000001,
      traceId: "trace-window-destroy",
      payload: {
        windowId: "window-1"
      }
    }
  ])
})

test("host window client rejects invalid create bounds before crossing the host boundary", async () => {
  const client = makeHostWindowClient(windowExchange([]))

  await expectEffectFailure(
    client.create({
      width: 0
    }),
    (error) => error instanceof HostProtocolInvalidArgumentError && error.field === "payload"
  )
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
