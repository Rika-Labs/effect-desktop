import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Stream } from "effect"

import {
  BridgeRpc,
  BridgeStreamCompleteFrame,
  BridgeStreamDataFrame,
  type BridgeRpcGroup,
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
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamOrdered")
  const runtime = Streams.withOptions(
    {
      now: () => 42,
      nextStreamId: () => "stream-1"
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () =>
        Stream.make(
          new WatchEvent({ sequence: 1, path: "a" }),
          new WatchEvent({ sequence: 2, path: "b" }),
          new WatchEvent({ sequence: 3, path: "c" })
        )
    })
  )
  const requests: HostProtocolRequestEnvelope[] = []
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, requests), {
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
      method: "ProjectRpcs.StreamOrdered.watch",
      timestamp: 41,
      traceId: "trace-watch",
      windowId: "window-1",
      originToken: "origin-1",
      payload: new WatchInput({ projectId: "project-1" })
    })
  ])
})

test("Client rejects stream envelopes for the wrong request id", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamWrongRequest")
  const client = Client(
    { project: ProjectRpcs },
    {
      request: () => Effect.fail(makeHostProtocolInvalidOutputError("test", "unused")),
      stream: () =>
        Stream.make(
          new HostProtocolStreamByRequestEnvelope({
            kind: "stream",
            id: "different-request",
            resourceId: "stream-wrong-request",
            timestamp: 42,
            traceId: "trace-stream",
            payload: new BridgeStreamDataFrame({
              type: "data",
              chunk: { sequence: "1", path: "a" }
            })
          })
        )
    },
    {
      nextRequestId: () => "request-watch",
      nextTraceId: () => "trace-watch",
      now: () => 41
    }
  )

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Streams rejects duplicate active request ids", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamDuplicateRequest")
  const lifecycle: string[] = []
  const runtime = Streams(
    BridgeRpc.layer(ProjectRpcs)({
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
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, requests), {
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
  const firstStreamFiber = firstFiber
  const firstExit = await Effect.runPromiseExit(Fiber.join(firstStreamFiber))
  await waitFor(() => lifecycle.includes("released"))
  expectFailureTag(firstExit, "StreamClosed")
})

test("Streams rejects duplicate active generated stream ids", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamDuplicateResource")
  const lifecycle: string[] = []
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-duplicate-resource"
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () =>
        Stream.scoped(
          Stream.fromEffect(
            Effect.acquireRelease(
              Effect.sync(() => lifecycle.push("acquired")),
              () => Effect.sync(() => lifecycle.push("released"))
            ).pipe(Effect.andThen(Effect.never))
          )
        )
    })
  )

  const firstFiber = Effect.runFork(
    runtime
      .stream(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-stream-resource-1",
          method: "ProjectRpcs.StreamDuplicateResource.watch",
          timestamp: 41,
          traceId: "trace-stream-resource-1",
          payload: new WatchInput({ projectId: "project-1" })
        })
      )
      .pipe(Stream.runDrain)
  )

  await waitFor(() => lifecycle.includes("acquired"))

  const duplicateExit = await Effect.runPromiseExit(
    runtime
      .stream(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-stream-resource-2",
          method: "ProjectRpcs.StreamDuplicateResource.watch",
          timestamp: 42,
          traceId: "trace-stream-resource-2",
          payload: new WatchInput({ projectId: "project-1" })
        })
      )
      .pipe(Stream.runCollect)
  )

  expectFailureTag(duplicateExit, "InvalidArgument")
  await Effect.runPromise(
    runtime.cancel(
      new HostProtocolCancelByResourceEnvelope({
        kind: "cancel",
        resourceId: "stream-duplicate-resource",
        timestamp: 43,
        traceId: "trace-stream-resource-cancel"
      })
    )
  )
  await waitFor(() => lifecycle.includes("released"))
  const firstStreamFiber = firstFiber
  const firstExit = await Effect.runPromiseExit(Fiber.join(firstStreamFiber))
  expect(Exit.isSuccess(firstExit)).toBe(true)
})

