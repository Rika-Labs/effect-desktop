import { expect, test } from "bun:test"
import { Cause, Context, Effect, Exit, Option, Schema, Stream } from "effect"

import {
  Api,
  ApiContractRegistryFrozen,
  Client,
  DuplicateApiContractTag,
  HostProtocolRequestEnvelope,
  InvalidApiContractSpec,
  Rpc,
  RpcGroup,
  RpcSchema,
  makeHostProtocolInvalidOutputError,
  rpcCapability,
  rpcEndpointKind,
  type ApiContractSpec,
  type HostProtocolError
} from "./index.js"

test("Api.Tag registers a frozen contract and exposes a stable snapshot", async () => {
  const ProjectApi = await Effect.runPromise(
    Api.Tag("Test.ProjectApi")<unknown>()({
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
    })
  )

  expect(ProjectApi.tag).toBe("Test.ProjectApi")
  expect(Object.isFrozen(ProjectApi.spec)).toBe(true)
  expect(
    Option.match(await Effect.runPromise(Api.get("Test.ProjectApi")), {
      onNone: () => false,
      onSome: (contract) => Object.isFrozen(contract)
    })
  ).toBe(true)
  expect((await Effect.runPromise(Api.entries())).map((entry) => entry.tag)).toContain(
    "Test.ProjectApi"
  )
})

test("Api.Tag accepts Effect schema classes", async () => {
  class Project extends Schema.Class<Project>("Project")({
    id: Schema.String
  }) {}

  const ClassSchemaApi = await Effect.runPromise(
    Api.Tag("Test.ClassSchemaApi")<unknown>()({
      call: {
        input: Project,
        output: Project,
        error: Schema.Never
      }
    })
  )

  expect(ClassSchemaApi.spec.call.input).toBe(Project)
  expect(ClassSchemaApi.spec.call.output).toBe(Project)
})

test("Api.Tag registers frozen event specs", async () => {
  const EventPayload = Schema.Struct({ id: Schema.String })
  const EventsApi = await Effect.runPromise(
    Api.Tag("Test.EventsApi")<unknown>()(
      {
        call: validMethodSpec()
      },
      {
        changed: {
          payload: EventPayload,
          backpressure: { strategy: "drop", size: 16 }
        }
      }
    )
  )

  expect(Object.isFrozen(EventsApi.events)).toBe(true)
  expect(Object.isFrozen(EventsApi.events["changed"])).toBe(true)
  expect(Object.isFrozen(EventsApi.events["changed"]?.backpressure)).toBe(true)

  const client = Client(
    { events: EventsApi },
    {
      request: (_request: HostProtocolRequestEnvelope) =>
        Effect.fail(makeHostProtocolInvalidOutputError("Test.EventsApi.call", "unused"))
    }
  )
  const stream: Stream.Stream<typeof EventPayload.Type, HostProtocolError, never> =
    client.events.events.changed

  expect(stream).toBeDefined()
})

test("Api.Tag rejects duplicate tags as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const FirstDuplicate = yield* Api.Tag("Test.Duplicate")<unknown>()({
        call: validMethodSpec()
      })

      expect(FirstDuplicate.tag).toBe("Test.Duplicate")

      return yield* Api.Tag("Test.Duplicate")<unknown>()({
        call: validMethodSpec()
      })
    })
  )

  expectFailure(exit, DuplicateApiContractTag)
})

test("Api.Tag rejects missing required schemas as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.Invalid")<unknown>()({
      call: {
        input: Schema.String,
        output: Schema.String
      }
    } as unknown as ApiContractSpec)
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects invalid timeout values as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.InvalidTimeout")<unknown>()({
      call: {
        ...validMethodSpec(),
        timeoutMs: -1
      }
    })
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects invalid permissions as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.InvalidPermission")<unknown>()({
      call: {
        ...validMethodSpec(),
        permission: { capability: "project:open" }
      }
    } as unknown as ApiContractSpec)
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects invalid cached result values as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.InvalidCachedResult")<unknown>()({
      call: {
        ...validMethodSpec(),
        cachedResultMs: Number.NaN
      }
    })
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects fractional timeoutMs as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.FractionalTimeout")<unknown>()({
      call: {
        ...validMethodSpec(),
        timeoutMs: 1.5
      }
    })
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects fractional cachedResultMs as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.FractionalCachedResult")<unknown>()({
      call: {
        ...validMethodSpec(),
        cachedResultMs: 2.5
      }
    })
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag accepts timeoutMs: 0 as the non-cancellable sentinel", async () => {
  const contract = await Effect.runPromise(
    Api.Tag("Test.ZeroTimeout")<unknown>()({
      call: {
        ...validMethodSpec(),
        timeoutMs: 0
      }
    })
  )

  expect(contract.spec.call.timeoutMs).toBe(0)
})

