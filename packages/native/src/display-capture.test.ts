import { expect, test } from "bun:test"
import { type BridgeClientExchange, HostProtocolInternalError } from "@effect-desktop/bridge"
import { type AuditEvent, makePermissionRegistry, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

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

test("DisplayCapture captures image bytes with redacted audit metadata", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const client = await Effect.runPromise(
    makeDisplayCaptureMemoryClient({ nextCaptureId: () => "capture-1" })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const capture = yield* DisplayCapture
      return yield* capture.captureDisplay(displayRequest())
    }).pipe(
      Effect.provide(
        makeDisplayCaptureServiceLayer(client, {
          permissions,
          grants: grantAuthority(),
          audit: memoryAudit(rows)
        })
      )
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
  expect(JSON.stringify(rows)).not.toContain(Array.from(result.image.bytes).join(","))
})

test("DisplayCapture denies before client side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const baseClient = await Effect.runPromise(makeDisplayCaptureMemoryClient())
  let calls = 0
  const client: DisplayCaptureClientApi = {
    ...baseClient,
    captureDisplay: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.captureDisplay(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const capture = yield* DisplayCapture
      return yield* Effect.exit(capture.captureDisplay(displayRequest()))
    }).pipe(
      Effect.provide(
        makeDisplayCaptureServiceLayer(client, { permissions, grants: grantAuthority() })
      )
    )
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "PermissionDenied",
      operation: "DisplayCapture.captureDisplay"
    })
  })
})

test("DisplayCapture rejects malformed input before client calls", async () => {
  const permissions = await configuredPermissions([])
  const baseClient = await Effect.runPromise(makeDisplayCaptureMemoryClient())
  let calls = 0
  const client: DisplayCaptureClientApi = {
    ...baseClient,
    captureWindow: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.captureWindow(input)))
  }

  const exit = await Effect.runPromise(
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
    }).pipe(
      Effect.provide(
        makeDisplayCaptureServiceLayer(client, { permissions, grants: grantAuthority() })
      )
    )
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "DisplayCapture.captureWindow"
    })
  })
})

test("DisplayCapture surfaces injected host failure and audits failure", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const failure = internalFailure("host failed", "DisplayCapture.captureDisplay")
  const client = await Effect.runPromise(
    makeDisplayCaptureMemoryClient({ failure: { captureDisplay: failure } })
  )

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const capture = yield* DisplayCapture
      return yield* Effect.exit(capture.captureDisplay(displayRequest()))
    }).pipe(
      Effect.provide(
        makeDisplayCaptureServiceLayer(client, {
          permissions,
          grants: grantAuthority(),
          audit: memoryAudit(rows)
        })
      )
    )
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Internal",
      operation: "DisplayCapture.captureDisplay"
    })
  })
  expect(rows.some((row) => row.outcome === "failed")).toBe(true)
})

test("DisplayCapture unsupported client fails through public service layer", async () => {
  const permissions = await configuredPermissions([])

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const capture = yield* DisplayCapture
      return yield* Effect.exit(capture.captureDisplay(displayRequest()))
    }).pipe(
      Effect.provide(
        makeDisplayCaptureServiceLayer(makeDisplayCaptureUnsupportedClient(), {
          permissions,
          grants: grantAuthority()
        })
      )
    )
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Unsupported",
      operation: "DisplayCapture.captureDisplay"
    })
  })
})

test("DisplayCapture emits substitutable capture events", async () => {
  const permissions = await configuredPermissions([])
  const client = await Effect.runPromise(
    makeDisplayCaptureMemoryClient({ nextCaptureId: () => "capture-event" })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const capture = yield* DisplayCapture
      const image = yield* capture.captureDisplay(displayRequest())
      const event = yield* capture.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { event, image }
    }).pipe(
      Effect.provide(
        makeDisplayCaptureServiceLayer(client, { permissions, grants: grantAuthority() })
      )
    )
  )

  expect(result.image.metadata.captureId).toBe("capture-event")
  expect(result.event).toMatchObject({
    phase: "captured",
    captureId: "capture-event",
    source: "display"
  })
})

test("DisplayCapture rejects mismatched image header", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions([])
  const baseClient = await Effect.runPromise(makeDisplayCaptureMemoryClient())
  const client: DisplayCaptureClientApi = {
    ...baseClient,
    captureDisplay: (input) =>
      baseClient.captureDisplay(input).pipe(
        Effect.map(
          (result) =>
            new DisplayCaptureResult({
              image: new DisplayCaptureImage({ mime: "image/jpeg", bytes: result.image.bytes }),
              metadata: result.metadata
            })
        )
      )
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const capture = yield* DisplayCapture
      return yield* Effect.exit(capture.captureDisplay(displayRequest()))
    }).pipe(
      Effect.provide(
        makeDisplayCaptureServiceLayer(client, {
          permissions,
          grants: grantAuthority(),
          audit: memoryAudit(rows)
        })
      )
    )
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidOutput",
      operation: "DisplayCapture.captureDisplay"
    })
  })
  expect(rows.some((row) => row.outcome === "failed")).toBe(true)
})

test("DisplayCapture emits substitutable failure events", async () => {
  const failure = internalFailure("host failed", "DisplayCapture.captureDisplay")
  const client = await Effect.runPromise(
    makeDisplayCaptureMemoryClient({
      failure: { captureDisplay: failure },
      nextCaptureId: () => "capture-failed"
    })
  )

  const event = await Effect.runPromise(
    client
      .captureDisplay(displayRequest())
      .pipe(
        Effect.ignore,
        Effect.andThen(client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow)))
      )
  )

  expect(event).toMatchObject({
    phase: "failed",
    captureId: "capture-failed",
    source: "display",
    reason: "Internal"
  })
})

test("DisplayCapture bridge client fails event stream as unsupported before subscribing", async () => {
  const subscriptions: string[] = []
  const exchange: BridgeClientExchange = {
    request: () => Effect.die("unexpected request"),
    subscribe: (method) => {
      subscriptions.push(method)
      return Stream.empty
    }
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* DisplayCaptureClient
      return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
    }).pipe(Effect.provide(makeDisplayCaptureBridgeClientLayer(exchange)))
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Unsupported",
      reason: "host-adapter-unimplemented",
      operation: "DisplayCapture.Event"
    })
  })
  expect(subscriptions).toEqual([])
})

const configuredPermissions = async (rows: AuditEvent[]) => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
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
  )
  rows.length = 0
  return permissions
}

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