test("Streams reserves duplicate generated stream ids atomically", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamDuplicateResourceRace")
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const release = Effect.runSync(Deferred.make<void>())
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-duplicate-resource-race",
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () =>
        Stream.fromEffect(
          Deferred.await(release).pipe(Effect.as(new WatchEvent({ sequence: 1, path: "a" })))
        ).pipe(Stream.concat(Stream.never))
    })
  )

  const exitsFiber = Effect.runFork(
    Effect.all(
      [
        Effect.exit(
          runtime
            .stream(
              new HostProtocolRequestEnvelope({
                kind: "request",
                id: "request-stream-resource-race-1",
                method: "ProjectRpcs.StreamDuplicateResourceRace.watch",
                timestamp: 41,
                traceId: "trace-stream-resource-race-1",
                payload: new WatchInput({ projectId: "project-1" })
              })
            )
            .pipe(Stream.take(1), Stream.runCollect)
        ),
        Effect.exit(
          runtime
            .stream(
              new HostProtocolRequestEnvelope({
                kind: "request",
                id: "request-stream-resource-race-2",
                method: "ProjectRpcs.StreamDuplicateResourceRace.watch",
                timestamp: 42,
                traceId: "trace-stream-resource-race-2",
                payload: new WatchInput({ projectId: "project-1" })
              })
            )
            .pipe(Stream.take(1), Stream.runCollect)
        )
      ],
      { concurrency: "unbounded" }
    )
  )

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await Effect.runPromise(registry.snapshot())).length === 1) {
      break
    }
    await Bun.sleep(1)
  }
  expect(await Effect.runPromise(registry.snapshot())).toHaveLength(1)
  await Effect.runPromise(Deferred.succeed(release, undefined))
  const exits = await Effect.runPromise(Fiber.join(exitsFiber))

  expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
  expect(exits.filter(Exit.isFailure)).toHaveLength(1)
  const failure = exits.find(Exit.isFailure)
  expect(failure).toBeDefined()
  if (failure !== undefined) {
    expectFailureTag(failure, "InvalidArgument")
  }
  await Effect.runPromise(runtime.dispose())
})

test("Streams rejects empty generated stream ids before registry state is created", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamEmptyId")
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "",
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () => Stream.make(new WatchEvent({ sequence: 1, path: "a" }))
    })
  )
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )
  const snapshot = await Effect.runPromise(registry.snapshot())

  expectFailureTag(exit, "InvalidArgument")
  expect(snapshot).toEqual([])
})

test("Streams carries typed stream errors as values in the error channel", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamError")
  const runtime = Streams(
    BridgeRpc.layer(ProjectRpcs)({
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
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  expectFailureTag(exit, "WatchError")
})

test("Client stops bridge streams at complete frames", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamCompleteTerminal")
  const requests: HostProtocolRequestEnvelope[] = []
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const client = Client(
    { project: ProjectRpcs },
    {
      request: () =>
        Effect.fail(
          makeHostProtocolInvalidOutputError(
            "ProjectRpcs.StreamCompleteTerminal.watch",
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
            payload: new BridgeStreamCompleteFrame({ type: "complete" })
          }),
          new HostProtocolStreamByRequestEnvelope({
            kind: "stream",
            id: request.id,
            resourceId: "stream-terminal",
            timestamp: 43,
            traceId: request.traceId,
            payload: new BridgeStreamDataFrame({
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
      method: "ProjectRpcs.StreamCompleteTerminal.watch",
      timestamp: 41,
      traceId: "trace-stream-complete",
      payload: new WatchInput({ projectId: "project-1" })
    })
  ])
  expect(cancelRequests).toEqual([])
})

test("Streams rejects malformed chunks as typed HostProtocol failures", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamInvalidChunk")
  const runtime = Streams(
    BridgeRpc.layer(ProjectRpcs)({
      watch: () =>
        Stream.make({
          sequence: Number.NaN,
          path: "a"
        } as unknown as WatchEvent)
    })
  )
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  expectFailureTag(exit, "InvalidOutput")
})

test("Streams rejects invalid generated timestamps as typed Effect failures", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamInvalidTimestamp")
  const runtime = Streams.withOptions(
    {
      now: () => Number.NaN
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () => Stream.make(new WatchEvent({ sequence: 1, path: "a" }))
    })
  )
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))

  const exit = await Effect.runPromiseExit(
    client.project.watch(new WatchInput({ projectId: "project-1" })).pipe(Stream.runCollect)
  )

  expectFailureTag(exit, "InvalidArgument")
})

test("Streams applies error overflow as a BackpressureOverflow terminal frame", async () => {
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamOverflow", {
    backpressure: { strategy: "buffer", size: 1, overflow: "error" }
  })
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-overflow",
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () =>
        Stream.make(
          new WatchEvent({ sequence: 1, path: "a" }),
          new WatchEvent({ sequence: 2, path: "b" }),
          new WatchEvent({ sequence: 3, path: "c" })
        )
    })
  )
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))

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
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamDropNewest", {
    backpressure: { strategy: "drop", size: 2, overflow: "dropNewest" }
  })
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-drop-newest",
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
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
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))

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
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamDropOldest", {
    backpressure: { strategy: "drop", size: 2, overflow: "dropOldest" }
  })
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-drop-oldest",
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
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
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))

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
  const registry = await Effect.runPromise(makeBridgeStreamRegistry(30_000))
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamLifecycle")
  const runtime = Streams.withOptions(
    {
      now: () => now,
      nextStreamId: () => "stream-lifecycle",
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () => Stream.make(new WatchEvent({ sequence: 1, path: "a" }))
    })
  )
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))

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
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
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
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
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
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamCancel")
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const finalizers: string[] = []
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-cancel",
      now: () => 42,
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
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
    { project: ProjectRpcs },
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

