import { expect, test } from "bun:test"
import { Effect, Option, Schema, Stream } from "effect"

import * as bridge from "./index.js"
import {
  BridgeRuntime,
  Client,
  HostProtocolRequestEnvelope,
  InvalidBridgeMetadataError,
  Rpc,
  RpcCapability,
  RpcEndpoint,
  RpcGroup,
  RpcSchema,
  RpcSupport,
  bridgeContractFromRpcGroup,
  makeHostProtocolInvalidOutputError,
  rpcCapability,
  rpcEndpointKind,
  rpcSupport,
  type HostProtocolError
} from "./index.js"

test("bridge package no longer exports legacy bridge authoring DSL", () => {
  expect(`Bridge${"Rpc"}` in bridge).toBe(false)
  expect(`makeBridge${"Rpc"}Group` in bridge).toBe(false)
  expect("Handlers" in bridge).toBe(false)
  expect("Streams" in bridge).toBe(false)
  expect("makeBridgeHandlerLayer" in bridge).toBe(false)
})

test("bridgeContractFromRpcGroup lowers a frozen Effect RpcGroup contract", () => {
  const Open = Rpc.make("Test.Project.open", {
    payload: Schema.Struct({ path: Schema.String }),
    success: Schema.Struct({ id: Schema.String }),
    error: Schema.Never
  }).pipe(
    RpcEndpoint.query,
    RpcCapability({ kind: "project:open" }),
    BridgeRuntime({
      timeoutMs: 30_000,
      cachedResultMs: 60_000,
      cancellable: true,
      backpressure: { strategy: "buffer", size: 128, overflow: "dropOldest" }
    })
  )
  const ProjectRpcs = bridgeContractFromRpcGroup("Test.Project", RpcGroup.make(Open))

  expect(ProjectRpcs.tag).toBe("Test.Project")
  expect(Object.isFrozen(ProjectRpcs)).toBe(true)
  expect(Object.isFrozen(ProjectRpcs.spec)).toBe(true)
  expect(Array.from(ProjectRpcs.requests.keys())).toEqual(["Test.Project.open"])
  expect(ProjectRpcs.spec["open"]?.permission).toBe("project:open")
  expect(ProjectRpcs.spec["open"]?.timeoutMs).toBe(30_000)
  expect(ProjectRpcs.spec["open"]?.cachedResultMs).toBe(60_000)
  expect(ProjectRpcs.spec["open"]?.cancellable).toBe(true)
  expect(ProjectRpcs.spec["open"]?.backpressure).toEqual({
    strategy: "buffer",
    size: 128,
    overflow: "dropOldest"
  })
})

test("bridgeContractFromRpcGroup accepts schema classes and derives event specs", () => {
  class Project extends Schema.Class<Project>("Project")({
    id: Schema.String
  }) {}
  const EventPayload = Schema.Struct({ id: Schema.String })
  const Call = Rpc.make("Test.Events.call", {
    payload: Project,
    success: Project,
    error: Schema.Never
  })
  const Changed = Rpc.make("Test.Events.events.changed", {
    success: EventPayload,
    error: Schema.Never,
    stream: true
  }).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 16 } }))
  const ProjectRpcs = bridgeContractFromRpcGroup("Test.Events", RpcGroup.make(Call, Changed))

  expect(ProjectRpcs.spec["call"]?.input).toBe(Project)
  expect(ProjectRpcs.spec["call"]?.output).toBe(Project)
  expect(Object.isFrozen(ProjectRpcs.events["changed"])).toBe(true)

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

test("bridge metadata validation rejects invalid RpcGroup lowering inputs", () => {
  const Valid = Rpc.make("Test.Valid.call", {
    payload: Schema.String,
    success: Schema.String,
    error: Schema.Never
  })

  expect(() => bridgeContractFromRpcGroup("", RpcGroup.make(Valid))).toThrow(
    InvalidBridgeMetadataError
  )
  expect(() => bridgeContractFromRpcGroup(" ", RpcGroup.make(Valid))).toThrow(
    InvalidBridgeMetadataError
  )
  expect(() => bridgeContractFromRpcGroup("Bad\nTag", RpcGroup.make(Valid))).toThrow(
    InvalidBridgeMetadataError
  )
  expect(() =>
    bridgeContractFromRpcGroup(
      "Test.Valid",
      RpcGroup.make(Rpc.make("Other.call", { success: Schema.String }))
    )
  ).toThrow(InvalidBridgeMetadataError)
  expect(() =>
    bridgeContractFromRpcGroup(
      "Test.Valid",
      RpcGroup.make(Rpc.make("Test.Valid.events.bad.event", { success: Schema.String }))
    )
  ).toThrow(InvalidBridgeMetadataError)
  expect(() =>
    bridgeContractFromRpcGroup(
      "Test.Valid",
      RpcGroup.make(
        Rpc.make("Test.Valid.events.changed", {
          success: Schema.String,
          error: Schema.Never,
          stream: true
        }).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1.5 } }))
      )
    )
  ).toThrow(InvalidBridgeMetadataError)
  expect(() =>
    bridgeContractFromRpcGroup(
      "Test.Valid",
      RpcGroup.make(
        Rpc.make("Test.Valid.events.changed", {
          success: Schema.String,
          error: Schema.Never,
          stream: true
        }).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 0 } }))
      )
    )
  ).toThrow(InvalidBridgeMetadataError)
  expect(() =>
    bridgeContractFromRpcGroup(
      "Test.Valid",
      RpcGroup.make(
        Rpc.make("Test.Valid.events.changed", {
          success: Schema.String,
          error: Schema.Never,
          stream: true
        }).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1, overflow: "error" } }))
      )
    )
  ).toThrow(InvalidBridgeMetadataError)
})

