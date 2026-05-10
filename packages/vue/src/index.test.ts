import { expect, test } from "bun:test"
import {
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeHostProtocolInvalidOutputError,
  RpcEndpoint,
  type HostProtocolEnvelope,
  type HostProtocolError
} from "@effect-desktop/bridge"
import {
  Desktop,
  MissingDesktopRpcClientError,
  type DesktopRendererRpcTransport
} from "@effect-desktop/core"
import { Cause, Deferred, Effect, Exit, Fiber, Queue, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createApp, effectScope } from "vue"

import { MissingDesktopContextError, VueDesktop } from "./index.js"

const Root = {
  setup() {
    return () => null
  }
}

test("VueDesktop.from exposes app-scoped composables from provided groups", () => {
  const ListNotes = Rpc.make("Notes.List", { success: Schema.Array(Schema.String) }).pipe(
    RpcEndpoint.query
  )
  const CreateNote = Rpc.make("Notes.Create", {
    payload: { title: Schema.String },
    success: Schema.String
  })
  const NotesRpcs = RpcGroup.make(ListNotes, CreateNote)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.List": () => Effect.succeed(["inbox"]),
          "Notes.Create": ({ title }) => Effect.succeed(`note:${title}`)
        })
      )
    )
  )
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.List": () => Effect.succeed(["inbox"]),
    "Notes.Create": (input) => {
      const title = (input as { readonly title?: unknown }).title
      return Effect.succeed(`note:${typeof title === "string" ? title : "untitled"}`)
    }
  })
  const app = NotesVue.createApp(Root, { transport })
  app.config.warnHandler = () => undefined

  app.runWithContext(() => {
    const scope = effectScope()
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      const list = notes.list.useQuery()
      const create = notes.create.useMutation()

      expect(list.value.status).toBe("running")
      expect(create.state.value.status).toBe("idle")
    })
    scope.stop()
  })
})

test("VueDesktop query effects are interrupted when the scope is disposed", async () => {
  const interrupted = await Effect.runPromise(Deferred.make<void>())
  const Slow = Rpc.make("Notes.Slow", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Slow)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Slow": () => Effect.succeed("unused")
        })
      )
    )
  )
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.Slow": () => Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
  })
  const app = NotesVue.createApp(Root, { transport })
  app.config.warnHandler = () => undefined

  app.runWithContext(() => {
    const scope = effectScope()
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      notes.slow.useQuery()
    })
    scope.stop()
  })

  await Effect.runPromise(Deferred.await(interrupted))
})

test("VueDesktop stream composables emit values, close, fail, and interrupt on disposal", async () => {
  const interrupted = await Effect.runPromise(Deferred.make<void>())
  const Tail = Rpc.make("Notes.Tail", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  })
  const Failing = Rpc.make("Notes.Failing", {
    success: Schema.String,
    error: Schema.Unknown,
    stream: true
  })
  const Slow = Rpc.make("Notes.SlowTail", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  })
  const NotesRpcs = RpcGroup.make(Tail, Failing, Slow)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Tail": () => Stream.make("a", "b"),
          "Notes.Failing": () => Stream.fail("boom"),
          "Notes.SlowTail": () => Stream.never
        })
      )
    )
  )
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.Tail": () => Stream.make("a", "b"),
    "Notes.Failing": () => Stream.fail(makeHostProtocolInvalidOutputError("Notes.Failing", "boom")),
    "Notes.SlowTail": () =>
      Stream.never.pipe(Stream.ensuring(Deferred.succeed(interrupted, undefined)))
  })
  const app = NotesVue.createApp(Root, { transport })
  app.config.warnHandler = () => undefined

  let tail:
    | { readonly value: { readonly status: string; readonly data: readonly unknown[] } }
    | undefined
  let failing: { readonly value: { readonly status: string } } | undefined
  const scope = effectScope()
  app.runWithContext(() => {
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      tail = notes.tail.useStream()
      failing = notes.failing.useStream()
      const slow = notes.slowTail.useStream()

      expect(tail?.value.status).toBe("running")
      expect(slow.value.status).toBe("running")
    })
  })
  await waitFor(() => tail?.value.status === "closed")
  expect(tail?.value.data).toEqual(["a", "b"])
  await waitFor(() => failing?.value.status === "failure")
  scope.stop()
  await Effect.runPromise(Deferred.await(interrupted))
})

