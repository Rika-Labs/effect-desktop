import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Schema, Stream } from "effect"

import {
  Api,
  ApiStreamCompleteFrame,
  ApiStreamDataFrame,
  apiContractToRpcGroup,
  type ApiContractClass,
  type ApiHandlers,
  type ApiLayer,
  Client,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolCancelByResourceEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
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

test("Streams rejects duplicate active request ids", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamDuplicateRequest")
  const lifecycle: string[] = []
  const runtime = Streams(
    ProjectApi.layer({
      watch: () =>
        Stream.scoped(
          Stream.fromEffect(
            Effect.acquireRelease(
              Effect.sync(() => {
                lifecycle.push("acquired")
              }),
              () => Effect.sync(() => lifecycle.push("released"))
            ).pipe(Effect.andThen(Effect.never))
          )
        )
    })
  )
  const requests: HostProtocolRequestEnvelope[] = []
  const client = Client({ project: ProjectApi }, streamExchange(runtime, requests), {
    nextRequestId: () => "request-stream-duplicate",
    nextTraceId: () => "trace-stream-duplicate",
    now: () => 41
  })
  const controller = new AbortController()

  const firstFiber = Effect.runFork(
    client.project
      .watch(new WatchInput({ projectId: "project-1" }), {
        signal: controller.signal
      })
      .pipe(Stream.runCollect)
  )

  await waitFor(() => requests.length === 1)
  await waitFor(() => lifecycle.includes("acquired"))

  const duplicateExit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )
  expectFailureTag(duplicateExit, "InvalidArgument")
  expect(lifecycle).toEqual(["acquired"])
  expect(requests).toHaveLength(2)

  controller.abort()
  const firstStreamFiber = await firstFiber
  const firstExit = await Effect.runPromiseExit(Fiber.join(firstStreamFiber))
  await waitFor(() => lifecycle.includes("released"))
  expectFailureTag(firstExit, "StreamClosed")
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

test("Client stops bridge streams at complete frames", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamCompleteTerminal")
  const requests: HostProtocolRequestEnvelope[] = []
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const client = Client(
    { project: ProjectApi },
    {
      request: () =>
        Effect.fail(
          makeHostProtocolInvalidOutputError(
            "ProjectApi.StreamCompleteTerminal.watch",
            "unexpected unary request"
          )
        ),
      stream: (request) => {
        requests.push(request)
        return Stream.fromIterable([
          new HostProtocolStreamByRequestEnvelope({
            kind: "stream",
            id: request.id,
            resourceId: "stream-terminal",
            timestamp: 42,
            traceId: request.traceId,
            payload: new ApiStreamCompleteFrame({ type: "complete" })
          }),
          new HostProtocolStreamByRequestEnvelope({
            kind: "stream",
            id: request.id,
            resourceId: "stream-terminal",
            timestamp: 43,
            traceId: request.traceId,
            payload: new ApiStreamDataFrame({
              type: "data",
              chunk: { sequence: "1", path: "late" }
            })
          })
        ])
      },
      cancel: (request) =>
        Effect.sync(() => {
          cancelRequests.push(request)
        })
    },
    {
      nextRequestId: () => "request-stream-complete",
      nextTraceId: () => "trace-stream-complete",
      now: () => 41
    }
  )

  const events = await Effect.runPromise(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  expect(Array.from(events)).toEqual([])
  expect(requests).toEqual([
    new HostProtocolRequestEnvelope({
      kind: "request",
      id: "request-stream-complete",
      method: "ProjectApi.StreamCompleteTerminal.watch",
      timestamp: 41,
      traceId: "trace-stream-complete",
      payload: new WatchInput({ projectId: "project-1" })
    })
  ])
  expect(cancelRequests).toEqual([])
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
  const registry = makeBridgeStreamRegistry()
  const ProjectApi = makeProjectApi("ProjectApi.StreamOverflow", {
    backpressure: { strategy: "buffer", size: 1, overflow: "error" }
  })
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-overflow",
      registry
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
  const client = Client({ project: ProjectApi }, streamExchange(runtime, []))

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(
      Stream.tap(() => Effect.sleep("1 second")),
      Stream.runCollect
    )
  )

  expectFailureTag(exit, "BackpressureOverflow")
  expect(getFailureError(exit)).toMatchObject({
    lostFrames: 1,
    policy: "error",
    tag: "BackpressureOverflow"
  })
  expect(await Effect.runPromise(registry.snapshot())).toEqual([
    {
      backpressure: {
        evictedFrames: 2,
        overflow: "error",
        queueCapacity: 1,
        queueDepth: 0
      },
      generation: 0,
      state: "terminal",
      streamId: "stream-overflow",
      terminal: "error",
      terminalAt: expect.any(Number)
    }
  ])
})

