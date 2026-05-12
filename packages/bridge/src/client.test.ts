import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Layer, Option, Schema } from "effect"

import {
  BridgeRpc,
  type BridgeRpcGroup,
  type BridgeClientResponse,
  type BridgeResourceHandle,
  type BridgeRpcResourceSpec,
  Client,
  Handlers,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolRequestEnvelope,
  RendererOriginAuth,
  Rpc,
  RpcClient,
  RpcGroup,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  makeHostProtocolInvalidOutputError,
  makeStaleHandleError,
  type HostProtocolError,
  type BridgeClientExchange
} from "./index.js"

class ProjectOpenInput extends Schema.Class<ProjectOpenInput>("ProjectOpenInput")({
  path: Schema.String
}) {}

class ProjectOpenOutput extends Schema.Class<ProjectOpenOutput>("ProjectOpenOutput")({
  id: Schema.String
}) {}

class ProjectOpenError extends Schema.Class<ProjectOpenError>("ProjectOpenError")({
  tag: Schema.Literal("ProjectOpenError"),
  message: Schema.String
}) {}

test("makeUnaryDesktopTransportFromBridgeClientExchange adapts unary bridge exchange to Effect RpcClient protocol", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const Open = Rpc.make("ProjectRpcs.Transport.open", {
    payload: ProjectOpenInput,
    success: ProjectOpenOutput,
    error: ProjectOpenError
  })
  const ProjectRpcs = RpcGroup.make(Open)
  const transport = await Effect.runPromise(
    makeUnaryDesktopTransportFromBridgeClientExchange(
      responseExchange(requests, { id: "project-1" }),
      {
        now: () => 41,
        nextTraceId: () => "trace-transport"
      }
    )
  )
  const protocolLayer = Layer.effect(RpcClient.Protocol)(
    makeDesktopClientProtocol(transport, { now: () => 42, nextTraceId: () => "trace-rpc" })
  )

  const output = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(ProjectRpcs)
        return yield* client["ProjectRpcs.Transport.open"](
          new ProjectOpenInput({ path: "/tmp/project" })
        )
      }).pipe(Effect.provide(protocolLayer))
    )
  )

  expect(output).toEqual(new ProjectOpenOutput({ id: "project-1" }))
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({
    kind: "request",
    method: "ProjectRpcs.Transport.open",
    timestamp: 42,
    payload: { path: "/tmp/project" }
  })
  expect(requests[0]?.traceId).toBeString()
})

test("Client generates a typed namespace from contract entries", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientTest")
  const client = Client({ project: ProjectRpcs }, responseExchange(requests, { id: "project-1" }), {
    nextRequestId: () => "request-project-open",
    nextTraceId: () => "trace-project-open",
    now: () => 42,
    windowId: "window-1",
    originToken: "origin-1"
  })

  const effect: Effect.Effect<ProjectOpenOutput, ProjectOpenError | HostProtocolError, never> =
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  const output = await Effect.runPromise(effect)

  expect(output.id).toBe("project-1")
  expect(requests).toEqual([
    new HostProtocolRequestEnvelope({
      kind: "request",
      id: "request-project-open",
      method: "ProjectRpcs.ClientTest.open",
      timestamp: 42,
      traceId: "trace-project-open",
      windowId: "window-1",
      originToken: "origin-1",
      payload: new ProjectOpenInput({ path: "/tmp/project" })
    })
  ])
  expect(Object.isFrozen(client)).toBe(true)
  expect(Object.isFrozen(client.project)).toBe(true)
})

test("Client rejects malformed input as a typed Effect failure before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.InvalidInput")
  const client = Client({ project: ProjectRpcs }, responseExchange(requests, { id: "project-1" }))

  const exit = await Effect.runPromiseExit(
    client.project.open({ path: 123 } as unknown as ProjectOpenInput)
  )

  expectFailureTag(exit, "InvalidArgument")
  expect(requests).toEqual([])
})

