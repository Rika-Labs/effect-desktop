import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"

import {
  type ApiContractClass,
  type ApiHandlers,
  type ApiLayer,
  Handlers,
  HostProtocolRequestEnvelope,
  type HostProtocolError
} from "./index.js"

class ProjectOpenInput extends Schema.Class<ProjectOpenInput>("HandlerProjectOpenInput")({
  path: Schema.String
}) {}

class ProjectOpenOutput extends Schema.Class<ProjectOpenOutput>("HandlerProjectOpenOutput")({
  id: Schema.NumberFromString
}) {}

class ProjectOpenError extends Schema.Class<ProjectOpenError>("HandlerProjectOpenError")({
  tag: Schema.Literal("ProjectOpenError"),
  code: Schema.NumberFromString
}) {}

test("Handlers binds contract layers into a request dispatcher", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.HandlerSuccess")
  const runtime = Handlers(
    ProjectApi.layer({
      open: (input) =>
        Effect.succeed(
          new ProjectOpenOutput({
            id: input.path.length
          })
        )
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(
      request("ProjectApi.HandlerSuccess.open", {
        path: "/tmp/project"
      })
    )
  )

  expect(response).toEqual({
    kind: "success",
    payload: {
      id: "12"
    }
  })
})

test("Handlers emits the request lifecycle in order for successful calls", async () => {
  const states: string[] = []
  const ProjectApi = makeProjectApi("ProjectApi.HandlerLifecycle")
  const runtime = Handlers.withOptions(
    {
      now: () => 42,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    ProjectApi.layer({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectApi.HandlerLifecycle.open", { path: "/tmp/project" }))
  )

  expect(response.kind).toBe("success")
  expect(states).toEqual(["Pending", "Authorized", "Running", "Completed"])
})

test("Handlers preserves prototype handler receivers", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.PrototypeReceiver")

  class ProjectHandlers {
    readonly prefix = "project"

    open(input: ProjectOpenInput): Effect.Effect<ProjectOpenOutput, never, never> {
      return Effect.succeed(
        new ProjectOpenOutput({
          id: `${this.prefix}:${input.path}`.length
        })
      )
    }
  }

  const runtime = Handlers(ProjectApi.layer(new ProjectHandlers()))

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectApi.PrototypeReceiver.open", { path: "/tmp/project" }))
  )

  expect(response).toEqual({
    kind: "success",
    payload: {
      id: "20"
    }
  })
})

test("Handlers decodes transformed input payloads before calling handlers", async () => {
  const EncodedInputApi = makeEncodedInputApi("ProjectApi.HandlerEncodedInput")
  const runtime = Handlers(
    EncodedInputApi.layer({
      open: (input) =>
        Effect.succeed(
          new ProjectOpenOutput({
            id: input
          })
        )
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectApi.HandlerEncodedInput.open", "42"))
  )

  expect(response).toEqual({
    kind: "success",
    payload: {
      id: "42"
    }
  })
})

test("Handlers encodes contract failures into failure responses", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.HandlerFailure")
  const runtime = Handlers(
    ProjectApi.layer({
      open: () =>
        Effect.fail(
          new ProjectOpenError({
            tag: "ProjectOpenError",
            code: 403
          })
        )
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectApi.HandlerFailure.open", { path: "/tmp/project" }))
  )

  expect(response).toEqual({
    kind: "failure",
    error: {
      tag: "ProjectOpenError",
      code: "403"
    }
  })
})

test("Handlers rejects malformed input before calling handlers", async () => {
  const calls: string[] = []
  const states: string[] = []
  const ProjectApi = makeProjectApi("ProjectApi.HandlerInvalidInput")
  const runtime = Handlers.withOptions(
    {
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    ProjectApi.layer({
      open: (input) => {
        calls.push(input.path)
        return Effect.succeed(new ProjectOpenOutput({ id: 1 }))
      }
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectApi.HandlerInvalidInput.open", { path: 123 }))
  )

  expectFailureTag(exit, "InvalidArgument")
  expect(calls).toEqual([])
  expect(states).toEqual(["Pending", "Failed"])
})

test("Handlers reports malformed handler output as InvalidOutput", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.HandlerInvalidOutput")
  const runtime = Handlers(
    ProjectApi.layer({
      open: () =>
        Effect.succeed({
          id: Number.NaN
        } as unknown as ProjectOpenOutput)
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectApi.HandlerInvalidOutput.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Handlers reports malformed contract errors as InvalidOutput", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.HandlerInvalidError")
  const runtime = Handlers(
    ProjectApi.layer({
      open: () =>
        Effect.fail({
          tag: "ProjectOpenError",
          code: Number.NaN
        } as unknown as ProjectOpenError)
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectApi.HandlerInvalidError.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Handlers times out cancellable handlers and records a terminal state", async () => {
  const states: string[] = []
  const ProjectApi = makeProjectApi("ProjectApi.HandlerTimeout", { timeoutMs: 5 })
  const runtime = Handlers.withOptions(
    {
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    ProjectApi.layer({
      open: () =>
        Effect.gen(function* () {
          yield* Effect.sleep(50)
          return new ProjectOpenOutput({ id: 1 })
        })
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectApi.HandlerTimeout.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "Timeout")
  expect(states).toEqual(["Pending", "Authorized", "Running", "TimedOut"])
})

test("Handlers rejects duplicate request ids after a terminal state", async () => {
  const states: string[] = []
  const ProjectApi = makeProjectApi("ProjectApi.HandlerDuplicate")
  const runtime = Handlers.withOptions(
    {
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    ProjectApi.layer({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )
  const duplicate = new HostProtocolRequestEnvelope({
    kind: "request",
    id: "request-duplicate",
    method: "ProjectApi.HandlerDuplicate.open",
    timestamp: 42,
    traceId: "trace-duplicate",
    payload: { path: "/tmp/project" }
  })

  await Effect.runPromise(runtime.dispatch(duplicate))
  const exit = await Effect.runPromiseExit(runtime.dispatch(duplicate))

  expectFailureTag(exit, "InvalidState")
  expect(states).toEqual(["Pending", "Authorized", "Running", "Completed", "RejectedLateFrame"])
})

test("Handlers reports unknown methods as MethodNotFound", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.HandlerUnknownMethod")
  const runtime = Handlers(
    ProjectApi.layer({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectApi.HandlerUnknownMethod.close", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "MethodNotFound")
})

type ProjectApiSpec = {
  readonly open: {
    readonly input: typeof ProjectOpenInput
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

const makeProjectApi = (
  tag: string,
  metadata: {
    readonly timeoutMs?: number
    readonly cancellable?: boolean
    readonly permission?: string
  } = {}
): ApiContractClass<string, ProjectApiSpec> => {
  const contract = class {
    static readonly tag = tag
    static readonly spec = Object.freeze({
      open: Object.freeze({
        input: ProjectOpenInput,
        output: ProjectOpenOutput,
        error: ProjectOpenError,
        ...metadata
      })
    })

    static layer<HandlersShape extends ApiHandlers<ProjectApiSpec>>(
      handlers: HandlersShape
    ): ApiLayer<string, ProjectApiSpec, HandlersShape> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<string, ProjectApiSpec>

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

    static layer<HandlersShape extends ApiHandlers<EncodedInputApiSpec>>(
      handlers: HandlersShape
    ): ApiLayer<Tag, EncodedInputApiSpec, HandlersShape> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<Tag, EncodedInputApiSpec>

  return Object.freeze(contract)
}

const request = (method: string, payload: unknown): HostProtocolRequestEnvelope =>
  new HostProtocolRequestEnvelope({
    kind: "request",
    id: `request-${method}`,
    method,
    timestamp: 42,
    traceId: `trace-${method}`,
    ...(payload === undefined ? {} : { payload })
  })

const expectFailureTag = (exit: Exit.Exit<unknown, unknown>, tag: string): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)

    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(String((fail.error as HostProtocolError).tag)).toBe(tag)
    }
  }
}
