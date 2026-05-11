import { expect, test } from "bun:test"
import {
  makeDesktopServerProtocol,
  RpcCapability,
  RpcEndpoint,
  RpcSupport
} from "@effect-desktop/bridge"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc"

test("public barrel exports the ResourceRegistry factory", async () => {
  const core = await import("./index.js")

  expect(core.makeResourceRegistry).toBeFunction()
  expect(core.makeProcess).toBeFunction()
  expect(core.ProcessLive).toBeDefined()
  expect(core.makeApprovalBroker).toBeFunction()
  expect(core.makeAuditEvents).toBeFunction()
  expect(core.makeCommandRegistry).toBeFunction()
})

test("public Desktop facade exposes Rpc metadata helpers", async () => {
  const core = await import("./index.js")

  expect(core.Desktop.RpcEndpoint.query).toBeFunction()
  expect(core.Desktop.RpcCapability).toBeFunction()
  expect(core.Desktop.RpcSupport.unsupported).toBeFunction()
  expect(core.Desktop.RedactionFilter.redact({ token: "abc" })).toEqual({ token: "[REDACTED]" })
})

test("framework boundary errors carry public diagnostic fields", async () => {
  const core = await import("./index.js")
  const error = core.makeMissingDesktopContextError(
    "react",
    "ReactDesktopRoot is required before useDesktop(group)"
  )

  expect(error).toBeInstanceOf(core.MissingDesktopContextError)
  expect(error).toMatchObject({
    code: "EDESKTOP_MISSING_CONTEXT",
    category: "usage",
    summary: "Desktop framework context is missing.",
    actor: "renderer",
    details: { framework: "react" }
  })
  expect(error.remediation).toContain("react")
  expect(error.docsUrl).toContain("docs/SPEC.md")
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

test("Desktop.toLayer rejects RpcGroup methods that declare known capability kinds without scoped fields", async () => {
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

  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.toLayer(definition)))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "invalid-config",
      method: "Network.Connect",
      permission: "network.connect"
    })
  }
})

test("Desktop.toLayer rejects RpcGroup methods that require undeclared capabilities", async () => {
  const core = await import("./index.js")
  const Connect = Rpc.make("Network.Connect").pipe(
    RpcCapability({
      kind: "network.connect",
      hosts: ["api.example.com"],
      askUnknownHosts: false,
      audit: "on-deny"
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

  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.toLayer(definition)))
  )

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

test("Desktop.toLayer validates RpcGroup capability scope coverage", async () => {
  const core = await import("./index.js")
  const requiredCapability = {
    kind: "network.connect",
    hosts: ["api.example.com"],
    askUnknownHosts: false,
    audit: "on-deny"
  } as const
  const Connect = Rpc.make("Network.Connect").pipe(RpcCapability(requiredCapability))
  const NetworkRpcs = RpcGroup.make(Connect)
  const layer = core.Desktop.Rpcs.layer(
    NetworkRpcs,
    NetworkRpcs.toLayer({
      "Network.Connect": () => Effect.succeed(undefined)
    })
  )
  const transport = {
    send: () => Effect.void,
    run: () => Effect.never
  }
  const protocolLayer = Layer.effect(RpcServer.Protocol)(makeDesktopServerProtocol(transport))
  const wrongScope = core.Desktop.make({
    id: "network-app",
    windows: {
      main: {
        title: "Network"
      }
    },
    permissions: [
      {
        ...requiredCapability,
        hosts: ["other.example.com"]
      }
    ]
  }).pipe(core.Desktop.provide(layer))
  const coveredScope = core.Desktop.make({
    id: "network-app",
    windows: {
      main: {
        title: "Network"
      }
    },
    permissions: [requiredCapability]
  }).pipe(core.Desktop.provide(layer))

  const rejected = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.toLayer(wrongScope)))
  )
  const accepted = await Effect.runPromiseExit(
    Effect.scoped(
      Layer.build(core.Desktop.toLayer(coveredScope).pipe(Layer.provide(protocolLayer)))
    )
  )

  expect(Exit.isFailure(rejected)).toBe(true)
  if (Exit.isFailure(rejected)) {
    const failure = rejected.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "missing-permission",
      method: "Network.Connect",
      permission: "network.connect"
    })
  }
  expect(Exit.isSuccess(accepted)).toBe(true)
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
