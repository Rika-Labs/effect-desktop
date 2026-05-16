import { expect, test } from "bun:test"
import { HostProtocolResponseEnvelope, type HostProtocolEnvelope } from "@effect-desktop/bridge"
import { Clock, Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import { Desktop } from "../index.js"
import type { DesktopAppManifest } from "./desktop-app.js"
import { MissingDesktopRpcClientError } from "./desktop-errors.js"
import {
  RendererRpcClients,
  makeDesktopRendererRpcClientLayer,
  makeDesktopRendererRpcLayer,
  makeDesktopRendererRpcTestLayer,
  makeDesktopRendererRpcTransportLayer,
  type DesktopRendererRpcTransport
} from "./renderer-rpc-client.js"
import { makeRendererInspectorCollector } from "./inspector-events.js"

const Ping = Rpc.make("Notes.Ping", { success: Schema.String })

test("RendererRpcClients layer fails missing transport as a typed layer error", async () => {
  const NotesRpcs = RpcGroup.make(Ping)
  const app = manifestFor(NotesRpcs)

  const exit = await Effect.runPromiseExit(
    Effect.service(RendererRpcClients).pipe(
      Effect.provide(makeDesktopRendererRpcLayer(app, { framework: "react" }))
    )
  )

  expect(exit._tag).toBe("Failure")
  if (exit._tag === "Failure") {
    const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(failure?.error).toBeInstanceOf(MissingDesktopRpcClientError)
  }
})

test("RendererRpcClients layer does not require transport for manifests with no RPC groups", async () => {
  const clients = await Effect.runPromise(
    Effect.service(RendererRpcClients).pipe(
      Effect.map((service) => service.clients),
      Effect.provide(makeDesktopRendererRpcLayer(emptyManifest(), { framework: "react" }))
    )
  )

  expect(clients.size).toBe(0)
})

test("RendererRpcClients layer closes the client protocol scope", async () => {
  const NotesRpcs = RpcGroup.make(Ping)
  const app = manifestFor(NotesRpcs)
  const started = Effect.runSync(Deferred.make<void>())
  const closed = Effect.runSync(Deferred.make<void>())
  let pendingRequest: Extract<HostProtocolEnvelope, { readonly kind: "request" }> | undefined
  const respond = (): void => {
    if (pendingRequest === undefined || onEnvelope === undefined) {
      return
    }
    const request = pendingRequest
    pendingRequest = undefined
    void Effect.runPromise(
      onEnvelope(
        new HostProtocolResponseEnvelope({
          kind: "response",
          id: request.id,
          timestamp: 0,
          traceId: request.traceId,
          payload: "pong"
        })
      )
    )
  }
  const transport: DesktopRendererRpcTransport = {
    send: (envelope) =>
      envelope.kind === "request"
        ? Effect.sync(() => {
            pendingRequest = envelope
            respond()
          })
        : Effect.void,
    run: (handler) => {
      onEnvelope = handler
      Effect.runSync(Deferred.succeed(started, undefined).pipe(Effect.asVoid))
      respond()
      return Effect.never.pipe(
        Effect.ensuring(Deferred.succeed(closed, undefined).pipe(Effect.asVoid))
      )
    }
  }
  let onEnvelope: ((envelope: HostProtocolEnvelope) => Effect.Effect<void>) | undefined

  await Effect.runPromise(
    Effect.scoped(
      Effect.service(RendererRpcClients).pipe(
        Effect.flatMap((service) => {
          const client = service.clients.get(NotesRpcs)
          expect(client).toBeDefined()
          const ping = client?.["Notes.Ping"]
          expect(ping).toBeDefined()
          return ping!(undefined) as Effect.Effect<unknown, unknown>
        }),
        Effect.andThen(Deferred.await(started)),
        Effect.provide(
          makeDesktopRendererRpcClientLayer(app, { framework: "react" }).pipe(
            Layer.provide(makeDesktopRendererRpcTransportLayer(transport))
          )
        )
      )
    )
  )
  await Effect.runPromise(Deferred.await(closed))
})

test("RendererRpcClients test layer executes RpcTest clients and interrupts scoped streams", async () => {
  const started = Effect.runSync(Deferred.make<void>())
  const interrupted = Effect.runSync(Deferred.make<void>())
  const Tail = Rpc.make("Notes.Tail", {
    success: Schema.String,
    stream: true
  })
  const NotesRpcs = RpcGroup.make(Tail)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Tail": () =>
        Stream.make("start").pipe(
          Stream.concat(
            Stream.fromEffect(Deferred.succeed(started, undefined).pipe(Effect.asVoid)).pipe(
              Stream.drain,
              Stream.concat(Stream.never),
              Stream.ensuring(Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid))
            )
          )
        )
    })
  )

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clients = yield* Effect.service(RendererRpcClients)
        const notes = clients.clients.get(NotesRpcs)
        const tail = notes?.["Notes.Tail"]
        expect(tail).toBeDefined()
        yield* Effect.forkScoped(Stream.runDrain(tail!(undefined) as Stream.Stream<unknown>))
        yield* Deferred.await(started)
      }).pipe(Effect.provide(makeDesktopRendererRpcTestLayer(NotesLayer)))
    )
  )

  await Effect.runPromise(Deferred.await(interrupted))
})

