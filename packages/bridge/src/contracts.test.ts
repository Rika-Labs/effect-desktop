import { expect, test } from "bun:test"
import { Effect, Option, Schema, Stream } from "effect"

import {
  BridgeRpc,
  Client,
  HostProtocolRequestEnvelope,
  InvalidBridgeRpcSpec,
  Rpc,
  RpcCapability,
  RpcEndpoint,
  RpcGroup,
  RpcSchema,
  RpcSupport,
  makeHostProtocolInvalidOutputError,
  rpcCapability,
  rpcEndpointKind,
  rpcSupport,
  type HostProtocolError
} from "./index.js"

test("BridgeRpc.group creates the frozen RpcGroup contract", () => {
  const ProjectRpcs = BridgeRpc.group(
    "Test.Project",
    {
      open: {
        input: Schema.Struct({ path: Schema.String }),
        output: Schema.Struct({ id: Schema.String }),
        error: Schema.Never,
        permission: "project:open",
        timeoutMs: 30_000,
        cachedResultMs: 60_000,
        idempotent: true,
        cancellable: true,
        backpressure: { strategy: "buffer", size: 128, overflow: "dropOldest" }
      }
    },
    {}
  )

  expect(ProjectRpcs.tag).toBe("Test.Project")
  expect(Object.isFrozen(ProjectRpcs)).toBe(true)
  expect(Object.isFrozen(ProjectRpcs.spec)).toBe(true)
  expect(Array.from(ProjectRpcs.requests.keys())).toEqual(["Test.Project.open"])
})

test("BridgeRpc.group accepts schema classes and frozen event specs", () => {
  class Project extends Schema.Class<Project>("Project")({
    id: Schema.String
  }) {}
  const EventPayload = Schema.Struct({ id: Schema.String })
  const ProjectRpcs = BridgeRpc.group(
    "Test.Events",
    {
      call: {
        input: Project,
        output: Project,
        error: Schema.Never
      }
    },
    {
      changed: {
        payload: EventPayload,
        backpressure: { strategy: "drop", size: 16 }
      }
    }
  )

  expect(ProjectRpcs.spec.call.input).toBe(Project)
  expect(ProjectRpcs.spec.call.output).toBe(Project)
  expect(Object.isFrozen(ProjectRpcs.events.changed)).toBe(true)

  const client = Client(
    { events: ProjectRpcs },
    {
      request: (_request: HostProtocolRequestEnvelope) =>
        Effect.fail(makeHostProtocolInvalidOutputError("Test.Events.call", "unused"))
    }
  )
  const stream: Stream.Stream<typeof EventPayload.Type, HostProtocolError, never> =
    client.events.events.changed

  expect(stream).toBeDefined()
})

test("BridgeRpc.group validates specs before producing a group", () => {
  expect(() =>
    BridgeRpc.group(
      "Test.Invalid",
      {
        call: {
          input: Schema.String,
          output: Schema.String
        }
      } as never,
      {}
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.InvalidTimeout",
      {
        call: {
          ...validMethodSpec(),
          timeoutMs: -1
        }
      },
      {}
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.ZeroCache",
      {
        call: {
          ...validMethodSpec(),
          cachedResultMs: 0,
          idempotent: true
        }
      },
      {}
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.LegacyResourceSpec",
      {
        call: {
          ...validMethodSpec(),
          output: {
            _tag: "BridgeRpcResourceSpec",
            kind: "project",
            state: "open",
            schema: Schema.String
          }
        }
      } as never,
      {}
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.InvalidStreamBackpressure",
      {
        call: {
          input: Schema.String,
          output: BridgeRpc.Stream(Schema.String, Schema.Never, {
            strategy: "buffer",
            size: 1.5,
            overflow: "dropOldest"
          }),
          error: Schema.Never
        }
      },
      {}
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.ZeroStreamBackpressure",
      {
        call: {
          input: Schema.String,
          output: BridgeRpc.Stream(Schema.String, Schema.Never, {
            strategy: "buffer",
            size: 0,
            overflow: "error"
          }),
          error: Schema.Never
        }
      },
      {}
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.InvalidSupport",
      {
        call: {
          ...validMethodSpec(),
          support: {
            status: "unsupported",
            reason: ""
          }
        }
      },
      {}
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.ReservedEventsMethod",
      {
        events: validMethodSpec()
      },
      {}
    )
  ).toThrow(InvalidBridgeRpcSpec)
})

test("BridgeRpc.group rejects empty contract tags", () => {
  expect(() => BridgeRpc.group("", { call: validMethodSpec() }, {})).toThrow(InvalidBridgeRpcSpec)
  expect(() => BridgeRpc.group(" ", { call: validMethodSpec() }, {})).toThrow(InvalidBridgeRpcSpec)
  expect(() => BridgeRpc.group("Bad\nTag", { call: validMethodSpec() }, {})).toThrow(
    InvalidBridgeRpcSpec
  )
})

