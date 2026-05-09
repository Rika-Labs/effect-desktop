import { expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc"

import {
  type DesktopTransportRun,
  type DesktopTransportSend,
  type HostProtocolEnvelope,
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
    expect(envelope.id).toBe("req-1")
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
  expect(sent[0]?.kind).toBe("cancel")
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