test("Client rejects invalid generated timestamps as typed Effect failures before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.InvalidTimestamp")
  const client = Client({ project: ProjectRpcs }, responseExchange(requests, { id: "project-1" }), {
    now: () => Number.NaN
  })

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidArgument")
  expectFailureField(exit, "field", "timestamp")
  expect(requests).toEqual([])
})

test("Client rejects empty generated request IDs before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EmptyRequestId")
  const client = Client({ project: ProjectRpcs }, responseExchange(requests, { id: "project-1" }), {
    nextRequestId: () => ""
  })

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidArgument")
  expectFailureField(exit, "field", "id")
  expect(requests).toEqual([])
})

test("Client rejects empty generated trace IDs as typed Effect failures before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EmptyTrace")
  const client = Client({ project: ProjectRpcs }, responseExchange(requests, { id: "project-1" }), {
    nextTraceId: () => ""
  })

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidArgument")
  expectFailureField(exit, "field", "traceId")
  expect(requests).toEqual([])
})

test("Client rejects empty renderer origin fields as typed Effect failures before transport", async () => {
  const cases: ReadonlyArray<{
    readonly field: "windowId" | "originToken"
    readonly options: { readonly windowId?: string; readonly originToken?: string }
  }> = [
    { field: "windowId", options: { windowId: "" } },
    { field: "originToken", options: { originToken: "" } }
  ]

  for (const { field, options } of cases) {
    const requests: HostProtocolRequestEnvelope[] = []
    const ProjectRpcs = makeProjectRpcs(`ProjectRpcs.Empty${field}`)
    const client = Client(
      { project: ProjectRpcs },
      responseExchange(requests, { id: "project-1" }),
      options
    )

    const exit = await Effect.runPromiseExit(
      client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
    )

    expectFailureTag(exit, "InvalidArgument")
    expectFailureField(exit, "field", field)
    expect(requests).toEqual([])
  }
})

test("Client allows zero-argument calls for void-input methods", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const VoidRpcs = makeVoidRpcs("ProjectRpcs.VoidInput")
  const client = Client({ project: VoidRpcs }, responseExchange(requests, { id: "project-1" }), {
    nextRequestId: () => "request-void-input",
    nextTraceId: () => "trace-void-input",
    now: () => 42
  })

  const output = await Effect.runPromise(client.project.open())

  expect(output.id).toBe("project-1")
  expect(requests).toEqual([
    new HostProtocolRequestEnvelope({
      kind: "request",
      id: "request-void-input",
      method: "ProjectRpcs.VoidInput.open",
      timestamp: 42,
      traceId: "trace-void-input"
    })
  ])
})

test("Client encodes typed input before sending request payloads", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const EncodedInputRpcs = makeEncodedInputRpcs("ProjectRpcs.EncodedInput")
  const client = Client(
    { project: EncodedInputRpcs },
    responseExchange(requests, { id: "project-1" }),
    {
      nextRequestId: () => "request-encoded-input",
      nextTraceId: () => "trace-encoded-input",
      now: () => 42
    }
  )

  const output = await Effect.runPromise(client.project.open(42))

  expect(output.id).toBe("project-1")
  expect(requests).toEqual([
    new HostProtocolRequestEnvelope({
      kind: "request",
      id: "request-encoded-input",
      method: "ProjectRpcs.EncodedInput.open",
      timestamp: 42,
      traceId: "trace-encoded-input",
      payload: "42"
    })
  ])
})

test("Client decodes malformed output as a typed Effect failure", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.InvalidOutput")
  const client = Client({ project: ProjectRpcs }, responseExchange([], { id: 123 }))

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Client decodes contract error responses as typed Effect failures", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ResponseError")
  const client = Client(
    { project: ProjectRpcs },
    responseExchange([], {
      kind: "failure",
      error: new ProjectOpenError({
        tag: "ProjectOpenError",
        message: "denied"
      })
    })
  )

  const effect: Effect.Effect<ProjectOpenOutput, ProjectOpenError | HostProtocolError, never> =
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  const exit = await Effect.runPromiseExit(effect)

  expectFailureTag(exit, "ProjectOpenError")
})

