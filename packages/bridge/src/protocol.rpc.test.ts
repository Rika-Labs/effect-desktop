import { expect, test } from "bun:test"
import { Deferred, Effect, Layer, Queue, Schema } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc"

import {
  type DesktopTransportRun,
  type DesktopTransportSend,
  type HostProtocolEnvelope,
  HostProtocolResponseEnvelope,
  makeDesktopClientProtocol,
  makeDesktopServerProtocol
} from "./index.js"

const PingRpc = Rpc.make("Ping", {
  payload: { message: Schema.String },
  success: Schema.String
})

const group = RpcGroup.make(PingRpc)

test("Rpc.make produces an rpc with the correct tag", () => {
  expect(PingRpc._tag).toBe("Ping")
})

test("RpcGroup.make includes the rpc by tag", () => {
  expect(group.requests.has("Ping")).toBe(true)
})

test("group.toLayer produces a Layer from a handler record", async () => {
  const handlerLayer = group.toLayer({
    Ping: ({ message }) => Effect.succeed(`pong: ${message}`)
  })

  expect(handlerLayer).toBeDefined()
  expect(Layer.isLayer(handlerLayer)).toBe(true)
})

test("makeDesktopClientProtocol returns a Protocol service with send and supportsAck", async () => {
  const sent: HostProtocolEnvelope[] = []

  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (envelope) =>
      Effect.sync(() => {
        sent.push(envelope)
      }),
    run: (_onEnvelope) => Effect.never
  }

  const protocol = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* makeDesktopClientProtocol(transport)
      })
    )
  )

  expect(typeof protocol.send).toBe("function")
  expect(protocol.supportsAck).toBe(false)
  expect(protocol.supportsTransferables).toBe(false)
})

test("makeDesktopClientProtocol send translates Request to HostProtocolRequestEnvelope", async () => {
  const sent: HostProtocolEnvelope[] = []

  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (envelope) =>
      Effect.sync(() => {
        sent.push(envelope)
      }),
    run: (_onEnvelope) => Effect.never
  }

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* makeDesktopClientProtocol(transport, {
          nextTraceId: () => "trace-rpc-test"
        })

        yield* protocol.send(0, {
          _tag: "Request",
          id: "req-1",
          tag: "Ping",
          payload: { message: "hello" },
          headers: [],
          traceId: "trace-rpc-test"
        })
      })
    )
  )

  expect(sent).toHaveLength(1)
  const envelope = sent[0]
  expect(envelope?.kind).toBe("request")
  if (envelope?.kind === "request") {
    expect(envelope.id).toBe("0:req-1")
    expect(envelope.method).toBe("Ping")
    expect(envelope.traceId).toBe("trace-rpc-test")
  }
})

test("makeDesktopClientProtocol send translates Interrupt to HostProtocolCancelByRequestEnvelope", async () => {
  const sent: HostProtocolEnvelope[] = []

  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (envelope) =>
      Effect.sync(() => {
        sent.push(envelope)
      }),
    run: (_onEnvelope) => Effect.never
  }

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* makeDesktopClientProtocol(transport)

        yield* protocol.send(0, {
          _tag: "Interrupt",
          requestId: "req-1"
        })
      })
    )
  )

  expect(sent).toHaveLength(1)
  const envelope = sent[0]
  expect(envelope?.kind).toBe("cancel")
  if (envelope?.kind === "cancel") {
    expect(envelope.id).toBe("0:req-1")
  }
})

test("makeDesktopClientProtocol routes responses to the client id that sent each request", async () => {
  const queue = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (envelope) => {
      if (envelope.kind !== "request") {
        return Effect.void
      }
      return Queue.offer(
        queue,
        new HostProtocolResponseEnvelope({
          kind: "response",
          id: envelope.id,
          timestamp: 0,
          traceId: envelope.traceId,
          payload: `pong:${(envelope.payload as { readonly message: string }).message}`
        })
      ).pipe(Effect.asVoid)
    },
    run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
  }

  const replies = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* makeDesktopClientProtocol(transport)
        const makeClient = RpcClient.make(group).pipe(
          Effect.provideService(RpcClient.Protocol, protocol)
        )
        const firstClient = yield* makeClient
        const secondClient = yield* makeClient
        const first = yield* firstClient.Ping({ message: "one" })
        const second = yield* secondClient.Ping({ message: "two" })
        return [first, second] as const
      })
    )
  )

  expect(replies).toEqual(["pong:one", "pong:two"])
})

