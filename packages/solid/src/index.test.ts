import { expect, test } from "bun:test"
import { RpcEndpoint, RpcSupport } from "@effect-desktop/bridge"
import {
  Desktop,
  DuplicateDesktopRpcNameError,
  MissingDesktopRpcClientError
} from "@effect-desktop/core"
import { Deferred, Effect, Schema, Stream } from "effect"
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
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.List": () => Effect.succeed(["inbox"]),
      "Notes.Create": ({ title }) => Effect.succeed(`note:${title}`)
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      rpcLayers,
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
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.__proto__": () => Effect.succeed("ok")
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      rpcLayers,
      get children() {
        const notes = NotesSolid.useDesktop(NotesRpcs) as unknown as Record<string, unknown>
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
  const CollidingLayer = Desktop.Rpcs.layer(
    CollidingRpcs,
    CollidingRpcs.toLayer({
      "Projects.List": () => Effect.succeed(["project"]),
      "Tasks.List": () => Effect.succeed(["task"])
    })
  )
  const CollidingApp = Desktop.make({
    windows: {
      main: {
        title: "Lists"
      }
    },
    rpcs: [CollidingLayer]
  })
  const CollidingSolid = SolidDesktop.from(Desktop.manifest(CollidingApp))
  const rpcLayers = [CollidingLayer]

  const dispose = createRoot((disposeRoot) => {
    createComponent(CollidingSolid.DesktopRoot, {
      rpcLayers,
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
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Slow": () =>
        Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      rpcLayers,
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
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Tail": () => Stream.make("a", "b"),
      "Notes.Failing": () => Stream.fail("boom"),
      "Notes.SlowTail": () =>
        Stream.never.pipe(Stream.ensuring(Deferred.succeed(interrupted, undefined)))
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]

  let tail: (() => { readonly status: string; readonly data: readonly unknown[] }) | undefined
  let failing: (() => { readonly status: string }) | undefined
  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      rpcLayers,
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
    },
    rpcs: [
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Ping": () => Effect.void
        })
      )
    ]
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
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Unsupported": () => Effect.succeed("unused")
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      rpcLayers,
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

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(predicate()).toBe(true)
}
