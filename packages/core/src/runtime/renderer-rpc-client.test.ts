import { expect, test } from "bun:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { BunServices } from "@effect/platform-bun"
import {
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  type HostProtocolEnvelope
} from "@orika/bridge"
import {
  Clock,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Layer,
  ManagedRuntime,
  Queue,
  Schema,
  Scope,
  Stream
} from "effect"
import type { PlatformError } from "effect/PlatformError"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import { Desktop } from "../index.js"
import type { AnyDesktopRpcRegistrationGroup, DesktopAppManifest } from "./desktop-app.js"
import { MissingDesktopRpcClientError } from "./desktop-errors.js"
import {
  RendererRpcClients,
  makeDesktopRendererRpcClientLayer,
  makeDesktopRendererRpcLayer,
  makeDesktopRendererRpcTestLayer,
  makeDesktopRendererRpcTransportLayer,
  getGlobalDesktopRendererRpcTransport,
  type DesktopRendererRpcTransport
} from "./renderer-rpc-client.js"
import { makeRendererInspectorCollector } from "./inspector-events.js"

const Ping = Rpc.make("Notes.Ping", { success: Schema.String })
const DialogMessage = Rpc.make("Dialog.message", {
  payload: { message: Schema.String },
  success: Schema.Void
})
const workspaceRootUrl = new URL("../../../../", import.meta.url)
const bundleScratchRootUrl = new URL("build/orika-bundle-tests/", workspaceRootUrl)
const rendererEntrypointUrl = new URL("renderer.ts", import.meta.url)
const rendererRpcClientUrl = new URL("renderer-rpc-client.ts", import.meta.url)
const PlatformRuntime = ManagedRuntime.make(BunServices.layer)

const runQueuedTransport = (
  queue: Queue.Queue<HostProtocolEnvelope>,
  onEnvelope: (envelope: HostProtocolEnvelope) => Effect.Effect<void>
): Effect.Effect<never> =>
  Stream.fromQueue(queue).pipe(Stream.runForEach(onEnvelope), Effect.andThen(Effect.never))

test("@orika/core/renderer entrypoint avoids host descriptor modules", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const source = yield* fs.readFileString(fileURLToPath(rendererEntrypointUrl))

      expect(source).not.toContain("./rpc-descriptors.js")
      expect(source).not.toContain("./desktop-app.js")
    })
  ))

test("RendererRpcClients invokes flat RpcClient without an unknown-erased function assertion", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const source = yield* fs.readFileString(fileURLToPath(rendererRpcClientUrl))

      expect(source).not.toContain("RawRendererRpcInvocation")
      expect(source).not.toContain("RendererRpcInvocation")
      expect(source).not.toContain("as unknown as")
      expect(source).not.toContain("as RendererRpcInvocation")
      expect(source).toContain("const result = rpcClient(tag, input)")
    })
  ))

test("@orika/core/renderer browser-bundles descriptor exports without host modules", () =>
  PlatformRuntime.runPromise(
    expectBrowserBundle(
      "core-renderer",
      [
        'import { describeRpcs, makeFrameworkScopedOperation } from "@orika/core/renderer"',
        "globalThis.__orikaCoreRendererSmoke = [describeRpcs, makeFrameworkScopedOperation]"
      ].join("\n")
    )
  ))

test("framework adapters browser-bundle against @orika/core/renderer", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      yield* expectBrowserBundle(
        "solid-renderer",
        [
          'import { SolidDesktop } from "../../../packages/solid/src/index.ts"',
          "globalThis.__orikaSolidDesktopSmoke = SolidDesktop"
        ].join("\n"),
        adapterBundleExternals
      )
      yield* expectBrowserBundle(
        "vue-renderer",
        [
          'import { VueDesktop } from "../../../packages/vue/src/index.ts"',
          "globalThis.__orikaVueDesktopSmoke = VueDesktop"
        ].join("\n"),
        adapterBundleExternals
      )
      yield* expectBrowserBundle(
        "next-renderer",
        [
          'import { NextDesktop } from "../../../packages/next/src/index.ts"',
          "globalThis.__orikaNextDesktopSmoke = NextDesktop"
        ].join("\n"),
        adapterBundleExternals
      )
    })
  ))

