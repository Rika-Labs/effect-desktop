import { expect, test } from "bun:test"
import { RpcEndpoint, RpcSupport } from "@effect-desktop/bridge"
import { Desktop, MissingDesktopRpcClientError } from "@effect-desktop/core"
import { BunServices } from "@effect/platform-bun"
import { Deferred, Effect, FileSystem, ManagedRuntime, Schedule, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createApp, effectScope } from "vue"

import { MissingDesktopContextError, VueDesktop } from "./index.js"

class WaitForTimeout extends Schema.TaggedErrorClass<WaitForTimeout>()("WaitForTimeout", {}) {}

const Root = {
  setup() {
    return () => null
  }
}

const indexSourcePath = new URL("./index.ts", import.meta.url).pathname

const PlatformRuntime = ManagedRuntime.make(BunServices.layer)

test("VueDesktop adapter runtime uses Effect disposal primitives", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const source = yield* fs.readFileString(indexSourcePath)

      expect(source).toContain("makeFrameworkRuntime(runtime)")
      expect(source).toContain("Effect.runCallback(runtime.disposeEffect)")
      expect(source).toContain("makeFrameworkScopedOperation(runtime)")
      expect(source).not.toContain("void runtime.dispose()")
      expect(source).not.toContain("await frameworkRuntime.dispose()")
      expect(source).not.toContain("runFrameworkPromiseExit")
    })
  ))

test("VueDesktop.from exposes app-scoped composables from provided groups", () => {
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
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const app = NotesVue.createApp(Root, { rpcs: NotesLayer })
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

test("VueDesktop.useDesktop keeps reserved endpoint names as own properties", () => {
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
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const app = NotesVue.createApp(Root, { rpcs: NotesLayer })
  app.config.warnHandler = () => undefined

  app.runWithContext(() => {
    const scope = effectScope()
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      expect(Object.getPrototypeOf(notes)).toBeNull()
      expect(Object.prototype.hasOwnProperty.call(notes, "__proto__")).toBe(true)
    })
    scope.stop()
  })
})

test("VueDesktop query effects are interrupted when the scope is disposed", () =>
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
      const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
      const app = NotesVue.createApp(Root, { rpcs: NotesLayer })
      app.config.warnHandler = () => undefined

      app.runWithContext(() => {
        const scope = effectScope()
        scope.run(() => {
          const notes = NotesVue.useDesktop(NotesRpcs)
          notes.slow.useQuery()
        })
        scope.stop()
      })

      yield* Deferred.await(interrupted)
    })
  ))

test("VueDesktop mutation effects are interrupted when the scope is disposed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>()
      const Slow = Rpc.make("Notes.SlowCreate", { success: Schema.String })
      const NotesRpcs = RpcGroup.make(Slow)
      const NotesLayer = Desktop.rpc(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.SlowCreate": () =>
            Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
        })
      )
      const NotesApp = Desktop.make({
        windows: Desktop.window("main", { title: "Notes" }),
        rpcs: NotesLayer
      })
      const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
      const app = NotesVue.createApp(Root, { rpcs: NotesLayer })
      app.config.warnHandler = () => undefined

      app.runWithContext(() => {
        const scope = effectScope()
        scope.run(() => {
          const notes = NotesVue.useDesktop(NotesRpcs)
          const mutation = notes.slowCreate.useMutation()
          mutation.run()
          expect(mutation.state.value.status).toBe("running")
        })
        scope.stop()
      })

      yield* Deferred.await(interrupted)
    })
  ))

test("VueDesktop stream composables emit values, close, fail, and interrupt on disposal", () =>
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
      const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
      const app = NotesVue.createApp(Root, { rpcs: NotesLayer })
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
      yield* waitFor(() => tail?.value.status === "closed")
      expect(tail?.value.data).toEqual(["a", "b"])
      yield* waitFor(() => failing?.value.status === "failure")
      scope.stop()
      yield* Deferred.await(interrupted)
    })
  ))

test("VueDesktop stream composables retain bounded data and support callback-only consumption", () =>
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
      const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
      const app = NotesVue.createApp(Root, { rpcs: NotesLayer })
      app.config.warnHandler = () => undefined

      const observed: string[] = []
      let bounded:
        | { readonly value: { readonly status: string; readonly data: readonly unknown[] } }
        | undefined
      let callbackOnly:
        | { readonly value: { readonly status: string; readonly data: readonly unknown[] } }
        | undefined
      const scope = effectScope()
      app.runWithContext(() => {
        scope.run(() => {
          const notes = NotesVue.useDesktop(NotesRpcs)
          bounded = notes.tail.useStream({ capacity: 2 })
          callbackOnly = notes.tail.useStream({
            capacity: 0,
            onItem: (item) => {
              observed.push(item)
            }
          })
        })
      })

      yield* waitFor(
        () => bounded?.value.status === "closed" && callbackOnly?.value.status === "closed"
      )
      expect(bounded?.value.data).toEqual(["b", "c"])
      expect(callbackOnly?.value.data).toEqual([])
      expect(observed).toEqual(["a", "b", "c"])
      scope.stop()
    })
  ))

test("VueDesktop.useDesktop fails loudly without provide/inject context or an installed client", () => {
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
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))

  const bareApp = createApp(Root)
  bareApp.config.warnHandler = () => undefined
  bareApp.runWithContext(() => {
    expect(() => NotesVue.useDesktop(NotesRpcs)).toThrow(MissingDesktopContextError)
  })
  expect(() => NotesVue.createApp(Root)).toThrow(MissingDesktopRpcClientError)
})

test("VueDesktop.useDesktop exposes RpcSupport metadata on generated endpoints", () => {
  type SupportedQueryEndpoint = {
    readonly useQuery: unknown
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
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const app = NotesVue.createApp(Root, { rpcs: NotesLayer })
  app.config.warnHandler = () => undefined

  app.runWithContext(() => {
    const scope = effectScope()
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      const endpoint: SupportedQueryEndpoint = notes.unsupported

      expect(endpoint.isSupported).toBe(false)
      expect(endpoint.support.status).toBe("unsupported")
    })
    scope.stop()
  })
})

const waitFor = (predicate: () => boolean): Effect.Effect<void, WaitForTimeout, never> =>
  Effect.suspend(() => (predicate() ? Effect.void : Effect.fail(new WaitForTimeout()))).pipe(
    Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(100)))),
    Effect.mapError(() => new WaitForTimeout())
  )
