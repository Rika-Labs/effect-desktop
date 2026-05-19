import { expect, test } from "bun:test"
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Stream } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc"

import {
  type DesktopTransportRun,
  type DesktopTransportSend,
  type HostProtocolEnvelope,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolCancelledError,
  HostProtocolMethodNotFoundError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  RendererOriginAuth,
  makeBridgeInspector,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
  makeDesktopServerProtocol
} from "./index.js"

const PingRpc = Rpc.make("Ping", {
  payload: { message: Schema.String },
  success: Schema.String
})

const group = RpcGroup.make(PingRpc)

const runQueuedTransport = (
  queue: Queue.Queue<HostProtocolEnvelope>,
  onEnvelope: (envelope: HostProtocolEnvelope) => Effect.Effect<void>
): Effect.Effect<never> =>
  Stream.fromQueue(queue).pipe(Stream.runForEach(onEnvelope), Effect.andThen(Effect.never))

const VoidPingRpc = Rpc.make("VoidPing", {
  payload: Schema.Void,
  success: Schema.String
})

const voidGroup = RpcGroup.make(VoidPingRpc)

const StreamPingRpc = Rpc.make("StreamPing", {
  payload: { message: Schema.String },
  success: Schema.String,
  stream: true
})

const streamGroup = RpcGroup.make(StreamPingRpc)

test("Rpc.make produces an rpc with the correct tag", () => {
  expect(PingRpc._tag).toBe("Ping")
})

test("RpcGroup.make includes the rpc by tag", () => {
  expect(group.requests.has("Ping")).toBe(true)
})

test("group.toLayer produces a Layer from a handler record", () => {
  const handlerLayer = group.toLayer({
    Ping: ({ message }) => Effect.succeed(`pong: ${message}`)
  })

  expect(handlerLayer).toBeDefined()
  expect(Layer.isLayer(handlerLayer)).toBe(true)
})

test("makeDesktopRpcHandlerRuntime dispatches host requests through RpcServer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = makeDesktopRpcHandlerRuntime(
        group,
        group.toLayer({
          Ping: ({ message }) => Effect.succeed(`pong: ${message}`)
        }),
        {
          originAuth: RendererOriginAuth.unsafeDisabledForTests,
          now: () => 1710000000000,
          nextTraceId: () => "trace-response"
        }
      )

      const response = yield* runtime.dispatch(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-1",
          method: "Ping",
          timestamp: 1710000000000,
          traceId: "trace-request",
          payload: { message: "hello" }
        })
      )

      expect(response).toEqual({ kind: "success", payload: "pong: hello" })
    })
  ))

test("makeDesktopRpcHandlerRuntime emits inspector RPC events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events: unknown[] = []
      const inspector = yield* makeBridgeInspector({
        onEvent: (event) =>
          Effect.sync(() => {
            events.push(event)
          })
      })
      const runtime = makeDesktopRpcHandlerRuntime(
        group,
        group.toLayer({
          Ping: ({ message }) => Effect.succeed(`pong: ${message}`)
        }),
        {
          originAuth: RendererOriginAuth.unsafeDisabledForTests,
          inspector
        }
      )

      yield* runtime
        .dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "request-inspector",
            method: "Ping",
            timestamp: 1710000000000,
            traceId: "trace-inspector",
            payload: { message: "hello" }
          })
        )
        .pipe(Effect.provideService(Clock.Clock, fixedClock(1_715_000_000_000)))

      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "rpc.request",
          boundary: "runtime",
          method: "Ping",
          requestId: "request-inspector",
          traceId: "trace-inspector",
          timestamp: 1_715_000_000_000
        })
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "rpc.response",
          boundary: "runtime",
          method: "Ping",
          requestId: "request-inspector",
          timestamp: 1_715_000_000_000
        })
      )
    })
  ))

test("makeDesktopRpcHandlerRuntime rejects unknown host methods before RpcServer dispatch", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = makeDesktopRpcHandlerRuntime(
        group,
        group.toLayer({
          Ping: ({ message }) => Effect.succeed(`pong: ${message}`)
        }),
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const exit = yield* Effect.exit(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "request-1",
            method: "Missing",
            timestamp: 1710000000000,
            traceId: "trace-request",
            payload: { message: "hello" }
          })
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(HostProtocolMethodNotFoundError)
      }
    })
  ))

test("makeDesktopRpcHandlerRuntime treats omitted host payloads as Effect void payloads", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = makeDesktopRpcHandlerRuntime(
        voidGroup,
        voidGroup.toLayer({
          VoidPing: () => Effect.succeed("pong")
        }),
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runtime.dispatch(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-void",
          method: "VoidPing",
          timestamp: 1710000000000,
          traceId: "trace-request"
        })
      )

      expect(response).toEqual({ kind: "success", payload: "pong" })
    })
  ))

