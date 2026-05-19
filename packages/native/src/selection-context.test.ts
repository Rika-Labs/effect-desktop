import { expect, test } from "bun:test"
import { type BridgeClientExchange, makeHostProtocolInternalError } from "@effect-desktop/bridge"
import {
  type AuditEvent,
  makePermissionRegistry,
  makeResourceRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, ManagedRuntime, Option, Stream } from "effect"

import {
  makeSelectionContextBridgeClientLayer,
  makeSelectionContextMemoryClient,
  makeSelectionContextServiceLayer,
  makeSelectionContextUnsupportedClient,
  SelectionContext,
  SelectionContextClient,
  type SelectionContextClientApi
} from "./selection-context.js"
import {
  SelectionContextActor,
  SelectionContextReadSelectionRequest,
  SelectionContextStopWatchingRequest,
  SelectionContextWatchFocusRequest
} from "./contracts/selection-context.js"

test("SelectionContext separates metadata from content and audits both access modes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const client = yield* makeSelectionContextMemoryClient()

      const runtime = ManagedRuntime.make(
        makeSelectionContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextTraceId: () => "trace-selection"
        })
      )
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            const metadata = yield* context.readSelection(readSelectionRequest("metadata"))
            const content = yield* context.readSelection(readSelectionRequest("content"))
            const document = yield* context.readDocumentContext({
              actor: actor(),
              access: "metadata"
            })
            return { content, document, metadata }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.metadata.text).toBeUndefined()
      expect(result.metadata.metadata.characterCount).toBeGreaterThan(0)
      expect(result.content.text).toBe("selected text")
      expect(result.document.text).toBeUndefined()
      expect(rows.filter((row) => row.source === "SelectionContext.readSelection")).toHaveLength(2)
      expect(rows.some((row) => row.resource === "metadata")).toBe(true)
      expect(rows.some((row) => row.resource === "content")).toBe(true)
    })
  ))

test("SelectionContext denies before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const baseClient = yield* makeSelectionContextMemoryClient()
      let calls = 0
      const client: SelectionContextClientApi = {
        ...baseClient,
        readSelection: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.readSelection(input)))
      }

      const runtime = ManagedRuntime.make(
        makeSelectionContextServiceLayer(client, {
          permissions,
          nextWatchId: () => "watch-1"
        })
      )
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            return yield* Effect.exit(context.readSelection(readSelectionRequest("metadata")))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "SelectionContext.readSelection"
        })
      })
    })
  ))

test("SelectionContext surfaces injected host failure as typed failure and audit failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const failure = makeHostProtocolInternalError("host failed", "SelectionContext.readSelection")
      const client = yield* makeSelectionContextMemoryClient({
        failure: { readSelection: failure }
      })

      const runtime = ManagedRuntime.make(
        makeSelectionContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextWatchId: () => "watch-1"
        })
      )
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            return yield* Effect.exit(context.readSelection(readSelectionRequest("metadata")))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "SelectionContext.readSelection"
        })
      })
      expect(rows.some((row) => row.outcome === "failed")).toBe(true)
    })
  ))

test("SelectionContext watches focus through substitutable events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const client = yield* makeSelectionContextMemoryClient({ nextWatchId: () => "watch-1" })

      const runtime = ManagedRuntime.make(
        makeSelectionContextServiceLayer(client, {
          permissions,
          nextWatchId: () => "watch-1"
        })
      )
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            const watch = yield* context.watchFocus(
              new SelectionContextWatchFocusRequest({ actor: actor(), access: "metadata" })
            )
            const event = yield* context
              .events()
              .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
            return { event, watch }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.watch).toMatchObject({ watchId: "watch-1", active: true, access: "metadata" })
      expect(result.event).toMatchObject({ phase: "watch-started", watchId: "watch-1" })
    })
  ))

