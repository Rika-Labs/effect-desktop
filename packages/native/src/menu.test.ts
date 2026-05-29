import { expect, test } from "bun:test"
import { type HostProtocolRequestEnvelope, makeDesktopClientProtocol } from "@orika/bridge"
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect"
import { RpcClient } from "effect/unstable/rpc"

import { MenuClient, MenuSurface } from "./menu.js"

const sendFailingProtocol = (requests: HostProtocolRequestEnvelope[]) =>
  Layer.effect(RpcClient.Protocol)(
    makeDesktopClientProtocol(
      {
        send: (envelope) => {
          if (envelope.kind === "request") {
            requests.push(envelope)
          }
          return Effect.void
        },
        run: () => Stream.empty.pipe(Stream.runDrain, Effect.andThen(Effect.never))
      },
      {
        // A negative timestamp makes validateHostProtocolTimestamp fail inside the send
        // request branch, producing a HostProtocolInvalidArgument that the transport wraps
        // as an RpcClientError (an RpcClientDefect carrying the original tagged error as
        // `cause`). This is the exact production trigger for the client error mapper.
        now: () => -1,
        nextRequestId: () => "menu-error-rpc",
        nextTraceId: () => "trace-menu-error-rpc"
      }
    )
  )

test("Menu client unwraps the wrapped HostProtocolError instead of flattening to Internal", () =>
  Effect.gen(function* () {
    const requests: HostProtocolRequestEnvelope[] = []

    const exit = yield* Effect.gen(function* () {
      const client = yield* MenuClient
      return yield* client.capability({ name: "application menu" })
    }).pipe(
      Effect.provide(Layer.provide(MenuSurface.clientLayer, sendFailingProtocol(requests))),
      Effect.exit
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) {
      return
    }

    const error = Cause.findErrorOption(exit.cause)
    expect(Option.isSome(error)).toBe(true)
    if (!Option.isSome(error)) {
      return
    }

    const value = error.value as {
      readonly tag: string
      readonly field?: string
      readonly operation?: string
      readonly recoverable: boolean
    }

    expect(value.tag).toBe("InvalidArgument")
    expect(value.field).toBe("timestamp")
    expect(value.operation).toBe("Menu.capability")
    expect(value.recoverable).toBe(false)
  }).pipe(Effect.runPromise))
