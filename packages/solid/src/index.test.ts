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
  DuplicateDesktopRpcNameError,
  MissingDesktopRpcClientError,
  type DesktopRendererRpcTransport
} from "@effect-desktop/core"
import { Cause, Deferred, Effect, Exit, Fiber, Queue, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createRoot } from "solid-js"
import { createComponent, renderToString } from "solid-js/web"

import { MissingDesktopContextError, SolidDesktop } from "./index.js"

test("SolidDesktop.from exposes app-scoped primitives from provided groups", () => {
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
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.List": () => Effect.succeed(["inbox"]),
    "Notes.Create": (input) => {
      const title = (input as { readonly title?: unknown }).title
      return Effect.succeed(`note:${typeof title === "string" ? title : "untitled"}`)
    }
  })

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      transport,
      get children() {
        const notes = NotesSolid.useDesktop(NotesRpcs)
        const list = notes.list.createQuery()
        const create = notes.create.createMutation()

        expect(list().status).toBe("running")
        expect(create.state().status).toBe("idle")
        return undefined
      }
    })
    return disposeRoot
  })
  dispose()
})

test("SolidDesktop.useDesktop rejects colliding endpoint names", () => {
  const ProjectList = Rpc.make("Projects.List", { success: Schema.Array(Schema.String) })
  const TaskList = Rpc.make("Tasks.List", { success: Schema.Array(Schema.String) })
  const CollidingRpcs = RpcGroup.make(ProjectList, TaskList)
  const CollidingApp = Desktop.make({
    windows: {
      main: {
        title: "Lists"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        CollidingRpcs,
        CollidingRpcs.toLayer({
          "Projects.List": () => Effect.succeed(["project"]),
          "Tasks.List": () => Effect.succeed(["task"])
        })
      )
    )
  )
  const CollidingSolid = SolidDesktop.from(Desktop.manifest(CollidingApp))
  const transport = makeRpcTransport({
    "Projects.List": () => Effect.succeed(["project"]),
    "Tasks.List": () => Effect.succeed(["task"])
  })

  const dispose = createRoot((disposeRoot) => {
    createComponent(CollidingSolid.DesktopRoot, {
      transport,
      get children() {
        expect(() => CollidingSolid.useDesktop(CollidingRpcs)).toThrow(DuplicateDesktopRpcNameError)
        return undefined
      }
    })
    return disposeRoot
  })
  dispose()
})

test("SolidDesktop query effects are interrupted when the owner is disposed", async () => {
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
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.Slow": () => Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
  })

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      transport,
      get children() {
        const notes = NotesSolid.useDesktop(NotesRpcs)
        notes.slow.createQuery()
        return undefined
      }
    })
    return disposeRoot
  })

  dispose()

  await Effect.runPromise(Deferred.await(interrupted))
})

test("SolidDesktop stream primitives emit values, close, fail, and interrupt on disposal", async () => {
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
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.Tail": () => Stream.make("a", "b"),
    "Notes.Failing": () => Stream.fail(makeHostProtocolInvalidOutputError("Notes.Failing", "boom")),
    "Notes.SlowTail": () =>
      Stream.never.pipe(Stream.ensuring(Deferred.succeed(interrupted, undefined)))
  })

  let tail: (() => { readonly status: string; readonly data: readonly unknown[] }) | undefined
  let failing: (() => { readonly status: string }) | undefined
  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      transport,
      get children() {
        const notes = NotesSolid.useDesktop(NotesRpcs)
        tail = notes.tail.createStream()
        failing = notes.failing.createStream()
        const slow = notes.slowTail.createStream()

        expect(tail?.().status).toBe("running")
        expect(slow().status).toBe("running")
        return undefined
      }
    })
    return disposeRoot
  })

  await waitFor(() => tail?.().status === "closed")
  expect(tail?.().data).toEqual(["a", "b"])
  await waitFor(() => failing?.().status === "failure")
  dispose()
  await Effect.runPromise(Deferred.await(interrupted))
})

test("SolidDesktop.useDesktop fails loudly without context or an installed client", () => {
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
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))

  createRoot((dispose) => {
    expect(() => NotesSolid.useDesktop(NotesRpcs)).toThrow(MissingDesktopContextError)
    dispose()
  })

  expect(() =>
    renderToString(() =>
      createComponent(NotesSolid.DesktopRoot, {
        get children() {
          NotesSolid.useDesktop(NotesRpcs)
          return undefined
        }
      })
    )
  ).toThrow(MissingDesktopRpcClientError)
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
