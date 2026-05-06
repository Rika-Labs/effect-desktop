import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Schema } from "effect"

import {
  Api,
  type ApiContractClass,
  type ApiHandlers,
  type ApiLayer,
  type ApiClientResponse,
  type ApiResourceHandle,
  type ApiResourceSpec,
  Client,
  Handlers,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolRequestEnvelope,
  RendererOriginAuth,
  makeHostProtocolInvalidOutputError,
  makeStaleHandleError,
  type HostProtocolError,
  type ApiClientExchange
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

test("Client generates a typed namespace from contract entries", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const ProjectApi = makeProjectApi("ProjectApi.ClientTest")
  const client = Client({ project: ProjectApi }, responseExchange(requests, { id: "project-1" }), {
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
      method: "ProjectApi.ClientTest.open",
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
  const ProjectApi = makeProjectApi("ProjectApi.InvalidInput")
  const client = Client({ project: ProjectApi }, responseExchange(requests, { id: "project-1" }))

  const exit = await Effect.runPromiseExit(
    client.project.open({ path: 123 } as unknown as ProjectOpenInput)
  )

  expectFailureTag(exit, "InvalidArgument")
  expect(requests).toEqual([])
})

test("Client allows zero-argument calls for void-input methods", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const VoidApi = makeVoidApi("ProjectApi.VoidInput")
  const client = Client({ project: VoidApi }, responseExchange(requests, { id: "project-1" }), {
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
      method: "ProjectApi.VoidInput.open",
      timestamp: 42,
      traceId: "trace-void-input"
    })
  ])
})

test("Client encodes typed input before sending request payloads", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const EncodedInputApi = makeEncodedInputApi("ProjectApi.EncodedInput")
  const client = Client(
    { project: EncodedInputApi },
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
      method: "ProjectApi.EncodedInput.open",
      timestamp: 42,
      traceId: "trace-encoded-input",
      payload: "42"
    })
  ])
})

test("Client decodes malformed output as a typed Effect failure", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.InvalidOutput")
  const client = Client({ project: ProjectApi }, responseExchange([], { id: 123 }))

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Client decodes contract error responses as typed Effect failures", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.ResponseError")
  const client = Client(
    { project: ProjectApi },
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
  const ProjectApi = makeProjectApi("ProjectApi.MalformedError")
  const client = Client(
    { project: ProjectApi },
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

test("Client propagates exchange failures", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.ExchangeError")
  const client = Client(
    { project: ProjectApi },
    failingExchange(makeHostProtocolInvalidOutputError("ProjectApi.ExchangeError.open", "bad"))
  )

  const exit = await Effect.runPromiseExit(
    client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Client decodes resource outputs into disposable renderer proxies", async () => {
  const ProcessApi = makeProcessApi("ProjectApi.ResourceProxy")
  const disposed: ApiResourceHandle[] = []
  const handle = {
    kind: "process",
    id: "process-1",
    generation: 0,
    ownerScope: "window-1",
    state: "running"
  } as const
  const client = Client(
    { process: ProcessApi },
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

test("Client resource proxies return stale-handle disposal failures as values", async () => {
  const ProcessApi = makeProcessApi("ProjectApi.ResourceProxyStale")
  const handle = {
    kind: "process",
    id: "process-stale",
    generation: 0,
    ownerScope: "window-1",
    state: "running"
  } as const
  const client = Client(
    { process: ProcessApi },
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

test("Client abort signals propagate as typed bridge cancellation", async () => {
  const ProcessApi = makeProjectApi("ProjectApi.ClientCancel")
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
    ProcessApi.layer({
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
    { project: ProcessApi },
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

test("Client pre-aborted signals fail typed without dispatching requests", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.ClientPreCancel")
  const requests: HostProtocolRequestEnvelope[] = []
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const controller = new AbortController()
  controller.abort()
  const client = Client(
    { project: ProjectApi },
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

type ProjectApiSpec = {
  readonly open: {
    readonly input: typeof ProjectOpenInput
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

type ProcessApiSpec = {
  readonly spawn: {
    readonly input: typeof Schema.Void
    readonly output: ApiResourceSpec<"process", "running">
    readonly error: typeof ProjectOpenError
  }
}

const makeProcessApi = <Tag extends string>(tag: Tag): ApiContractClass<Tag, ProcessApiSpec> => {
  const contract = class {
    static readonly tag = tag
    static readonly spec = Object.freeze({
      spawn: Object.freeze({
        input: Schema.Void,
        output: Api.Resource("process", "running"),
        error: ProjectOpenError
      })
    })
    static readonly events = Object.freeze({})

    static layer<Handlers extends ApiHandlers<ProcessApiSpec>>(
      handlers: Handlers
    ): ApiLayer<Tag, ProcessApiSpec, Handlers> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<Tag, ProcessApiSpec>

  return Object.freeze(contract)
}

const makeProjectApi = <Tag extends string>(tag: Tag): ApiContractClass<Tag, ProjectApiSpec> => {
  const contract = class {
    static readonly tag = tag
    static readonly spec = Object.freeze({
      open: Object.freeze({
        input: ProjectOpenInput,
        output: ProjectOpenOutput,
        error: ProjectOpenError
      })
    })
    static readonly events = Object.freeze({})

    static layer<Handlers extends ApiHandlers<ProjectApiSpec>>(
      handlers: Handlers
    ): ApiLayer<Tag, ProjectApiSpec, Handlers> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<Tag, ProjectApiSpec>

  return Object.freeze(contract)
}

type VoidApiSpec = {
  readonly open: {
    readonly input: typeof Schema.Void
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

const makeVoidApi = <Tag extends string>(tag: Tag): ApiContractClass<Tag, VoidApiSpec> => {
  const contract = class {
    static readonly tag = tag
    static readonly spec = Object.freeze({
      open: Object.freeze({
        input: Schema.Void,
        output: ProjectOpenOutput,
        error: ProjectOpenError
      })
    })
    static readonly events = Object.freeze({})

    static layer<Handlers extends ApiHandlers<VoidApiSpec>>(
      handlers: Handlers
    ): ApiLayer<Tag, VoidApiSpec, Handlers> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<Tag, VoidApiSpec>

  return Object.freeze(contract)
}

type EncodedInputApiSpec = {
  readonly open: {
    readonly input: typeof Schema.NumberFromString
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

const makeEncodedInputApi = <Tag extends string>(
  tag: Tag
): ApiContractClass<Tag, EncodedInputApiSpec> => {
  const contract = class {
    static readonly tag = tag
    static readonly spec = Object.freeze({
      open: Object.freeze({
        input: Schema.NumberFromString,
        output: ProjectOpenOutput,
        error: ProjectOpenError
      })
    })
    static readonly events = Object.freeze({})

    static layer<Handlers extends ApiHandlers<EncodedInputApiSpec>>(
      handlers: Handlers
    ): ApiLayer<Tag, EncodedInputApiSpec, Handlers> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<Tag, EncodedInputApiSpec>

  return Object.freeze(contract)
}

const responseExchange = (
  requests: HostProtocolRequestEnvelope[],
  response: unknown
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(
      isApiClientResponse(response)
        ? response
        : {
            kind: "success",
            payload: response
          }
    )
  }
})

const failingExchange = (error: HostProtocolError): ApiClientExchange => ({
  request: () => Effect.fail(error)
})

const isApiClientResponse = (value: unknown): value is ApiClientResponse => {
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
