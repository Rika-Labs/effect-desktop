import { expect, test } from "bun:test"
import {
  type HostProtocolEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Effect, Layer, ManagedRuntime, Option, Queue, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { NotificationClient, NotificationRpcs, NotificationSurface } from "./notification.js"
import {
  NotificationActionEvent,
  NotificationClickEvent,
  type NotificationHandle
} from "./contracts/notification.js"

test("Clipboard public surface omits the empty event side object", async () => {
  const clipboardModule = await import("./clipboard.js")
  const rootModule = await import("./index.js")

  expect("ClipboardRpcEvents" in clipboardModule).toBe(false)
  expect("ClipboardRpcEvents" in rootModule).toBe(false)
})

test("Notification event schemas are owned by RPC stream contracts", async () => {
  const notificationModule = await import("./notification.js")
  const rootModule = await import("./index.js")
  const clickRpc = NotificationRpcs.requests.get("Notification.events.Click")
  const actionRpc = NotificationRpcs.requests.get("Notification.events.Action")

  expect("NotificationRpcEvents" in notificationModule).toBe(false)
  expect("NotificationRpcEvents" in rootModule).toBe(false)
  expect(clickRpc).toBeDefined()
  expect(actionRpc).toBeDefined()
  expect(clickRpc === undefined ? false : RpcSchema.isStreamSchema(clickRpc.successSchema)).toBe(
    true
  )
  expect(actionRpc === undefined ? false : RpcSchema.isStreamSchema(actionRpc.successSchema)).toBe(
    true
  )
  if (clickRpc !== undefined && RpcSchema.isStreamSchema(clickRpc.successSchema)) {
    expect(clickRpc.successSchema.success).toBe(NotificationClickEvent)
  }
  if (actionRpc !== undefined && RpcSchema.isStreamSchema(actionRpc.successSchema)) {
    expect(actionRpc.successSchema.success).toBe(NotificationActionEvent)
  }

  const callableTags = NotificationSurface.schemaDocs
    .filter((doc) => doc.callable)
    .map((doc) => doc.tag)
    .toSorted()
  expect(callableTags).toEqual([
    "Notification.close",
    "Notification.events.Action",
    "Notification.events.Click",
    "Notification.getPermissionStatus",
    "Notification.isSupported",
    "Notification.requestPermission",
    "Notification.show"
  ])
  for (const tag of ["Notification.events.Action", "Notification.events.Click"]) {
    const eventDoc = NotificationSurface.schemaDocs.find((doc) => doc.tag === tag)
    expect(eventDoc?.kind).toBe("stream")
    expect(eventDoc?.callable).toBe(true)
  }
})

test("Notification direct client consumes canonical RPC event streams", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const click = yield* directNotificationEvent(
        "Notification.events.Click",
        clickPayload(),
        Effect.gen(function* () {
          const client = yield* NotificationClient
          return client.onClick()
        })
      )
      const action = yield* directNotificationEvent(
        "Notification.events.Action",
        actionPayload(),
        Effect.gen(function* () {
          const client = yield* NotificationClient
          return client.onAction()
        })
      )

      expect(click.event).toMatchObject(clickPayload())
      expect(click.methods).toEqual(["Notification.events.Click"])
      expect(action.event).toMatchObject(actionPayload())
      expect(action.methods).toEqual(["Notification.events.Action"])
    })
  ))

const directNotificationEvent = <A>(
  method: string,
  payload: unknown,
  stream: Effect.Effect<Stream.Stream<A, unknown, never>, never, NotificationClient>
) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
    const requests: HostProtocolRequestEnvelope[] = []
    const protocolLayer = Layer.effect(RpcClient.Protocol)(
      makeDesktopClientProtocol(
        {
          send: (envelope) => {
            if (envelope.kind !== "request") {
              return Effect.void
            }
            requests.push(envelope)
            return Effect.all(
              [
                Queue.offer(
                  queue,
                  new HostProtocolStreamByRequestEnvelope({
                    kind: "stream",
                    id: envelope.id,
                    timestamp: 1_710_000_000_001,
                    traceId: envelope.traceId,
                    payload
                  })
                ),
                Queue.offer(
                  queue,
                  new HostProtocolResponseEnvelope({
                    kind: "response",
                    id: envelope.id,
                    timestamp: 1_710_000_000_002,
                    traceId: envelope.traceId
                  })
                )
              ],
              { discard: true }
            )
          },
          run: (onEnvelope) =>
            Stream.fromQueue(queue).pipe(
              Stream.runForEach(onEnvelope),
              Effect.andThen(Effect.never)
            )
        },
        {
          nextRequestId: () => `${method}-request`,
          nextTraceId: () => `${method}-trace`
        }
      )
    )

    const event = yield* runScoped(
      stream.pipe(Stream.unwrap, Stream.runHead, Effect.map(Option.getOrThrow)),
      Layer.provide(NotificationSurface.clientLayer, protocolLayer)
    )

    return {
      event,
      methods: requests.map((request) => request.method)
    }
  })

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    try {
      return yield* Effect.promise(() => runtime.runPromise(effect))
    } finally {
      yield* Effect.promise(() => runtime.dispose())
    }
  })

const notificationHandle = (): NotificationHandle => ({
  kind: "notification",
  id: makeResourceId("notification-1"),
  generation: 0,
  ownerScope: "owner-scope",
  state: "open"
})

const clickPayload = () => ({
  notification: notificationHandle(),
  ownerWindowId: "window-1"
})

const actionPayload = () => ({
  notification: notificationHandle(),
  actionId: "open",
  ownerWindowId: "window-1"
})
