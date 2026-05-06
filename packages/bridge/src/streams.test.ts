import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema, Stream } from "effect"

import {
  Api,
  type ApiContractClass,
  type ApiHandlers,
  type ApiLayer,
  Client,
  HostProtocolRequestEnvelope,
  Streams,
  type HostProtocolError,
  type HostProtocolStreamEnvelope,
  makeBridgeStreamRegistry,
  makeHostProtocolInvalidOutputError
} from "./index.js"

class WatchInput extends Schema.Class<WatchInput>("StreamWatchInput")({
  projectId: Schema.String
}) {}

class WatchEvent extends Schema.Class<WatchEvent>("StreamWatchEvent")({
  sequence: Schema.NumberFromString,
  path: Schema.String
}) {}

class WatchError extends Schema.Class<WatchError>("StreamWatchError")({
  tag: Schema.Literal("WatchError"),
  code: Schema.NumberFromString
}) {}

test("Streams carries typed chunks from handler to client in order", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamOrdered")
  const runtime = Streams.withOptions(
    {
      now: () => 42,
      nextStreamId: () => "stream-1"
    },
    ProjectApi.layer({
      watch: () =>
        Stream.make(
          new WatchEvent({ sequence: 1, path: "a" }),
          new WatchEvent({ sequence: 2, path: "b" }),
          new WatchEvent({ sequence: 3, path: "c" })
        )
    })
  )
  const requests: HostProtocolRequestEnvelope[] = []
  const client = Client({ project: ProjectApi }, streamExchange(runtime, requests), {
    nextRequestId: () => "request-watch",
    nextTraceId: () => "trace-watch",
    now: () => 41,
    windowId: "window-1",
    originToken: "origin-1"
  })
  const stream: Stream.Stream<WatchEvent, WatchError | HostProtocolError, never> =
    client.project.watch(new WatchInput({ projectId: "project-1" }))

  const events = await Effect.runPromise(stream.pipe(Stream.runCollect))

  expect(Array.from(events).map((event) => event.sequence)).toEqual([1, 2, 3])
  expect(requests).toEqual([
    new HostProtocolRequestEnvelope({
      kind: "request",
      id: "request-watch",
      method: "ProjectApi.StreamOrdered.watch",
      timestamp: 41,
      traceId: "trace-watch",
      windowId: "window-1",
      originToken: "origin-1",
      payload: new WatchInput({ projectId: "project-1" })
    })
  ])
})

test("Streams carries typed stream errors as values in the error channel", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamError")
  const runtime = Streams(
    ProjectApi.layer({
      watch: () =>
        Stream.make(new WatchEvent({ sequence: 1, path: "a" })).pipe(
          Stream.concat(
            Stream.fail(
              new WatchError({
                tag: "WatchError",
                code: 500
              })
            )
          )
        )
    })
  )
  const client = Client({ project: ProjectApi }, streamExchange(runtime, []))

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  expectFailureTag(exit, "WatchError")
})

test("Streams rejects malformed chunks as typed HostProtocol failures", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamInvalidChunk")
  const runtime = Streams(
    ProjectApi.layer({
      watch: () =>
        Stream.make({
          sequence: Number.NaN,
          path: "a"
        } as unknown as WatchEvent)
    })
  )
  const client = Client({ project: ProjectApi }, streamExchange(runtime, []))

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Streams applies error overflow as a BackpressureOverflow terminal frame", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamOverflow", {
    backpressure: { strategy: "buffer", size: 1, overflow: "error" }
  })
  const runtime = Streams(
    ProjectApi.layer({
      watch: () =>
        Stream.make(
          new WatchEvent({ sequence: 1, path: "a" }),
          new WatchEvent({ sequence: 2, path: "b" }),
          new WatchEvent({ sequence: 3, path: "c" })
        )
    })
  )
  const client = Client({ project: ProjectApi }, streamExchange(runtime, []))

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(
      Stream.tap(() => Effect.sleep("1 second")),
      Stream.runCollect
    )
  )

  expectFailureTag(exit, "BackpressureOverflow")
})

test("Streams records one terminal state and expires it after cleanup grace", async () => {
  let now = 1_000
  const registry = makeBridgeStreamRegistry(30_000)
  const ProjectApi = makeProjectApi("ProjectApi.StreamLifecycle")
  const runtime = Streams.withOptions(
    {
      now: () => now,
      nextStreamId: () => "stream-lifecycle",
      registry
    },
    ProjectApi.layer({
      watch: () => Stream.make(new WatchEvent({ sequence: 1, path: "a" }))
    })
  )
  const client = Client({ project: ProjectApi }, streamExchange(runtime, []))

  await Effect.runPromise(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  const terminalSnapshot = await Effect.runPromise(registry.snapshot())
  expect(terminalSnapshot).toEqual([
    {
      generation: 0,
      state: "terminal",
      streamId: "stream-lifecycle",
      terminal: "complete",
      terminalAt: 1_000
    }
  ])

  now = 31_000
  const removed = await Effect.runPromise(registry.gcExpired(now))
  const reused = await Effect.runPromise(registry.register("stream-lifecycle"))
  expect(removed).toBe(1)
  expect(reused).toEqual({
    generation: 1,
    state: "open",
    streamId: "stream-lifecycle"
  })
})

test("BridgeStreamRegistry refuses duplicate terminal transitions", async () => {
  const registry = makeBridgeStreamRegistry()
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      yield* registry.register("stream-duplicate")
      const first = yield* registry.terminate("stream-duplicate", "complete", 10)
      const second = yield* registry.terminate("stream-duplicate", "error", 11)
      const snapshot = yield* registry.snapshot()
      return { first, second, snapshot }
    })
  )

  expect(result.first).toBe(true)
  expect(result.second).toBe(false)
  expect(result.snapshot).toEqual([
    {
      generation: 0,
      state: "terminal",
      streamId: "stream-duplicate",
      terminal: "complete",
      terminalAt: 10
    }
  ])
})

type ProjectApiSpec = {
  readonly watch: {
    readonly input: typeof WatchInput
    readonly output: ReturnType<typeof makeWatchStream>
    readonly error: typeof WatchError
    readonly backpressure?: {
      readonly strategy: "buffer"
      readonly size: number
      readonly overflow: "error" | "dropOldest" | "dropNewest" | "block"
    }
  }
}

const makeWatchStream = () => Api.Stream(WatchEvent, WatchError)

const makeProjectApi = <Tag extends string>(
  tag: Tag,
  watchSpec: Pick<ProjectApiSpec["watch"], "backpressure"> = {}
): ApiContractClass<Tag, ProjectApiSpec> => {
  const contract = class {
    static readonly tag = tag
    static readonly spec = Object.freeze({
      watch: Object.freeze({
        input: WatchInput,
        output: makeWatchStream(),
        error: WatchError,
        ...watchSpec
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

const streamExchange = (
  runtime: {
    readonly stream: (
      request: HostProtocolRequestEnvelope
    ) => Stream.Stream<HostProtocolStreamEnvelope, HostProtocolError, never>
  },
  requests: HostProtocolRequestEnvelope[]
) => ({
  request: () => Effect.fail(makeHostProtocolInvalidOutputError("test", "unused")),
  stream: (request: HostProtocolRequestEnvelope) => {
    requests.push(request)
    return runtime.stream(request)
  }
})

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