test("bridge metadata validation rejects invalid annotations", () => {
  const EmptyCapability = Rpc.make("Test.FromGroup.open", {
    success: Schema.String
  }).pipe(RpcCapability({ kind: "" }))
  const EmptySupportReason = Rpc.make("Test.FromGroup.unsupported", {
    success: Schema.String
  }).pipe(RpcSupport.unsupported(""))
  const InvalidStreamBackpressure = Rpc.make("Test.FromGroup.watch", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  }).pipe(BridgeRuntime({ backpressure: { strategy: "buffer", size: 1.5 } }))
  const ZeroStreamBackpressure = Rpc.make("Test.FromGroup.watch", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  }).pipe(BridgeRuntime({ backpressure: { strategy: "buffer", size: 0, overflow: "error" } }))

  expect(() =>
    bridgeContractFromRpcGroup("Test.FromGroup", RpcGroup.make(EmptyCapability))
  ).toThrow(InvalidBridgeMetadataError)
  expect(() =>
    bridgeContractFromRpcGroup("Test.FromGroup", RpcGroup.make(EmptySupportReason))
  ).toThrow(InvalidBridgeMetadataError)
  expect(() =>
    bridgeContractFromRpcGroup("Test.FromGroup", RpcGroup.make(InvalidStreamBackpressure))
  ).toThrow(InvalidBridgeMetadataError)
  expect(() =>
    bridgeContractFromRpcGroup("Test.FromGroup", RpcGroup.make(ZeroStreamBackpressure))
  ).toThrow(InvalidBridgeMetadataError)
})

test("canonical RpcGroup carries endpoint, capability, support, stream, and event metadata", () => {
  const List = Rpc.make("Test.Metadata.list", {
    success: Schema.Array(Schema.String)
  }).pipe(RpcEndpoint.query, BridgeRuntime({ cachedResultMs: 1_000 }))
  const Open = Rpc.make("Test.Metadata.open", {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: Schema.Never
  }).pipe(
    RpcCapability({ kind: "notes:open" }),
    RpcSupport.unsupported("host adapter does not implement open yet")
  )
  const Watch = Rpc.make("Test.Metadata.watch", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  })
  const Changed = Rpc.make("Test.Metadata.events.changed", {
    success: Schema.Struct({ id: Schema.String }),
    error: Schema.Never,
    stream: true
  })
  const NotesRpcs = bridgeContractFromRpcGroup(
    "Test.Metadata",
    RpcGroup.make(List, Open, Watch, Changed)
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
  expect(Object.isFrozen(NotesRpcs.spec["open"]?.support)).toBe(true)
  expect(RpcSchema.isStreamSchema(successSchema(request(NotesRpcs, "Test.Metadata.watch")))).toBe(
    true
  )
  expect(
    RpcSchema.isStreamSchema(successSchema(request(NotesRpcs, "Test.Metadata.events.changed")))
  ).toBe(true)
})

test("bridgeContractFromRpcGroup requires pure Rpc schemas", () => {
  type DecodeService = { readonly _tag: "DecodeService" }
  const ServicefulPayload = Schema.String as Schema.Codec<string, string, DecodeService, never>
  const ServicefulRpc = Rpc.make("Test.FromGroup.serviceful", {
    payload: ServicefulPayload,
    success: Schema.String
  })

  const compileOnly = () => {
    // @ts-expect-error bridge runtimes cannot provide schema services while decoding host payloads
    bridgeContractFromRpcGroup("Test.FromGroup", RpcGroup.make(ServicefulRpc))
  }

  expect(compileOnly).toBeFunction()
  expect(ServicefulRpc._tag).toBe("Test.FromGroup.serviceful")
})

interface RpcWithSuccessSchema extends Rpc.Any {
  readonly successSchema: Schema.Top
}

const request = (
  group: { readonly requests: ReadonlyMap<string, Rpc.AnyWithProps> },
  tag: string
): Rpc.AnyWithProps => {
  const rpc = group.requests.get(tag)

  expect(rpc, tag).toBeDefined()
  if (rpc === undefined) {
    throw new Error(`missing rpc ${tag}`)
  }

  return rpc
}

const successSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSuccessSchema).successSchema
