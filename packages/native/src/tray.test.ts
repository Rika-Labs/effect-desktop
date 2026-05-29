import { expect, test } from "bun:test"
import {
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  PermissionRegistry,
  ResourceRegistry,
  type ResourceId,
  type ResourceRegistryApi
} from "@orika/core"
import { HostProtocolRequestEnvelope, RendererOriginAuth } from "@orika/bridge"
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect"

import { makeTrayServiceLayer, Tray, TraySurface, type TrayClientApi } from "./tray.js"
import { TrayActivatedEvent, type TrayHandle, TraySupportedResult } from "./contracts/tray.js"

const resourceId = (value: string): ResourceId => makeResourceId(value)

const trayHandle: TrayHandle = {
  kind: "tray",
  id: resourceId("tray-1"),
  generation: 0,
  ownerScope: "app",
  state: "open"
}

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const baseTrayClient = (calls: string[]): TrayClientApi => ({
  create: () =>
    Effect.sync(() => {
      calls.push("create")
      return trayHandle
    }),
  setIcon: () => Effect.void,
  setTooltip: () => Effect.void,
  setTitle: () => Effect.void,
  setMenu: () => Effect.void,
  destroy: (tray) =>
    Effect.sync(() => {
      calls.push(`destroy:${tray.id}`)
    }),
  onActivated: () =>
    Stream.make(new TrayActivatedEvent({ tray: trayHandle, ownerWindowId: "window-1" })),
  isSupported: () => Effect.succeed(new TraySupportedResult({ supported: true }))
})

// Bug 1: the unsupported `reason` must flow through the service unchanged.
test("Tray service preserves the host-supplied unsupported reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const resources = yield* makeResourceRegistry()
      const client: TrayClientApi = {
        ...baseTrayClient([]),
        isSupported: () =>
          Effect.succeed(
            new TraySupportedResult({ supported: false, reason: "host-tray-unavailable" })
          )
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const tray = yield* Tray
          return yield* tray.isSupported()
        }),
        makeTrayServiceLayer(client, { resources })
      )

      expect(result).toBeInstanceOf(TraySupportedResult)
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-tray-unavailable")
    })
  ))

// Bug 1: the reason must survive the RPC handler reconstruction and reach the bridge caller.
test("Tray.isSupported RPC handler returns the host-supplied reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client: TrayClientApi = {
        ...baseTrayClient([]),
        isSupported: () =>
          Effect.succeed(
            new TraySupportedResult({ supported: false, reason: "host-tray-unavailable" })
          )
      }

      // Mirror the shipped Tray.isSupported handler: it must return the service result
      // directly rather than reconstructing a reason-less TraySupportedResult.
      const runtime = TraySurface.hostRuntime(
        {
          "Tray.create": (input) =>
            Effect.gen(function* () {
              const tray = yield* Tray
              return yield* tray.create(input)
            }),
          "Tray.setIcon": (input) =>
            Effect.gen(function* () {
              const tray = yield* Tray
              yield* tray.setIcon(input.tray, input.icon)
            }),
          "Tray.setTooltip": (input) =>
            Effect.gen(function* () {
              const tray = yield* Tray
              yield* tray.setTooltip(input.tray, input.tooltip)
            }),
          "Tray.setTitle": (input) =>
            Effect.gen(function* () {
              const tray = yield* Tray
              yield* tray.setTitle(input.tray, input.title)
            }),
          "Tray.setMenu": (input) =>
            Effect.gen(function* () {
              const tray = yield* Tray
              yield* tray.setMenu(input.tray, input.menu)
            }),
          "Tray.destroy": (input) =>
            Effect.gen(function* () {
              const tray = yield* Tray
              yield* tray.destroy(input.tray)
            }),
          "Tray.isSupported": () =>
            Effect.gen(function* () {
              const tray = yield* Tray
              return yield* tray.isSupported()
            }),
          "Tray.events.Activated": () => Stream.empty
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "tray-is-supported",
            method: "Tray.isSupported",
            timestamp: 1710000000000,
            traceId: "trace-tray-is-supported"
          })
        ),
        Layer.mergeAll(
          Layer.effect(PermissionRegistry, makePermissionRegistry()),
          Layer.effect(ResourceRegistry, makeResourceRegistry()),
          makeTrayServiceLayer(client)
        )
      )

      expect(response.kind).toBe("success")
      if (response.kind === "success") {
        expect(response.payload).toEqual({ supported: false, reason: "host-tray-unavailable" })
      }
    })
  ))

// Bug 2: an interrupt landing after the native destroy completes must not let the
// registry finalizer run a second native destroy at scope close.
test("Tray.destroy drops the native icon exactly once under interruption", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const resources: ResourceRegistryApi = yield* makeResourceRegistry()
      const calls: string[] = []
      const nativeEntered = yield* Deferred.make<void>()
      const releaseNative = yield* Deferred.make<void>()

      const client: TrayClientApi = {
        ...baseTrayClient(calls),
        // Model a native destroy that, once dispatched, cannot be cancelled mid-flight:
        // it signals entry, waits for the test to release it, then records exactly one
        // native destroy. The test queues an interrupt while it is in this critical
        // section so the interrupt is observed only at the boundary that follows.
        destroy: (tray) =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              yield* Deferred.succeed(nativeEntered, undefined)
              yield* Deferred.await(releaseNative)
              calls.push(`destroy:${tray.id}`)
            })
          )
      }

      yield* runScoped(
        Effect.gen(function* () {
          const tray = yield* Tray
          const created = yield* tray.create({ icon: "solid:#3366ccff" })

          const fiber = yield* Effect.forkChild(tray.destroy(created))
          yield* Deferred.await(nativeEntered)
          // Queue the interrupt while the native destroy is uninterruptible, then let it
          // complete. The interrupt is delivered at the first interruptible boundary after
          // the native call returns.
          yield* Effect.sync(() => fiber.interruptUnsafe())
          yield* Deferred.succeed(releaseNative, undefined)
          yield* Fiber.await(fiber)

          // Close the owner scope: the registry finalizer runs the registered dispose,
          // which must observe the explicitlyDestroyed flag and skip a second native call.
          yield* resources.closeScope(created.ownerScope)
        }),
        makeTrayServiceLayer(client, { resources })
      )

      expect(calls.filter((call) => call === `destroy:${trayHandle.id}`)).toHaveLength(1)

      const snapshot = yield* resources.list()
      expect(snapshot.entries).toHaveLength(0)
    })
  ))