test("Client reports malformed contract error responses as InvalidOutput", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.MalformedError")
  const client = Client(
    { project: ProjectRpcs },
    responseExchange([], {
      kind: "failure",
      error: {
        tag: "ProjectOpenError"
      }
    })
  )

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Client rejects unknown response kinds as InvalidOutput", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.UnknownResponseKind")
  const client = Client(
    { project: ProjectRpcs },
    {
      request: () =>
        Effect.succeed({
          kind: "nonsense",
          payload: { id: "accepted" }
        } as never)
    }
  )

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Client propagates exchange failures", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ExchangeError")
  const client = Client(
    { project: ProjectRpcs },
    failingExchange(makeHostProtocolInvalidOutputError("ProjectRpcs.ExchangeError.open", "bad"))
  )

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Client decodes resource outputs into disposable renderer proxies", async () => {
  const ProcessRpcs = makeProcessRpcs("ProjectRpcs.ResourceProxy")
  const disposed: BridgeResourceHandle[] = []
  const handle = {
    kind: "process",
    id: "process-1",
    generation: 0,
    ownerScope: "window-1",
    state: "running"
  } as const
  const client = Client(
    { process: ProcessRpcs },
    {
      ...responseExchange([], handle),
      resource: {
        dispose: (resource) =>
          Effect.sync(() => {
            disposed.push(resource)
          })
      }
    }
  )

  const proxy = await Effect.runPromise(client.process.spawn())
  await Effect.runPromise(proxy.dispose())

  expect(proxy.kind).toBe("process")
  expect(proxy.state).toBe("running")
  expect(disposed).toEqual([handle])
})

test("Client rejects resource outputs with empty owner scopes", async () => {
  const ProcessRpcs = makeProcessRpcs("ProjectRpcs.ResourceProxyEmptyOwner")
  const client = Client(
    { process: ProcessRpcs },
    responseExchange([], {
      kind: "process",
      id: "process-empty-owner",
      generation: 0,
      ownerScope: "",
      state: "running"
    })
  )

  const exit = await Effect.runPromiseExit(client.process.spawn())

  expectFailureTag(exit, "InvalidOutput")
})

test("Client resource proxies return stale-handle disposal failures as values", async () => {
  const ProcessRpcs = makeProcessRpcs("ProjectRpcs.ResourceProxyStale")
  const handle = {
    kind: "process",
    id: "process-stale",
    generation: 0,
    ownerScope: "window-1",
    state: "running"
  } as const
  const client = Client(
    { process: ProcessRpcs },
    {
      ...responseExchange([], handle),
      resource: {
        dispose: (resource) => Effect.fail(makeStaleHandleError("Resource.dispose", resource, 1))
      }
    }
  )

  const proxy = await Effect.runPromise(client.process.spawn())
  const exit = await Effect.runPromiseExit(proxy.dispose())

  expectFailureTag(exit, "StaleHandle")
})

test("Client resource proxies dispose only once", async () => {
  const ProcessRpcs = makeProcessRpcs("ProjectRpcs.ResourceProxyIdempotent")
  const disposed: BridgeResourceHandle[] = []
  const handle = {
    kind: "process",
    id: "process-once",
    generation: 0,
    ownerScope: "window-1",
    state: "running"
  } as const
  const client = Client(
    { process: ProcessRpcs },
    {
      ...responseExchange([], handle),
      resource: {
        dispose: (resource) =>
          Effect.sync(() => {
            disposed.push(resource)
          })
      }
    }
  )

  const proxy = await Effect.runPromise(client.process.spawn())
  await Effect.runPromise(proxy.dispose())
  await Effect.runPromise(proxy.dispose())

  expect(disposed).toEqual([handle])
})