test("Streams records dropNewest overflow metrics without failing publishers", async () => {
  const registry = makeBridgeStreamRegistry()
  const ProjectApi = makeProjectApi("ProjectApi.StreamDropNewest", {
    backpressure: { strategy: "drop", size: 2, overflow: "dropNewest" }
  })
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-drop-newest",
      registry
    },
    ProjectApi.layer({
      watch: () =>
        Stream.make(
          new WatchEvent({ sequence: 1, path: "a" }),
          new WatchEvent({ sequence: 2, path: "b" }),
          new WatchEvent({ sequence: 3, path: "c" }),
          new WatchEvent({ sequence: 4, path: "d" }),
          new WatchEvent({ sequence: 5, path: "e" })
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

  expect(Exit.isSuccess(exit)).toBe(true)
  expect(await Effect.runPromise(registry.snapshot())).toEqual([
    {
      backpressure: {
        evictedFrames: 4,
        overflow: "dropNewest",
        queueCapacity: 2,
        queueDepth: 0
      },
      generation: 0,
      state: "terminal",
      streamId: "stream-drop-newest",
      terminal: "complete",
      terminalAt: expect.any(Number)
    }
  ])
})

test("Streams records dropOldest overflow metrics while keeping the stream successful", async () => {
  const registry = makeBridgeStreamRegistry()
  const ProjectApi = makeProjectApi("ProjectApi.StreamDropOldest", {
    backpressure: { strategy: "drop", size: 2, overflow: "dropOldest" }
  })
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-drop-oldest",
      registry
    },
    ProjectApi.layer({
      watch: () =>
        Stream.make(
          new WatchEvent({ sequence: 1, path: "a" }),
          new WatchEvent({ sequence: 2, path: "b" }),
          new WatchEvent({ sequence: 3, path: "c" }),
          new WatchEvent({ sequence: 4, path: "d" }),
          new WatchEvent({ sequence: 5, path: "e" })
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

  expect(Exit.isSuccess(exit)).toBe(true)
  expect(await Effect.runPromise(registry.snapshot())).toEqual([
    {
      backpressure: {
        evictedFrames: 3,
        overflow: "dropOldest",
        queueCapacity: 2,
        queueDepth: 0
      },
      generation: 0,
      state: "terminal",
      streamId: "stream-drop-oldest",
      terminal: "complete",
      terminalAt: expect.any(Number)
    }
  ])
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
      backpressure: {
        evictedFrames: 0,
        overflow: "error",
        queueCapacity: 1024,
        queueDepth: 0
      },
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

test("BridgeStreamRegistry observe emits current and updated snapshots", async () => {
  const registry = makeBridgeStreamRegistry()
  const observed = Effect.runFork(registry.observe().pipe(Stream.take(3), Stream.runCollect))
  await Bun.sleep(0)

  await Effect.runPromise(registry.register("stream-observed"))
  await Effect.runPromise(
    registry.updateBackpressure("stream-observed", {
      evictedFrames: 1,
      overflow: "dropOldest",
      queueCapacity: 4,
      queueDepth: 2
    })
  )

  const snapshots = Array.from(await Effect.runPromise(Fiber.join(observed)))
  expect(snapshots[0]).toEqual([])
  expect(snapshots[1]).toEqual([
    {
      generation: 0,
      state: "open",
      streamId: "stream-observed"
    }
  ])
  expect(snapshots[2]?.[0]?.backpressure).toEqual({
    evictedFrames: 1,
    overflow: "dropOldest",
    queueCapacity: 4,
    queueDepth: 2
  })
})

test("Streams cancellation interrupts the producer and emits a closed terminal", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamCancel")
  const registry = makeBridgeStreamRegistry()
  const finalizers: string[] = []
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-cancel",
      now: () => 42,
      registry
    },
    ProjectApi.layer({
      watch: () =>
        Stream.scoped(
          Stream.fromEffect(
            Effect.acquireRelease(
              Effect.sync(() => finalizers.push("acquired")),
              (_acquired, _exit) => Effect.sync(() => finalizers.push("interrupted"))
            ).pipe(Effect.andThen(Effect.never))
          )
        )
    })
  )
  const requests: HostProtocolRequestEnvelope[] = []
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const client = Client(
    { project: ProjectApi },
    streamExchange(runtime, requests, cancelRequests),
    {
      nextRequestId: () => "request-stream-cancel",
      nextTraceId: () => "trace-stream-cancel",
      now: () => 41
    }
  )
  const controller = new AbortController()
  const exitPromise = Effect.runPromiseExit(
    client.project
      .watch(new WatchInput({ projectId: "project-1" }), { signal: controller.signal })
      .pipe(Stream.runCollect)
  )

  await waitFor(() => requests.length === 1)
  await waitFor(() => finalizers.includes("acquired"))
  controller.abort()

  const exit = await exitPromise
  await waitFor(() => finalizers.includes("interrupted"))
  expectFailureTag(exit, "StreamClosed")
  expect(finalizers).toEqual(["acquired", "interrupted"])
  expect(cancelRequests).toEqual([
    new HostProtocolCancelByRequestEnvelope({
      kind: "cancel",
      id: "request-stream-cancel",
      timestamp: 41,
      traceId: "trace-stream-cancel"
    })
  ])
  expect(await Effect.runPromise(registry.snapshot())).toEqual([
    {
      generation: 0,
      backpressure: {
        evictedFrames: 0,
        overflow: "error",
        queueCapacity: 1024,
        queueDepth: 0
      },
      state: "terminal",
      streamId: "stream-cancel",
      terminal: "closed",
      terminalAt: 42
    }
  ])
})

test("Streams cancellation by resource id interrupts the producer", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamCancelByResource")
  const registry = makeBridgeStreamRegistry()
  const finalizers: string[] = []
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-resource-cancel",
      now: () => 42,
      registry
    },
    ProjectApi.layer({
      watch: () =>
        Stream.scoped(
          Stream.fromEffect(
            Effect.acquireRelease(
              Effect.sync(() => finalizers.push("acquired")),
              (_acquired, _exit) => Effect.sync(() => finalizers.push("interrupted"))
            ).pipe(Effect.andThen(Effect.never))
          )
        )
    })
  )
  const client = Client({ project: ProjectApi }, streamExchange(runtime, []))
  const exitPromise = Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  await waitFor(() => finalizers.includes("acquired"))
  await Effect.runPromise(
    runtime.cancel({
      kind: "cancel",
      resourceId: "stream-resource-cancel",
      timestamp: 42,
      traceId: "trace-stream-resource-cancel"
    } satisfies HostProtocolCancelByResourceEnvelope)
  )

  const exit = await exitPromise
  await waitFor(() => finalizers.includes("interrupted"))
  expectFailureTag(exit, "StreamClosed")
  expect(finalizers).toEqual(["acquired", "interrupted"])
  expect(await Effect.runPromise(registry.snapshot())).toEqual([
    {
      generation: 0,
      backpressure: {
        evictedFrames: 0,
        overflow: "error",
        queueCapacity: 1024,
        queueDepth: 0
      },
      state: "terminal",
      streamId: "stream-resource-cancel",
      terminal: "closed",
      terminalAt: 42
    }
  ])
})