test("BridgeRpc.group rejects empty method names", () => {
  expect(() => BridgeRpc.group("Test.EmptyMethod", { "": validMethodSpec() }, {})).toThrow(
    InvalidBridgeRpcSpec
  )
  expect(() =>
    BridgeRpc.group("Test.EmptyMethodWhitespace", { " ": validMethodSpec() }, {})
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group("Test.BadMethodControl", { "bad\nmethod": validMethodSpec() }, {})
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group("Test.BadMethodDot", { "bad.method": validMethodSpec() }, {})
  ).toThrow(InvalidBridgeRpcSpec)
})

test("BridgeRpc.group rejects empty event names", () => {
  expect(() =>
    BridgeRpc.group(
      "Test.EmptyEvent",
      { call: validMethodSpec() },
      { "": { payload: Schema.String } }
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.EmptyEventWhitespace",
      { call: validMethodSpec() },
      { " ": { payload: Schema.String } }
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.BadEventControl",
      { call: validMethodSpec() },
      { "bad\nevent": { payload: Schema.String } }
    )
  ).toThrow(InvalidBridgeRpcSpec)
  expect(() =>
    BridgeRpc.group(
      "Test.BadEventDot",
      { call: validMethodSpec() },
      { "bad.event": { payload: Schema.String } }
    )
  ).toThrow(InvalidBridgeRpcSpec)
})

test("BridgeRpc.group rejects empty permissions", () => {
  for (const [index, permission] of ["", " "].entries()) {
    expect(() =>
      BridgeRpc.group(
        `Test.EmptyPermission.${index}`,
        {
          call: {
            ...validMethodSpec(),
            permission
          }
        },
        {}
      )
    ).toThrow(InvalidBridgeRpcSpec)
  }
})

test("BridgeRpc.layer binds handlers to a RpcGroup descriptor", async () => {
  const ProjectRpcs = BridgeRpc.group("Test.Layered", { call: validMethodSpec() }, {})
  const layer = BridgeRpc.layer(ProjectRpcs)({
    call: (input) => Effect.succeed(input.toUpperCase())
  })

  expect(layer.group).toBe(ProjectRpcs)
  expect(await Effect.runPromise(layer.handlers.call("request"))).toBe("REQUEST")
  expect(Object.isFrozen(layer)).toBe(true)
  expect(Object.isFrozen(layer.handlers)).toBe(true)
})

test("BridgeRpc.layer rejects missing handlers", () => {
  const ProjectRpcs = BridgeRpc.group("Test.MissingHandler", { call: validMethodSpec() }, {})

  expect(() => BridgeRpc.layer(ProjectRpcs)({} as never)).toThrow(InvalidBridgeRpcSpec)
  expect(() => BridgeRpc.layer(ProjectRpcs)({ call: "not callable" } as never)).toThrow(
    InvalidBridgeRpcSpec
  )
})

test("BridgeRpc.layer accepts prototype handlers", async () => {
  const ProjectRpcs = BridgeRpc.group("Test.PrototypeHandler", { call: validMethodSpec() }, {})
  class Handlers {
    call(input: string): Effect.Effect<string, never, never> {
      return Effect.succeed(input.toUpperCase())
    }
  }
  const layer = BridgeRpc.layer(ProjectRpcs)(new Handlers())

  expect(await Effect.runPromise(layer.handlers.call("request"))).toBe("REQUEST")
})

test("BridgeRpc.group carries endpoint, capability, support, stream, and event metadata", () => {
  const NotesRpcs = BridgeRpc.group(
    "Test.Metadata",
    {
      list: {
        input: Schema.Void,
        output: Schema.Array(Schema.String),
        error: Schema.Never,
        cachedResultMs: 1_000,
        idempotent: true
      },
      open: {
        input: Schema.Struct({ id: Schema.String }),
        output: Schema.Struct({ ok: Schema.Boolean }),
        error: Schema.Never,
        permission: "notes:open",
        support: {
          status: "unsupported",
          reason: "host adapter does not implement open yet"
        }
      },
      watch: {
        input: Schema.Void,
        output: BridgeRpc.Stream(Schema.String, Schema.Never),
        error: Schema.Never
      }
    },
    {
      changed: {
        payload: Schema.Struct({ id: Schema.String })
      }
    }
  )

  expect(Array.from(NotesRpcs.requests.keys()).sort()).toEqual([
    "Test.Metadata.events.changed",
    "Test.Metadata.list",
    "Test.Metadata.open",
    "Test.Metadata.watch"
  ])
  expect(rpcEndpointKind(request(NotesRpcs, "Test.Metadata.list"))).toBe("query")
  expect(rpcEndpointKind(request(NotesRpcs, "Test.Metadata.open"))).toBe("mutation")
  expect(
    Option.match(rpcCapability(request(NotesRpcs, "Test.Metadata.open")), {
      onNone: () => undefined,
      onSome: (capability) => capability
    })
  ).toEqual({ kind: "notes:open" })
  expect(rpcSupport(request(NotesRpcs, "Test.Metadata.open"))).toEqual({
    status: "unsupported",
    reason: "host adapter does not implement open yet"
  })
  expect(Object.isFrozen(NotesRpcs.spec.open.support)).toBe(true)
  expect(RpcSchema.isStreamSchema(successSchema(request(NotesRpcs, "Test.Metadata.watch")))).toBe(
    true
  )
  expect(
    RpcSchema.isStreamSchema(successSchema(request(NotesRpcs, "Test.Metadata.events.changed")))
  ).toBe(true)
})

