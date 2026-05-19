import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { makePermissionRegistry, makeResourceRegistry, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Stream } from "effect"

import {
  NativeNetwork,
  makeNativeNetworkMemoryClient,
  makeNativeNetworkServiceLayer,
  makeNativeNetworkUnsupportedClient,
  type NativeNetworkClientApi
} from "./native-network.js"

test("NativeNetwork fetches, uploads, opens localhost URLs, streams events, and disposes websockets once", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeNativeNetworkMemoryClient()
      let closes = 0
      const client: NativeNetworkClientApi = {
        ...baseClient,
        closeWebSocket: (input) =>
          Effect.sync(() => {
            closes += 1
          }).pipe(Effect.andThen(baseClient.closeWebSocket(input)))
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const network = yield* NativeNetwork
          const fetched = yield* network.fetch("https://example.test/data.json")
          const uploaded = yield* network.upload("https://example.test/upload", "payload")
          const socket = yield* network.connectWebSocket("wss://example.test/socket", {
            ownerScope: "workspace:a",
            protocols: ["events"]
          })
          const localhost = yield* network.localhostUrl(3010, { path: "/health" })
          const events = yield* network.events().pipe(Stream.take(6), Stream.runCollect)
          yield* network.closeWebSocket(socket.socket)
          yield* resources.closeScope("workspace:a")
          return { events: Array.from(events), fetched, localhost, socket, uploaded }
        }),
        makeNativeNetworkServiceLayer(client, { permissions, resources })
      )

      expect(result.fetched.status).toBe(200)
      expect(result.uploaded.sentBytes).toBe(7)
      expect(result.socket.state).toBe("open")
      expect(result.localhost.url).toBe("http://127.0.0.1:3010/health")
      expect(result.events.map((event) => event.phase)).toEqual([
        "fetch-started",
        "fetch-completed",
        "upload-started",
        "upload-progress",
        "upload-completed",
        "websocket-opened"
      ])
      expect(closes).toBe(1)
    })
  ))

test("NativeNetwork denies before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeNativeNetworkMemoryClient()
      let calls = 0
      const client: NativeNetworkClientApi = {
        ...baseClient,
        fetch: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.fetch(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const network = yield* NativeNetwork
          return yield* Effect.exit(network.fetch("https://example.test/data.json"))
        }),
        makeNativeNetworkServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "PermissionDenied", operation: "NativeNetwork.fetch" })
      })
    })
  ))

test("NativeNetwork surfaces unsupported and host failures as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const unsupported = makeNativeNetworkUnsupportedClient()
      const failing = yield* makeNativeNetworkMemoryClient({
        failure: {
          upload: makeHostProtocolInternalError("host failed", "NativeNetwork.upload")
        }
      })

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const network = yield* NativeNetwork
          return yield* Effect.exit(network.fetch("https://example.test/data.json"))
        }),
        makeNativeNetworkServiceLayer(unsupported, { permissions, resources })
      )
      const failureExit = yield* runScoped(
        Effect.gen(function* () {
          const network = yield* NativeNetwork
          return yield* Effect.exit(network.upload("https://example.test/upload", "payload"))
        }),
        makeNativeNetworkServiceLayer(failing, { permissions, resources })
      )

      expectExitFailure(unsupportedExit, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "NativeNetwork.fetch" })
      })
      expectExitFailure(failureExit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "NativeNetwork.upload" })
      })
    })
  ))

test("NativeNetwork rejects malformed inputs before client work", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeNativeNetworkMemoryClient()
      let calls = 0
      const client: NativeNetworkClientApi = {
        ...baseClient,
        fetch: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.fetch(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const network = yield* NativeNetwork
          return yield* Effect.exit(
            network.fetch("https://example.test/data.json", { method: "GET", body: "payload" })
          )
        }),
        makeNativeNetworkServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "InvalidArgument", operation: "NativeNetwork.fetch" })
      })
    })
  ))

const configuredPermissions = () =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "NativeNetwork", methods: ["fetch"] })),
      permissions.declare(P.nativeInvoke({ primitive: "NativeNetwork", methods: ["upload"] })),
      permissions.declare(
        P.nativeInvoke({ primitive: "NativeNetwork", methods: ["connectWebSocket"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "NativeNetwork", methods: ["closeWebSocket"] })
      ),
      permissions.declare(P.nativeInvoke({ primitive: "NativeNetwork", methods: ["localhostUrl"] }))
    ])
    return permissions
  })

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
