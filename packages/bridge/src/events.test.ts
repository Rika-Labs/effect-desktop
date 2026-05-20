import { expect, test } from "bun:test"
import { Cause, Clock, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"

import {
  BridgeRuntime,
  type BridgeContract,
  Client,
  EventHub,
  HostProtocolEventEnvelope,
  Rpc,
  RpcGroup,
  bridgeContractFromRpcGroup,
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

test("EventHub publishes contract events to typed client streams in order", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsOrdered")
      const hub = yield* EventHub([ProjectRpcs], {
        now: () => 42,
        nextTraceId: () => "trace-event",
        windowId: "window-1"
      })
      const client = Client({ project: ProjectRpcs }, { request: missingRequest, ...hub.exchange })
      const fiber = yield* client.project.events.changed.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )

      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 3, path: "c" })
      )

      const values = yield* Fiber.join(fiber).pipe(Effect.timeout("2 seconds"))

      expect(Array.from(values).map((event) => event.sequence)).toEqual([1, 2, 3])
    })
  ))

test("EventHub encodes payloads before fanout", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsEncoded")
      const timestamp = 1_715_000_000_000
      const envelopes = yield* Effect.gen(function* () {
        const hub = yield* EventHub([ProjectRpcs], {
          nextTraceId: () => "trace-event",
          windowId: "window-1"
        })
        const fiber = yield* hub.exchange
          .subscribe("ProjectRpcs.EventsEncoded.changed")
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

        yield* hub.publish(
          ProjectRpcs,
          "changed",
          new ProjectChangedEvent({ sequence: 1, path: "a" })
        )

        return yield* Fiber.join(fiber).pipe(Effect.timeout("2 seconds"))
      }).pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))

      expect(Array.from(envelopes)).toEqual([
        new HostProtocolEventEnvelope({
          kind: "event",
          method: "ProjectRpcs.EventsEncoded.changed",
          timestamp,
          traceId: "trace-event",
          windowId: "window-1",
          payload: {
            sequence: "1",
            path: "a"
          }
        })
      ])
    })
  ))

test("EventHub rejects malformed publish payloads as typed Effect failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsInvalidPublish")
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const hub = yield* EventHub([ProjectRpcs])
          const payload = new ProjectChangedEvent({
            sequence: 1,
            path: "a"
          })
          Object.defineProperty(payload, "path", { value: 1 })

          return yield* hub.publish(ProjectRpcs, "changed", payload)
        })
      )

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("EventHub rejects invalid generated timestamps as typed Effect failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsInvalidTimestamp")
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const hub = yield* EventHub([ProjectRpcs], { now: () => Number.NaN })

          return yield* hub.publish(
            ProjectRpcs,
            "changed",
            new ProjectChangedEvent({ sequence: 1, path: "a" })
          )
        })
      )

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("EventHub rejects empty generated trace IDs before publishing envelopes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsEmptyTrace")
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const hub = yield* EventHub([ProjectRpcs], { nextTraceId: () => "" })
          const fiber = yield* hub.exchange
            .subscribe("ProjectRpcs.EventsEmptyTrace.changed")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* hub.publish(
            ProjectRpcs,
            "changed",
            new ProjectChangedEvent({ sequence: 1, path: "a" })
          )

          return yield* Fiber.join(fiber)
        })
      )

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("EventHub rejects unchecked zero-sized event backpressure as typed setup failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeUncheckedEventBackpressure(
        makeProjectRpcs("ProjectRpcs.EventsUncheckedZero"),
        { strategy: "drop", size: 0 }
      )
      const exit = yield* Effect.exit(EventHub([ProjectRpcs]))

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("EventHub rejects unchecked event overflow error as typed setup failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeUncheckedEventBackpressure(
        makeProjectRpcs("ProjectRpcs.EventsUncheckedError"),
        { strategy: "drop", size: 1, overflow: "error" }
      )
      const exit = yield* Effect.exit(EventHub([ProjectRpcs]))

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("client event streams reject malformed event envelopes as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsInvalidEnvelope")
      const client = Client(
        { project: ProjectRpcs },
        {
          request: missingRequest,
          subscribe: () =>
            Stream.make(
              new HostProtocolEventEnvelope({
                kind: "event",
                method: "ProjectRpcs.EventsInvalidEnvelope.changed",
                timestamp: 42,
                traceId: "trace-event",
                payload: { sequence: Number.NaN, path: "a" }
              })
            )
        }
      )

      const exit = yield* Effect.exit(
        client.project.events.changed.pipe(Stream.take(1), Stream.runCollect)
      )

      expectFailureTag(exit, "InvalidOutput")
    })
  ))

