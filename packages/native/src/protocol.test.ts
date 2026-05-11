import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type BridgeClientResponse,
  HostProtocolRequestEnvelope
} from "@effect-desktop/bridge"
import { Cause, Effect, Exit, Layer } from "effect"

import { Protocol, ProtocolLive, makeProtocolBridgeClientLayer } from "./index.js"

const expectExitFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  predicate: (error: E) => boolean
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(predicate(fail.error as E)).toBe(true)
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

test("Protocol bridge client validates asset roots as absolute local paths", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Protocol
    }).pipe(
      Effect.provide(
        Layer.provide(
          ProtocolLive,
          makeProtocolBridgeClientLayer(
            protocolExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  await Effect.runPromise(client.serveAsset({ scheme: "assets", root: "/app/assets" }))
  const emptyRootExit = await Effect.runPromiseExit(
    client.serveAsset({ scheme: "assets", root: "" })
  )
  const relativeRootExit = await Effect.runPromiseExit(
    client.serveAsset({ scheme: "assets", root: "relative/assets" })
  )
  const traversalRootExit = await Effect.runPromiseExit(
    client.serveAsset({ scheme: "assets", root: "../outside" })
  )
  const fileUrlRootExit = await Effect.runPromiseExit(
    client.serveAsset({ scheme: "assets", root: "file:///tmp/assets" })
  )
  const controlRootExit = await Effect.runPromiseExit(
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
})