test("RpcServer stream handlers emit host stream envelopes through desktop protocol", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const responseObserved = yield* Deferred.make<void>()
      const sent: HostProtocolEnvelope[] = []
      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }).pipe(
            Effect.flatMap(() =>
              envelope.kind === "response" ? Deferred.succeed(responseObserved, undefined) : Effect.void
            )
          ),
        run: (onEnvelope): Effect.Effect<never> => runQueuedTransport(queue, onEnvelope)
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* makeDesktopServerProtocol(transport, {
            nextTraceId: () => "trace-stream-response",
            now: () => 1710000000001
          })
          yield* Layer.build(
            RpcServer.layer(streamGroup).pipe(
              Layer.provide(
                streamGroup.toLayer({
                  StreamPing: ({ message }) => Stream.make(`${message}:1`, `${message}:2`)
                })
              ),
              Layer.provide(Layer.succeed(RpcServer.Protocol)(protocol))
            )
          )
          yield* Queue.offer(
            queue,
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: "stream-request",
              method: "StreamPing",
              timestamp: 1710000000000,
              traceId: "trace-request",
              payload: { message: "hello" }
            })
          )
          yield* Deferred.await(responseObserved)
        })
      )

      expect(
        sent.filter((envelope) => envelope.kind === "stream").map((envelope) => envelope.payload)
      ).toEqual(["hello:1", "hello:2"])
      expect(sent.some((envelope) => envelope.kind === "response")).toBe(true)
    })
  ))

test("makeDesktopRpcHandlerRuntime interrupts pending dispatches on cancel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const runtime = makeDesktopRpcHandlerRuntime(
        group,
        group.toLayer({
          Ping: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.flatMap(() => Effect.never as Effect.Effect<string, never, never>),
              Effect.ensuring(Deferred.succeed(interrupted, undefined))
            )
        }),
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const fiber = yield* Effect.forkChild(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "request-cancel",
            method: "Ping",
            timestamp: 1710000000000,
            traceId: "trace-request",
            payload: { message: "hello" }
          })
        )
      )

      yield* Deferred.await(started)
      yield* runtime.cancel(
        new HostProtocolCancelByRequestEnvelope({
          kind: "cancel",
          id: "request-cancel",
          timestamp: 1710000000001,
          traceId: "trace-cancel"
        })
      )
      yield* Deferred.await(interrupted)

      const exit = yield* Effect.exit(Fiber.join(fiber))
      expectExitFailure(exit, (error) => Schema.is(HostProtocolCancelledError)(error))
    })
  ))

test("makeDesktopRpcHandlerRuntime rejects duplicate late request ids", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let calls = 0
      const states: unknown[] = []
      const runtime = makeDesktopRpcHandlerRuntime(
        group,
        group.toLayer({
          Ping: ({ message }) =>
            Effect.sync(() => {
              calls += 1
              return `pong: ${message}`
            })
        }),
        {
          originAuth: RendererOriginAuth.unsafeDisabledForTests,
          onState: (state) =>
            Effect.sync(() => {
              states.push(state)
            })
        }
      )
      const request = new HostProtocolRequestEnvelope({
        kind: "request",
        id: "request-duplicate",
        method: "Ping",
        timestamp: 1710000000000,
        traceId: "trace-request",
        payload: { message: "hello" }
      })

      const first = yield* runtime.dispatch(request)
      const second = yield* Effect.exit(runtime.dispatch(request))

      expect(first).toEqual({ kind: "success", payload: "pong: hello" })
      expectExitFailure(second, (error) => hasErrorTag(error, "InvalidState"))
      expect(calls).toBe(1)
      expect(states).toContainEqual(
        expect.objectContaining({
          tag: "RejectedLateFrame",
          id: "request-duplicate",
          terminalState: "Completed"
        })
      )
    })
  ))

test("makeDesktopClientProtocol returns a Protocol service with send and supportsAck", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent: HostProtocolEnvelope[] = []

      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (_onEnvelope) => Effect.never
      }

      const protocol = yield* Effect.scoped(makeDesktopClientProtocol(transport))

      expect(typeof protocol.send).toBe("function")
      expect(protocol.supportsAck).toBe(false)
      expect(protocol.supportsTransferables).toBe(false)
    })
  ))

test("makeDesktopClientProtocol send translates Request to HostProtocolRequestEnvelope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent: HostProtocolEnvelope[] = []

      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (_onEnvelope) => Effect.never
      }

      yield* Effect.scoped(
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
      ).pipe(Effect.provideService(Clock.Clock, fixedClock(1_715_000_000_000)))

      expect(sent).toHaveLength(1)
      const envelope = sent[0]
      expect(envelope?.kind).toBe("request")
      if (envelope?.kind === "request") {
        expect(envelope.id).toBe("0:req-1")
        expect(envelope.method).toBe("Ping")
        expect(envelope.traceId).toBe("trace-rpc-test")
        expect(envelope.timestamp).toBe(1_715_000_000_000)
      }
    })
  ))

