import { expect, test } from "bun:test"
import { makeHostProtocolHostUnavailableError, RpcClientError } from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { RpcClient } from "effect/unstable/rpc"

import { AppClient, AppSurface } from "./app.js"

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      return reason.error
    }
  }
  return undefined
}

// The desktop transport maps its own send-time failures onto the RpcClient
// error channel by wrapping the real HostProtocolError inside an
// RpcClientError.RpcClientDefect (see hostProtocolErrorToRpcClientError in
// @orika/bridge). This layer reproduces that exact value shape so the App
// client must recover the typed host error rather than collapse it.
const protocolLayerFailingSendWith = (
  error: RpcClientError.RpcClientError
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    RpcClient.Protocol.make((_write) =>
      Effect.succeed({
        send: (_clientId, request) =>
          request._tag === "Request" ? Effect.fail(error) : Effect.void,
        supportsAck: false,
        supportsTransferables: false
      })
    )
  )

const focusFailingWith = (error: RpcClientError.RpcClientError) =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(
      Layer.provide(AppSurface.clientLayer, protocolLayerFailingSendWith(error))
    )
    const exit = yield* Effect.promise(() =>
      runtime.runPromiseExit(
        Effect.gen(function* () {
          const client = yield* AppClient
          return yield* Effect.exit(client.focus())
        })
      )
    )
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

test("App client recovers the typed host error wrapped in an RpcClientError", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const hostError = makeHostProtocolHostUnavailableError("App.focus")
      const wrapped = new RpcClientError.RpcClientError({
        reason: new RpcClientError.RpcClientDefect({
          message: hostError.message,
          cause: hostError
        })
      })

      const exit = yield* focusFailingWith(wrapped)

      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) {
        return
      }

      const error = firstFailure(exit.cause) as
        | {
            readonly tag?: unknown
            readonly operation?: unknown
            readonly recoverable?: unknown
          }
        | undefined

      expect(error).toBeDefined()
      // The wrapped error is a recoverable HostUnavailable for App.focus. It must
      // survive intact, not be flattened into a non-recoverable Internal/App error.
      expect(error?.tag).toBe("HostUnavailable")
      expect(error?.operation).toBe("App.focus")
      expect(error?.recoverable).toBe(true)
    })
  ))