test("Client abort signals propagate as typed bridge cancellation", async () => {
  const ProcessRpcs = makeProjectRpcs("ProjectRpcs.ClientCancel")
  const started = await Effect.runPromise(Deferred.make<void>())
  const states: string[] = []
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.unsafeDisabledForTests,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProcessRpcs)({
      open: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Effect.sleep(10_000)
          return new ProjectOpenOutput({ id: "project-1" })
        })
    })
  )
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const controller = new AbortController()
  const client = Client(
    { project: ProcessRpcs },
    {
      request: runtime.dispatch,
      cancel: (request) =>
        Effect.gen(function* () {
          cancelRequests.push(request)
          yield* runtime.cancel(request)
        })
    },
    {
      nextRequestId: () => "request-client-cancel",
      nextTraceId: () => "trace-client-cancel",
      now: () => 42
    }
  )

  const exitPromise = Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }), {
      signal: controller.signal
    })
  )

  await Effect.runPromise(Deferred.await(started))
  controller.abort()
  const exit = await exitPromise

  expectFailureTag(exit, "Cancelled")
  expectFailureField(exit, "source", "renderer")
  expect(cancelRequests).toEqual([
    new HostProtocolCancelByRequestEnvelope({
      kind: "cancel",
      id: "request-client-cancel",
      timestamp: 42,
      traceId: "trace-client-cancel"
    })
  ])
  expect(states).toEqual(["Pending", "Authorized", "Running", "Canceled"])
})

test("Client abort signals release callers when the exchange does not answer", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientCancelNever")
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const controller = new AbortController()
  const client = Client(
    { project: ProjectRpcs },
    {
      request: () => Effect.never,
      cancel: (request) =>
        Effect.sync(() => {
          cancelRequests.push(request)
        })
    },
    {
      nextRequestId: () => "request-client-cancel-never",
      nextTraceId: () => "trace-client-cancel-never",
      now: () => 42
    }
  )

  const exitPromise = Effect.runPromise(
    client.project
      .open(new ProjectOpenInput({ path: "/tmp/project" }), { signal: controller.signal })
      .pipe(Effect.exit, Effect.timeoutOption("50 millis"))
  )

  controller.abort()
  const result = await exitPromise

  expect(Option.isSome(result)).toBe(true)
  if (Option.isSome(result)) {
    expectFailureTag(result.value, "Cancelled")
    expectFailureField(result.value, "source", "renderer")
  }
  expect(cancelRequests).toEqual([
    new HostProtocolCancelByRequestEnvelope({
      kind: "cancel",
      id: "request-client-cancel-never",
      timestamp: 42,
      traceId: "trace-client-cancel-never"
    })
  ])
})

test("Client abort ignores invalid cancel timestamps without throwing from listeners", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientCancelInvalidTimestamp")
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const controller = new AbortController()
  const timestamps = [42, Number.NaN]
  const client = Client(
    { project: ProjectRpcs },
    {
      request: () => Effect.never,
      cancel: (request) =>
        Effect.sync(() => {
          cancelRequests.push(request)
        })
    },
    {
      nextRequestId: () => "request-client-cancel-invalid-timestamp",
      nextTraceId: () => "trace-client-cancel-invalid-timestamp",
      now: () => timestamps.shift() ?? Number.NaN
    }
  )

  const exitPromise = Effect.runPromise(
    client.project
      .open(new ProjectOpenInput({ path: "/tmp/project" }), { signal: controller.signal })
      .pipe(Effect.exit, Effect.timeoutOption("50 millis"))
  )

  expect(() => controller.abort()).not.toThrow()
  const result = await exitPromise

  expect(Option.isSome(result)).toBe(true)
  if (Option.isSome(result)) {
    expectFailureTag(result.value, "Cancelled")
  }
  expect(cancelRequests).toEqual([])
})

