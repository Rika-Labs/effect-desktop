import { expect, test } from "bun:test"
import {
  HostProtocolResponseEnvelope,
  makeDesktopClientProtocol,
  makeDesktopServerProtocol,
  RpcCapability,
  RpcEndpoint,
  RpcSupport,
  type HostProtocolEnvelope
} from "@effect-desktop/bridge"
import { Cause, Context, Effect, Exit, Layer, Queue, Schema } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc"
import type { DesktopRpcClient, SupportedDesktopRpcClient } from "./runtime/desktop-rpc-surface.js"

test("public barrel exports the ResourceRegistry factory", async () => {
  const core = await import("./index.js")

  expect(core.makeResourceRegistry).toBeFunction()
  expect(core.makeProcess).toBeFunction()
  expect(core.ProcessLive).toBeDefined()
  expect(core.makeApprovalBroker).toBeFunction()
  expect(core.makeAuditEvents).toBeFunction()
  expect(core.makeCommandRegistry).toBeFunction()
})

test("public barrel keeps low-level runtime plumbing behind subpaths", async () => {
  const core = await import("./index.js")

  expect("FrameDecoder" in core).toBe(false)
  expect("encodeFrame" in core).toBe(false)
  expect("layerStdioSocket" in core).toBe(false)
  expect("makeDesktopRendererRpcRuntime" in core).toBe(false)
  expect("describeRpcs" in core).toBe(false)
})

test("runtime transport subpath exposes framed transport helpers", async () => {
  const transport = await import("@effect-desktop/core/runtime/transport")

  expect(transport.FrameDecoder).toBeFunction()
  expect(transport.encodeFrame).toBeFunction()
})

test("public Desktop facade exposes Rpc metadata helpers", async () => {
  const core = await import("./index.js")

  expect(core.Desktop.RpcEndpoint.query).toBeFunction()
  expect(core.Desktop.RpcCapability).toBeFunction()
  expect(core.Desktop.RpcSupport.unsupported).toBeFunction()
  expect(core.Desktop.Rpc.supportedGroup).toBeFunction()
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

test("Desktop.Rpc.surface derives server, client, test, docs, and laws from one RpcGroup", async () => {
  const core = await import("./index.js")
  const Ping = Rpc.make("Notes.Ping", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Ping)
  class NotesClient extends Context.Service<
    NotesClient,
    RpcClient.RpcClient<RpcGroup.Rpcs<typeof NotesRpcs>>
  >()("NotesClient") {}
  const NotesLive = NotesRpcs.toLayer({
    "Notes.Ping": () => Effect.succeed("pong")
  })
  class NotesFacade extends Context.Service<
    NotesFacade,
    { readonly ping: () => Effect.Effect<string> }
  >()("NotesFacade") {}
  const assertSurfaceRequiresMappedCustomServices = (
    makeSurface: typeof core.Desktop.Rpc.surface
  ): void => {
    // @ts-expect-error custom service shapes must explicitly map from the generated RPC client
    makeSurface("Notes", NotesRpcs, {
      service: NotesFacade,
      handlers: NotesLive
    })
  }
  void assertSurfaceRequiresMappedCustomServices
  const surface = core.Desktop.Rpc.surface("Notes", NotesRpcs, {
    service: NotesClient,
    handlers: NotesLive
  })
  const app = core.Desktop.make({
    id: "notes",
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(core.Desktop.provide(surface.serverLayer))

  for (const law of surface.contractLaws) {
    await Effect.runPromise(law.check)
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* NotesClient
      return yield* client["Notes.Ping"](undefined)
    }).pipe(Effect.provide(surface.testClientLayer))
  )
  const queue = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const requests: HostProtocolEnvelope[] = []
  const protocolLayer = Layer.effect(RpcClient.Protocol)(
    makeDesktopClientProtocol(
      {
        send: (envelope) => {
          requests.push(envelope)
          if (envelope.kind !== "request") {
            return Effect.void
          }
          return Queue.offer(
            queue,
            new HostProtocolResponseEnvelope({
              kind: "response",
              id: envelope.id,
              timestamp: 0,
              traceId: envelope.traceId,
              payload: "pong-live"
            })
          ).pipe(Effect.asVoid)
        },
        run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
      },
      { nextTraceId: () => "trace-surface-client" }
    )
  )
  const liveClientResult = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* NotesClient
        return yield* client["Notes.Ping"](undefined)
      }).pipe(Effect.provide(Layer.provide(surface.clientLayer, protocolLayer)))
    )
  )

  expect(result).toBe("pong")
  expect(liveClientResult).toBe("pong-live")
  expect(requests).toMatchObject([
    {
      kind: "request",
      method: "Notes.Ping"
    }
  ])
  expect(surface.group).toBe(NotesRpcs)
  expect(surface.serverLayer.group).toBe(NotesRpcs)
  expect(surface.serverLayer.layer).toBe(NotesLive)
  expect(Layer.isLayer(surface.clientLayer)).toBe(true)
  expect(Layer.isLayer(surface.testClientLayer)).toBe(true)
  expect(surface.schemaDocs.map((doc) => [doc.name, doc.tag, doc.kind])).toEqual([
    ["ping", "Notes.Ping", "query"]
  ])
  expect(core.Desktop.manifest(app).rpcGroups[0]?.group).toBe(NotesRpcs)
  expect(core.Desktop.describeRpcs(app, NotesRpcs).map((descriptor) => descriptor.tag)).toEqual([
    "Notes.Ping"
  ])
})

