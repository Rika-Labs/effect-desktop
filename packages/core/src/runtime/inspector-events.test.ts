import { expect, test } from "bun:test"
import { Effect, Fiber, Schema, Stream } from "effect"

import {
  EventLogInspectorEvent,
  InspectorEvent,
  PersistenceInspectorEvent,
  WorkflowInspectorEvent,
  makeInspectorCollectors
} from "./inspector-events.js"

const now = 1_715_000_000_000

test("InspectorCollectors streams typed durable events from persistence workflow and event log feeds", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const collectors = yield* makeInspectorCollectors()
      const fiber = yield* collectors.events.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )

      yield* collectors.persistence.publish(
        new PersistenceInspectorEvent({
          kind: "settings",
          status: "success",
          operation: "Settings.migrate",
          store: "settings",
          ownerScope: "app",
          namespace: "default",
          fromVersion: 1,
          toVersion: 2,
          durationMs: 7,
          timestamp: now
        })
      )
      yield* collectors.workflow.publish(
        new WorkflowInspectorEvent({
          kind: "workflow",
          status: "start",
          workflowName: "CrashSubmissionWorkflow",
          executionId: "crash-1",
          operation: "execute",
          timestamp: now + 1
        })
      )
      yield* collectors.eventLog.publish(
        new EventLogInspectorEvent({
          kind: "append",
          status: "failure",
          operation: "EventLog.append",
          event: "crash-report-submitted",
          primaryKey: "trace-1",
          errorTag: "EventJournalError",
          message: "append failed",
          timestamp: now + 2
        })
      )

      const events = yield* Fiber.join(fiber)
      expect(events.map((event) => event.channel).sort()).toEqual([
        "event-log",
        "persistence",
        "workflow"
      ])
      expect(events.some((event) => event.persistence?.operation === "Settings.migrate")).toBe(true)
      expect(
        events.some((event) => event.workflow?.workflowName === "CrashSubmissionWorkflow")
      ).toBe(true)
      expect(events.some((event) => event.eventLog?.status === "failure")).toBe(true)
    })
  ))

test("durable Inspector event fixtures decode after a restart boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture: readonly unknown[] = [
        {
          channel: "persistence",
          persistence: {
            kind: "settings",
            status: "success",
            operation: "Settings.migrate",
            store: "settings",
            namespace: "default",
            fromVersion: 1,
            toVersion: 2,
            durationMs: 7,
            timestamp: now
          }
        },
        {
          channel: "event-log",
          eventLog: {
            kind: "recovery",
            status: "success",
            operation: "EventLog.recover",
            namespace: "audit",
            message: "replayed retained journal entries",
            timestamp: now + 1
          }
        }
      ]

      const decoded = yield* Effect.forEach(
        fixture,
        (event) => Schema.decodeUnknownEffect(InspectorEvent)(event),
        { concurrency: 1 }
      )

      expect(decoded[0]?.persistence?.fromVersion).toBe(1)
      expect(decoded[1]?.eventLog?.kind).toBe("recovery")
    })
  ))