test("makeDesktopClientProtocol send translates Interrupt to HostProtocolCancelByRequestEnvelope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent: HostProtocolEnvelope[] = []

      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (_onEnvelope) => Effect.never
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* makeDesktopClientProtocol(transport)

          yield* protocol.send(0, {
            _tag: "Interrupt",
            requestId: "req-1"
          })
        })
      )

      expect(sent).toHaveLength(1)
      const envelope = sent[0]
      expect(envelope?.kind).toBe("cancel")
      if (envelope?.kind === "cancel") {
        expect(envelope.id).toBe("0:req-1")
      }
    })
  ))

test("makeDesktopClientProtocol preserves caller supplied host request ids", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent: HostProtocolEnvelope[] = []
      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (_onEnvelope) => Effect.never
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* makeDesktopClientProtocol(transport, {
            nextRequestId: () => "request-from-options",
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
          yield* protocol.send(0, {
            _tag: "Interrupt",
            requestId: "req-1"
          })
        })
      )

      expect(
        sent.map((envelope) => [
          envelope.kind,
          envelope.kind === "request" || envelope.kind === "cancel" ? envelope.id : undefined
        ])
      ).toEqual([
        ["request", "request-from-options"],
        ["cancel", "request-from-options"]
      ])
    })
  ))

test("makeDesktopClientProtocol routes responses to the client id that sent each request", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
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
        run: (onEnvelope) => runQueuedTransport(queue, onEnvelope)
      }

      const replies = yield* Effect.scoped(
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

      expect(replies).toEqual(["pong:one", "pong:two"])
    })
  ))

test("makeDesktopClientProtocol namespaces duplicate request ids by client id", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const sentBoth = yield* Deferred.make<void>()
      const receivedBoth = yield* Deferred.make<void>()
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
        run: (onEnvelope) => runQueuedTransport(queue, onEnvelope)
      }

      const replies = yield* Effect.scoped(
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

      const repliesByClient = [...replies].sort((a, b) => a.clientId - b.clientId)
      expect(repliesByClient).toEqual([
        {
          clientId: 1,
          payload: {
            _tag: "Success",
            value: "pong:one"
          }
        },
        {
          clientId: 2,
          payload: {
            _tag: "Success",
            value: "pong:two"
          }
        }
      ])
    })
  ))

test("makeDesktopServerProtocol returns a Protocol service with disconnects and send", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent: HostProtocolEnvelope[] = []

      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (_onEnvelope) => Effect.never
      }

      const protocol = yield* Effect.scoped(makeDesktopServerProtocol(transport))

      expect(typeof protocol.send).toBe("function")
      expect(typeof protocol.end).toBe("function")
      expect(protocol.supportsAck).toBe(false)
      expect(protocol.supportsTransferables).toBe(false)
      expect(protocol.supportsSpanPropagation).toBe(false)
    })
  ))

test("makeDesktopServerProtocol send translates Exit success to HostProtocolResponseEnvelope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent: HostProtocolEnvelope[] = []

      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (_onEnvelope) => Effect.never
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* makeDesktopServerProtocol(transport, {
            nextTraceId: () => "trace-server-test"
          })

          yield* protocol.send(0, {
            _tag: "Exit",
            requestId: "req-1",
            exit: { _tag: "Success", value: { result: "ok" } }
          })
        })
      ).pipe(Effect.provideService(Clock.Clock, fixedClock(1_710_000_000_000)))

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
  ))

test("makeDesktopServerProtocol send translates Chunk to HostProtocolStreamByRequestEnvelope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent: HostProtocolEnvelope[] = []

      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (_onEnvelope) => Effect.never
      }

      yield* Effect.scoped(
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

      expect(sent).toHaveLength(1)
      const envelope = sent[0]
      expect(envelope?.kind).toBe("stream")
      if (envelope?.kind === "stream") {
        expect(envelope.id).toBe("req-2")
        expect(envelope.payload).toEqual({ item: 1 })
      }
    })
  ))

test("makeDesktopServerProtocol clientIds resolves to singleton set with 0", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (_envelope) => Effect.void,
        run: (_onEnvelope) => Effect.never
      }

      const clientIds = yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* makeDesktopServerProtocol(transport)
          return yield* protocol.clientIds
        })
      )

      expect(clientIds.size).toBe(1)
      expect(clientIds.has(0)).toBe(true)
    })
  ))

