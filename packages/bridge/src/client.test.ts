import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"

import {
  type BridgeClientResponse,
  Client,
  Handlers,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolRequestEnvelope,
  RendererOriginAuth,
  Rpc,
  RpcClient,
  RpcGroup,
  bridgeContractFromRpcGroup,
  makeBridgeHandlerLayer,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  makeHostProtocolInvalidOutputError,
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

const ProcessHandle = Schema.Struct({
  kind: Schema.Literal("process"),
  id: Schema.NonEmptyString,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ownerScope: Schema.NonEmptyString,
  state: Schema.Literal("running")
})

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

test("Client decodes resource outputs through the method schema", async () => {
  const ProcessRpcs = makeProcessRpcs("ProjectRpcs.ResourceHandle")
  const handle = {
    kind: "process",
    id: "process-1",
    generation: 0,
    ownerScope: "window-1",
    state: "running"
  } as const
  const client = Client({ process: ProcessRpcs }, responseExchange([], handle))

  const decoded = await Effect.runPromise(client.process.spawn())

  expect(decoded).toEqual(handle)
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

test("Client interruption sends bridge cancellation", async () => {
  const ProcessRpcs = makeProjectRpcs("ProjectRpcs.ClientInterrupt")
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
    makeBridgeHandlerLayer(ProcessRpcs)({
      open: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Effect.sleep(10_000)
          return new ProjectOpenOutput({ id: "project-1" })
        })
    })
  )
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
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

  const fiber = Effect.runFork(client.project.open(new ProjectOpenInput({ path: "/tmp/project" })))

  await Effect.runPromise(Deferred.await(started))
  await Effect.runPromise(Fiber.interrupt(fiber))
  const exit = await Effect.runPromiseExit(Fiber.join(fiber))
  await waitFor(() => states.includes("Canceled"))

  expectInterrupted(exit)
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

test("Client runtime AbortSignal interruption sends bridge cancellation", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientRuntimeSignal")
  const started = await Effect.runPromise(Deferred.make<void>())
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const controller = new AbortController()
  const client = Client(
    { project: ProjectRpcs },
    {
      request: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
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

  const fiber = Effect.runFork(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" })),
    { signal: controller.signal }
  )

  await Effect.runPromise(Deferred.await(started))
  controller.abort()
  const exit = await Effect.runPromiseExit(Fiber.join(fiber))

  expectInterrupted(exit)
  expect(cancelRequests).toEqual([
    new HostProtocolCancelByRequestEnvelope({
      kind: "cancel",
      id: "request-client-cancel-never",
      timestamp: 42,
      traceId: "trace-client-cancel-never"
    })
  ])
})

test("Client interruption releases callers when the exchange does not answer", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientInterruptNever")
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const finalizers: string[] = []
  const client = Client(
    { project: ProjectRpcs },
    {
      request: () =>
        Effect.never.pipe(Effect.ensuring(Effect.sync(() => finalizers.push("request")))),
      cancel: (request) =>
        Effect.sync(() => {
          cancelRequests.push(request)
        })
    },
    {
      nextRequestId: () => "request-client-interrupt-never",
      nextTraceId: () => "trace-client-interrupt-never",
      now: () => 42
    }
  )

  const fiber = Effect.runFork(client.project.open(new ProjectOpenInput({ path: "/tmp/project" })))

  await Effect.runPromise(Fiber.interrupt(fiber))
  const result = await Effect.runPromise(
    Fiber.join(fiber).pipe(Effect.exit, Effect.timeoutOption("50 millis"))
  )

  expect(Option.isSome(result)).toBe(true)
  if (Option.isSome(result)) {
    expectInterrupted(result.value)
  }
  expect(cancelRequests).toEqual([
    new HostProtocolCancelByRequestEnvelope({
      kind: "cancel",
      id: "request-client-interrupt-never",
      timestamp: 42,
      traceId: "trace-client-interrupt-never"
    })
  ])
  await waitFor(() => finalizers.includes("request"))
})

test("Client interruption releases callers when cancel dispatch does not answer", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientInterruptCancelNever")
  const finalizers: string[] = []
  const client = Client(
    { project: ProjectRpcs },
    {
      request: () =>
        Effect.never.pipe(Effect.ensuring(Effect.sync(() => finalizers.push("request")))),
      cancel: () => Effect.never.pipe(Effect.ensuring(Effect.sync(() => finalizers.push("cancel"))))
    },
    {
      nextRequestId: () => "request-client-interrupt-cancel-never",
      nextTraceId: () => "trace-client-interrupt-cancel-never",
      now: () => 42
    }
  )

  const fiber = Effect.runFork(client.project.open(new ProjectOpenInput({ path: "/tmp/project" })))

  await Effect.runPromise(Fiber.interrupt(fiber))
  const result = await Effect.runPromise(
    Fiber.join(fiber).pipe(Effect.exit, Effect.timeoutOption("50 millis"))
  )

  expect(Option.isSome(result)).toBe(true)
  if (Option.isSome(result)) {
    expectInterrupted(result.value)
  }
  await waitFor(() => finalizers.includes("request"))
  await waitFor(() => finalizers.includes("cancel"))
})

test("Client interruption ignores invalid cancel timestamps without masking interruption", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientInterruptInvalidTimestamp")
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
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
      nextRequestId: () => "request-client-interrupt-invalid-timestamp",
      nextTraceId: () => "trace-client-interrupt-invalid-timestamp",
      now: () => timestamps.shift() ?? Number.NaN
    }
  )

  const fiber = Effect.runFork(client.project.open(new ProjectOpenInput({ path: "/tmp/project" })))

  await Effect.runPromise(Fiber.interrupt(fiber))
  const result = await Effect.runPromise(
    Fiber.join(fiber).pipe(Effect.exit, Effect.timeoutOption("50 millis"))
  )

  expect(Option.isSome(result)).toBe(true)
  if (Option.isSome(result)) {
    expectInterrupted(result.value)
  }
  expect(cancelRequests).toEqual([])
})

const makeProcessRpcs = <Tag extends string>(tag: Tag) => {
  const Spawn = Rpc.make(`${tag}.spawn`, {
    payload: Schema.Void,
    success: ProcessHandle,
    error: ProjectOpenError
  })
  return bridgeContractFromRpcGroup(tag, RpcGroup.make(Spawn))
}

const makeProjectRpcs = <Tag extends string>(tag: Tag) => {
  const Open = Rpc.make(`${tag}.open`, {
    payload: ProjectOpenInput,
    success: ProjectOpenOutput,
    error: ProjectOpenError
  })
  return bridgeContractFromRpcGroup(tag, RpcGroup.make(Open))
}

const makeVoidRpcs = <Tag extends string>(tag: Tag) => {
  const Open = Rpc.make(`${tag}.open`, {
    payload: Schema.Void,
    success: ProjectOpenOutput,
    error: ProjectOpenError
  })
  return bridgeContractFromRpcGroup(tag, RpcGroup.make(Open))
}

const makeEncodedInputRpcs = <Tag extends string>(tag: Tag) => {
  const Open = Rpc.make(`${tag}.open`, {
    payload: Schema.NumberFromString,
    success: ProjectOpenOutput,
    error: ProjectOpenError
  })
  return bridgeContractFromRpcGroup(tag, RpcGroup.make(Open))
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

const expectInterrupted = (exit: Exit.Exit<unknown, unknown>): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    expect(Cause.hasInterrupts(exit.cause)).toBe(true)
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

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  expect(predicate()).toBe(true)
}
