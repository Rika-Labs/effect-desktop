import { expect, test } from "bun:test"
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Schedule,
  Schema
} from "effect"

import {
  type BridgeClientResponse,
  Client,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolRequestEnvelope,
  RendererOriginAuth,
  Rpc,
  RpcClient,
  RpcGroup,
  bridgeContractFromRpcGroup,
  makeBridgeInspector,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
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

test("makeUnaryDesktopTransportFromBridgeClientExchange adapts unary bridge exchange to Effect RpcClient protocol", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const Open = Rpc.make("ProjectRpcs.Transport.open", {
    payload: ProjectOpenInput,
    success: ProjectOpenOutput,
    error: ProjectOpenError
  })
  const ProjectRpcs = RpcGroup.make(Open)

  const TransportLayer = Layer.unwrap(
    makeUnaryDesktopTransportFromBridgeClientExchange(
      responseExchange(requests, { id: "project-1" }),
      {
        now: () => 41,
        nextTraceId: () => "trace-transport"
      }
    ).pipe(
      Effect.map((transport) =>
        Layer.effect(RpcClient.Protocol)(
          makeDesktopClientProtocol(transport, { now: () => 42, nextTraceId: () => "trace-rpc" })
        )
      )
    )
  )

  const program = Effect.gen(function* () {
    const client = yield* RpcClient.make(ProjectRpcs)
    const output = yield* client["ProjectRpcs.Transport.open"](
      new ProjectOpenInput({ path: "/tmp/project" })
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

  const runtime = ManagedRuntime.make(TransportLayer)
  return runtime.runPromise(Effect.scoped(program))
})

test("makeUnaryDesktopTransportFromBridgeClientExchange uses the Effect Clock by default", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_715_000_000_000
      const responses: unknown[] = []

      yield* Effect.gen(function* () {
        const transport = yield* makeUnaryDesktopTransportFromBridgeClientExchange(
          responseExchange([], { id: "project-1" }),
          { nextTraceId: () => "trace-transport" }
        )
        const fiber = yield* transport
          .run((envelope) =>
            Effect.sync(() => {
              responses.push(envelope)
            })
          )
          .pipe(Effect.forkChild({ startImmediately: true }))

        yield* transport.send(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "request-1",
            method: "Project.open",
            timestamp: 42,
            traceId: "trace-request"
          })
        )
        yield* Effect.yieldNow
        yield* Fiber.interrupt(fiber)
      }).pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))

      expect(responses).toContainEqual(
        expect.objectContaining({
          kind: "response",
          id: "request-1",
          timestamp,
          traceId: "trace-request"
        })
      )
    })
  ))

test("makeUnaryDesktopTransportFromBridgeClientExchange converts invalid exchange responses to failure frames", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const responses: unknown[] = []

      const transport = yield* makeUnaryDesktopTransportFromBridgeClientExchange(
        {
          request: () => Effect.succeed({ kind: "nonsense", payload: { id: "accepted" } })
        },
        { now: () => 43, nextTraceId: () => "trace-transport" }
      )
      const fiber = yield* transport
        .run((envelope) =>
          Effect.sync(() => {
            responses.push(envelope)
          })
        )
        .pipe(Effect.forkChild({ startImmediately: true }))

      yield* transport.send(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-invalid-response",
          method: "Project.open",
          timestamp: 42,
          traceId: "trace-request"
        })
      )
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)

      expect(responses).toContainEqual(
        expect.objectContaining({
          kind: "response",
          id: "request-invalid-response",
          traceId: "trace-request",
          error: expect.objectContaining({
            tag: "InvalidOutput",
            operation: "Project.open"
          })
        })
      )
    })
  ))

test("Client generates a typed namespace from contract entries", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientTest")
      const client = Client(
        { project: ProjectRpcs },
        responseExchange(requests, { id: "project-1" }),
        {
          nextRequestId: () => "request-project-open",
          nextTraceId: () => "trace-project-open",
          windowId: "window-1",
          originToken: "origin-1"
        }
      )

      const effect: Effect.Effect<ProjectOpenOutput, ProjectOpenError | HostProtocolError, never> =
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      const output = yield* effect.pipe(Effect.provideService(Clock.Clock, fixedClock(42)))

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
  ))

