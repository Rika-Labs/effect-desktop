import { expect, test } from "bun:test"
import { type HostProtocolError, makeHostProtocolHostUnavailableError } from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { RpcClient, RpcClientError } from "effect/unstable/rpc"

import { PowerMonitor, PowerMonitorSurface } from "./power-monitor.js"

test("PowerMonitor preserves the host error tag and recoverable flag through the RPC client", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const hostFailure = makeHostProtocolHostUnavailableError("PowerMonitor.isSupported")

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const monitor = yield* PowerMonitor
          return yield* Effect.exit(monitor.isSupported("onSuspend"))
        }),
        powerMonitorLayerFailingWith(wrapHostError(hostFailure))
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "HostUnavailable",
          recoverable: true,
          operation: "PowerMonitor.isSupported"
        })
      })
    })
  ))

test("PowerMonitor falls back to Internal for non-host RPC client failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const monitor = yield* PowerMonitor
          return yield* Effect.exit(monitor.isSupported("onSuspend"))
        }),
        powerMonitorLayerFailingWith(
          new RpcClientError.RpcClientError({
            reason: new RpcClientError.RpcClientDefect({
              message: "transport blew up",
              cause: new Error("transport blew up")
            })
          })
        )
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          recoverable: false,
          operation: "PowerMonitor"
        })
      })
    })
  ))

// Mirrors how the host wire wraps a real HostProtocolError into an RpcClientError
// (bridge/src/protocol.ts hostProtocolErrorToRpcClientError).
const wrapHostError = (error: HostProtocolError): RpcClientError.RpcClientError =>
  new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({
      message: error.message,
      cause: error
    })
  })

const powerMonitorLayerFailingWith = (
  failure: RpcClientError.RpcClientError
): Layer.Layer<PowerMonitor> =>
  PowerMonitor.layer.pipe(
    Layer.provide(PowerMonitorSurface.clientLayer),
    Layer.provide(protocolLayerFailingSend(failure))
  )

const protocolLayerFailingSend = (
  failure: RpcClientError.RpcClientError
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    RpcClient.Protocol.make((_write, _clientIds) =>
      Effect.succeed({
        send: () => Effect.fail(failure),
        supportsAck: false,
        supportsTransferables: false
      })
    )
  )

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