test("Streams sends cancel on early consumer finalization without abort signal", async () => {
  const ProjectApi = makeProjectApi("ProjectApi.StreamTakeWithoutSignal")
  const requests: HostProtocolRequestEnvelope[] = []
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-take-without-signal",
      now: () => 42
    },
    ProjectApi.layer({
      watch: () =>
        Stream.make(new WatchEvent({ sequence: 1, path: "a" })).pipe(Stream.concat(Stream.never))
    })
  )
  const client = Client(
    { project: ProjectApi },
    streamExchange(runtime, requests, cancelRequests),
    {
      nextRequestId: () => "request-stream-take",
      nextTraceId: () => "trace-stream-take",
      now: () => 41
    }
  )

  const events = await Effect.runPromise(
    client.project
      .watch(new WatchInput({ projectId: "project-1" }))
      .pipe(Stream.take(1), Stream.runCollect)
  )

  expect(Array.from(events).map((event) => event.path)).toEqual(["a"])
  expect(requests).toEqual([
    new HostProtocolRequestEnvelope({
      kind: "request",
      id: "request-stream-take",
      method: "ProjectApi.StreamTakeWithoutSignal.watch",
      timestamp: 41,
      traceId: "trace-stream-take",
      payload: new WatchInput({ projectId: "project-1" })
    })
  ])
  await waitFor(() => cancelRequests.length === 1)
  expect(cancelRequests).toEqual([
    new HostProtocolCancelByRequestEnvelope({
      kind: "cancel",
      id: "request-stream-take",
      timestamp: 41,
      traceId: "trace-stream-take"
    })
  ])
})

type ProjectApiSpec = {
  readonly watch: {
    readonly input: typeof WatchInput
    readonly output: ReturnType<typeof makeWatchStream>
    readonly error: typeof WatchError
    readonly backpressure?: {
      readonly strategy: "buffer" | "drop"
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

    static toRpcGroup() {
      return apiContractToRpcGroup(contract.tag, contract.spec, contract.events)
    }

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
    readonly cancel?: (
      request: HostProtocolCancelByRequestEnvelope
    ) => Effect.Effect<void, never, never>
  },
  requests: HostProtocolRequestEnvelope[],
  cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
) => ({
  request: () => Effect.fail(makeHostProtocolInvalidOutputError("test", "unused")),
  stream: (request: HostProtocolRequestEnvelope) => {
    requests.push(request)
    return runtime.stream(request)
  },
  cancel: (request: HostProtocolCancelByRequestEnvelope) => {
    cancelRequests.push(request)
    return runtime.cancel?.(request) ?? Effect.void
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

const getFailureError = (exit: Exit.Exit<unknown, unknown>): unknown => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    return fail?.error
  }

  return undefined
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