test("makeDesktopClientProtocol namespaces duplicate request ids by client id", async () => {
  const queue = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const sentBoth = Effect.runSync(Deferred.make<void>())
  const receivedBoth = Effect.runSync(Deferred.make<void>())
  const requests: HostProtocolEnvelope[] = []
  const received: Array<{ readonly clientId: number; readonly payload: unknown }> = []
  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (envelope) => {
      if (envelope.kind !== "request") {
        return Effect.void
      }
      return Effect.sync(() => {
        requests.push(envelope)
        return requests.length
      }).pipe(
        Effect.flatMap((requestCount) =>
          requestCount === 2 ? Deferred.succeed(sentBoth, undefined) : Effect.void
        )
      )
    },
    run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
  }

  const replies = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* makeDesktopClientProtocol(transport)
        yield* protocol
          .run(1, (message) =>
            Effect.sync(() => {
              received.push({
                clientId: 1,
                payload: message._tag === "Exit" ? message.exit : undefined
              })
              return received.length
            }).pipe(
              Effect.flatMap((receivedCount) =>
                receivedCount === 2 ? Deferred.succeed(receivedBoth, undefined) : Effect.void
              )
            )
          )
          .pipe(Effect.forkScoped)
        yield* protocol
          .run(2, (message) =>
            Effect.sync(() => {
              received.push({
                clientId: 2,
                payload: message._tag === "Exit" ? message.exit : undefined
              })
              return received.length
            }).pipe(
              Effect.flatMap((receivedCount) =>
                receivedCount === 2 ? Deferred.succeed(receivedBoth, undefined) : Effect.void
              )
            )
          )
          .pipe(Effect.forkScoped)

        yield* protocol.send(1, {
          _tag: "Request",
          id: "1",
          tag: "Ping",
          payload: { message: "one" },
          headers: [],
          traceId: "trace-one"
        })
        yield* protocol.send(2, {
          _tag: "Request",
          id: "1",
          tag: "Ping",
          payload: { message: "two" },
          headers: [],
          traceId: "trace-two"
        })

        yield* Deferred.await(sentBoth)
        const firstRequest = requests[0]
        const secondRequest = requests[1]
        if (firstRequest?.kind !== "request" || secondRequest?.kind !== "request") {
          return yield* Effect.die("expected two request envelopes")
        }
        expect(firstRequest.id).not.toBe(secondRequest.id)
        expect(firstRequest.id.endsWith(":1")).toBe(true)
        expect(secondRequest.id.endsWith(":1")).toBe(true)

        yield* Queue.offer(
          queue,
          new HostProtocolResponseEnvelope({
            kind: "response",
            id: secondRequest.id,
            timestamp: 0,
            traceId: secondRequest.traceId,
            payload: "pong:two"
          })
        )
        yield* Queue.offer(
          queue,
          new HostProtocolResponseEnvelope({
            kind: "response",
            id: firstRequest.id,
            timestamp: 0,
            traceId: firstRequest.traceId,
            payload: "pong:one"
          })
        )

        yield* Deferred.await(receivedBoth)
        return received
      })
    )
  )

  expect(replies).toEqual([
    {
      clientId: 2,
      payload: {
        _tag: "Success",
        value: "pong:two"
      }
    },
    {
      clientId: 1,
      payload: {
        _tag: "Success",
        value: "pong:one"
      }
    }
  ])
})

test("makeDesktopServerProtocol returns a Protocol service with disconnects and send", async () => {
  const sent: HostProtocolEnvelope[] = []

  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (envelope) =>
      Effect.sync(() => {
        sent.push(envelope)
      }),
    run: (_onEnvelope) => Effect.never
  }

  const protocol = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* makeDesktopServerProtocol(transport)
      })
    )
  )

  expect(typeof protocol.send).toBe("function")
  expect(typeof protocol.end).toBe("function")
  expect(protocol.supportsAck).toBe(false)
  expect(protocol.supportsTransferables).toBe(false)
  expect(protocol.supportsSpanPropagation).toBe(false)
})

test("makeDesktopServerProtocol send translates Exit success to HostProtocolResponseEnvelope", async () => {
  const sent: HostProtocolEnvelope[] = []

  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (envelope) =>
      Effect.sync(() => {
        sent.push(envelope)
      }),
    run: (_onEnvelope) => Effect.never
  }

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* makeDesktopServerProtocol(transport, {
          nextTraceId: () => "trace-server-test",
          now: () => 1710000000000
        })

        yield* protocol.send(0, {
          _tag: "Exit",
          requestId: "req-1",
          exit: { _tag: "Success", value: { result: "ok" } }
        })
      })
    )
  )

  expect(sent).toHaveLength(1)
  const envelope = sent[0]
  expect(envelope?.kind).toBe("response")
  if (envelope?.kind === "response") {
    expect(envelope.id).toBe("req-1")
    expect(envelope.payload).toEqual({ result: "ok" })
    expect(envelope.traceId).toBe("trace-server-test")
    expect(envelope.timestamp).toBe(1710000000000)
  }
})

test("makeDesktopServerProtocol send translates Chunk to HostProtocolStreamByRequestEnvelope", async () => {
  const sent: HostProtocolEnvelope[] = []

  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (envelope) =>
      Effect.sync(() => {
        sent.push(envelope)
      }),
    run: (_onEnvelope) => Effect.never
  }

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* makeDesktopServerProtocol(transport, {
          nextTraceId: () => "trace-chunk-test",
          now: () => 1710000000001
        })

        yield* protocol.send(0, {
          _tag: "Chunk",
          requestId: "req-2",
          values: [{ item: 1 }]
        })
      })
    )
  )

  expect(sent).toHaveLength(1)
  const envelope = sent[0]
  expect(envelope?.kind).toBe("stream")
  if (envelope?.kind === "stream") {
    expect(envelope.id).toBe("req-2")
    expect(envelope.payload).toEqual({ item: 1 })
  }
})

test("makeDesktopServerProtocol clientIds resolves to singleton set with 0", async () => {
  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (_envelope) => Effect.void,
    run: (_onEnvelope) => Effect.never
  }

  const clientIds = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* makeDesktopServerProtocol(transport)
        return yield* protocol.clientIds
      })
    )
  )

  expect(clientIds.size).toBe(1)
  expect(clientIds.has(0)).toBe(true)
})

test("RpcClient.Protocol and RpcServer.Protocol are exported from bridge index", () => {
  expect(RpcClient.Protocol).toBeDefined()
  expect(RpcServer.Protocol).toBeDefined()
})

test("Scope is a valid requirement for makeDesktopClientProtocol", () => {
  const transport: DesktopTransportSend & DesktopTransportRun = {
    send: (_envelope) => Effect.void,
    run: (_onEnvelope) => Effect.never
  }

  const effect = makeDesktopClientProtocol(transport)
  const isEffect = Effect.isEffect(effect)
  expect(isEffect).toBe(true)
})