test("makeDesktopServerProtocol translates server defects to host protocol failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const requestObserved = yield* Deferred.make<void>()
      const sent: HostProtocolEnvelope[] = []
      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (onEnvelope): Effect.Effect<never> =>
          Stream.fromQueue(queue).pipe(
            Stream.runForEach((envelope) =>
              onEnvelope(envelope).pipe(
                Effect.flatMap(() => Deferred.succeed(requestObserved, undefined))
              )
            ),
            Effect.andThen(Effect.never)
          )
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* makeDesktopServerProtocol(transport, {
            nextTraceId: () => "trace-defect-response",
            now: () => 1710000000002
          })
          yield* Queue.offer(
            queue,
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: "host-request-1",
              method: "Ping",
              timestamp: 1710000000000,
              traceId: "trace-request",
              payload: { message: "hello" }
            })
          )
          yield* Deferred.await(requestObserved)
          yield* protocol.send(0, {
            _tag: "Defect",
            defect: "server decode failed"
          })
        })
      )

      expect(sent).toHaveLength(1)
      const envelope = sent[0]
      expect(envelope?.kind).toBe("response")
      if (envelope?.kind === "response") {
        expect(envelope.id).toBe("host-request-1")
        expect(envelope.error?.tag).toBe("Internal")
        expect(envelope.traceId).toBe("trace-defect-response")
      }
    })
  ))

test("makeDesktopServerProtocol translates RPC permission denials to host permission errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent: HostProtocolEnvelope[] = []
      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (_onEnvelope) => Effect.never
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* makeDesktopServerProtocol(transport, {
            nextTraceId: () => "trace-permission-response",
            now: () => 1710000000003
          })
          yield* protocol.send(0, {
            _tag: "Exit",
            requestId: "permission-request",
            exit: {
              _tag: "Failure",
              cause: [
                {
                  _tag: "Fail",
                  error: {
                    _tag: "PermissionDenied",
                    reason: "default-deny",
                    capability: {
                      kind: "network.connect",
                      hosts: ["api.example.com"],
                      askUnknownHosts: false,
                      audit: "on-deny"
                    },
                    actor: { kind: "window", id: "main" },
                    traceId: "trace-permission-request",
                    message: "permission denied: default-deny"
                  }
                }
              ]
            }
          })
        })
      )

      expect(sent).toHaveLength(1)
      const envelope = sent[0]
      expect(envelope?.kind).toBe("response")
      if (envelope?.kind === "response") {
        expect(envelope.error).toMatchObject({
          tag: "PermissionDenied",
          capability: "network.connect",
          operation: "permission-request",
          cause: {
            _tag: "PermissionDenied",
            actor: { kind: "window", id: "main" },
            traceId: "trace-permission-request"
          }
        })
      }
    })
  ))

test("makeDesktopServerProtocol fails every pending host request for client defects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const observedBoth = yield* Deferred.make<void>()
      const sent: HostProtocolEnvelope[] = []
      let observedCount = 0
      const transport: DesktopTransportSend & DesktopTransportRun = {
        send: (envelope) =>
          Effect.sync(() => {
            sent.push(envelope)
          }),
        run: (onEnvelope): Effect.Effect<never> =>
          Stream.fromQueue(queue).pipe(
            Stream.runForEach((envelope) =>
              onEnvelope(envelope).pipe(
                Effect.flatMap(() =>
                  Effect.sync(() => {
                    observedCount += 1
                    return observedCount
                  })
                ),
                Effect.flatMap((count) =>
                  count === 2 ? Deferred.succeed(observedBoth, undefined) : Effect.void
                )
              )
            ),
            Effect.andThen(Effect.never)
          )
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* makeDesktopServerProtocol(transport, {
            nextTraceId: () => "trace-defect-response",
            now: () => 1710000000002
          })
          yield* Queue.offer(
            queue,
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: "host-request-1",
              method: "Ping",
              timestamp: 1710000000000,
              traceId: "trace-request-1",
              payload: { message: "one" }
            })
          )
          yield* Queue.offer(
            queue,
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: "host-request-2",
              method: "Ping",
              timestamp: 1710000000001,
              traceId: "trace-request-2",
              payload: { message: "two" }
            })
          )
          yield* Deferred.await(observedBoth)
          yield* protocol.send(0, {
            _tag: "Defect",
            defect: "server decode failed"
          })
        })
      )

      expect(
        sent.map((envelope) =>
          envelope.kind === "response" ? [envelope.id, envelope.error?.tag] : [envelope.kind]
        )
      ).toEqual([
        ["host-request-1", "Internal"],
        ["host-request-2", "Internal"]
      ])
    })
  ))

const expectExitFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  predicate: (error: unknown) => boolean
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(predicate(Cause.squash(exit.cause))).toBe(true)
  }
}

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "tag" in error && error.tag === tag

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
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
