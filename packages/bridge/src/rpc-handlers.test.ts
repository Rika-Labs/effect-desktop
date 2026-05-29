import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import {
  type BridgeCallState,
  type RendererOriginAuth,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolCancelledError,
  HostProtocolRequestEnvelope,
  makeDesktopRpcHandlerRuntime
} from "./index.js"

const PingRpc = Rpc.make("Ping", {
  payload: { message: Schema.String },
  success: Schema.String
})

const group = RpcGroup.make(PingRpc)

test("cancel during dispatch preamble still interrupts the call and records Canceled", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const verifyEntered = yield* Deferred.make<void>()
      const verifyGate = yield* Deferred.make<void>()
      const states: BridgeCallState[] = []

      const blockingOriginAuth: RendererOriginAuth = {
        verify: () =>
          Deferred.succeed(verifyEntered, undefined).pipe(
            Effect.flatMap(() => Deferred.await(verifyGate))
          )
      }

      const runtime = makeDesktopRpcHandlerRuntime(
        group,
        group.toLayer({
          Ping: () => Effect.never as Effect.Effect<string, never, never>
        }),
        {
          originAuth: blockingOriginAuth,
          onState: (state) =>
            Effect.sync(() => {
              states.push(state)
            })
        }
      )

      const dispatchFiber = yield* Effect.forkChild(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "request-race",
            method: "Ping",
            timestamp: 1710000000000,
            traceId: "trace-request",
            payload: { message: "hello" }
          })
        )
      )

      yield* Deferred.await(verifyEntered)

      const cancelExit = yield* Effect.exit(
        runtime.cancel(
          new HostProtocolCancelByRequestEnvelope({
            kind: "cancel",
            id: "request-race",
            timestamp: 1710000000001,
            traceId: "trace-cancel"
          })
        )
      )

      yield* Deferred.succeed(verifyGate, undefined)

      const dispatchExit = yield* Fiber.join(dispatchFiber).pipe(
        Effect.exit,
        Effect.timeoutOption("2 seconds")
      )

      yield* Fiber.interrupt(dispatchFiber)

      expect(Exit.isSuccess(cancelExit)).toBe(true)
      expect(Option.isSome(dispatchExit)).toBe(true)
      if (Option.isSome(dispatchExit)) {
        const exit = dispatchExit.value
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Schema.is(HostProtocolCancelledError)(Cause.squash(exit.cause))).toBe(true)
        }
      }
      expect(states.some((state) => state.tag === "Canceled")).toBe(true)
    })
  ))

test("dispatch rejects a concurrent duplicate request id instead of running the handler twice", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const handlerEntered = yield* Deferred.make<void>()
      const handlerGate = yield* Deferred.make<void>()
      let handlerRuns = 0

      const runtime = makeDesktopRpcHandlerRuntime(
        group,
        group.toLayer({
          Ping: () =>
            Effect.sync(() => {
              handlerRuns += 1
            }).pipe(
              Effect.andThen(Deferred.succeed(handlerEntered, undefined)),
              Effect.andThen(Deferred.await(handlerGate)),
              Effect.as("pong")
            )
        }),
        { originAuth: { verify: () => Effect.void } }
      )

      const frame = () =>
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "dup-id",
          method: "Ping",
          timestamp: 1710000000000,
          traceId: "trace-dup",
          payload: { message: "hello" }
        })

      const firstFiber = yield* Effect.forkChild(runtime.dispatch(frame()))
      yield* Deferred.await(handlerEntered)
      const secondFiber = yield* Effect.forkChild(runtime.dispatch(frame()))
      yield* Effect.sleep("50 millis")
      const runsWhileFirstInFlight = handlerRuns
      yield* Deferred.succeed(handlerGate, undefined)
      yield* Fiber.join(firstFiber).pipe(Effect.exit)
      const secondExit = yield* Fiber.join(secondFiber).pipe(Effect.exit)

      expect(runsWhileFirstInFlight).toBe(1)
      expect(Exit.isFailure(secondExit)).toBe(true)
    })
  ))