test("Client emits typed inspector RPC and bridge frame events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events: unknown[] = []
      const inspector = yield* makeBridgeInspector({
        onEvent: (event) =>
          Effect.sync(() => {
            events.push(event)
          })
      })
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.Inspector")
      const client = Client({ project: ProjectRpcs }, responseExchange([], { id: "project-1" }), {
        nextRequestId: () => "request-inspector",
        nextTraceId: () => "trace-inspector",
        now: () => 42,
        inspector
      })

      yield* client.project.open(new ProjectOpenInput({ path: "/secret/project" }))

      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "rpc.request",
          method: "ProjectRpcs.Inspector.open",
          requestId: "request-inspector",
          traceId: "trace-inspector"
        })
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "bridge.frame",
          frameKind: "request",
          payload: new ProjectOpenInput({ path: "/secret/project" })
        })
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "rpc.response",
          method: "ProjectRpcs.Inspector.open",
          requestId: "request-inspector",
          traceId: "trace-inspector"
        })
      )
    })
  ))

test("Client rejects malformed input as a typed Effect failure before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.InvalidInput")
      const client = Client(
        { project: ProjectRpcs },
        responseExchange(requests, { id: "project-1" })
      )

      // @ts-expect-error intentionally malformed path exercises runtime payload decoding.
      const exit = yield* Effect.exit(client.project.open({ path: 123 }))

      expectFailureTag(exit, "InvalidArgument")
      expect(requests).toEqual([])
    })
  ))

test("Client rejects invalid generated timestamps as typed Effect failures before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.InvalidTimestamp")
      const client = Client(
        { project: ProjectRpcs },
        responseExchange(requests, { id: "project-1" }),
        {
          now: () => Number.NaN
        }
      )

      const exit = yield* Effect.exit(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      )

      expectFailureTag(exit, "InvalidArgument")
      expectFailureField(exit, "field", "timestamp")
      expect(requests).toEqual([])
    })
  ))

test("Client rejects empty generated request IDs before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EmptyRequestId")
      const client = Client(
        { project: ProjectRpcs },
        responseExchange(requests, { id: "project-1" }),
        {
          nextRequestId: () => ""
        }
      )

      const exit = yield* Effect.exit(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      )

      expectFailureTag(exit, "InvalidArgument")
      expectFailureField(exit, "field", "id")
      expect(requests).toEqual([])
    })
  ))

test("Client rejects empty generated trace IDs as typed Effect failures before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EmptyTrace")
      const client = Client(
        { project: ProjectRpcs },
        responseExchange(requests, { id: "project-1" }),
        {
          nextTraceId: () => ""
        }
      )

      const exit = yield* Effect.exit(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      )

      expectFailureTag(exit, "InvalidArgument")
      expectFailureField(exit, "field", "traceId")
      expect(requests).toEqual([])
    })
  ))

test("Client rejects empty renderer origin fields as typed Effect failures before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

        const exit = yield* Effect.exit(
          client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
        )

        expectFailureTag(exit, "InvalidArgument")
        expectFailureField(exit, "field", field)
        expect(requests).toEqual([])
      }
    })
  ))

test("Client allows zero-argument calls for void-input methods", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const VoidRpcs = makeVoidRpcs("ProjectRpcs.VoidInput")
      const client = Client(
        { project: VoidRpcs },
        responseExchange(requests, { id: "project-1" }),
        {
          nextRequestId: () => "request-void-input",
          nextTraceId: () => "trace-void-input",
          now: () => 42
        }
      )

      const output = yield* client.project.open()

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
  ))

test("Client encodes typed input before sending request payloads", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const output = yield* client.project.open(42)

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
  ))

test("Client decodes malformed output as a typed Effect failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.InvalidOutput")
      const client = Client({ project: ProjectRpcs }, responseExchange([], { id: 123 }))

      const exit = yield* Effect.exit(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      )

      expectFailureTag(exit, "InvalidOutput")
    })
  ))

test("Client emits inspector decode failures for malformed outputs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events: unknown[] = []
      const inspector = yield* makeBridgeInspector({
        onEvent: (event) =>
          Effect.sync(() => {
            events.push(event)
          })
      })
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.InvalidOutputInspector")
      const client = Client({ project: ProjectRpcs }, responseExchange([], { id: 123 }), {
        nextRequestId: () => "request-decode-failure",
        nextTraceId: () => "trace-decode-failure",
        now: () => 42,
        inspector
      })

      const exit = yield* Effect.exit(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      )

      expectFailureTag(exit, "InvalidOutput")
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "bridge.decodeFailure",
          method: "ProjectRpcs.InvalidOutputInspector.open",
          requestId: "request-decode-failure",
          traceId: "trace-decode-failure",
          timestamp: 42,
          frameKind: "response",
          errorTag: "InvalidOutput"
        })
      )
    })
  ))

test("Client decodes contract error responses as typed Effect failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
      const exit = yield* Effect.exit(effect)

      expectFailureTag(exit, "ProjectOpenError")
    })
  ))

