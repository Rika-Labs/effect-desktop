import { expect, test } from "bun:test"
import { RpcCapability, RpcEndpoint, RpcSupport } from "@effect-desktop/bridge"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

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