test("Streams dispose interrupts active producer fibers", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamRuntimeDispose")
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const finalizers: string[] = []
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-runtime-dispose",
      now: () => 42,
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () =>
        Stream.scoped(
          Stream.fromEffect(
            Effect.acquireRelease(
              Effect.sync(() => finalizers.push("acquired")),
              () => Effect.sync(() => finalizers.push("interrupted"))
            ).pipe(Effect.andThen(Effect.never))
          )
        )
    })
  )
  const streamFiber = Effect.runFork(
    runtime
      .stream(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-stream-runtime-dispose",
          method: "ProjectRpcs.StreamRuntimeDispose.watch",
          timestamp: 41,
          traceId: "trace-stream-runtime-dispose",
          payload: new WatchInput({ projectId: "project-1" })
        })
      )
      .pipe(Stream.runDrain)
  )

  await waitFor(() => finalizers.includes("acquired"))
  await Effect.runPromise(runtime.dispose())
  await waitFor(() => finalizers.includes("interrupted"))

  const fiber = streamFiber
  const exit = await Effect.runPromiseExit(Fiber.join(fiber))
  expect(Exit.isSuccess(exit)).toBe(true)
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
      streamId: "stream-runtime-dispose",
      terminal: "closed",
      terminalAt: 42
    }
  ])

  const postDisposeExit = await Effect.runPromiseExit(
    runtime
      .stream(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-stream-runtime-after-dispose",
          method: "ProjectRpcs.StreamRuntimeDispose.watch",
          timestamp: 44,
          traceId: "trace-stream-runtime-after-dispose",
          payload: new WatchInput({ projectId: "project-1" })
        })
      )
      .pipe(Stream.runDrain)
  )
  expectFailureTag(postDisposeExit, "InvalidState")
})

test("Streams cancellation by resource id interrupts the producer", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamCancelByResource")
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const finalizers: string[] = []
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-resource-cancel",
      now: () => 42,
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
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
  const client = Client({ project: ProjectRpcs }, streamExchange(runtime, []))
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

test("Streams cancellation cleanup survives invalid close frame timestamps", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamCancelInvalidTimestamp")
  const registry = await Effect.runPromise(makeBridgeStreamRegistry())
  const finalizers: string[] = []
  let now = 42
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-invalid-cancel-time",
      now: () => now,
      registry
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () =>
        Stream.scoped(
          Stream.fromEffect(
            Effect.acquireRelease(
              Effect.sync(() => finalizers.push("acquired")),
              () => Effect.sync(() => finalizers.push("interrupted"))
            ).pipe(Effect.andThen(Effect.never))
          )
        )
    })
  )
  const streamFiber = Effect.runFork(
    runtime
      .stream(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-stream-invalid-cancel-time",
          method: "ProjectRpcs.StreamCancelInvalidTimestamp.watch",
          timestamp: 41,
          traceId: "trace-stream-invalid-cancel-time",
          payload: new WatchInput({ projectId: "project-1" })
        })
      )
      .pipe(Stream.runDrain)
  )

  await waitFor(() => finalizers.includes("acquired"))
  now = Number.NaN
  await Effect.runPromise(
    runtime.cancel({
      kind: "cancel",
      resourceId: "stream-invalid-cancel-time",
      timestamp: 43,
      traceId: "trace-stream-invalid-cancel-time"
    } satisfies HostProtocolCancelByResourceEnvelope)
  )

  const fiber = streamFiber
  const exit = await Effect.runPromiseExit(Fiber.join(fiber))
  expect(Exit.isSuccess(exit)).toBe(true)
  await waitFor(() => finalizers.includes("interrupted"))
  expect(await Effect.runPromise(registry.snapshot())).toMatchObject([
    {
      state: "terminal",
      streamId: "stream-invalid-cancel-time",
      terminal: "closed"
    }
  ])
})

test("Streams sends cancel on early consumer finalization without abort signal", async () => {
  const ProjectRpcs = makeProjectRpcs("ProjectRpcs.StreamTakeWithoutSignal")
  const requests: HostProtocolRequestEnvelope[] = []
  const cancelRequests: HostProtocolCancelByRequestEnvelope[] = []
  const runtime = Streams.withOptions(
    {
      nextStreamId: () => "stream-take-without-signal",
      now: () => 42
    },
    BridgeRpc.layer(ProjectRpcs)({
      watch: () =>
        Stream.make(new WatchEvent({ sequence: 1, path: "a" })).pipe(Stream.concat(Stream.never))
    })
  )
  const client = Client(
    { project: ProjectRpcs },
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
      method: "ProjectRpcs.StreamTakeWithoutSignal.watch",
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

type ProjectRpcSpec = {
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

const makeWatchStream = () => BridgeRpc.Stream(WatchEvent, WatchError)

const makeProjectRpcs = <Tag extends string>(
  tag: Tag,
  watchSpec: Pick<ProjectRpcSpec["watch"], "backpressure"> = {}
): BridgeRpcGroup<Tag, ProjectRpcSpec> => {
  const spec = Object.freeze({
    watch: Object.freeze({
      input: WatchInput,
      output: makeWatchStream(),
      error: WatchError,
      ...watchSpec
    })
  })
  return BridgeRpc.group(tag, spec, Object.freeze({}))
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
