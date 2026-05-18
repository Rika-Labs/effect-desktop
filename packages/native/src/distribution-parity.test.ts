import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolInternalError,
  type HostProtocolRequestEnvelope
} from "@effect-desktop/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  type NormalizedCapability,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Stream } from "effect"

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
  DistributionParityVerifyRequest
} from "./contracts/distribution-parity.js"

test("DistributionParity verifies package, plugin, template, and docs evidence", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeDistributionParityMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const parity = yield* DistributionParity
      const verified = yield* parity.verify(verifyRequest())
      const event = yield* parity.events().pipe(Stream.runHead)
      return { event, verified }
    }).pipe(
      Effect.provide(
        makeDistributionParityServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows)
        })
      )
    )
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

test("DistributionParity denies before host verification", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const baseClient = await Effect.runPromise(makeDistributionParityMemoryClient())
  let calls = 0
  const client: DistributionParityClientApi = {
    ...baseClient,
    verify: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.verify(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const parity = yield* DistributionParity
      return yield* Effect.exit(parity.verify(verifyRequest()))
    }).pipe(
      Effect.provide(
        makeDistributionParityServiceLayer(client, { permissions, audit: memoryAudit(rows) })
      )
    )
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

test("DistributionParity rejects mismatched capability evidence before transport", async () => {
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

  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* DistributionParityClient
    }).pipe(Effect.provide(makeDistributionParityBridgeClientLayer(exchange)))
  )

  const exit = await Effect.runPromise(
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
    }).pipe(
      Effect.provide(
        makeDistributionParityServiceLayer(client, { permissions, audit: memoryAudit(rows) })
      )
    )
  )

  expect(requests).toEqual([])
  expect(rows.some((row) => row.kind === "permission-used" && row.outcome === "failed")).toBe(true)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "DistributionParity.verify"
    })
  })
})

test("DistributionParity returns typed unsupported and host failures", async () => {
  const permissions = await configuredPermissions()
  const unsupported = await Effect.runPromise(
    Effect.gen(function* () {
      const parity = yield* DistributionParity
      return yield* Effect.exit(parity.verify(verifyRequest()))
    }).pipe(
      Effect.provide(
        makeDistributionParityServiceLayer(makeDistributionParityUnsupportedClient(), {
          permissions
        })
      )
    )
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
  const failing = await Effect.runPromise(
    makeDistributionParityMemoryClient({ failure: { verify: failure } })
  )
  const failed = await Effect.runPromise(
    Effect.gen(function* () {
      const parity = yield* DistributionParity
      return yield* Effect.exit(parity.verify(verifyRequest()))
    }).pipe(
      Effect.provide(
        makeDistributionParityServiceLayer(failing, { permissions, audit: memoryAudit(rows) })
      )
    )
  )
  expect(rows.some((row) => row.kind === "permission-used" && row.outcome === "failed")).toBe(true)
  expectExitFailure(failed, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "DistributionParity.verify" })
  })
})

const configuredPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    permissions.declare(P.nativeInvoke({ primitive: "DistributionParity", methods: ["verify"] }))
  )
  return permissions
}

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

const expectExitFailure = <A>(exit: Exit.Exit<A, unknown>, assert: (error: unknown) => void) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