test("SelectionContext releases focus watches when their resource scope closes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const client = yield* makeSelectionContextMemoryClient()

      const runtime = ManagedRuntime.make(
        makeSelectionContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          resources
        })
      )
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            const watch = yield* context.watchFocus(
              new SelectionContextWatchFocusRequest({
                actor: actor(),
                access: "metadata",
                ownerScope: "scope-selection",
                watchId: "watch-resource"
              })
            )
            const beforeClose = yield* resources.list()
            yield* resources.closeScope("scope-selection")
            const afterClose = yield* resources.list()
            const stopAfterCleanup = yield* client.stopWatching({
              actor: actor(),
              watchId: "watch-resource"
            })
            return { afterClose, beforeClose, stopAfterCleanup, watch }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.watch.watchId).toBe("watch-resource")
      expect(result.beforeClose.entries).toHaveLength(1)
      expect(result.afterClose.entries).toHaveLength(0)
      expect(result.stopAfterCleanup.stopped).toBe(false)
      expect(
        rows.some((row) => row.details && JSON.stringify(row.details).includes("released-by-scope"))
      ).toBe(true)
    })
  ))

test("SelectionContext stopWatching is permissioned and idempotent", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const client = yield* makeSelectionContextMemoryClient()

      const runtime = ManagedRuntime.make(makeSelectionContextServiceLayer(client, { permissions }))
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            yield* context.watchFocus(
              new SelectionContextWatchFocusRequest({
                actor: actor(),
                access: "metadata",
                watchId: "watch-stop"
              })
            )
            const first = yield* context.stopWatching(
              new SelectionContextStopWatchingRequest({ actor: actor(), watchId: "watch-stop" })
            )
            const second = yield* context.stopWatching(
              new SelectionContextStopWatchingRequest({ actor: actor(), watchId: "watch-stop" })
            )
            return { first, second }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.first).toMatchObject({ watchId: "watch-stop", stopped: true })
      expect(result.second).toMatchObject({ watchId: "watch-stop", stopped: false })
    })
  ))

test("SelectionContext rejects malformed input before client calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const baseClient = yield* makeSelectionContextMemoryClient()
      let calls = 0
      const client: SelectionContextClientApi = {
        ...baseClient,
        readSelection: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.readSelection(input)))
      }

      const runtime = ManagedRuntime.make(makeSelectionContextServiceLayer(client, { permissions }))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            return yield* Effect.exit(
              context.readSelection({
                actor: actor(),
                access: "metadata",
                traceId: "\0"
              })
            )
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "SelectionContext.readSelection"
        })
      })
    })
  ))

test("SelectionContext unsupported client validates then fails closed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSelectionContextUnsupportedClient()
      const support = yield* client.isSupported()
      const exit = yield* Effect.exit(client.readSelection({ actor: actor(), access: "metadata" }))

      expect(support).toMatchObject({ supported: false, reason: "host-adapter-unimplemented" })
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "SelectionContext.readSelection"
        })
      })
    })
  ))

test("SelectionContext unsupported client fails through the public service layer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const runtime = ManagedRuntime.make(
        makeSelectionContextServiceLayer(makeSelectionContextUnsupportedClient(), { permissions })
      )
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            return yield* Effect.exit(context.readSelection(readSelectionRequest("metadata")))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "SelectionContext.readSelection"
        })
      })
    })
  ))

test("SelectionContext bridge client fails event stream as unsupported before subscribing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const runtime = ManagedRuntime.make(makeSelectionContextBridgeClientLayer(exchange))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* SelectionContextClient
            return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "SelectionContext.Event"
        })
      })
      expect(subscriptions).toEqual([])
    })
  ))

const configuredPermissions = (rows: AuditEvent[]) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "SelectionContext", methods: ["readSelection"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "SelectionContext", methods: ["readDocumentContext"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "SelectionContext", methods: ["watchFocus"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "SelectionContext", methods: ["stopWatching"] })
      )
    ])
    rows.length = 0
    return permissions
  })

const memoryAudit = (rows: AuditEvent[]) => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const actor = () => new SelectionContextActor({ kind: "workspace", id: "workspace-1" })

const readSelectionRequest = (access: "metadata" | "content") =>
  new SelectionContextReadSelectionRequest({ actor: actor(), access })

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
