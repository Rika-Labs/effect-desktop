import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Schema } from "effect"

import {
  type ApiContractClass,
  type ApiHandlers,
  type ApiLayer,
  Handlers,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolRequestEnvelope,
  RendererOriginAuth,
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

test("Handlers verifies renderer origin before dispatching", async () => {
  let handled = false
  const ProjectApi = makeProjectApi("ProjectApi.OriginVerified")
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.fromCurrentTokens(new Map([["window-1", "origin-1"]]))
    },
    ProjectApi.layer({
      open: () =>
        Effect.sync(() => {
          handled = true
          return new ProjectOpenOutput({ id: 1 })
        })
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(
      requestWithOrigin(
        "ProjectApi.OriginVerified.open",
        { path: "/tmp/project" },
        "window-1",
        "origin-1"
      )
    )
  )

  expect(response.kind).toBe("success")
  expect(handled).toBe(true)
})

test("Handlers rejects missing renderer origin before handler lookup", async () => {
  let handled = false
  const ProjectApi = makeProjectApi("ProjectApi.OriginMissing")
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.fromCurrentTokens(new Map([["window-1", "origin-1"]]))
    },
    ProjectApi.layer({
      open: () =>
        Effect.sync(() => {
          handled = true
          return new ProjectOpenOutput({ id: 1 })
        })
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectApi.OriginMissing.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "OriginInvalid")
  expect(handled).toBe(false)
})

test("Handlers rejects forged renderer origin tokens", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.OriginForged")
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.fromCurrentTokens(new Map([["window-1", "origin-1"]]))
    },
    ProjectApi.layer({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(
      requestWithOrigin(
        "ProjectApi.OriginForged.open",
        { path: "/tmp/project" },
        "window-1",
        "origin-2"
      )
    )
  )

  expectFailureTag(exit, "OriginInvalid")
})

test("Handlers rejects stale origin tokens after rotation", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.OriginRotated")
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.fromCurrentTokens(new Map([["window-1", "origin-2"]]))
    },
    ProjectApi.layer({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(
      requestWithOrigin(
        "ProjectApi.OriginRotated.open",
        { path: "/tmp/project" },
        "window-1",
        "origin-1"
      )
    )
  )

  expectFailureTag(exit, "OriginInvalid")
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

test("Handlers redacts secret-shaped contract failure fields before renderer emission", async () => {
  class ProjectSecretError extends Schema.Class<ProjectSecretError>("HandlerProjectSecretError")({
    tag: Schema.Literal("ProjectSecretError"),
    authorization: Schema.String,
    details: Schema.Struct({
      refresh_token: Schema.String,
      safe: Schema.String
    })
  }) {}
  type SecretErrorApiSpec = {
    readonly open: {
      readonly input: typeof ProjectOpenInput
      readonly output: typeof ProjectOpenOutput
      readonly error: typeof ProjectSecretError
    }
  }
  const states: unknown[] = []
  const contract = class {
    static readonly tag = "ProjectApi.HandlerRedactedFailure"
    static readonly spec = Object.freeze({
      open: Object.freeze({
        input: ProjectOpenInput,
        output: ProjectOpenOutput,
        error: ProjectSecretError
      })
    })
    static readonly events = Object.freeze({})

    static layer<HandlersShape extends ApiHandlers<SecretErrorApiSpec>>(
      handlers: HandlersShape
    ): ApiLayer<string, SecretErrorApiSpec, HandlersShape> {
      return Object.freeze({ contract, handlers: Object.freeze(handlers) })
    }
  } as ApiContractClass<string, SecretErrorApiSpec>
  const runtime = Handlers.withOptions(
    {
      onState: (state) =>
        Effect.sync(() => {
          states.push(state)
        })
    },
    contract.layer({
      open: () =>
        Effect.fail(
          new ProjectSecretError({
            tag: "ProjectSecretError",
            authorization: "Bearer abc",
            details: { refresh_token: "refresh", safe: "visible" }
          })
        )
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectApi.HandlerRedactedFailure.open", { path: "/tmp/project" }))
  )

  expect(response).toEqual({
    kind: "failure",
    error: {
      tag: "ProjectSecretError",
      authorization: "[REDACTED]",
      details: { refresh_token: "[REDACTED]", safe: "visible" }
    }
  })
  expect(JSON.stringify(states)).not.toContain("Bearer abc")
  expect(JSON.stringify(states)).not.toContain(':"refresh"')
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

test("Handlers ignore renderer cancel envelopes for non-cancellable methods", async () => {
  const started = await Effect.runPromise(Deferred.make<void>())
  const states: string[] = []
  const ProjectApi = makeProjectApi("ProjectApi.HandlerNonCancellable", {
    cancellable: false
  })
  const requestEnvelope = request("ProjectApi.HandlerNonCancellable.open", {
    path: "/tmp/project"
  })
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
          yield* Deferred.succeed(started, undefined)
          yield* Effect.sleep(5)
          return new ProjectOpenOutput({ id: 1 })
        })
    })
  )

  const responsePromise = Effect.runPromise(runtime.dispatch(requestEnvelope))
  await Effect.runPromise(Deferred.await(started))
  await Effect.runPromise(
    runtime.cancel(
      new HostProtocolCancelByRequestEnvelope({
        kind: "cancel",
        id: requestEnvelope.id,
        timestamp: 42,
        traceId: requestEnvelope.traceId
      })
    )
  )
  const response = await responsePromise

  expect(response).toEqual({
    kind: "success",
    payload: {
      id: "1"
    }
  })
  expect(states).toEqual(["Pending", "Authorized", "Running", "Completed"])
})

