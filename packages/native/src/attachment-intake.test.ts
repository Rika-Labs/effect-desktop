import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@orika/bridge"
import { type AuditEvent, makePermissionRegistry, P } from "@orika/core"
import { Cause, Effect, Exit, ManagedRuntime, Option, Stream } from "effect"

import {
  AttachmentIntake,
  type AttachmentIntakeClientApi,
  makeAttachmentIntakeMemoryClient,
  makeAttachmentIntakeServiceLayer,
  makeAttachmentIntakeUnsupportedClient
} from "./attachment-intake.js"
import {
  AttachmentIntakeActor,
  AttachmentIntakeIngestRequest,
  AttachmentIntakeItemInput,
  AttachmentIntakePolicy
} from "./contracts/attachment-intake.js"

const encoder = new TextEncoder()

test("AttachmentIntake ingests, inspects, disposes, emits events, and audits use", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const client = yield* makeAttachmentIntakeMemoryClient({
        nextIntakeId: () => "intake-1",
        nextItemId: () => "item-1"
      })

      const runtime = ManagedRuntime.make(
        makeAttachmentIntakeServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextIntakeId: () => "intake-1",
          nextTraceId: () => "trace-intake"
        })
      )

      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const intake = yield* AttachmentIntake
            const ingested = yield* intake.ingest(ingestRequest())
            const inspected = yield* intake.inspect({ intakeId: ingested.intakeId })
            const disposed = yield* intake.dispose({ intakeId: ingested.intakeId })
            const event = yield* intake.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
            return { disposed, event, ingested, inspected }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.ingested).toMatchObject({ intakeId: "intake-1", state: "ingested" })
      expect(result.ingested.items).toEqual([
        expect.objectContaining({
          itemId: "item-1",
          mimeType: "text/plain",
          sizeBytes: 5
        })
      ])
      expect(result.inspected.items).toHaveLength(1)
      expect(result.disposed).toMatchObject({ intakeId: "intake-1", disposed: true })
      expect(result.event.phase).toBe("ingested")
      expect(rows.some((row) => row.source === "AttachmentIntake.ingest")).toBe(true)
      expect(rows.some((row) => row.source === "AttachmentIntake.inspect")).toBe(true)
      expect(rows.some((row) => row.source === "AttachmentIntake.dispose")).toBe(true)
    })
  ))

test("AttachmentIntake enforces MIME, size, count, and lifetime policy before client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const baseClient = yield* makeAttachmentIntakeMemoryClient()
      let calls = 0
      const client: AttachmentIntakeClientApi = {
        ...baseClient,
        ingest: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.ingest(input)))
      }

      const runtime = ManagedRuntime.make(makeAttachmentIntakeServiceLayer(client, { permissions }))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const intake = yield* AttachmentIntake
            return yield* Effect.exit(
              intake.ingest(
                ingestRequest({
                  policy: new AttachmentIntakePolicy({
                    allowedMimeTypes: ["image/png"],
                    maxItems: 1,
                    maxBytesPerItem: 1,
                    maxTotalBytes: 1,
                    lifetimeMillis: 1
                  })
                })
              )
            )
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "AttachmentIntake.ingest"
        })
      })
    })
  ))

test("AttachmentIntake rejects expired intake metadata before exposing it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const client = yield* makeAttachmentIntakeMemoryClient({
        nextIntakeId: () => "intake-1",
        nextItemId: () => "item-1"
      })

      const runtime = ManagedRuntime.make(makeAttachmentIntakeServiceLayer(client, { permissions }))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const intake = yield* AttachmentIntake
            const ingested = yield* intake.ingest(
              ingestRequest({
                policy: new AttachmentIntakePolicy({
                  allowedMimeTypes: ["text/plain"],
                  maxItems: 1,
                  maxBytesPerItem: 1024,
                  maxTotalBytes: 1024,
                  lifetimeMillis: 1
                })
              })
            )
            yield* Effect.sleep("5 millis")
            return yield* Effect.exit(intake.inspect({ intakeId: ingested.intakeId }))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "AttachmentIntake.inspect"
        })
      })
    })
  ))

test("AttachmentIntake denies ingest before client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const baseClient = yield* makeAttachmentIntakeMemoryClient()
      let calls = 0
      const client: AttachmentIntakeClientApi = {
        ...baseClient,
        ingest: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.ingest(input)))
      }

      const runtime = ManagedRuntime.make(makeAttachmentIntakeServiceLayer(client, { permissions }))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const intake = yield* AttachmentIntake
            return yield* Effect.exit(intake.ingest(ingestRequest()))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "AttachmentIntake.ingest"
        })
      })
    })
  ))

test("AttachmentIntake surfaces injected host failure as typed failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const failure = makeHostProtocolInternalError("host failed", "AttachmentIntake.ingest")
      const client = yield* makeAttachmentIntakeMemoryClient({ failure: { ingest: failure } })

      const runtime = ManagedRuntime.make(makeAttachmentIntakeServiceLayer(client, { permissions }))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const intake = yield* AttachmentIntake
            return yield* Effect.exit(intake.ingest(ingestRequest()))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "AttachmentIntake.ingest"
        })
      })
    })
  ))

test("AttachmentIntake unsupported client validates then fails closed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeAttachmentIntakeUnsupportedClient()
      const support = yield* client.isSupported()
      const exit = yield* Effect.exit(client.ingest(ingestRequest()))

      expect(support).toMatchObject({ supported: false, reason: "host-adapter-unimplemented" })
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "AttachmentIntake.ingest"
        })
      })
    })
  ))

const configuredPermissions = (rows: AuditEvent[]) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "AttachmentIntake", methods: ["ingest"] })),
      permissions.declare(P.nativeInvoke({ primitive: "AttachmentIntake", methods: ["inspect"] })),
      permissions.declare(P.nativeInvoke({ primitive: "AttachmentIntake", methods: ["dispose"] }))
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

const actor = () => new AttachmentIntakeActor({ kind: "workspace", id: "workspace-1" })

const policy = () =>
  new AttachmentIntakePolicy({
    allowedMimeTypes: ["text/plain"],
    maxItems: 2,
    maxBytesPerItem: 1024,
    maxTotalBytes: 2048,
    lifetimeMillis: 60_000
  })

const item = () =>
  new AttachmentIntakeItemInput({
    name: "note.txt",
    mimeType: "text/plain",
    source: "provided-by-caller",
    bytes: encoder.encode("hello")
  })

const ingestRequest = (
  options: {
    readonly policy?: AttachmentIntakePolicy
  } = {}
) =>
  new AttachmentIntakeIngestRequest({
    actor: actor(),
    policy: options.policy ?? policy(),
    items: [item()]
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