test("Client reports malformed contract error responses as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const exit = yield* Effect.exit(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      )

      expectFailureTag(exit, "InvalidOutput")
    })
  ))

test("Client rejects unknown response kinds as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.UnknownResponseKind")
      const client = Client(
        { project: ProjectRpcs },
        {
          request: () =>
            Effect.succeed({
              kind: "nonsense",
              payload: { id: "accepted" }
            })
        }
      )

      const exit = yield* Effect.exit(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      )

      expectFailureTag(exit, "InvalidOutput")
    })
  ))

test("Client converts null and undefined responses to typed InvalidOutput failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const value of [null, undefined] as const) {
        const ProjectRpcs = makeProjectRpcs(`ProjectRpcs.NullishResponse.${String(value)}`)
        const client = Client({ project: ProjectRpcs }, { request: () => Effect.succeed(value) })

        const exit = yield* Effect.exit(
          client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
        )

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.hasDies(exit.cause)).toBe(false)
        }
        expectFailureTag(exit, "InvalidOutput")
      }
    })
  ))

test("makeUnaryDesktopTransportFromBridgeClientExchange converts nullish responses to failure frames", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const value of [null, undefined] as const) {
        const responses: unknown[] = []

        const transport = yield* makeUnaryDesktopTransportFromBridgeClientExchange(
          {
            request: () => Effect.succeed(value)
          },
          { now: () => 43, nextTraceId: () => "trace-transport" }
        )
        const fiber = yield* transport
          .run((envelope) =>
            Effect.sync(() => {
              responses.push(envelope)
            })
          )
          .pipe(Effect.forkChild({ startImmediately: true }))

        const sendExit = yield* Effect.exit(
          transport.send(
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: "request-nullish-response",
              method: "Project.open",
              timestamp: 42,
              traceId: "trace-request"
            })
          )
        )
        yield* Effect.yieldNow
        yield* Fiber.interrupt(fiber)

        expect(Exit.isSuccess(sendExit)).toBe(true)
        expect(responses).toContainEqual(
          expect.objectContaining({
            kind: "response",
            id: "request-nullish-response",
            traceId: "trace-request",
            error: expect.objectContaining({
              tag: "InvalidOutput",
              operation: "Project.open"
            })
          })
        )
      }
    })
  ))

test("Client propagates exchange failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ExchangeError")
      const client = Client(
        { project: ProjectRpcs },
        failingExchange(makeHostProtocolInvalidOutputError("ProjectRpcs.ExchangeError.open", "bad"))
      )

      const exit = yield* Effect.exit(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" }))
      )

      expectFailureTag(exit, "InvalidOutput")
    })
  ))

test("Client decodes resource outputs through the method schema", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProcessRpcs = makeProcessRpcs("ProjectRpcs.ResourceHandle")
      const handle = {
        kind: "process",
        id: "process-1",
        generation: 0,
        ownerScope: "window-1",
        state: "running"
      } as const
      const client = Client({ process: ProcessRpcs }, responseExchange([], handle))

      const decoded = yield* client.process.spawn()

      expect(decoded).toEqual(handle)
    })
  ))

test("Client rejects resource outputs with empty owner scopes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const exit = yield* Effect.exit(client.process.spawn())

      expectFailureTag(exit, "InvalidOutput")
    })
  ))

test("Client interruption sends bridge cancellation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProcessRpcs = makeProjectRpcs("ProjectRpcs.ClientInterrupt")
      const started = yield* Deferred.make<void>()
      const states: string[] = []
      const runtime = makeDesktopRpcHandlerRuntime(
        ProcessRpcs,
        ProcessRpcs.toLayer({
          "ProjectRpcs.ClientInterrupt.open": () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Effect.sleep(10_000)
              return new ProjectOpenOutput({ id: "project-1" })
            })
        }),
        {
          originAuth: RendererOriginAuth.unsafeDisabledForTests,
          onState: (state) =>
            Effect.sync(() => {
              states.push(state.tag)
            })
        }
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

      const fiber = yield* client.project
        .open(new ProjectOpenInput({ path: "/tmp/project" }))
        .pipe(Effect.forkDetach({ startImmediately: true }))

      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Effect.exit(Fiber.join(fiber))
      yield* waitFor(() => states.includes("Canceled"))

      expectInterrupted(exit)
      expect(cancelRequests).toEqual([
        new HostProtocolCancelByRequestEnvelope({
          kind: "cancel",
          id: "request-client-cancel",
          timestamp: 42,
          traceId: "trace-client-cancel"
        })
      ])
      expect(states).toEqual(["Pending", "Running", "Canceled"])
    })
  ))