test("Client pre-aborted signals fail typed without dispatching requests", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientPreCancel")
  const requests: HostProtocolRequestEnvelope[] = []
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const controller = new AbortController()
  controller.abort()
  const client = Client(
    { project: ProjectRpcs },
    {
      request: (request) => {
        requests.push(request)
        return Effect.succeed({
          kind: "success",
          payload: { id: "project-1" }
        })
      },
      cancel: (request) =>
        Effect.sync(() => {
          cancelRequests.push(request)
        })
    },
    {
      nextRequestId: () => "request-client-pre-cancel",
      nextTraceId: () => "trace-client-pre-cancel",
      now: () => 42
    }
  )

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }), {
      signal: controller.signal
    })
  )

  expectFailureTag(exit, "Cancelled")
  expectFailureField(exit, "source", "renderer")
  expect(requests).toEqual([])
  expect(cancelRequests).toEqual([])
})

type ProjectRpcSpec = {
  readonly open: {
    readonly input: typeof ProjectOpenInput
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

type ProcessRpcSpec = {
  readonly spawn: {
    readonly input: typeof Schema.Void
    readonly output: BridgeRpcResourceSpec<"process", "running">
    readonly error: typeof ProjectOpenError
  }
}

const makeProcessRpcs = <Tag extends string>(tag: Tag): BridgeRpcGroup<Tag, ProcessRpcSpec> => {
  const spec = Object.freeze({
    spawn: Object.freeze({
      input: Schema.Void,
      output: BridgeRpc.Resource("process", "running"),
      error: ProjectOpenError
    })
  })
  return BridgeRpc.group(tag, spec, Object.freeze({}))
}

const makeProjectRpcs = <Tag extends string>(tag: Tag): BridgeRpcGroup<Tag, ProjectRpcSpec> => {
  const spec = Object.freeze({
    open: Object.freeze({
      input: ProjectOpenInput,
      output: ProjectOpenOutput,
      error: ProjectOpenError
    })
  })
  return BridgeRpc.group(tag, spec, Object.freeze({}))
}

type VoidRpcSpec = {
  readonly open: {
    readonly input: typeof Schema.Void
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

const makeVoidRpcs = <Tag extends string>(tag: Tag): BridgeRpcGroup<Tag, VoidRpcSpec> => {
  const spec = Object.freeze({
    open: Object.freeze({
      input: Schema.Void,
      output: ProjectOpenOutput,
      error: ProjectOpenError
    })
  })
  return BridgeRpc.group(tag, spec, Object.freeze({}))
}

type EncodedInputRpcSpec = {
  readonly open: {
    readonly input: typeof Schema.NumberFromString
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

const makeEncodedInputRpcs = <Tag extends string>(
  tag: Tag
): BridgeRpcGroup<Tag, EncodedInputRpcSpec> => {
  const spec = Object.freeze({
    open: Object.freeze({
      input: Schema.NumberFromString,
      output: ProjectOpenOutput,
      error: ProjectOpenError
    })
  })
  return BridgeRpc.group(tag, spec, Object.freeze({}))
}

const responseExchange = (
  requests: HostProtocolRequestEnvelope[],
  response: unknown
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(
      isBridgeClientResponse(response)
        ? response
        : {
            kind: "success",
            payload: response
          }
    )
  }
})

const failingExchange = (error: HostProtocolError): BridgeClientExchange => ({
  request: () => Effect.fail(error)
})

const isBridgeClientResponse = (value: unknown): value is BridgeClientResponse => {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "success" || value.kind === "failure")
  )
}

const expectFailureTag = (exit: Exit.Exit<unknown, unknown>, tag: string): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)

    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect((fail.error as { readonly tag?: unknown }).tag).toBe(tag)
    }
  }
}

const expectFailureField = (
  exit: Exit.Exit<unknown, unknown>,
  field: string,
  value: unknown
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)

    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect((fail.error as Record<string, unknown>)[field]).toBe(value)
    }
  }
}