test("RendererRpcClients layer fails missing transport as a typed layer error", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const NotesRpcs = RpcGroup.make(Ping)
      const app = manifestFor(NotesRpcs)

      const exit = yield* runScopedExit(
        Effect.service(RendererRpcClients),
        makeDesktopRendererRpcLayer(app, { framework: "react" })
      )

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
        expect(failure?.error).toBeInstanceOf(MissingDesktopRpcClientError)
      }
    })
  ))

test("global renderer RPC transport wraps the host-installed WebView transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const key = "__ORIKA_HOST_RPC_TRANSPORT__"
      type HostInstalledTransport = {
        readonly send: (envelope: HostProtocolEnvelope) => void
        readonly subscribe: (listener: (envelope: unknown) => void) => () => void
      }
      const target = globalThis as typeof globalThis & {
        [key]?: HostInstalledTransport | undefined
      }
      const sent: HostProtocolEnvelope[] = []
      let listener: ((envelope: unknown) => void) | undefined

      target[key] = Object.freeze({
        send: (envelope: HostProtocolEnvelope) => {
          sent.push(envelope)
        },
        subscribe: (next: (envelope: unknown) => void) => {
          listener = next
          return () => {
            listener = undefined
          }
        }
      })

      try {
        const transport = getGlobalDesktopRendererRpcTransport()
        expect(transport).toBeDefined()
        if (transport === undefined) {
          throw new Error("expected host-installed renderer RPC transport")
        }

        const received = yield* Deferred.make<HostProtocolEnvelope>()
        const fiber = yield* Effect.forkChild(
          transport.run((envelope) => Deferred.succeed(received, envelope).pipe(Effect.asVoid)),
          { startImmediately: true }
        )
        while (listener === undefined) {
          yield* Effect.yieldNow
        }
        const inbound = new HostProtocolResponseEnvelope({
          kind: "response",
          id: "request-1",
          timestamp: 1,
          traceId: "trace-response",
          payload: "pong"
        })

        listener?.(inbound)
        yield* transport.send(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "request-1",
            method: "Notes.Ping",
            timestamp: 1,
            traceId: "trace-request"
          })
        )

        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({
          kind: "request",
          id: "request-1",
          method: "Notes.Ping",
          traceId: "trace-request"
        })
        expect(yield* Deferred.await(received)).toMatchObject({
          kind: "response",
          id: "request-1",
          payload: "pong"
        })

        yield* Fiber.interrupt(fiber)
        expect(listener).toBeUndefined()
      } finally {
        delete target[key]
      }
    })
  ))

test("RendererRpcClients layer does not require transport for manifests with no RPC groups", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const clients = yield* runScoped(
        Effect.service(RendererRpcClients).pipe(Effect.map((service) => service.clients)),
        makeDesktopRendererRpcLayer(emptyManifest(), { framework: "react" })
      )

      expect(clients.size).toBe(0)
    })
  ))

