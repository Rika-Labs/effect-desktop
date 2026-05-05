import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"

import {
  type ApiContractClass,
  type ApiHandlers,
  type ApiLayer,
  type ApiClientResponse,
  Client,
  HostProtocolRequestEnvelope,
  makeHostProtocolInvalidOutputError,
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

type ProjectApiSpec = {
  readonly open: {
    readonly input: typeof ProjectOpenInput
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
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