test("client event streams reject envelopes for the wrong method", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsWrongMethod")
      const client = Client(
        { project: ProjectRpcs },
        {
          request: missingRequest,
          subscribe: () =>
            Stream.make(
              new HostProtocolEventEnvelope({
                kind: "event",
                method: "ProjectRpcs.EventsWrongMethod.other",
                timestamp: 42,
                traceId: "trace-event",
                payload: { sequence: "1", path: "a" }
              })
            )
        }
      )

      const exit = yield* Effect.exit(
        client.project.events.changed.pipe(Stream.take(1), Stream.runCollect)
      )

      expectFailureTag(exit, "InvalidOutput")
    })
  ))

test("EventHub fans out published events to multiple subscribers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsFanout")
      const hub = yield* EventHub([ProjectRpcs])
      const first = yield* hub.exchange
        .subscribe("ProjectRpcs.EventsFanout.changed")
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      const second = yield* hub.exchange
        .subscribe("ProjectRpcs.EventsFanout.changed")
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )

      const values = [
        yield* Fiber.join(first).pipe(Effect.timeout("2 seconds")),
        yield* Fiber.join(second).pipe(Effect.timeout("2 seconds"))
      ] as const

      expect(values.map((chunk) => Array.from(chunk).map(readEnvelopeSequence))).toEqual([
        [1, 2],
        [1, 2]
      ])
    })
  ))

test("EventHub rejects unknown event subscriptions as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsUnknownSubscribe")
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const hub = yield* EventHub([ProjectRpcs])

          return yield* hub.exchange
            .subscribe("ProjectRpcs.EventsUnknownSubscribe.missing")
            .pipe(Stream.take(1), Stream.runDrain)
        })
      )

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("EventHub rejects unknown event publishes as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsUnknownPublish")
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const hub = yield* EventHub([ProjectRpcs])
          const event = "missing" as keyof typeof ProjectRpcs.events

          return yield* hub.publish(
            ProjectRpcs,
            event,
            new ProjectChangedEvent({ sequence: 1, path: "a" })
          )
        })
      )

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("EventHub honors dropNewest event overflow without failing publishers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsDropNewest")
      const hub = yield* EventHub([ProjectRpcs])
      const fiber = yield* hub.exchange.subscribe("ProjectRpcs.EventsDropNewest.changed").pipe(
        Stream.take(2),
        Stream.tap(() => Effect.sleep("50 millis")),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 3, path: "c" })
      )
      const values = yield* Fiber.join(fiber).pipe(Effect.timeout("2 seconds"))

      expect(Array.from(values).map(readEnvelopeSequence)).toEqual([1, 2])
    })
  ))

test("EventHub dropNewest uses shared PubSub backpressure across fast and slow subscribers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsDropNewestShared", {
        overflow: "dropNewest",
        queueSize: 1
      })
      const hub = yield* EventHub([ProjectRpcs])
      const slow = yield* hub.exchange.subscribe("ProjectRpcs.EventsDropNewestShared.changed").pipe(
        Stream.take(2),
        Stream.tap(() => Effect.sleep("50 millis")),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )
      const fast = yield* hub.exchange
        .subscribe("ProjectRpcs.EventsDropNewestShared.changed")
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 3, path: "c" })
      )
      const fastResult = yield* Fiber.join(fast).pipe(Effect.timeoutOption("100 millis"))
      yield* Fiber.interrupt(fast)

      const result = {
        slow: yield* Fiber.join(slow).pipe(Effect.timeout("2 seconds")),
        fastResult
      }

      expect(Array.from(result.slow).map(readEnvelopeSequence)).toEqual([1, 2])
      expect(Option.isNone(result.fastResult)).toBe(true)
    })
  ))

