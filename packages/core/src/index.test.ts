import { expect, test } from "bun:test"
import {
  makeDesktopServerProtocol,
  RpcCapability,
  RpcEndpoint,
  RpcSupport
} from "@effect-desktop/bridge"
import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import { Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc"
import type { AnyApiLayer } from "./index.js"

test("public barrel exports the ResourceRegistry factory", async () => {
  const core = await import("./index.js")

  expect(core.makeResourceRegistry).toBeFunction()
  expect(core.makeProcess).toBeFunction()
  expect(core.ProcessLive).toBeDefined()
  expect(core.makeApprovalBroker).toBeFunction()
  expect(core.makeAuditEvents).toBeFunction()
  expect(core.makeCommandRegistry).toBeFunction()
})

test("public Desktop facade exposes the API contract registry", async () => {
  const core = await import("./index.js")

  expect(core.Client).toBeFunction()
  expect(core.Handlers).toBeFunction()
  expect(core.Desktop.Api.Tag).toBeFunction()
  expect(core.Desktop.Client).toBeFunction()
  expect(core.Desktop.Handlers).toBeFunction()
  expect(core.Desktop.RpcEndpoint.query).toBeFunction()
  expect(core.Desktop.RpcCapability).toBeFunction()
  expect(core.Desktop.RpcSupport.unsupported).toBeFunction()
  expect(core.Desktop.RedactionFilter.redact({ token: "abc" })).toEqual({ token: "[REDACTED]" })
})

test("Desktop.make produces a pipeable app definition and Desktop.provide appends layers", async () => {
  const core = await import("./index.js")
  const definition = core.Desktop.make({
    id: "notes",
    windows: {
      main: {
        title: "Notes",
        renderer: "/"
      }
    }
  }).pipe(core.Desktop.provide(Layer.empty))

  expect(definition._tag).toBe("DesktopAppDefinition")
  expect(definition.id).toBe("notes")
  expect(definition.windows["main"]?.title).toBe("Notes")
  expect(definition.windows["main"]?.renderer).toBe("/")
  expect(definition.layers).toHaveLength(1)
  expect(Layer.isLayer(core.Desktop.toLayer(definition))).toBe(true)
})

test("Desktop.Rpcs.layer pairs an RpcGroup with its implementation for app adapters", async () => {
  const core = await import("./index.js")
  const Ping = Rpc.make("Notes.Ping", { success: Schema.String })
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesLive = NotesRpcs.toLayer({
    "Notes.Ping": () => Effect.succeed("pong")
  })
  const definition = core.Desktop.make({
    id: "notes",
    windows: {
      main: {
        title: "Notes",
        renderer: "/"
      }
    }
  }).pipe(core.Desktop.provide(core.Desktop.Rpcs.layer(NotesRpcs, NotesLive)))

  expect(definition.layers).toHaveLength(0)
  expect(definition.rpcLayers).toHaveLength(1)
  expect(definition.rpcLayers[0]?.group.requests.has("Notes.Ping")).toBe(true)
  expect(core.Desktop.manifest(definition)).toEqual({
    _tag: "DesktopAppManifest",
    id: "notes",
    windows: definition.windows,
    rpcGroups: [
      {
        _tag: "DesktopRpcGroup",
        group: NotesRpcs
      }
    ]
  })
})

test("Desktop.toLayer binds RpcGroups into the runtime RpcServer protocol", async () => {
  const core = await import("./index.js")
  let acquired = 0
  const Ping = Rpc.make("Notes.Ping", { success: Schema.String })
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesLive = Layer.merge(
    NotesRpcs.toLayer({
      "Notes.Ping": () => Effect.succeed("pong")
    }),
    Layer.effectDiscard(
      Effect.sync(() => {
        acquired += 1
      })
    )
  )
  const definition = core.Desktop.make({
    id: "notes",
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(core.Desktop.provide(core.Desktop.Rpcs.layer(NotesRpcs, NotesLive)))
  const transport = {
    send: () => Effect.void,
    run: () => Effect.never
  }
  const protocolLayer = Layer.effect(RpcServer.Protocol)(makeDesktopServerProtocol(transport))
  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.toLayer(definition).pipe(Layer.provide(protocolLayer))))
  )

  expect(Exit.isSuccess(exit)).toBe(true)
  expect(acquired).toBe(1)
})