test("RendererRpcClients layer closes the client protocol scope", () => {
  const NotesRpcs = RpcGroup.make(Ping)
  const app = manifestFor(NotesRpcs)
  const started = Deferred.makeUnsafe<void>()
  const closed = Deferred.makeUnsafe<void>()
  let pendingRequest: Extract<HostProtocolEnvelope, { readonly kind: "request" }> | undefined
  let onEnvelope: ((envelope: HostProtocolEnvelope) => Effect.Effect<void>) | undefined
  const respond = (): Effect.Effect<void> => {
    if (pendingRequest === undefined || onEnvelope === undefined) {
      return Effect.void
    }
    const request = pendingRequest
    pendingRequest = undefined
    return onEnvelope(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: 0,
        traceId: request.traceId,
        payload: "pong"
      })
    )
  }
  const transport: DesktopRendererRpcTransport = {
    send: (envelope) =>
      envelope.kind === "request"
        ? Effect.suspend(() => {
            pendingRequest = envelope
            return respond()
          })
        : Effect.void,
    run: (handler) =>
      Effect.suspend(() => {
        onEnvelope = handler
        return Deferred.succeed(started, undefined).pipe(
          Effect.asVoid,
          Effect.andThen(respond()),
          Effect.andThen(
            Effect.never.pipe(
              Effect.ensuring(Deferred.succeed(closed, undefined).pipe(Effect.asVoid))
            )
          )
        )
      })
  }

  return Effect.runPromise(
    Effect.gen(function* () {
      yield* runScoped(
        Effect.service(RendererRpcClients).pipe(
          Effect.flatMap((service) => {
            const client = service.clients.get(NotesRpcs)
            expect(client).toBeDefined()
            const ping = client?.["Notes.Ping"]
            expect(ping).toBeDefined()
            return (ping!(undefined) as Effect.Effect<unknown, never>).pipe(Effect.orDie)
          }),
          Effect.andThen(Deferred.await(started))
        ),
        makeDesktopRendererRpcClientLayer(app, { framework: "react" }).pipe(
          Layer.provide(makeDesktopRendererRpcTransportLayer(transport))
        )
      )
      yield* Deferred.await(closed)
    })
  )
})

test("RendererRpcClients decodes omitted host response payloads for void mutations", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const DialogRpcs = RpcGroup.make(DialogMessage)
      const app = manifestFor(DialogRpcs)
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const requests: HostProtocolEnvelope[] = []
      const transport: DesktopRendererRpcTransport = {
        send: (envelope) => {
          if (envelope.kind !== "request") {
            return Effect.void
          }
          requests.push(envelope)
          return Queue.offer(
            queue,
            new HostProtocolResponseEnvelope({
              kind: "response",
              id: envelope.id,
              timestamp: 0,
              traceId: envelope.traceId
            })
          ).pipe(Effect.asVoid)
        },
        run: (onEnvelope) => runQueuedTransport(queue, onEnvelope)
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const clients = yield* Effect.service(RendererRpcClients)
          const dialog = clients.clients.get(DialogRpcs)
          const message = dialog?.["Dialog.message"]
          expect(message).toBeDefined()
          if (message === undefined) {
            return yield* Effect.die("expected Dialog.message client")
          }
          const response = message({ message: "hello" })
          if (!Effect.isEffect(response)) {
            return yield* Effect.die("expected Dialog.message to return an Effect")
          }
          return yield* response.pipe(Effect.orDie)
        }),
        makeDesktopRendererRpcClientLayer(app, { framework: "react" }).pipe(
          Layer.provide(makeDesktopRendererRpcTransportLayer(transport))
        )
      )

      expect(result).toBeUndefined()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        kind: "request",
        method: "Dialog.message",
        payload: { message: "hello" }
      })
    })
  ))

test("RendererRpcClients test layer executes RpcTest clients and interrupts scoped streams", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
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

      yield* runScoped(
        Effect.gen(function* () {
          const clients = yield* Effect.service(RendererRpcClients)
          const notes = clients.clients.get(NotesRpcs)
          const tail = notes?.["Notes.Tail"]
          expect(tail).toBeDefined()
          yield* Effect.forkScoped(Stream.runDrain(tail!(undefined) as Stream.Stream<unknown>))
          yield* Deferred.await(started)
        }),
        makeDesktopRendererRpcTestLayer(NotesLayer)
      )

      yield* Deferred.await(interrupted)
    })
  ))