test("EventHub honors dropOldest event overflow with Effect PubSub sliding semantics", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsDropOldest", {
        overflow: "dropOldest",
        queueSize: 1
      })
      const hub = yield* EventHub([ProjectRpcs])
      const fiber = yield* hub.exchange.subscribe("ProjectRpcs.EventsDropOldest.changed").pipe(
        Stream.take(2),
        Stream.tap(() => Effect.sleep("50 millis")),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 3, path: "c" })
      )
      const values = yield* Fiber.join(fiber).pipe(Effect.timeout("2 seconds"))

      expect(Array.from(values).map(readEnvelopeSequence)).toEqual([1, 3])
    })
  ))

test("EventHub dropOldest uses shared PubSub sliding while fast subscribers can drain", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsDropOldestShared", {
        overflow: "dropOldest",
        queueSize: 1
      })
      const hub = yield* EventHub([ProjectRpcs])
      const slow = yield* hub.exchange.subscribe("ProjectRpcs.EventsDropOldestShared.changed").pipe(
        Stream.take(2),
        Stream.tap(() => Effect.sleep("50 millis")),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )
      const fast = yield* hub.exchange
        .subscribe("ProjectRpcs.EventsDropOldestShared.changed")
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 3, path: "c" })
      )

      const result = {
        slow: yield* Fiber.join(slow).pipe(Effect.timeout("2 seconds")),
        fast: yield* Fiber.join(fast).pipe(Effect.timeout("2 seconds"))
      }

      expect(Array.from(result.slow).map(readEnvelopeSequence)).toEqual([1, 3])
      expect(Array.from(result.fast).map(readEnvelopeSequence)).toEqual([1, 2, 3])
    })
  ))

test("EventHub drop backpressure does not block publishers when overflow is omitted", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsDropDefault", {
        includeOverflow: false,
        queueSize: 1
      })
      const hub = yield* EventHub([ProjectRpcs])
      const fiber = yield* hub.exchange.subscribe("ProjectRpcs.EventsDropDefault.changed").pipe(
        Stream.tap(() => Effect.sleep("1 second")),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true })
      )

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )
      const third = yield* hub
        .publish(ProjectRpcs, "changed", new ProjectChangedEvent({ sequence: 3, path: "c" }))
        .pipe(Effect.timeoutOption("50 millis"))
      yield* Fiber.interrupt(fiber)

      expect(Option.isSome(third)).toBe(true)
    })
  ))

test("EventHub block overflow applies PubSub backpressure until subscribers drain", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsBlock", {
        overflow: "block",
        queueSize: 1,
        strategy: "block"
      })
      const hub = yield* EventHub([ProjectRpcs])
      const fiber = yield* hub.exchange.subscribe("ProjectRpcs.EventsBlock.changed").pipe(
        Stream.take(3),
        Stream.tap(() => Effect.sleep("50 millis")),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true })
      )

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )
      const thirdFiber = yield* hub
        .publish(ProjectRpcs, "changed", new ProjectChangedEvent({ sequence: 3, path: "c" }))
        .pipe(Effect.forkChild({ startImmediately: true }))
      const third = yield* Fiber.join(thirdFiber).pipe(Effect.timeoutOption("10 millis"))
      yield* Fiber.join(thirdFiber).pipe(Effect.timeout("2 seconds"))
      yield* Fiber.join(fiber).pipe(Effect.timeout("2 seconds"))

      expect(Option.isNone(third)).toBe(true)
    })
  ))

