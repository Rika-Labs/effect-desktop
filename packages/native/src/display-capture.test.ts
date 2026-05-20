import { expect, test } from "bun:test"
import { type BridgeClientExchange, HostProtocolInternalError } from "@effect-desktop/bridge"
import { type AuditEvent, makePermissionRegistry, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, ManagedRuntime, Option, Stream } from "effect"

import {
  DisplayCapture,
  DisplayCaptureClient,
  makeDisplayCaptureBridgeClientLayer,
  makeDisplayCaptureGrantAuthority,
  makeDisplayCaptureMemoryClient,
  makeDisplayCaptureServiceLayer,
  makeDisplayCaptureUnsupportedClient,
  type DisplayCaptureClientApi
} from "./display-capture.js"
import {
  DisplayCaptureActor,
  DisplayCaptureDisplayRequest,
  DisplayCaptureDisplayTarget,
  DisplayCaptureGrant,
  DisplayCaptureImage,
  DisplayCaptureResult
} from "./contracts/display-capture.js"

test("DisplayCapture captures image bytes with redacted audit metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissionsEffect(rows)
      const client = yield* makeDisplayCaptureMemoryClient({ nextCaptureId: () => "capture-1" })
      const layer = makeDisplayCaptureServiceLayer(client, {
        permissions,
        grants: grantAuthority(),
        audit: memoryAudit(rows)
      })
      const runtime = ManagedRuntime.make(layer)
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const capture = yield* DisplayCapture
            return yield* capture.captureDisplay(displayRequest())
          })
        )
      )

      expect(result.image.mime).toBe("image/png")
      expect(result.image.bytes.length).toBe(result.metadata.byteLength)
      expect(result.metadata).toMatchObject({
        captureId: "capture-1",
        source: "display",
        displayId: "display-1"
      })
      expect(rows.some((row) => row.source === "DisplayCapture.captureDisplay")).toBe(true)
      expect(serialize(rows)).not.toContain(Array.from(result.image.bytes).join(","))
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DisplayCapture denies before client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const baseClient = yield* makeDisplayCaptureMemoryClient()
      let calls = 0
      const client: DisplayCaptureClientApi = {
        ...baseClient,
        captureDisplay: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.captureDisplay(input)))
      }
      const layer = makeDisplayCaptureServiceLayer(client, {
        permissions,
        grants: grantAuthority()
      })
      const runtime = ManagedRuntime.make(layer)
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const capture = yield* DisplayCapture
            return yield* Effect.exit(capture.captureDisplay(displayRequest()))
          })
        )
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "DisplayCapture.captureDisplay"
        })
      })
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DisplayCapture rejects malformed input before client calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissionsEffect([])
      const baseClient = yield* makeDisplayCaptureMemoryClient()
      let calls = 0
      const client: DisplayCaptureClientApi = {
        ...baseClient,
        captureWindow: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.captureWindow(input)))
      }
      const layer = makeDisplayCaptureServiceLayer(client, {
        permissions,
        grants: grantAuthority()
      })
      const runtime = ManagedRuntime.make(layer)
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const capture = yield* DisplayCapture
            return yield* Effect.exit(
              capture.captureWindow({
                actor: actor(),
                grant: grant(),
                target: {
                  source: "window",
                  windowId: "\0"
                }
              })
            )
          })
        )
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "DisplayCapture.captureWindow"
        })
      })
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DisplayCapture surfaces injected host failure and audits failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissionsEffect(rows)
      const failure = internalFailure("host failed", "DisplayCapture.captureDisplay")
      const client = yield* makeDisplayCaptureMemoryClient({
        failure: { captureDisplay: failure }
      })
      const layer = makeDisplayCaptureServiceLayer(client, {
        permissions,
        grants: grantAuthority(),
        audit: memoryAudit(rows)
      })
      const runtime = ManagedRuntime.make(layer)
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const capture = yield* DisplayCapture
            return yield* Effect.exit(capture.captureDisplay(displayRequest()))
          })
        )
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "DisplayCapture.captureDisplay"
        })
      })
      expect(rows.some((row) => row.outcome === "failed")).toBe(true)
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DisplayCapture unsupported client fails through public service layer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissionsEffect([])
      const layer = makeDisplayCaptureServiceLayer(makeDisplayCaptureUnsupportedClient(), {
        permissions,
        grants: grantAuthority()
      })
      const runtime = ManagedRuntime.make(layer)
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const capture = yield* DisplayCapture
            return yield* Effect.exit(capture.captureDisplay(displayRequest()))
          })
        )
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "DisplayCapture.captureDisplay"
        })
      })
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DisplayCapture emits substitutable capture events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissionsEffect([])
      const client = yield* makeDisplayCaptureMemoryClient({
        nextCaptureId: () => "capture-event"
      })
      const layer = makeDisplayCaptureServiceLayer(client, {
        permissions,
        grants: grantAuthority()
      })
      const runtime = ManagedRuntime.make(layer)
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const capture = yield* DisplayCapture
            const image = yield* capture.captureDisplay(displayRequest())
            const event = yield* capture
              .events()
              .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
            return { event, image }
          })
        )
      )

      expect(result.image.metadata.captureId).toBe("capture-event")
      expect(result.event).toMatchObject({
        phase: "captured",
        captureId: "capture-event",
        source: "display"
      })
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DisplayCapture rejects mismatched image header", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissionsEffect([])
      const baseClient = yield* makeDisplayCaptureMemoryClient()
      const client: DisplayCaptureClientApi = {
        ...baseClient,
        captureDisplay: (input) =>
          baseClient.captureDisplay(input).pipe(
            Effect.map(
              (result) =>
                new DisplayCaptureResult({
                  image: new DisplayCaptureImage({
                    mime: "image/jpeg",
                    bytes: result.image.bytes
                  }),
                  metadata: result.metadata
                })
            )
          )
      }
      const layer = makeDisplayCaptureServiceLayer(client, {
        permissions,
        grants: grantAuthority(),
        audit: memoryAudit(rows)
      })
      const runtime = ManagedRuntime.make(layer)
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const capture = yield* DisplayCapture
            return yield* Effect.exit(capture.captureDisplay(displayRequest()))
          })
        )
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidOutput",
          operation: "DisplayCapture.captureDisplay"
        })
      })
      expect(rows.some((row) => row.outcome === "failed")).toBe(true)
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DisplayCapture emits substitutable failure events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const failure = internalFailure("host failed", "DisplayCapture.captureDisplay")
      const client = yield* makeDisplayCaptureMemoryClient({
        failure: { captureDisplay: failure },
        nextCaptureId: () => "capture-failed"
      })
      const event = yield* client
        .captureDisplay(displayRequest())
        .pipe(
          Effect.ignore,
          Effect.andThen(client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow)))
        )

      expect(event).toMatchObject({
        phase: "failed",
        captureId: "capture-failed",
        source: "display",
        reason: "Internal"
      })
    })
  ))