test("Client runtime AbortSignal interruption sends bridge cancellation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientRuntimeSignal")
      const started = yield* Deferred.make<void>()
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

      const fiber = yield* Effect.forkDetach(
        client.project.open(new ProjectOpenInput({ path: "/tmp/project" })).pipe(
          Effect.raceFirst(
            Effect.callback<never>((resume) => {
              if (controller.signal.aborted) {
                resume(Effect.interrupt)
                return
              }
              controller.signal.addEventListener(
                "abort",
                () => {
                  resume(Effect.interrupt)
                },
                { once: true }
              )
            })
          )
        )
      )

      yield* Deferred.await(started)
      controller.abort()
      const exit = yield* Effect.exit(Fiber.join(fiber))

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
  ))

test("Client interruption releases callers when the exchange does not answer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const fiber = yield* client.project
        .open(new ProjectOpenInput({ path: "/tmp/project" }))
        .pipe(Effect.forkDetach({ startImmediately: true }))

      yield* Fiber.interrupt(fiber)
      const result = yield* Fiber.join(fiber).pipe(Effect.exit, Effect.timeoutOption("50 millis"))

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
      yield* waitFor(() => finalizers.includes("request"))
    })
  ))

test("Client interruption releases callers when cancel dispatch does not answer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientInterruptCancelNever")
      const finalizers: string[] = []
      const client = Client(
        { project: ProjectRpcs },
        {
          request: () =>
            Effect.never.pipe(Effect.ensuring(Effect.sync(() => finalizers.push("request")))),
          cancel: () =>
            Effect.never.pipe(Effect.ensuring(Effect.sync(() => finalizers.push("cancel"))))
        },
        {
          nextRequestId: () => "request-client-interrupt-cancel-never",
          nextTraceId: () => "trace-client-interrupt-cancel-never",
          now: () => 42
        }
      )

      const fiber = yield* client.project
        .open(new ProjectOpenInput({ path: "/tmp/project" }))
        .pipe(Effect.forkDetach({ startImmediately: true }))

      yield* Fiber.interrupt(fiber)
      const result = yield* Fiber.join(fiber).pipe(Effect.exit, Effect.timeoutOption("50 millis"))

      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expectInterrupted(result.value)
      }
      yield* waitFor(() => finalizers.includes("request"))
      yield* waitFor(() => finalizers.includes("cancel"))
    })
  ))

test("Client normalizes outbound requests before exchange dispatch", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.ClientNormalizeRequest")
      const client = Client(
        { project: ProjectRpcs },
        responseExchange(requests, { id: "project-1" }),
        {
          nextRequestId: () => "request-project-open",
          nextTraceId: () => "trace-project-open",
          normalizeRequest: (request) =>
            new HostProtocolRequestEnvelope({
              kind: request.kind,
              id: request.id,
              method: request.method,
              timestamp: request.timestamp,
              traceId: request.traceId,
              ...(request.payload === undefined ? {} : { payload: request.payload }),
              ...(request.windowId === undefined ? {} : { windowId: request.windowId }),
              originToken: "normalized-origin"
            })
        }
      )

      yield* client.project
        .open(new ProjectOpenInput({ path: "/tmp/project" }))
        .pipe(Effect.provideService(Clock.Clock, fixedClock(42)))

      expect(requests).toEqual([
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-project-open",
          method: "ProjectRpcs.ClientNormalizeRequest.open",
          timestamp: 42,
          traceId: "trace-project-open",
          originToken: "normalized-origin",
          payload: new ProjectOpenInput({ path: "/tmp/project" })
        })
      ])
    })
  ))

test("Client interruption ignores invalid cancel timestamps without masking interruption", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const fiber = yield* client.project
        .open(new ProjectOpenInput({ path: "/tmp/project" }))
        .pipe(Effect.forkDetach({ startImmediately: true }))

      yield* Fiber.interrupt(fiber)
      const result = yield* Fiber.join(fiber).pipe(Effect.exit, Effect.timeoutOption("50 millis"))

      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expectInterrupted(result.value)
      }
      expect(cancelRequests).toEqual([])
    })
  ))

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

const isBridgeClientResponse = (value: unknown): value is BridgeClientResponse =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  (value.kind === "success" || value.kind === "failure")

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

class WaitForTimeout extends Schema.TaggedErrorClass<WaitForTimeout>()("WaitForTimeout", {}) {}

const waitFor = (predicate: () => boolean): Effect.Effect<void, WaitForTimeout, never> =>
  Effect.suspend(() => (predicate() ? Effect.void : new WaitForTimeout().asEffect())).pipe(
    Effect.retry(Schedule.spaced("1 millis").pipe(Schedule.both(Schedule.recurs(100))))
  )

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