test("VueDesktop.useDesktop fails loudly without provide/inject context or an installed client", () => {
  const Ping = Rpc.make("Notes.Ping")
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Ping": () => Effect.void
        })
      )
    )
  )
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))

  const bareApp = createApp(Root)
  bareApp.config.warnHandler = () => undefined
  bareApp.runWithContext(() => {
    expect(() => NotesVue.useDesktop(NotesRpcs)).toThrow(MissingDesktopContextError)
  })
  expect(() => NotesVue.createApp(Root)).toThrow(MissingDesktopRpcClientError)
})

type RpcTransportHandler = (
  payload: unknown
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

const makeRpcTransport = (
  handlers: Readonly<Record<string, RpcTransportHandler>>
): DesktopRendererRpcTransport => {
  const queue = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const fibers = new Map<string, Fiber.Fiber<void, unknown>>()
  return {
    send: (envelope) => {
      if (envelope.kind === "cancel" && envelope.id !== undefined) {
        const fiber = fibers.get(envelope.id)
        if (fiber === undefined) {
          return Effect.void
        }
        fibers.delete(envelope.id)
        return Fiber.interrupt(fiber).pipe(Effect.asVoid)
      }
      if (envelope.kind !== "request") {
        return Effect.void
      }
      const handler = handlers[envelope.method]
      if (handler === undefined) {
        return Queue.offer(
          queue,
          responseEnvelope(envelope, {
            error: makeHostProtocolInvalidOutputError(envelope.method, "missing test handler")
          })
        )
      }
      const result = handler(envelope.payload)
      if (Stream.isStream(result)) {
        return Effect.gen(function* () {
          const fiber = yield* Effect.forkDetach(
            Effect.exit(
              Stream.runForEach(result, (item) =>
                Queue.offer(queue, streamEnvelope(envelope, item))
              )
            ).pipe(
              Effect.flatMap((exit) => Queue.offer(queue, responseFromExit(envelope, exit))),
              Effect.asVoid
            ),
            { startImmediately: true }
          )
          fibers.set(envelope.id, fiber)
        })
      }
      return Effect.exit(result).pipe(
        Effect.flatMap((exit) => Queue.offer(queue, responseFromExit(envelope, exit)))
      )
    },
    run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
  }
}

const responseFromExit = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  exit: Exit.Exit<unknown, unknown>
): HostProtocolResponseEnvelope =>
  Exit.isSuccess(exit)
    ? responseEnvelope(request, { payload: exit.value === undefined ? null : exit.value })
    : responseEnvelope(request, { error: hostProtocolErrorFromCause(request.method, exit.cause) })

const responseEnvelope = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  fields: { readonly payload?: unknown; readonly error?: HostProtocolError }
): HostProtocolResponseEnvelope =>
  new HostProtocolResponseEnvelope({
    kind: "response",
    id: request.id,
    timestamp: 0,
    traceId: request.traceId,
    ...fields
  })

const streamEnvelope = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  payload: unknown
): HostProtocolStreamByRequestEnvelope =>
  new HostProtocolStreamByRequestEnvelope({
    kind: "stream",
    id: request.id,
    timestamp: 0,
    traceId: request.traceId,
    payload
  })

const hostProtocolErrorFromCause = (
  method: string,
  cause: Cause.Cause<unknown>
): HostProtocolError => {
  const failure = cause.reasons.find(Cause.isFailReason)
  return failure?.error instanceof Error || typeof failure?.error === "string"
    ? makeHostProtocolInvalidOutputError(method, String(failure.error))
    : makeHostProtocolInvalidOutputError(method, String(cause))
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(predicate()).toBe(true)
}
