import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInternalError,
  HostProtocolInvalidOutputError,
  type HostProtocolRequestEnvelope
} from "@orika/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  type NormalizedCapability,
  P
} from "@orika/core"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Option, Schema, Stream } from "effect"

import {
  DistributionParity,
  DistributionParityClient,
  type DistributionParityClientApi,
  makeDistributionParityBridgeClientLayer,
  makeDistributionParityMemoryClient,
  makeDistributionParityServiceLayer,
  makeDistributionParityUnsupportedClient
} from "./distribution-parity.js"
import {
  DistributionParityEvidence,
  DistributionParityEvent,
  DistributionParityVerifyRequest
} from "./contracts/distribution-parity.js"

test("DistributionParity verifies package, plugin, template, and docs evidence", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions()
      const client = yield* makeDistributionParityMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          const verified = yield* parity.verify(verifyRequest())
          const event = yield* parity.events().pipe(Stream.runHead)
          return { event, verified }
        }),
        makeDistributionParityServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows)
        })
      )

      expect(result.verified).toMatchObject({
        packageId: "extension-1",
        version: "1.0.0",
        capabilityCount: 1,
        evidenceCount: 4
      })
      expect(result.event._tag).toBe("Some")
      expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
    })
  ))

test("DistributionParity contracts reject inconsistent event phase payloads", () => {
  for (const payload of [
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "verified",
      packageId: "extension-1"
    },
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "verified",
      packageId: "extension-1",
      version: "1.0.0",
      reason: "host failed"
    },
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      packageId: "extension-1",
      version: "1.0.0"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(DistributionParityEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "verified",
      packageId: "extension-1",
      version: "1.0.0"
    },
    {
      type: "distribution-parity-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      packageId: "extension-1",
      version: "1.0.0",
      reason: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(DistributionParityEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("DistributionParity bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("DistributionParity event test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "distribution-parity-event-trace",
              payload: {
                type: "distribution-parity-event",
                timestamp: 1_710_000_000_000,
                phase: "verified",
                packageId: "extension-1",
                reason: "bad shape"
              }
            })
          )
      }
      const permissions = yield* configuredPermissions()
      const client = yield* runScoped(
        Effect.gen(function* () {
          return yield* DistributionParityClient
        }),
        makeDistributionParityBridgeClientLayer(exchange)
      )

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(
            parity.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        makeDistributionParityServiceLayer(client, { permissions })
      )

      expectInvalidOutput(exit)
    })
  ))

test("DistributionParity denies before host verification", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* makePermissionRegistry()
      const baseClient = yield* makeDistributionParityMemoryClient()
      let calls = 0
      const client: DistributionParityClientApi = {
        ...baseClient,
        verify: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.verify(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(parity.verify(verifyRequest()))
        }),
        makeDistributionParityServiceLayer(client, { permissions, audit: memoryAudit(rows) })
      )

      expect(calls).toBe(0)
      expect(rows.some((row) => row.kind === "permission-denied")).toBe(true)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "DistributionParity.verify"
        })
      })
    })
  ))

test("DistributionParity rejects mismatched capability evidence before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: {
              packageId: "extension-1",
              version: "1.0.0",
              capabilityCount: 1,
              evidenceCount: 4
            }
          })
        },
        subscribe: () => Stream.empty
      }

      const permissions = yield* configuredPermissions()
      const client = yield* runScoped(
        Effect.gen(function* () {
          const c = yield* DistributionParityClient
          return c
        }),
        makeDistributionParityBridgeClientLayer(exchange)
      )

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(
            parity.verify(
              verifyRequest({
                evidence: [
                  evidence("package-artifact"),
                  evidence("plugin-registration"),
                  evidence("template", [P.filesystemWrite({ roots: ["/tmp/extensions"] })]),
                  evidence("docs")
                ]
              })
            )
          )
        }),
        makeDistributionParityServiceLayer(client, { permissions, audit: memoryAudit(rows) })
      )

      expect(requests).toEqual([])
      expect(rows.some((row) => row.kind === "permission-used" && row.outcome === "failed")).toBe(
        true
      )
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "DistributionParity.verify"
        })
      })
    })
  ))

test("DistributionParity returns typed unsupported and host failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const unsupported = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(parity.verify(verifyRequest()))
        }),
        makeDistributionParityServiceLayer(makeDistributionParityUnsupportedClient(), {
          permissions
        })
      )
      expectExitFailure(unsupported, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "DistributionParity.verify" })
      })

      const rows: AuditEvent[] = []
      const failure = new HostProtocolInternalError({
        tag: "Internal",
        operation: "DistributionParity.verify",
        message: "host failed",
        recoverable: false
      })
      const failing = yield* makeDistributionParityMemoryClient({ failure: { verify: failure } })
      const failed = yield* runScoped(
        Effect.gen(function* () {
          const parity = yield* DistributionParity
          return yield* Effect.exit(parity.verify(verifyRequest()))
        }),
        makeDistributionParityServiceLayer(failing, { permissions, audit: memoryAudit(rows) })
      )
      expect(rows.some((row) => row.kind === "permission-used" && row.outcome === "failed")).toBe(
        true
      )
      expectExitFailure(failed, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "DistributionParity.verify" })
      })
    })
  ))

const configuredPermissions = () =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* permissions.declare(
      P.nativeInvoke({ primitive: "DistributionParity", methods: ["verify"] })
    )
    return permissions
  })

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const capability = (): NormalizedCapability => P.filesystemRead({ roots: ["/tmp/extensions"] })

const evidence = (kind: DistributionParityEvidence["kind"], capabilities = [capability()]) =>
  new DistributionParityEvidence({
    kind,
    id: kind,
    path: `docs/${kind}.md`,
    sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    capabilities
  })

const verifyRequest = (input: Partial<DistributionParityVerifyRequest> = {}) =>
  new DistributionParityVerifyRequest({
    packageId: "extension-1",
    version: "1.0.0",
    capabilities: [capability()],
    evidence: [
      evidence("package-artifact"),
      evidence("plugin-registration"),
      evidence("template"),
      evidence("docs")
    ],
    traceId: "trace-distribution",
    ...input
  })

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

const expectExitFailure = <A>(exit: Exit.Exit<A, unknown>, assert: (error: unknown) => void) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
