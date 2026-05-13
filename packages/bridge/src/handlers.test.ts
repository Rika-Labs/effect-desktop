import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Schema } from "effect"

import {
  BridgeRpc,
  type BridgeRpcGroup,
  type BridgeClientResponse,
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

const ProcessHandle = Schema.Struct({
  kind: Schema.Literal("process"),
  id: Schema.NonEmptyString,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ownerScope: Schema.NonEmptyString,
  state: Schema.Literal("running")
})

test("Handlers fails closed when renderer origin verification is not configured", async () => {
  let handled = false
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerDefaultOrigin")
  const runtime = Handlers(
    BridgeRpc.layer(ProjectRpcs)({
      open: () =>
        Effect.sync(() => {
          handled = true
          return new ProjectOpenOutput({ id: 1 })
        })
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectRpcs.HandlerDefaultOrigin.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "OriginInvalid")
  expect(handled).toBe(false)
})

test("Handlers binds contract layers into a request dispatcher", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerSuccess")
  const runtime = Handlers.withOptions(
    testOriginAuthDisabled,
    BridgeRpc.layer(ProjectRpcs)({
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
      request("ProjectRpcs.HandlerSuccess.open", {
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

test("Handlers encodes handle-shaped outputs through the method schema", async () => {
  const ProcessRpcs = BridgeRpc.group(
    "ProcessRpcs.HandlerResourceHandle",
    {
      spawn: {
        input: Schema.Void,
        output: ProcessHandle,
        error: Schema.Never
      }
    },
    {}
  )
  const runtime = Handlers.withOptions(
    testOriginAuthDisabled,
    BridgeRpc.layer(ProcessRpcs)({
      spawn: () =>
        Effect.succeed({
          kind: "process",
          id: "process-1",
          generation: 0,
          ownerScope: "window-1",
          state: "running"
        } as const)
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProcessRpcs.HandlerResourceHandle.spawn", undefined))
  )

  expect(response).toEqual({
    kind: "success",
    payload: {
      kind: "process",
      id: "process-1",
      generation: 0,
      ownerScope: "window-1",
      state: "running"
    }
  })
})

test("Handlers emits the request lifecycle in order for successful calls", async () => {
  const states: string[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerLifecycle")
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      now: () => 42,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectRpcs.HandlerLifecycle.open", { path: "/tmp/project" }))
  )

  expect(response.kind).toBe("success")
  expect(states).toEqual(["Pending", "Authorized", "Running", "Completed"])
})

test("Handlers verifies renderer origin before dispatching", async () => {
  let handled = false
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.OriginVerified")
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.fromCurrentTokens(new Map([["window-1", "origin-1"]]))
    },
    BridgeRpc.layer(ProjectRpcs)({
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
        "ProjectRpcs.OriginVerified.open",
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
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.OriginMissing")
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.fromCurrentTokens(new Map([["window-1", "origin-1"]]))
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: () =>
        Effect.sync(() => {
          handled = true
          return new ProjectOpenOutput({ id: 1 })
        })
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectRpcs.OriginMissing.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "OriginInvalid")
  expect(handled).toBe(false)
})

test("Handlers rejects forged renderer origin tokens", async () => {
  const states: string[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.OriginForged")
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.fromCurrentTokens(new Map([["window-1", "origin-1"]])),
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(
      requestWithOrigin(
        "ProjectRpcs.OriginForged.open",
        { path: "/tmp/project" },
        "window-1",
        "origin-2"
      )
    )
  )

  expectFailureTag(exit, "OriginInvalid")
  expect(states).toEqual(["Pending", "Failed"])
})

test("Handlers rejects stale origin tokens after rotation", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.OriginRotated")
  const runtime = Handlers.withOptions(
    {
      originAuth: RendererOriginAuth.fromCurrentTokens(new Map([["window-1", "origin-2"]]))
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(
      requestWithOrigin(
        "ProjectRpcs.OriginRotated.open",
        { path: "/tmp/project" },
        "window-1",
        "origin-1"
      )
    )
  )

  expectFailureTag(exit, "OriginInvalid")
})

test("Handlers preserves prototype handler receivers", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.PrototypeReceiver")

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

  const runtime = Handlers.withOptions(
    testOriginAuthDisabled,
    BridgeRpc.layer(ProjectRpcs)(new ProjectHandlers())
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectRpcs.PrototypeReceiver.open", { path: "/tmp/project" }))
  )

  expect(response).toEqual({
    kind: "success",
    payload: {
      id: "20"
    }
  })
})

test("Handlers decodes transformed input payloads before calling handlers", async () => {
  const EncodedInputRpcs = makeEncodedInputRpcs("ProjectRpcs.HandlerEncodedInput")
  const runtime = Handlers.withOptions(
    testOriginAuthDisabled,
    BridgeRpc.layer(EncodedInputRpcs)({
      open: (input) =>
        Effect.succeed(
          new ProjectOpenOutput({
            id: input
          })
        )
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectRpcs.HandlerEncodedInput.open", "42"))
  )

  expect(response).toEqual({
    kind: "success",
    payload: {
      id: "42"
    }
  })
})

test("Handlers encodes contract failures into failure responses", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerFailure")
  const runtime = Handlers.withOptions(
    testOriginAuthDisabled,
    BridgeRpc.layer(ProjectRpcs)({
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
    runtime.dispatch(request("ProjectRpcs.HandlerFailure.open", { path: "/tmp/project" }))
  )

  expect(response).toEqual({
    kind: "failure",
    error: {
      tag: "ProjectOpenError",
      code: "403"
    }
  })
})

test("Handlers wraps synchronous handler throws into typed failure responses", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerSyncThrow")
  const states: string[] = []
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: () => {
        throw new ProjectOpenError({ tag: "ProjectOpenError", code: 403 })
      }
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(
      request("ProjectRpcs.HandlerSyncThrow.open", { path: "/tmp/project" })
    ) as Effect.Effect<BridgeClientResponse, unknown, never>
  )

  expect(response).toEqual({
    kind: "failure",
    error: {
      tag: "ProjectOpenError",
      code: "403"
    }
  })
  expect(states).toEqual(["Pending", "Authorized", "Running", "Failed"])
})

test("Handlers redacts secret-shaped contract failure fields before renderer emission", async () => {
  class ProjectSecretError extends Schema.Class<ProjectSecretError>("HandlerProjectSecretError")({
    tag: Schema.Literal("ProjectSecretError"),
    authorization: Schema.String,
    customerSsn: Schema.String,
    details: Schema.Struct({
      refresh_token: Schema.String,
      safe: Schema.String
    })
  }) {}
  type SecretErrorRpcSpec = {
    readonly open: {
      readonly input: typeof ProjectOpenInput
      readonly output: typeof ProjectOpenOutput
      readonly error: typeof ProjectSecretError
    }
  }
  const states: unknown[] = []
  const contract = BridgeRpc.group(
    "ProjectRpcs.HandlerRedactedFailure",
    Object.freeze({
      open: Object.freeze({
        input: ProjectOpenInput,
        output: ProjectOpenOutput,
        error: ProjectSecretError
      })
    }),
    Object.freeze({})
  ) as BridgeRpcGroup<string, SecretErrorRpcSpec>
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      redaction: {
        additionalPatterns: ["customerSsn"],
        allowlist: ["details.safe"]
      },
      onState: (state) =>
        Effect.sync(() => {
          states.push(state)
        })
    },
    BridgeRpc.layer(contract)({
      open: () =>
        Effect.fail(
          new ProjectSecretError({
            tag: "ProjectSecretError",
            authorization: "Bearer abc",
            customerSsn: "123-45-6789",
            details: { refresh_token: "refresh", safe: "visible" }
          })
        )
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(request("ProjectRpcs.HandlerRedactedFailure.open", { path: "/tmp/project" }))
  )

  expect(response).toEqual({
    kind: "failure",
    error: {
      tag: "ProjectSecretError",
      authorization: "<redacted:redacted>",
      customerSsn: "<redacted:redacted>",
      details: { refresh_token: "<redacted:redacted>", safe: "visible" }
    }
  })
  expect(
    Schema.decodeUnknownSync(ProjectSecretError)((response as { readonly error?: unknown }).error)
  ).toBeInstanceOf(ProjectSecretError)
  expect(JSON.stringify(states)).not.toContain("Bearer abc")
  expect(JSON.stringify(states)).not.toContain("123-45-6789")
  expect(JSON.stringify(states)).not.toContain(':"refresh"')
})

test("Handlers rejects malformed input before calling handlers", async () => {
  const calls: string[] = []
  const states: string[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerInvalidInput")
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: (input) => {
        calls.push(input.path)
        return Effect.succeed(new ProjectOpenOutput({ id: 1 }))
      }
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectRpcs.HandlerInvalidInput.open", { path: 123 }))
  )

  expectFailureTag(exit, "InvalidArgument")
  expect(calls).toEqual([])
  expect(states).toEqual(["Pending", "Failed"])
})

test("Handlers reports malformed handler output as InvalidOutput", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerInvalidOutput")
  const runtime = Handlers.withOptions(
    testOriginAuthDisabled,
    BridgeRpc.layer(ProjectRpcs)({
      open: () =>
        Effect.succeed({
          id: Number.NaN
        } as unknown as ProjectOpenOutput)
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectRpcs.HandlerInvalidOutput.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Handlers reports malformed contract errors as InvalidOutput", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerInvalidError")
  const runtime = Handlers.withOptions(
    testOriginAuthDisabled,
    BridgeRpc.layer(ProjectRpcs)({
      open: () =>
        Effect.fail({
          tag: "ProjectOpenError",
          code: Number.NaN
        } as unknown as ProjectOpenError)
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectRpcs.HandlerInvalidError.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Handlers times out cancellable handlers and records a terminal state", async () => {
  const states: string[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerTimeout", { timeoutMs: 5 })
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: () =>
        Effect.gen(function* () {
          yield* Effect.sleep(50)
          return new ProjectOpenOutput({ id: 1 })
        })
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectRpcs.HandlerTimeout.open", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "Timeout")
  expect(states).toEqual(["Pending", "Authorized", "Running", "TimedOut"])
})

test("Handlers ignore renderer cancel envelopes for non-cancellable methods", async () => {
  const started = await Effect.runPromise(Deferred.make<void>())
  const states: string[] = []
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerNonCancellable", {
    cancellable: false
  })
  const requestEnvelope = request("ProjectRpcs.HandlerNonCancellable.open", {
    path: "/tmp/project"
  })
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProjectRpcs)({
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
  type TimeoutCollisionRpcSpec = {
    readonly open: {
      readonly input: typeof ProjectOpenInput
      readonly output: typeof ProjectOpenOutput
      readonly error: typeof ProjectTimeoutError
    }
  }
  const contract = BridgeRpc.group(
    "ProjectRpcs.HandlerTimeoutCollision",
    Object.freeze({
      open: Object.freeze({
        input: ProjectOpenInput,
        output: ProjectOpenOutput,
        error: ProjectTimeoutError,
        timeoutMs: 50
      })
    }),
    Object.freeze({})
  ) as BridgeRpcGroup<string, TimeoutCollisionRpcSpec>
  const states: string[] = []
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(contract)({
      open: () => Effect.fail(new ProjectTimeoutError({ _tag: "TimeoutError", code: 408 }))
    })
  )

  const response = await Effect.runPromise(
    runtime.dispatch(
      request("ProjectRpcs.HandlerTimeoutCollision.open", {
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
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerDuplicate")
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )
  const duplicate = new HostProtocolRequestEnvelope({
    kind: "request",
    id: "request-duplicate",
    method: "ProjectRpcs.HandlerDuplicate.open",
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
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerDuplicateExpiry")
  const runtime = Handlers.withOptions(
    {
      ...testOriginAuthDisabled,
      now: () => now,
      terminalStateTtlMs: 10,
      onState: (state) =>
        Effect.sync(() => {
          states.push(state.tag)
        })
    },
    BridgeRpc.layer(ProjectRpcs)({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )
  const duplicate = new HostProtocolRequestEnvelope({
    kind: "request",
    id: "request-duplicate-expiry",
    method: "ProjectRpcs.HandlerDuplicateExpiry.open",
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
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.HandlerUnknownMethod")
  const runtime = Handlers.withOptions(
    testOriginAuthDisabled,
    BridgeRpc.layer(ProjectRpcs)({
      open: () => Effect.succeed(new ProjectOpenOutput({ id: 1 }))
    })
  )

  const exit = await Effect.runPromiseExit(
    runtime.dispatch(request("ProjectRpcs.HandlerUnknownMethod.close", { path: "/tmp/project" }))
  )

  expectFailureTag(exit, "MethodNotFound")
})

type ProjectRpcSpec = {
  readonly open: {
    readonly input: typeof ProjectOpenInput
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

const makeProjectRpcs = (
  tag: string,
  metadata: {
    readonly timeoutMs?: number
    readonly cancellable?: boolean
    readonly permission?: string
  } = {}
): BridgeRpcGroup<string, ProjectRpcSpec> => {
  const spec = Object.freeze({
    open: Object.freeze({
      input: ProjectOpenInput,
      output: ProjectOpenOutput,
      error: ProjectOpenError,
      ...metadata
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

const request = (method: string, payload: unknown): HostProtocolRequestEnvelope =>
  new HostProtocolRequestEnvelope({
    kind: "request",
    id: `request-${method}`,
    method,
    timestamp: 42,
    traceId: `trace-${method}`,
    ...(payload === undefined ? {} : { payload })
  })

const testOriginAuthDisabled = {
  originAuth: RendererOriginAuth.unsafeDisabledForTests
} as const

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