test("RendererRpcClients test layer publishes renderer RPC lifecycle events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_715_001_456_000
      const inspector = yield* makeRendererInspectorCollector()
      const NotesRpcs = RpcGroup.make(Ping)
      const NotesLayer = Desktop.rpc(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Ping": () => Effect.succeed("pong")
        })
      )

      yield* runScoped(
        Effect.gen(function* () {
          const clients = yield* Effect.service(RendererRpcClients)
          const notes = clients.clients.get(NotesRpcs)
          const ping = notes?.["Notes.Ping"]
          expect(ping).toBeDefined()
          const result = yield* (ping!(undefined) as Effect.Effect<unknown, never>).pipe(
            Effect.orDie
          )
          expect(result).toBe("pong")
        }).pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp))),
        makeDesktopRendererRpcTestLayer(NotesLayer, { inspector })
      )

      const events = yield* Stream.runCollect(Stream.take(inspector.events, 2))

      expect(
        Array.from(events).map(({ kind, operation, status }) => ({ kind, operation, status }))
      ).toEqual([
        { kind: "rpc", operation: "Notes.Ping", status: "start" },
        { kind: "rpc", operation: "Notes.Ping", status: "success" }
      ])
      expect(Array.from(events).map((event) => event.timestamp)).toEqual([timestamp, timestamp])
    })
  ))

test("RendererRpcClients test layer publishes renderer stream interruption events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const inspector = yield* makeRendererInspectorCollector()
      const started = yield* Deferred.make<void>()
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

      yield* runScoped(
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
        }),
        makeDesktopRendererRpcTestLayer(NotesLayer, { inspector })
      )

      const events = yield* Stream.runCollect(Stream.take(inspector.events, 2))

      expect(
        Array.from(events).map(({ kind, operation, status }) => ({ kind, operation, status }))
      ).toEqual([
        { kind: "stream", operation: "Notes.Tail", status: "start" },
        { kind: "stream", operation: "Notes.Tail", status: "interruption" }
      ])
    })
  ))

const expectBrowserBundle = (
  name: string,
  source: string,
  extraExternal: readonly string[] = []
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(fileURLToPath(bundleScratchRootUrl), { recursive: true })
    const directory = yield* fs.makeTempDirectory({
      directory: fileURLToPath(bundleScratchRootUrl),
      prefix: `${name}-`
    })
    const directoryUrl = pathToFileURL(`${directory}/`)
    const entryPath = fileURLToPath(new URL("entry.ts", directoryUrl))
    const outdir = fileURLToPath(new URL("out/", directoryUrl))

    try {
      yield* fs.writeFileString(entryPath, `${source}\n`)

      const result = yield* Effect.promise(() =>
        runBunBuild({
          entryPath,
          externals: [
            ...extraExternal,
            "@effect/atom-react",
            "@effect/atom-solid",
            "@effect/atom-vue",
            "@effect/platform-browser",
            "@orika/platform-browser",
            "react",
            "solid-js",
            "solid-js/web",
            "vue"
          ],
          outdir
        })
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe("")
    } finally {
      yield* fs.remove(directory, { force: true, recursive: true })
    }
  })

const runBunBuild = ({
  entryPath,
  externals,
  outdir
}: {
  readonly entryPath: string
  readonly externals: readonly string[]
  readonly outdir: string
}): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> => {
  const process = Bun.spawn(
    [
      "bun",
      "build",
      entryPath,
      "--target=browser",
      "--format=esm",
      "--outdir",
      outdir,
      ...externals.map((external) => `--external=${external}`)
    ],
    {
      cwd: fileURLToPath(workspaceRootUrl),
      stderr: "pipe",
      stdout: "pipe"
    }
  )

  return Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stderr, stdout }))
}

const adapterBundleExternals = Object.freeze(["@orika/bridge", "effect", "effect/unstable/rpc"])

const manifestFor = (group: AnyDesktopRpcRegistrationGroup): DesktopAppManifest =>
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

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() =>
      runtime.runPromiseExit(Effect.scoped(effect) as Effect.Effect<A, E, R>)
    )
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const runScopedExit = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<Exit.Exit<A, E | LE>, never, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    try {
      return yield* Effect.promise(() => runtime.runPromiseExit(effect))
    } finally {
      yield* Effect.promise(() => runtime.dispose())
    }
  })