test("Desktop.Rpc.supportedGroup filters unsupported RPCs from generated clients", async () => {
  const core = await import("./index.js")
  const List = Rpc.make("Notes.List", {
    success: Schema.Array(Schema.String)
  }).pipe(RpcSupport.supported)
  const Delete = Rpc.make("Notes.Delete", {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Void
  }).pipe(RpcSupport.unsupported("host adapter does not implement delete yet"))
  const NotesRpcs = RpcGroup.make(List, Delete)
  const SupportedNotesRpcs = core.Desktop.Rpc.supportedGroup(NotesRpcs)
  class NotesClient extends Context.Service<
    NotesClient,
    DesktopRpcClient<RpcGroup.Rpcs<typeof NotesRpcs>>
  >()("NotesClient") {}
  const assertSupportedClient = (
    client: SupportedDesktopRpcClient<RpcGroup.Rpcs<typeof NotesRpcs>>
  ): void => {
    void client["Notes.List"]
    // @ts-expect-error unsupported RPCs are absent from supported generated clients
    void client["Notes.Delete"]
  }
  void assertSupportedClient

  expect(Array.from(SupportedNotesRpcs.requests.keys())).toEqual(["Notes.List"])
  expect(
    core.Desktop.Rpc.surface("Notes", NotesRpcs, {
      service: NotesClient,
      handlers: NotesRpcs.toLayer({
        "Notes.List": () => Effect.succeed(["one"]),
        "Notes.Delete": () => Effect.void
      })
    }).schemaDocs.map((doc) => [doc.tag, doc.support])
  ).toEqual([
    ["Notes.List", { status: "supported" }],
    [
      "Notes.Delete",
      { status: "unsupported", reason: "host adapter does not implement delete yet" }
    ]
  ])
})

test("Desktop.Rpc.surface laws reject groups that cannot lower to bridge metadata", async () => {
  const core = await import("./index.js")
  const Valid = Rpc.make("Notes.Ping", { success: Schema.String })
  const InvalidNamespace = RpcGroup.make(Rpc.make("Other.Ping", { success: Schema.String }))
  const DuplicateNames = RpcGroup.make(Valid, Rpc.make("Tasks.Ping", { success: Schema.String }))
  const Broken = { _tag: "Notes.Broken", annotations: Context.empty() }
  const BrokenGroup = Object.freeze({
    ...RpcGroup.make(Valid),
    requests: new Map([["Notes.Broken", Broken]])
  }) as unknown as RpcGroup.Any & {
    readonly requests: ReadonlyMap<string, Rpc.Any>
  }

  const invalidNamespace = core.Desktop.Rpc.surface("Notes", InvalidNamespace, {
    service: Context.Service<{ readonly client: unknown }>("InvalidNamespaceClient"),
    handlers: InvalidNamespace.toLayer({
      "Other.Ping": () => Effect.succeed("pong")
    }),
    client: (client) => ({ client })
  })
  const duplicateNames = core.Desktop.Rpc.surface("Notes", DuplicateNames, {
    service: Context.Service<{ readonly client: unknown }>("DuplicateNamesClient"),
    handlers: DuplicateNames.toLayer({
      "Notes.Ping": () => Effect.succeed("pong"),
      "Tasks.Ping": () => Effect.succeed("pong")
    }),
    client: (client) => ({ client })
  })
  const brokenSchema = core.Desktop.Rpc.surface("Notes", BrokenGroup, {
    service: Context.Service<{ readonly client: unknown }>("BrokenSchemaClient"),
    handlers: Layer.empty as Layer.Layer<unknown>,
    client: (client: unknown) => ({ client })
  })

  const expectLawFailure = async (
    law: (typeof invalidNamespace.contractLaws)[number],
    expected: Record<string, unknown>
  ) => {
    const exit = await Effect.runPromiseExit(law.check)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject(expected)
    }
  }

  await expectLawFailure(invalidNamespace.contractLaws[0]!, {
    reason: "invalid-tag",
    tag: "Other.Ping"
  })
  await expectLawFailure(duplicateNames.contractLaws[1]!, {
    reason: "duplicate-endpoint",
    tag: "Tasks.Ping"
  })
  await expectLawFailure(brokenSchema.contractLaws[2]!, {
    reason: "missing-schema",
    tag: "Notes.Broken"
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