test("EventHub block overflow shares backpressure across fast and slow subscribers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsBlockShared", {
        overflow: "block",
        queueSize: 1,
        strategy: "block"
      })
      const hub = yield* EventHub([ProjectRpcs])
      const slow = yield* hub.exchange.subscribe("ProjectRpcs.EventsBlockShared.changed").pipe(
        Stream.take(3),
        Stream.tap(() => Effect.sleep("50 millis")),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true })
      )
      const fast = yield* hub.exchange
        .subscribe("ProjectRpcs.EventsBlockShared.changed")
        .pipe(Stream.take(3), Stream.runDrain, Effect.forkChild({ startImmediately: true }))

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 2, path: "b" })
      )
      const thirdFiber = yield* hub
        .publish(ProjectRpcs, "changed", new ProjectChangedEvent({ sequence: 3, path: "c" }))
        .pipe(Effect.forkChild({ startImmediately: true }))
      const third = yield* Fiber.join(thirdFiber).pipe(Effect.timeoutOption("10 millis"))

      yield* Fiber.join(thirdFiber).pipe(Effect.timeout("2 seconds"))
      yield* Fiber.join(slow).pipe(Effect.timeout("2 seconds"))
      yield* Fiber.join(fast).pipe(Effect.timeout("2 seconds"))

      expect(Option.isNone(third)).toBe(true)
    })
  ))

test("EventHub subscription finalization removes backpressure after Stream.take completes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ProjectRpcs = makeProjectRpcs("ProjectRpcs.EventsFinalize", {
        overflow: "block",
        queueSize: 1,
        strategy: "block"
      })
      const hub = yield* EventHub([ProjectRpcs])
      const fiber = yield* hub.exchange
        .subscribe("ProjectRpcs.EventsFinalize.changed")
        .pipe(Stream.take(1), Stream.runDrain, Effect.forkChild({ startImmediately: true }))

      yield* Effect.sleep("10 millis")
      yield* hub.publish(
        ProjectRpcs,
        "changed",
        new ProjectChangedEvent({ sequence: 1, path: "a" })
      )
      yield* Fiber.join(fiber).pipe(Effect.timeout("2 seconds"))
      const second = yield* hub
        .publish(ProjectRpcs, "changed", new ProjectChangedEvent({ sequence: 2, path: "b" }))
        .pipe(Effect.timeoutOption("10 millis"))
      const third = yield* hub
        .publish(ProjectRpcs, "changed", new ProjectChangedEvent({ sequence: 3, path: "c" }))
        .pipe(Effect.timeoutOption("10 millis"))

      const result = [second, third] as const

      expect(result.every(Option.isSome)).toBe(true)
    })
  ))

const makeProjectRpcs = <Tag extends string>(
  tag: Tag,
  options: {
    readonly includeOverflow?: boolean
    readonly overflow?: "dropOldest" | "dropNewest" | "block"
    readonly queueSize?: number
    readonly strategy?: "buffer" | "drop" | "block"
  } = {}
) => {
  const includeOverflow = options.includeOverflow ?? true
  const Open = Rpc.make(`${tag}.open`, {
    payload: ProjectOpenInput,
    success: ProjectOpenOutput,
    error: ProjectOpenError
  })
  const Changed = Rpc.make(`${tag}.events.changed`, {
    success: ProjectChangedEvent,
    error: Schema.Never,
    stream: true
  }).pipe(
    BridgeRuntime({
      backpressure: {
        strategy: options.strategy ?? "drop",
        size: options.queueSize ?? (tag === "ProjectRpcs.EventsDropNewest" ? 1 : 16),
        ...(includeOverflow ? { overflow: options.overflow ?? "dropNewest" } : {})
      }
    })
  )
  return bridgeContractFromRpcGroup(tag, RpcGroup.make(Open, Changed))
}

const makeUncheckedEventBackpressure = <Contract extends BridgeContract>(
  contract: Contract,
  backpressure: NonNullable<Contract["events"][keyof Contract["events"]]["backpressure"]>
): Contract => ({
  ...contract,
  events: {
    ...contract.events,
    changed: {
      ...contract.events["changed"],
      backpressure
    }
  }
})

const missingRequest = () => Effect.fail(makeHostProtocolInvalidOutputError("test", "unused"))

const readEnvelopeSequence = (envelope: HostProtocolEventEnvelope): number => {
  const payload = envelope.payload
  if (typeof payload === "object" && payload !== null && "sequence" in payload) {
    const sequence = payload.sequence
    if (typeof sequence === "string") {
      return Number(sequence)
    }
  }

  throw new Error("missing encoded sequence")
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

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
