import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"

import {
  apiContractToRpcGroup,
  type ApiContractClass,
  type ApiHandlers,
  type ApiLayer,
  Client,
  EventHub,
  HostProtocolEventEnvelope,
  makeHostProtocolInvalidOutputError
} from "./index.js"

class ProjectChangedEvent extends Schema.Class<ProjectChangedEvent>("ProjectChangedEvent")({
  sequence: Schema.NumberFromString,
  path: Schema.String
}) {}

class ProjectOpenInput extends Schema.Class<ProjectOpenInput>("EventProjectOpenInput")({
  path: Schema.String
}) {}

class ProjectOpenOutput extends Schema.Class<ProjectOpenOutput>("EventProjectOpenOutput")({
  id: Schema.String
}) {}

class ProjectOpenError extends Schema.Class<ProjectOpenError>("EventProjectOpenError")({
  tag: Schema.Literal("ProjectOpenError")
}) {}

test("EventHub publishes contract events to typed client streams in order", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.EventsOrdered")
  const values = await Effect.runPromise(
    Effect.gen(function* () {
      const hub = yield* EventHub([ProjectApi], {
        now: () => 42,
        nextTraceId: () => "trace-event",
        windowId: "window-1"
      })
      const client = Client({ project: ProjectApi }, { request: missingRequest, ...hub.exchange })
      const fiber = yield* client.project.events.changed.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )

      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 1, path: "a" }))
      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 2, path: "b" }))
      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 3, path: "c" }))

      return yield* Fiber.join(fiber)
    })
  )

  expect(Array.from(values).map((event) => event.sequence)).toEqual([1, 2, 3])
})

test("EventHub encodes payloads before fanout", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.EventsEncoded")
  const envelopes = await Effect.runPromise(
    Effect.gen(function* () {
      const hub = yield* EventHub([ProjectApi], {
        now: () => 42,
        nextTraceId: () => "trace-event",
        windowId: "window-1"
      })
      const fiber = yield* hub.exchange
        .subscribe("ProjectApi.EventsEncoded.changed")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 1, path: "a" }))

      return yield* Fiber.join(fiber)
    })
  )

  expect(Array.from(envelopes)).toEqual([
    new HostProtocolEventEnvelope({
      kind: "event",
      method: "ProjectApi.EventsEncoded.changed",
      timestamp: 42,
      traceId: "trace-event",
      windowId: "window-1",
      payload: {
        sequence: "1",
        path: "a"
      }
    })
  ])
})

test("EventHub rejects malformed publish payloads as typed Effect failures", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.EventsInvalidPublish")
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const hub = yield* EventHub([ProjectApi])

      return yield* hub.publish(ProjectApi, "changed", {
        sequence: Number.NaN,
        path: "a"
      } as unknown as ProjectChangedEvent)
    })
  )

  expectFailureTag(exit, "InvalidArgument")
})

test("EventHub rejects invalid generated timestamps as typed Effect failures", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.EventsInvalidTimestamp")
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const hub = yield* EventHub([ProjectApi], { now: () => Number.NaN })

      return yield* hub.publish(
        ProjectApi,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
    })
  )

  expectFailureTag(exit, "InvalidArgument")
})

test("client event streams reject malformed event envelopes as typed failures", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.EventsInvalidEnvelope")
  const client = Client(
    { project: ProjectApi },
    {
      request: missingRequest,
      subscribe: () =>
        Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            method: "ProjectApi.EventsInvalidEnvelope.changed",
            timestamp: 42,
            traceId: "trace-event",
            payload: { sequence: Number.NaN, path: "a" }
          })
        )
    }
  )

  const exit = await Effect.runPromiseExit(
    client.project.events.changed.pipe(Stream.take(1), Stream.runCollect)
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("client event streams reject envelopes for the wrong method", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.EventsWrongMethod")
  const client = Client(
    { project: ProjectApi },
    {
      request: missingRequest,
      subscribe: () =>
        Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            method: "ProjectApi.EventsWrongMethod.other",
            timestamp: 42,
            traceId: "trace-event",
            payload: { sequence: "1", path: "a" }
          })
        )
    }
  )

  const exit = await Effect.runPromiseExit(
    client.project.events.changed.pipe(Stream.take(1), Stream.runCollect)
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("EventHub honors dropNewest event overflow without failing publishers", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.EventsDropNewest")
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const hub = yield* EventHub([ProjectApi])
      const fiber = yield* hub.exchange.subscribe("ProjectApi.EventsDropNewest.changed").pipe(
        Stream.tap(() => Effect.sleep("1 second")),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true })
      )

      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 1, path: "a" }))
      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 2, path: "b" }))
      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 3, path: "c" }))
      yield* Fiber.interrupt(fiber)
    })
  )

  expect(Exit.isSuccess(exit)).toBe(true)
})

test("EventHub drop backpressure does not block publishers when overflow is omitted", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.EventsDropDefault", {
    includeOverflow: false,
    queueSize: 1
  })
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const hub = yield* EventHub([ProjectApi])
      const fiber = yield* hub.exchange.subscribe("ProjectApi.EventsDropDefault.changed").pipe(
        Stream.tap(() => Effect.sleep("1 second")),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true })
      )

      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 1, path: "a" }))
      yield* hub.publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 2, path: "b" }))
      const third = yield* hub
        .publish(ProjectApi, "changed", new ProjectChangedEvent({ sequence: 3, path: "c" }))
        .pipe(Effect.timeoutOption("50 millis"))
      yield* Fiber.interrupt(fiber)
      return third
    })
  )

  expect(Option.isSome(result)).toBe(true)
})

type ProjectApiSpec = {
  readonly open: {
    readonly input: typeof ProjectOpenInput
    readonly output: typeof ProjectOpenOutput
    readonly error: typeof ProjectOpenError
  }
}

type ProjectApiEvents = {
  readonly changed: {
    readonly payload: typeof ProjectChangedEvent
    readonly backpressure: { readonly strategy: "drop"; readonly size: 16 }
  }
}

const makeProjectApi = <Tag extends string>(
  tag: Tag,
  options: { readonly includeOverflow?: boolean; readonly queueSize?: number } = {}
): ApiContractClass<Tag, ProjectApiSpec, ProjectApiEvents> => {
  const includeOverflow = options.includeOverflow ?? true
  const contract = class {
    static readonly tag = tag
    static readonly spec = Object.freeze({
      open: Object.freeze({
        input: ProjectOpenInput,
        output: ProjectOpenOutput,
        error: ProjectOpenError
      })
    })
    static readonly events = Object.freeze({
      changed: Object.freeze({
        payload: ProjectChangedEvent,
        backpressure: Object.freeze({
          strategy: "drop",
          size: options.queueSize ?? (tag === "ProjectApi.EventsDropNewest" ? 1 : 16),
          ...(includeOverflow ? { overflow: "dropNewest" } : {})
        } as const)
      })
    })

    static toRpcGroup() {
      return apiContractToRpcGroup(contract.tag, contract.spec, contract.events)
    }

    static layer<Handlers extends ApiHandlers<ProjectApiSpec>>(
      handlers: Handlers
    ): ApiLayer<Tag, ProjectApiSpec, Handlers, ProjectApiEvents> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<Tag, ProjectApiSpec, ProjectApiEvents>

  return Object.freeze(contract)
}

const missingRequest = () => Effect.fail(makeHostProtocolInvalidOutputError("test", "unused"))

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
