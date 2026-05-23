import { expect, test } from "bun:test"
import { RpcEndpoint, RpcSupport } from "@orika/bridge"
import { Desktop, DuplicateDesktopRpcNameError, MissingDesktopRpcClientError } from "@orika/core"
import { Deferred, Effect, Exit, Schedule, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createRoot } from "solid-js"
import { createComponent, renderToString } from "solid-js/web"

import { MissingDesktopContextError, SolidDesktop } from "./index.js"

class WaitForTimeout extends Schema.TaggedErrorClass<WaitForTimeout>()("WaitForTimeout", {}) {}

class SourceReadError extends Schema.TaggedErrorClass<SourceReadError>()("SourceReadError", {
  cause: Schema.Defect
}) {}

const readSolidIndexSource = Effect.tryPromise({
  try: () => Bun.file(new URL("./index.ts", import.meta.url)).text(),
  catch: (cause) => new SourceReadError({ cause })
})

test("SolidDesktop adapter runtime uses the shared scoped framework helper", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* readSolidIndexSource

      expect(source).toContain("makeFrameworkRuntime(runtime)")
      expect(source).toContain("Effect.runCallback(runtime.disposeEffect)")
      expect(source).toContain("makeFrameworkScopedOperation(runtime)")
      expect(source).not.toContain("void runtime.dispose()")
      expect(source).not.toContain("await frameworkRuntime.dispose()")
      expect(source).not.toContain("let runId")
      expect(source).not.toContain("let active")
      expect(source).not.toContain("runFrameworkPromiseExit")
    })
  ))

test("SolidDesktop.render forwards the public rpcs option to DesktopRoot", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* readSolidIndexSource

      expect(source).toContain("rpcs: options.rpcs")
      expect(source).not.toContain("rpcLayers: options.rpcs")
    })
  ))

test("SolidDesktop.from exposes app-scoped primitives from provided groups", () => {
  const ListNotes = Rpc.make("Notes.List", { success: Schema.Array(Schema.String) }).pipe(
    RpcEndpoint.query
  )
  const CreateNote = Rpc.make("Notes.Create", {
    payload: { title: Schema.String },
    success: Schema.String
  })
  const NotesRpcs = RpcGroup.make(ListNotes, CreateNote)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.List": () => Effect.succeed(["inbox"]),
      "Notes.Create": ({ title }) => Effect.succeed(`note:${title}`)
    })
  )
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: NotesLayer
  })
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const rpcs = NotesLayer

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      rpcs,
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

test("SolidDesktop.useDesktop keeps reserved endpoint names as own properties", () => {
  const Reserved = Rpc.make("Notes.__proto__", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Reserved)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.__proto__": () => Effect.succeed("ok")
    })
  )
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: NotesLayer
  })
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const rpcs = NotesLayer

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      rpcs,
      get children() {
        const notes = NotesSolid.useDesktop(NotesRpcs)
        expect(Object.getPrototypeOf(notes)).toBeNull()
        expect(Object.prototype.hasOwnProperty.call(notes, "__proto__")).toBe(true)
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
  const CollidingLayer = Desktop.rpc(
    CollidingRpcs,
    CollidingRpcs.toLayer({
      "Projects.List": () => Effect.succeed(["project"]),
      "Tasks.List": () => Effect.succeed(["task"])
    })
  )
  const CollidingApp = Desktop.make({
    windows: Desktop.window("main", { title: "Lists" }),
    rpcs: CollidingLayer
  })
  const CollidingSolid = SolidDesktop.from(Desktop.manifest(CollidingApp))
  const rpcs = CollidingLayer

  const dispose = createRoot((disposeRoot) => {
    createComponent(CollidingSolid.DesktopRoot, {
      rpcs,
      get children() {
        expect(() => CollidingSolid.useDesktop(CollidingRpcs)).toThrow(DuplicateDesktopRpcNameError)
        return undefined
      }
    })
    return disposeRoot
  })
  dispose()
})

test("SolidDesktop query effects are interrupted when the owner is disposed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>()
      const Slow = Rpc.make("Notes.Slow", { success: Schema.String }).pipe(RpcEndpoint.query)
      const NotesRpcs = RpcGroup.make(Slow)
      const NotesLayer = Desktop.rpc(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Slow": () =>
            Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
        })
      )
      const NotesApp = Desktop.make({
        windows: Desktop.window("main", { title: "Notes" }),
        rpcs: NotesLayer
      })
      const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
      const rpcs = NotesLayer

      const dispose = createRoot((disposeRoot) => {
        createComponent(NotesSolid.DesktopRoot, {
          rpcs,
          get children() {
            const notes = NotesSolid.useDesktop(NotesRpcs)
            notes.slow.createQuery()
            return undefined
          }
        })
        return disposeRoot
      })

      dispose()

      yield* Deferred.await(interrupted)
    })
  ))