test("BridgeRpc.fromGroup derives bridge runtime metadata from RpcGroup contracts", () => {
  const List = Rpc.make("Test.FromGroup.list", {
    success: Schema.Array(Schema.String)
  }).pipe(RpcEndpoint.query)
  const Open = Rpc.make("Test.FromGroup.open", {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: Schema.Never
  }).pipe(
    RpcCapability({ kind: "notes:open" }),
    RpcSupport.unsupported("host adapter does not implement open yet")
  )
  const Watch = Rpc.make("Test.FromGroup.watch", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  })
  const Process = Rpc.make("Test.FromGroup.process", {
    payload: Schema.Struct({ path: Schema.String }),
    success: Schema.Struct({
      kind: Schema.Literal("process"),
      id: Schema.NonEmptyString,
      generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      ownerScope: Schema.NonEmptyString,
      state: Schema.Literal("running")
    }),
    error: Schema.Never
  })
  const NotesRpcs = BridgeRpc.fromGroup(
    "Test.FromGroup",
    RpcGroup.make(List, Open, Watch, Process),
    {}
  )

  expect(Array.from(NotesRpcs.requests.keys()).sort()).toEqual([
    "Test.FromGroup.list",
    "Test.FromGroup.open",
    "Test.FromGroup.process",
    "Test.FromGroup.watch"
  ])
  expect(Object.keys(NotesRpcs.spec).sort()).toEqual(["list", "open", "process", "watch"])
  expect(NotesRpcs.spec["open"]?.permission).toBe("notes:open")
  expect(NotesRpcs.spec["process"]?.output).toBe(
    successSchema(request(NotesRpcs, "Test.FromGroup.process"))
  )
  expect(NotesRpcs.spec["open"]?.support).toEqual({
    status: "unsupported",
    reason: "host adapter does not implement open yet"
  })
  expect(rpcEndpointKind(request(NotesRpcs, "Test.FromGroup.list"))).toBe("query")
  expect(RpcSchema.isStreamSchema(successSchema(request(NotesRpcs, "Test.FromGroup.watch")))).toBe(
    true
  )
})

test("BridgeRpc.fromGroup rejects RpcGroups with mismatched tags", () => {
  const Other = Rpc.make("Other.list", {
    success: Schema.Array(Schema.String)
  })

  expect(() => BridgeRpc.fromGroup("Test.FromGroup", RpcGroup.make(Other), {})).toThrow(
    InvalidBridgeRpcSpec
  )
})

test("BridgeRpc.fromGroup validates annotation-derived bridge metadata", () => {
  const EmptyCapability = Rpc.make("Test.FromGroup.open", {
    success: Schema.String
  }).pipe(RpcCapability({ kind: "" }))
  const EmptySupportReason = Rpc.make("Test.FromGroup.unsupported", {
    success: Schema.String
  }).pipe(RpcSupport.unsupported(""))

  expect(() => BridgeRpc.fromGroup("Test.FromGroup", RpcGroup.make(EmptyCapability), {})).toThrow(
    InvalidBridgeRpcSpec
  )
  expect(() =>
    BridgeRpc.fromGroup("Test.FromGroup", RpcGroup.make(EmptySupportReason), {})
  ).toThrow(InvalidBridgeRpcSpec)
})

const validMethodSpec = () => ({
  input: Schema.String,
  output: Schema.String,
  error: Schema.Never
})

interface RpcWithSuccessSchema extends Rpc.Any {
  readonly successSchema: Schema.Top
}

const request = (group: RpcGroup.RpcGroup<Rpc.Any>, tag: string): Rpc.Any => {
  const rpc = group.requests.get(tag)

  expect(rpc, tag).toBeDefined()
  if (rpc === undefined) {
    throw new Error(`missing rpc ${tag}`)
  }

  return rpc
}

const successSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSuccessSchema).successSchema
