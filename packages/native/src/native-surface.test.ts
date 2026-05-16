import { expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import {
  type BridgeClientExchange,
  type HostProtocolError,
  HostProtocolEventEnvelope,
  type HostProtocolRequestEnvelope,
  rpcCapability,
  rpcEndpointKind,
  rpcSupport
} from "@effect-desktop/bridge"
import { P } from "@effect-desktop/core"
import { Context, Effect, Option, Schema, Stream } from "effect"
import { RpcGroup } from "effect/unstable/rpc"

import { subscribeNativeEvent } from "./event-stream.js"
import { NativeSurface } from "./native-surface.js"

test("NativeSurface.rpc records native authority, endpoint kind, and support explicitly", () => {
  const rpc = NativeSurface.rpc("Example", "open", {
    payload: Schema.Void,
    success: Schema.Void,
    authority: NativeSurface.authority.native(),
    endpoint: "query",
    support: NativeSurface.support.supported
  })

  expect(rpc._tag).toBe("Example.open")
  expect(rpcEndpointKind(rpc)).toBe("query")
  expect(rpcSupport(rpc)).toEqual({ status: "supported" })
  expect(Option.getOrUndefined(rpcCapability(rpc))).toEqual(
    P.nativeInvoke({ primitive: "Example", methods: ["open"] })
  )
})

test("NativeSurface.rpc records explicit public authority", () => {
  const rpc = NativeSurface.rpc("Example", "isSupported", {
    payload: Schema.Void,
    success: Schema.Void,
    authority: NativeSurface.authority.none,
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })

  expect(Option.getOrUndefined(rpcCapability(rpc))).toEqual({ kind: "none" })
})

test("native service files construct RPCs through NativeSurface", async () => {
  const sourceDir = new URL(".", import.meta.url)
  const sourcePath = fileURLToPath(sourceDir)
  const entries = await readdir(sourceDir)
  const checkedFiles = entries.filter(
    (entry) =>
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      entry !== "desktop-http-api.ts" &&
      entry !== "native-surface.ts"
  )

  const offenders: string[] = []
  for (const entry of checkedFiles) {
    const contents = await readFile(join(sourcePath, entry), "utf8")
    if (contents.includes("Rpc.make(")) {
      offenders.push(entry)
    }
  }

  expect(offenders).toEqual([])
})

test("NativeSurface bridgeClientLayer passes exchange to event-aware mapped clients", async () => {
  const PingResult = Schema.Struct({ value: Schema.String })
  const ExamplePing = NativeSurface.rpc("Example", "ping", {
    payload: Schema.Void,
    success: PingResult,
    authority: NativeSurface.authority.none,
    endpoint: "query",
    support: NativeSurface.support.supported
  })
  const ExampleGroup = RpcGroup.make(ExamplePing)

  interface ExampleClientApi {
    readonly ping: () => Effect.Effect<typeof PingResult.Type, unknown, never>
    readonly events: () => Stream.Stream<string, HostProtocolError, never>
  }

  class ExampleClient extends Context.Service<ExampleClient, ExampleClientApi>()(
    "@effect-desktop/native/test/ExampleClient"
  ) {}

  const ExampleSurface = NativeSurface.make("Example", ExampleGroup, {
    service: ExampleClient,
    handlers: ExampleGroup.toLayer({
      "Example.ping": () => Effect.succeed({ value: "handler" })
    }),
    client: (client) =>
      ({
        ping: () => client["Example.ping"](undefined),
        events: () => Stream.empty
      }) satisfies ExampleClientApi,
    bridgeClient: (client, exchange) =>
      ({
        ping: () => client["Example.ping"](undefined),
        events: () => subscribeNativeEvent(exchange, "Example.Event", Schema.String)
      }) satisfies ExampleClientApi
  })

  const requests: HostProtocolRequestEnvelope[] = []
  const eventMethods: string[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: { value: "bridge" }
      })
    },
    subscribe: (method) => {
      eventMethods.push(method)
      return Stream.make(
        new HostProtocolEventEnvelope({
          kind: "event",
          timestamp: 1_710_000_000_000,
          traceId: "event-trace",
          method,
          payload: "event-value"
        })
      )
    }
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const example = yield* ExampleClient
      const ping = yield* example.ping()
      const event = yield* example.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { event, ping }
    }).pipe(
      Effect.provide(
        ExampleSurface.bridgeClientLayer(exchange, {
          nextTraceId: () => "trace-bridge-client",
          now: () => 1_710_000_000_001
        })
      )
    )
  )

  expect(result).toEqual({ ping: { value: "bridge" }, event: "event-value" })
  expect(requests.map((request) => request.method)).toEqual(["Example.ping"])
  expect(eventMethods).toEqual(["Example.Event"])
})