test("SolidDesktop mutation replaces active runs through the scoped runtime helper", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>()
      const Save = Rpc.make("Notes.Save", { success: Schema.String })
      const NotesRpcs = RpcGroup.make(Save)
      let calls = 0
      const NotesLayer = Desktop.rpc(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Save": () => {
            calls += 1
            return calls === 1
              ? Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
              : Effect.succeed("second")
          }
        })
      )
      const NotesApp = Desktop.make({
        windows: Desktop.window("main", { title: "Notes" }),
        rpcs: NotesLayer
      })
      const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))

      let mutation:
        | {
            readonly state: () => unknown
            readonly runPromise: () => Promise<Exit.Exit<string, unknown>>
          }
        | undefined
      const dispose = createRoot((disposeRoot) => {
        createComponent(NotesSolid.DesktopRoot, {
          rpcs: NotesLayer,
          get children() {
            const notes = NotesSolid.useDesktop(NotesRpcs)
            mutation = notes.save.createMutation()
            return undefined
          }
        })
        return disposeRoot
      })

      const first = mutation?.runPromise()
      const second = mutation?.runPromise()

      yield* Deferred.await(interrupted)
      const secondExit = yield* Effect.promise(() => second ?? Promise.resolve(undefined))
      const firstExit = yield* Effect.promise(() => first ?? Promise.resolve(undefined))

      expect(secondExit !== undefined && Exit.isSuccess(secondExit)).toBe(true)
      expect(firstExit !== undefined && Exit.isFailure(firstExit)).toBe(true)
      expect(mutation?.state()).toMatchObject({ status: "success" })
      expect(calls).toBe(2)
      dispose()
    })
  ))

test("SolidDesktop stream primitives emit values, close, fail, and interrupt on disposal", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>()
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
      const NotesLayer = Desktop.rpc(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Tail": () => Stream.make("a", "b"),
          "Notes.Failing": () => Stream.fail("boom"),
          "Notes.SlowTail": () =>
            Stream.never.pipe(Stream.ensuring(Deferred.succeed(interrupted, undefined)))
        })
      )
      const NotesApp = Desktop.make({
        windows: Desktop.window("main", { title: "Notes" }),
        rpcs: NotesLayer
      })
      const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
      const rpcs = NotesLayer

      let tail: (() => { readonly status: string; readonly data: readonly unknown[] }) | undefined
      let failing: (() => { readonly status: string }) | undefined
      const dispose = createRoot((disposeRoot) => {
        createComponent(NotesSolid.DesktopRoot, {
          rpcs,
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

      yield* waitFor(() => tail?.().status === "closed")
      expect(tail?.().data).toEqual(["a", "b"])
      yield* waitFor(() => failing?.().status === "failure")
      dispose()
      yield* Deferred.await(interrupted)
    })
  ))

test("SolidDesktop stream primitives retain bounded data and support callback-only consumption", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const Tail = Rpc.make("Notes.Tail", {
        success: Schema.String,
        error: Schema.Never,
        stream: true
      })
      const NotesRpcs = RpcGroup.make(Tail)
      const NotesLayer = Desktop.rpc(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Tail": () => Stream.make("a", "b", "c")
        })
      )
      const NotesApp = Desktop.make({
        windows: Desktop.window("main", { title: "Notes" }),
        rpcs: NotesLayer
      })
      const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
      const observed: string[] = []

      let bounded:
        | (() => { readonly status: string; readonly data: readonly unknown[] })
        | undefined
      let callbackOnly:
        | (() => { readonly status: string; readonly data: readonly unknown[] })
        | undefined
      const dispose = createRoot((disposeRoot) => {
        createComponent(NotesSolid.DesktopRoot, {
          rpcs: NotesLayer,
          get children() {
            const notes = NotesSolid.useDesktop(NotesRpcs)
            bounded = notes.tail.createStream({ capacity: 2 })
            callbackOnly = notes.tail.createStream({
              capacity: 0,
              onItem: (item) => {
                observed.push(item)
              }
            })
            return undefined
          }
        })
        return disposeRoot
      })

      yield* waitFor(() => bounded?.().status === "closed" && callbackOnly?.().status === "closed")
      expect(bounded?.().data).toEqual(["b", "c"])
      expect(callbackOnly?.().data).toEqual([])
      expect(observed).toEqual(["a", "b", "c"])
      dispose()
    })
  ))

test("SolidDesktop.useDesktop fails loudly without context or an installed client", () => {
  const Ping = Rpc.make("Notes.Ping")
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: Desktop.rpc(
      NotesRpcs,
      NotesRpcs.toLayer({
        "Notes.Ping": () => Effect.void
      })
    )
  })
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

test("SolidDesktop.useDesktop exposes RpcSupport metadata on generated endpoints", () => {
  type SupportedQueryEndpoint = {
    readonly createQuery: unknown
    readonly support: { readonly status: string }
    readonly isSupported: boolean
  }
  const Unsupported = Rpc.make("Notes.Unsupported", { success: Schema.String }).pipe(
    RpcEndpoint.query,
    RpcSupport.unsupported("host method is unavailable")
  )
  const NotesRpcs = RpcGroup.make(Unsupported)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Unsupported": () => Effect.succeed("unused")
    })
  )
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: NotesLayer
  })
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const rpcs = NotesLayer

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      rpcs,
      get children() {
        const notes = NotesSolid.useDesktop(NotesRpcs)
        const endpoint: SupportedQueryEndpoint = notes.unsupported

        expect(endpoint.isSupported).toBe(false)
        expect(endpoint.support.status).toBe("unsupported")
        return undefined
      }
    })
    return disposeRoot
  })
  dispose()
})

const waitFor = (predicate: () => boolean): Effect.Effect<void, WaitForTimeout, never> =>
  Effect.gen(function* () {
    if (!predicate()) {
      return yield* new WaitForTimeout()
    }
  }).pipe(Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(100)))))