test("Handlers does not confuse domain _tag collisions with Effect timeout errors", async () => {
  class ProjectTimeoutError extends Schema.Class<ProjectTimeoutError>("HandlerProjectTimeoutError")(
    {
      _tag: Schema.Literal("TimeoutError"),
      code: Schema.NumberFromString
    }
  ) {}
  type TimeoutCollisionApiSpec = {
    readonly open: {
      readonly input: typeof ProjectOpenInput
      readonly output: typeof ProjectOpenOutput
      readonly error: typeof ProjectTimeoutError
    }
  }
  const contract = class {
    static readonly tag = "ProjectApi.HandlerTimeoutCollision"
    static readonly spec = Object.freeze({
      open: Object.freeze({
        input: ProjectOpenInput,
        output: ProjectOpenOutput,
        error: ProjectTimeoutError,
        timeoutMs: 50
      })
    })
    static readonly events = Object.freeze({})

    static layer<HandlersShape extends ApiHandlers<TimeoutCollisionApiSpec>>(
      handlers: HandlersShape
    ): ApiLayer<string, TimeoutCollisionApiSpec, HandlersShape> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<string, TimeoutCollisionApiSpec>
  const states: string[] = []
  const runtime = Handlers.withOptions(
    {
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    contract.layer({
      open: () => Effect.fail(new ProjectTimeoutError({ _tag: "TimeoutError", code: 408 }))
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(
      request("ProjectApi.HandlerTimeoutCollision.open", {
        path: "/tmp/project"
      })
    )
  )

  expect(response).toEqual({
    kind: "failure",
    error: {
      _tag: "TimeoutError",
      code: "408"
    }
  })
  expect(states).toEqual(["Pending", "Authorized", "Running", "Failed"])
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

test("Handlers expires terminal request ids after the replay window", async () => {
  let now = 1_000
  const states: string[] = []
  const ProjectApi = makeProjectApi("ProjectApi.HandlerDuplicateExpiry")
  const runtime = Handlers.withOptions(
    {
      now: () => now,
      terminalStateTtlMs: 10,
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
    id: "request-duplicate-expiry",
    method: "ProjectApi.HandlerDuplicateExpiry.open",
    timestamp: 42,
    traceId: "trace-duplicate-expiry",
    payload: { path: "/tmp/project" }
  })

  await Effect.runPromise(runtime.dispatch(duplicate))
  now = 1_011
  const response = await Effect.runPromise(runtime.dispatch(duplicate))

  expect(response.kind).toBe("success")
  expect(states).toEqual([
    "Pending",
    "Authorized",
    "Running",
    "Completed",
    "Pending",
    "Authorized",
    "Running",
    "Completed"
  ])
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
    static readonly events = Object.freeze({})

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
    static readonly events = Object.freeze({})

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

const requestWithOrigin = (
  method: string,
  payload: unknown,
  windowId: string,
  originToken: string
): HostProtocolRequestEnvelope =>
  new HostProtocolRequestEnvelope({
    kind: "request",
    id: `request-${method}`,
    method,
    timestamp: 42,
    traceId: `trace-${method}`,
    windowId,
    originToken,
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