test("DisplayCapture bridge client fails event stream as unsupported before subscribing", () => {
  const subscriptions: string[] = []
  const exchange: BridgeClientExchange = {
    request: () => Effect.die("unexpected request"),
    subscribe: (method) => {
      subscriptions.push(method)
      return Stream.empty
    }
  }
  const runtime = ManagedRuntime.make(makeDisplayCaptureBridgeClientLayer(exchange))
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* DisplayCaptureClient
      const exit = yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "DisplayCapture.Event"
        })
      })
      expect(subscriptions).toEqual([])
    })
  )
})

const configuredPermissionsEffect = (rows: AuditEvent[]) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "DisplayCapture", methods: ["captureDisplay"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "DisplayCapture", methods: ["captureWindow"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "DisplayCapture", methods: ["captureRegion"] })
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

const internalFailure = (message: string, operation: string) =>
  new HostProtocolInternalError({
    tag: "Internal",
    message,
    operation,
    recoverable: false
  })

const actor = () => new DisplayCaptureActor({ kind: "workspace", id: "workspace-1" })

const grant = () => new DisplayCaptureGrant({ kind: "policy", id: "grant-1" })

const grantAuthority = () =>
  makeDisplayCaptureGrantAuthority(new Set(["policy:grant-1", "user:grant-1"]))

const displayRequest = () =>
  new DisplayCaptureDisplayRequest({
    actor: actor(),
    grant: grant(),
    target: new DisplayCaptureDisplayTarget({
      source: "display",
      displayId: "display-1"
    })
  })

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}

const serialize = (value: unknown): string => {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString()
  }
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "function") return value.toString()
  if (value instanceof Uint8Array) return Array.from(value).join(",")
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => `${key}:${serialize(child)}`)
    .join(",")
  return `{${entries}}`
}
