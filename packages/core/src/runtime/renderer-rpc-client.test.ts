import { expect, test } from "bun:test"
import { HostProtocolResponseEnvelope, type HostProtocolEnvelope } from "@effect-desktop/bridge"
import { Effect, Layer, Schema, Stream } from "effect"
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
  let startRun: (() => void) | undefined
  let closeRun: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    startRun = resolve
  })
  const closed = new Promise<void>((resolve) => {
    closeRun = resolve
  })
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
      startRun?.()
      respond()
      return Effect.never.pipe(Effect.ensuring(Effect.sync(() => closeRun?.())))
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
        Effect.andThen(Effect.promise(() => started)),
        Effect.provide(
          makeDesktopRendererRpcClientLayer(app, { framework: "react" }).pipe(
            Layer.provide(makeDesktopRendererRpcTransportLayer(transport))
          )
        )
      )
    )
  )
  await closed
})

test("RendererRpcClients test layer executes RpcTest clients and interrupts scoped streams", async () => {
  let markStarted: (() => void) | undefined
  let markInterrupted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const interrupted = new Promise<void>((resolve) => {
    markInterrupted = resolve
  })
  const Tail = Rpc.make("Notes.Tail", {
    success: Schema.String,
    stream: true
  })
  const NotesRpcs = RpcGroup.make(Tail)
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Tail": () =>
        Stream.make("start").pipe(
          Stream.tap(() => Effect.sync(() => markStarted?.())),
          Stream.concat(Stream.never.pipe(Stream.ensuring(Effect.sync(() => markInterrupted?.()))))
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
        yield* Effect.promise(() => started)
      }).pipe(Effect.provide(makeDesktopRendererRpcTestLayer([NotesLayer])))
    )
  )

  await interrupted
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
