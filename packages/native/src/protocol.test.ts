import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type BridgeClientResponse,
  HostProtocolRequestEnvelope
} from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"

import { Protocol, ProtocolSurface } from "./index.js"

const expectExitFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  predicate: (error: E) => boolean
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(predicate(fail.error)).toBe(true)
      return
    }
  }

  throw new Error("expected typed failure")
}

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag

const protocolExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

test("Protocol public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("protocol.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )
      const protocolModule = yield* Effect.promise(() => import("./protocol.js"))
      const rootModule = yield* Effect.promise(() => import("./index.js"))

      for (const removedName of [
        "class ProtocolClient",
        "ProtocolServiceApi",
        "ProtocolLive",
        "Protocol.layer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
      expect("ProtocolClient" in protocolModule).toBe(false)
      expect("ProtocolClient" in rootModule).toBe(false)
      expect("ProtocolLive" in protocolModule).toBe(false)
      expect("ProtocolLive" in rootModule).toBe(false)
    })
  ))

test("Protocol bridge client validates asset roots as absolute local paths", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  return Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const client = yield* Protocol

        yield* client.serveAsset({ scheme: "assets", root: "/app/assets" })
        const emptyRootExit = yield* Effect.exit(client.serveAsset({ scheme: "assets", root: "" }))
        const relativeRootExit = yield* Effect.exit(
          client.serveAsset({ scheme: "assets", root: "relative/assets" })
        )
        const traversalRootExit = yield* Effect.exit(
          client.serveAsset({ scheme: "assets", root: "../outside" })
        )
        const fileUrlRootExit = yield* Effect.exit(
          client.serveAsset({ scheme: "assets", root: "file:///tmp/assets" })
        )
        const controlRootExit = yield* Effect.exit(
          client.serveAsset({ scheme: "assets", root: "/app/assets/\u0000bad" })
        )

        expectExitFailure(emptyRootExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(relativeRootExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(traversalRootExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(fileUrlRootExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(controlRootExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expect(requests.map((request) => [request.method, request.payload])).toEqual([
          ["Protocol.serveAsset", { scheme: "assets", root: "/app/assets" }]
        ])
      }),
      ProtocolSurface.bridgeClientLayer(
        protocolExchange(requests, () => ({ kind: "success", payload: undefined }))
      )
    )
  )
})

test("Protocol bridge client rejects double-encoded traversal in route and deny paths", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  return Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const client = yield* Protocol

        const doubleEncodedRouteExit = yield* Effect.exit(
          client.serveRoute({ scheme: "myapp", route: "/%252e%252e/secret" })
        )
        const doubleEncodedDenyExit = yield* Effect.exit(
          client.deny({ scheme: "assets", path: "/%252e%252e/secret" })
        )
        const tripleEncodedRouteExit = yield* Effect.exit(
          client.serveRoute({ scheme: "myapp", route: "/%25252e%25252e/secret" })
        )

        expectExitFailure(doubleEncodedRouteExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(doubleEncodedDenyExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(tripleEncodedRouteExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expect(requests).toEqual([])
      }),
      ProtocolSurface.bridgeClientLayer(
        protocolExchange(requests, () => ({ kind: "success", payload: undefined }))
      )
    )
  )
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