test("Api.Tag rejects invalid boolean flags as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.InvalidBooleanFlags")<unknown>()({
      call: {
        ...validMethodSpec(),
        idempotent: "false",
        cancellable: "true"
      }
    } as unknown as ApiContractSpec)
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects idempotent methods without cached result metadata", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.MissingCachedResult")<unknown>()({
      call: {
        ...validMethodSpec(),
        idempotent: true
      }
    })
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects invalid backpressure values as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.InvalidBackpressure")<unknown>()({
      call: {
        ...validMethodSpec(),
        backpressure: {
          strategy: "buffer",
          size: 1.5,
          overflow: "drop-oldest"
        }
      }
    } as unknown as ApiContractSpec)
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects invalid event specs as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.InvalidEvent")<unknown>()(
      {
        call: validMethodSpec()
      },
      {
        changed: {
          backpressure: { strategy: "drop", size: 16 }
        }
      } as unknown as Record<string, { readonly payload: typeof Schema.String }>
    )
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects events as a reserved method name", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.ReservedEventsMethod")<unknown>()({
      events: validMethodSpec()
    })
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("contract classes expose frozen layer descriptors", async () => {
  const LayeredApi = await Effect.runPromise(
    Api.Tag("Test.Layered")<unknown>()({
      call: validMethodSpec()
    })
  )

  const layer = LayeredApi.layer({
    call: (input) => Effect.succeed(input.toUpperCase())
  })

  expect(layer.contract).toBe(LayeredApi)
  expect(await Effect.runPromise(layer.handlers.call("request"))).toBe("REQUEST")
  expect(Object.isFrozen(layer)).toBe(true)
  expect(Object.isFrozen(layer.handlers)).toBe(true)
})

test("contract layer builder preserves prototype handler methods", async () => {
  const PrototypeLayerApi = await Effect.runPromise(
    Api.Tag("Test.PrototypeLayer")<unknown>()({
      call: validMethodSpec()
    })
  )
  class PrototypeHandlers {
    call(input: string): Effect.Effect<string, never, never> {
      return Effect.succeed(input.toUpperCase())
    }
  }

  const handlers = new PrototypeHandlers()
  const layer = PrototypeLayerApi.layer(handlers)

  expect(layer.handlers).toBe(handlers)
  expect(await Effect.runPromise(layer.handlers.call("request"))).toBe("REQUEST")
  expect(Object.isFrozen(layer.handlers)).toBe(true)
})

test("contract layer builder remains bound when destructured", async () => {
  const DestructuredLayerApi = await Effect.runPromise(
    Api.Tag("Test.DestructuredLayer")<unknown>()({
      call: validMethodSpec()
    })
  )
  const { layer } = DestructuredLayerApi

  const descriptor = layer({
    call: (input) => Effect.succeed(input)
  })

  expect(descriptor.contract).toBe(DestructuredLayerApi)
})

test("contract layer handlers can depend on an Effect environment", async () => {
  const Dependency = Context.Service<"Dependency", string>("Dependency")
  const DependentApi = await Effect.runPromise(
    Api.Tag("Test.DependentLayer")<unknown>()({
      call: validMethodSpec()
    })
  )

  const descriptor = DependentApi.layer({
    call: () => Effect.service(Dependency)
  })

  expect(descriptor.contract).toBe(DependentApi)
})

test("Api.Tag lowers methods, streams, permissions, and events into RpcGroup", async () => {
  const LegacyApi = await Effect.runPromise(
    Api.Tag("Test.LegacyRpcLowering")<unknown>()(
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
          permission: "notes:open"
        },
        watch: {
          input: Schema.Void,
          output: Api.Stream(Schema.String, Schema.Never),
          error: Schema.Never
        }
      },
      {
        changed: {
          payload: Schema.Struct({ id: Schema.String })
        }
      }
    )
  )
  const group = LegacyApi.toRpcGroup()

  expect(Array.from(group.requests.keys()).sort()).toEqual([
    "Test.LegacyRpcLowering.events.changed",
    "Test.LegacyRpcLowering.list",
    "Test.LegacyRpcLowering.open",
    "Test.LegacyRpcLowering.watch"
  ])
  expect(rpcEndpointKind(request(group, "Test.LegacyRpcLowering.list"))).toBe("query")
  expect(rpcEndpointKind(request(group, "Test.LegacyRpcLowering.open"))).toBe("mutation")
  expect(
    Option.match(rpcCapability(request(group, "Test.LegacyRpcLowering.open")), {
      onNone: () => undefined,
      onSome: (capability) => capability
    })
  ).toEqual({ kind: "notes:open" })
  expect(
    RpcSchema.isStreamSchema(successSchema(request(group, "Test.LegacyRpcLowering.watch")))
  ).toBe(true)
  expect(
    RpcSchema.isStreamSchema(successSchema(request(group, "Test.LegacyRpcLowering.events.changed")))
  ).toBe(true)
})

test("zz Api.freeze rejects later registrations as a typed Effect failure", async () => {
  await Effect.runPromise(Api.freeze())

  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.AfterFreeze")<unknown>()({
      call: validMethodSpec()
    })
  )

  expectFailure(exit, ApiContractRegistryFrozen)
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

const expectFailure = (
  exit: Exit.Exit<unknown, unknown>,
  expected: abstract new (...args: ReadonlyArray<never>) => unknown
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)

    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(fail.error).toBeInstanceOf(expected)
    }
  }
}