test("RendererRpcClients test layer publishes renderer RPC lifecycle events", async () => {
  const timestamp = 1_715_001_456_000
  const inspector = await Effect.runPromise(makeRendererInspectorCollector())
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Ping": () => Effect.succeed("pong")
    })
  )

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clients = yield* Effect.service(RendererRpcClients)
        const notes = clients.clients.get(NotesRpcs)
        const ping = notes?.["Notes.Ping"]
        expect(ping).toBeDefined()
        const result = yield* ping!(undefined) as Effect.Effect<unknown, unknown>
        expect(result).toBe("pong")
      }).pipe(
        Effect.provide(makeDesktopRendererRpcTestLayer(NotesLayer, { inspector })),
        Effect.provideService(Clock.Clock, fixedClock(timestamp))
      )
    )
  )

  const events = await Effect.runPromise(Stream.runCollect(Stream.take(inspector.events, 2)))

  expect(
    Array.from(events).map(({ kind, operation, status }) => ({ kind, operation, status }))
  ).toEqual([
    { kind: "rpc", operation: "Notes.Ping", status: "start" },
    { kind: "rpc", operation: "Notes.Ping", status: "success" }
  ])
  expect(Array.from(events).map((event) => event.timestamp)).toEqual([timestamp, timestamp])
})

test("RendererRpcClients test layer publishes renderer stream interruption events", async () => {
  const inspector = await Effect.runPromise(makeRendererInspectorCollector())
  const started = Effect.runSync(Deferred.make<void>())
  const Tail = Rpc.make("Notes.Tail", {
    success: Schema.String,
    stream: true
  })
  const NotesRpcs = RpcGroup.make(Tail)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Tail": () =>
        Stream.make("start").pipe(
          Stream.concat(
            Stream.fromEffect(Deferred.succeed(started, undefined).pipe(Effect.asVoid)).pipe(
              Stream.drain,
              Stream.concat(Stream.never)
            )
          )
        )
    })
  )

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clients = yield* Effect.service(RendererRpcClients)
        const notes = clients.clients.get(NotesRpcs)
        const tail = notes?.["Notes.Tail"]
        expect(tail).toBeDefined()
        const fiber = yield* Effect.forkScoped(
          Stream.runDrain(tail!(undefined) as Stream.Stream<unknown>)
        )
        yield* Deferred.await(started)
        yield* Fiber.interrupt(fiber)
      }).pipe(Effect.provide(makeDesktopRendererRpcTestLayer(NotesLayer, { inspector })))
    )
  )

  const events = await Effect.runPromise(Stream.runCollect(Stream.take(inspector.events, 2)))

  expect(
    Array.from(events).map(({ kind, operation, status }) => ({ kind, operation, status }))
  ).toEqual([
    { kind: "stream", operation: "Notes.Tail", status: "start" },
    { kind: "stream", operation: "Notes.Tail", status: "interruption" }
  ])
})

const manifestFor = (
  group: RpcGroup.Any & { readonly requests: ReadonlyMap<string, Rpc.Any> }
): DesktopAppManifest =>
  Object.freeze({
    _tag: "DesktopAppManifest",
    id: "notes",
    windows: Object.freeze({}),
    rpcGroups: Object.freeze([
      Object.freeze({
        _tag: "DesktopRpcGroup" as const,
        group
      })
    ])
  })

const emptyManifest = (): DesktopAppManifest =>
  Object.freeze({
    _tag: "DesktopAppManifest",
    id: "empty",
    windows: Object.freeze({}),
    rpcGroups: Object.freeze([])
  })

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})