test("Desktop.app lowers legacy Api layers into the RpcGroup registry", async () => {
  const core = await import("./index.js")
  const List = Rpc.make("Legacy.Notes.list", {
    payload: Schema.Void,
    success: Schema.Array(Schema.String),
    error: Schema.Never
  })
  const LegacyRpcs = RpcGroup.make(List)
  class LegacyNotes {
    static readonly tag = "Legacy.Notes"
    static readonly spec = {
      list: {
        input: Schema.Void,
        output: Schema.Array(Schema.String),
        error: Schema.Never
      }
    }
    static readonly events = {}
    static toRpcGroup(): typeof LegacyRpcs {
      return LegacyRpcs
    }
    static layer(
      handlers: { readonly list: () => Effect.Effect<readonly string[], never, never> }
    ) {
      return Object.freeze({
        contract: LegacyNotes,
        handlers: Object.freeze(handlers)
      })
    }
  }
  const legacyLayer = LegacyNotes.layer({
    list: () => Effect.succeed(["inbox"])
  }) as unknown as AnyApiLayer
  const transport = {
    send: () => Effect.void,
    run: () => Effect.never
  }
  const protocolLayer = Layer.effect(RpcServer.Protocol)(makeDesktopServerProtocol(transport))
  const app = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          core
            .desktopApp({
              id: "legacy-notes",
              windows: {
                main: {
                  title: "Notes"
                }
              },
              handlers: [legacyLayer]
            })
            .pipe(Layer.provide(protocolLayer))
        )
        return Context.get(context, core.DesktopApp)
      })
    )
  )

  expect(app.rpcLayers).toHaveLength(1)
  expect(app.rpcLayers[0]?.group.requests.has("Legacy.Notes.list")).toBe(true)
})

test("Desktop.toLayer rejects RpcGroup methods that require undeclared capabilities", async () => {
  const core = await import("./index.js")
  const Connect = Rpc.make("Network.Connect").pipe(
    RpcCapability({
      kind: "network.connect"
    })
  )
  const NetworkRpcs = RpcGroup.make(Connect)
  const definition = core.Desktop.make({
    id: "network-app",
    windows: {
      main: {
        title: "Network"
      }
    }
  }).pipe(
    core.Desktop.provide(
      core.Desktop.Rpcs.layer(
        NetworkRpcs,
        NetworkRpcs.toLayer({
          "Network.Connect": () => Effect.succeed(undefined)
        })
      )
    )
  )

  const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(core.Desktop.toLayer(definition))))

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "missing-permission",
      method: "Network.Connect",
      permission: "network.connect"
    })
  }
})

test("describeRpcs derives endpoint descriptors from provided RpcGroups", async () => {
  const core = await import("./index.js")
  const List = Rpc.make("Notes.List", { success: Schema.Array(Schema.String) }).pipe(
    RpcEndpoint.query
  )
  const Tail = Rpc.make("Notes.Tail", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  }).pipe(RpcSupport.unsupported("host stream is unavailable"))
  const NotesRpcs = RpcGroup.make(List, Tail)
  const definition = core.Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    core.Desktop.provide(
      core.Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.List": () => Effect.succeed(["inbox"]),
          "Notes.Tail": () => Effect.never
        })
      )
    )
  )

  expect(
    core.Desktop.describeRpcs(definition, NotesRpcs).map((descriptor) => descriptor.name)
  ).toEqual(["list", "tail"])
  expect(
    core.Desktop.describeRpcs(definition, NotesRpcs).map((descriptor) => descriptor.kind)
  ).toEqual(["query", "stream"])
  expect(core.Desktop.describeRpcs(definition, NotesRpcs)[1]?.support).toEqual({
    status: "unsupported",
    reason: "host stream is unavailable"
  })
})

test("describeRpcs rejects duplicate endpoint names before adapters build maps", async () => {
  const core = await import("./index.js")
  const ProjectList = Rpc.make("Projects.List", { success: Schema.Array(Schema.String) })
  const TaskList = Rpc.make("Tasks.List", { success: Schema.Array(Schema.String) })
  const CollidingRpcs = RpcGroup.make(ProjectList, TaskList)
  const definition = core.Desktop.make({
    windows: {
      main: {
        title: "Lists"
      }
    }
  }).pipe(
    core.Desktop.provide(
      core.Desktop.Rpcs.layer(
        CollidingRpcs,
        CollidingRpcs.toLayer({
          "Projects.List": () => Effect.succeed(["project"]),
          "Tasks.List": () => Effect.succeed(["task"])
        })
      )
    )
  )

  expect(() => core.Desktop.describeRpcs(definition, CollidingRpcs)).toThrow(
    core.DuplicateDesktopRpcNameError
  )
})

test("describeRpcs fails loudly when a group is not provided to the app", async () => {
  const core = await import("./index.js")
  const Missing = RpcGroup.make(Rpc.make("Notes.Missing"))
  const definition = core.Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  })

  expect(() => core.Desktop.describeRpcs(definition, Missing)).toThrow(core.MissingDesktopRpcsError)
})
