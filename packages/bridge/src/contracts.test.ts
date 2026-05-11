import { expect, test } from "bun:test"
import { Effect, Option, Schema, Stream } from "effect"

import {
  BridgeRpc,
  Client,
  HostProtocolRequestEnvelope,
  InvalidBridgeRpcSpec,
  Rpc,
  RpcGroup,
  RpcSchema,
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
  for (const [index, output] of [
    BridgeRpc.Resource("", "running"),
    BridgeRpc.Resource("process", ""),
    BridgeRpc.Resource(" ", "running"),
    BridgeRpc.Resource("process", " ")
  ].entries()) {
    expect(() =>
      BridgeRpc.group(
        `Test.InvalidResource.${index}`,
        {
          call: {
            ...validMethodSpec(),
            output
          }
        },
        {}
      )
    ).toThrow(InvalidBridgeRpcSpec)
  }
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
