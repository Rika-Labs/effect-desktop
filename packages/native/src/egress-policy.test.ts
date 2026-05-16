import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolRequestEnvelope,
  type HostProtocolError,
  makeHostProtocolInternalError
} from "@effect-desktop/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  EgressPolicy,
  EgressPolicyClient,
  makeEgressPolicyBridgeClientLayer,
  makeEgressPolicyMemoryClient,
  makeEgressPolicyServiceLayer,
  makeEgressPolicyUnsupportedClient
} from "./egress-policy.js"
import {
  EgressPolicyActor,
  EgressPolicyDecisionInput,
  EgressPolicyDecisionRequest,
  EgressPolicyDestination,
  EgressPolicyRecordRequest,
  EgressPolicyRule
} from "./contracts/egress-policy.js"

test("EgressPolicy service allows matching egress and records an auditable decision event", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1",
      now: () => 1_710_000_000_000
    })
  )
  await Effect.runPromise(
    permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }), { source: "test" })
  )
  const client = await Effect.runPromise(
    makeEgressPolicyMemoryClient({ nextDecisionId: () => "decision-allow" })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicy
      const decision = yield* policy.decide(decisionRequest())
      const record = yield* policy.record(
        new EgressPolicyRecordRequest({ decisionId: decision.decisionId })
      )
      const event = yield* policy.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { decision, event, record }
    }).pipe(
      Effect.provide(
        makeEgressPolicyServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          rules: [allowRule()],
          nextDecisionId: () => "decision-allow",
          nextTraceId: () => "trace-egress"
        })
      )
    )
  )

  expect(result.decision.outcome).toBe("allowed")
  expect(result.decision.rule.id).toBe("allow-api")
  expect(result.record.recorded).toBe(true)
  expect(result.event.decision.decisionId).toBe("decision-allow")
  expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
})

test("EgressPolicy service fails denied policy decisions and audits actor destination and rule", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
  )
  await Effect.runPromise(
    permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }), { source: "test" })
  )
  const client = await Effect.runPromise(
    makeEgressPolicyMemoryClient({ nextDecisionId: () => "decision-deny" })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicy
      const exit = yield* Effect.exit(policy.decide(decisionRequest()))
      const event = yield* policy.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { event, exit }
    }).pipe(
      Effect.provide(
        makeEgressPolicyServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          rules: [denyRule(), allowRule()],
          nextTraceId: () => "trace-egress"
        })
      )
    )
  )

  expectExitFailure(result.exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "EgressPolicy.decide" })
  })
  expect(result.event.decision.rule.id).toBe("deny-api")
  expect(
    rows.some(
      (row) =>
        row.kind === "permission-denied" &&
        hasAuditRule(row, "deny-api") &&
        hasAuditDestination(row, "api.example.test")
    )
  ).toBe(true)
})

test("EgressPolicy service checks permission before client side effects", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
  )
  let calls = 0
  const client = {
    decide: () => {
      calls += 1
      return Effect.succeed(allowDecision())
    },
    record: () => Effect.succeed({ decisionId: "unused", recorded: true }),
    isSupported: () => Effect.succeed({ supported: true }),
    events: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicy
      return yield* Effect.exit(policy.decide(decisionRequest()))
    }).pipe(
      Effect.provide(
        makeEgressPolicyServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          rules: [allowRule()],
          nextTraceId: () => "trace-egress"
        })
      )
    )
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "EgressPolicy.decide" })
  })
  expect(
    rows.some((row) => row.kind === "permission-denied" && hasAuditRule(row, "permission-registry"))
  ).toBe(true)
})

test("EgressPolicy service rejects forged record requests before client side effects", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(makePermissionRegistry())
  let calls = 0
  const client = {
    decide: () => Effect.succeed(allowDecision()),
    record: () => {
      calls += 1
      return Effect.succeed({ decisionId: "forged", recorded: true })
    },
    isSupported: () => Effect.succeed({ supported: true }),
    events: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicy
      return yield* Effect.exit(
        policy.record(new EgressPolicyRecordRequest({ decisionId: "forged" }))
      )
    }).pipe(
      Effect.provide(
        makeEgressPolicyServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          rules: [allowRule()]
        })
      )
    )
  )

  expect(calls).toBe(0)
  expect(rows).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "EgressPolicy.record" })
  })
})

test("EgressPolicy service mints unique default decision ids", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }), { source: "test" })
  )
  const client = await Effect.runPromise(makeEgressPolicyMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicy
      const first = yield* policy.decide(decisionRequest())
      const second = yield* policy.decide(decisionRequest())
      return { first, second }
    }).pipe(
      Effect.provide(
        makeEgressPolicyServiceLayer(client, {
          permissions,
          rules: [allowRule()]
        })
      )
    )
  )

  expect(result.first.decisionId).toBe("egress-decision-1")
  expect(result.second.decisionId).toBe("egress-decision-2")
})

test("EgressPolicy bridge client rejects malformed input before native transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({ kind: "success", payload: allowDecision() })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicyClient
      return yield* Effect.exit(policy.decide(invalidDecisionInput()))
    }).pipe(Effect.provide(makeEgressPolicyBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "EgressPolicy.decide" })
  })
})

test("EgressPolicy unsupported client exposes typed unsupported failures", async () => {
  const client = makeEgressPolicyUnsupportedClient()
  const supported = await Effect.runPromise(client.isSupported())
  const exit = await Effect.runPromiseExit(client.decide(allowInput()))

  expect(supported).toEqual({ supported: false, reason: "host-adapter-unimplemented" })
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "EgressPolicy.decide" })
  })
})

test("EgressPolicy memory client exposes typed host failures", async () => {
  const client = await Effect.runPromise(
    makeEgressPolicyMemoryClient({
      failure: {
        decide: makeHostProtocolInternalError("host egress policy failed", "EgressPolicy.decide")
      }
    })
  )

  const exit = await Effect.runPromiseExit(client.decide(allowInput()))

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "EgressPolicy.decide" })
  })
})

test("EgressPolicy bridge client does not forward caller-supplied rules", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({ kind: "success", payload: allowDecision() })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicyClient
      return yield* Effect.exit(policy.decide(callerSuppliedRuleInput()))
    }).pipe(Effect.provide(makeEgressPolicyBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "EgressPolicy.decide" })
  })
})

const actor = (): EgressPolicyActor =>
  new EgressPolicyActor({ kind: "extension", id: "extension-1" })

const destination = (): EgressPolicyDestination =>
  new EgressPolicyDestination({
    protocol: "https",
    host: "api.example.test",
    port: 443,
    path: "/v1"
  })

const allowRule = (): EgressPolicyRule =>
  new EgressPolicyRule({
    id: "allow-api",
    effect: "allow",
    hosts: ["api.example.test"],
    protocols: ["https"],
    ports: [443],
    reason: "workspace policy allows API access"
  })

const denyRule = (): EgressPolicyRule =>
  new EgressPolicyRule({
    id: "deny-api",
    effect: "deny",
    hosts: ["api.example.test"],
    protocols: ["https"],
    ports: [443],
    reason: "workspace policy blocks API access"
  })

const allowInput = (): EgressPolicyDecisionInput =>
  new EgressPolicyDecisionInput({
    actor: actor(),
    destination: destination(),
    traceId: "trace-egress"
  })

const decisionRequest = (): EgressPolicyDecisionRequest =>
  new EgressPolicyDecisionRequest({
    actor: actor(),
    destination: destination(),
    traceId: "trace-egress"
  })

const allowDecision = () => ({
  decisionId: "decision-allow",
  outcome: "allowed" as const,
  actor: actor(),
  destination: destination(),
  rule: allowRule(),
  reason: "workspace policy allows API access"
})

const invalidDecisionInput = (): EgressPolicyDecisionInput => {
  const input = allowInput()
  Object.defineProperty(input.destination, "host", { value: "api.example.test\nforged" })
  return input
}

const callerSuppliedRuleInput = (): EgressPolicyDecisionInput => {
  const input = allowInput()
  Object.defineProperty(input, "rules", { value: [allowRule()] })
  return input
}

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}

const hasAuditRule = (event: AuditEvent, ruleId: string): boolean =>
  isAuditDetails(event.details) && event.details.rule.id === ruleId

const hasAuditDestination = (event: AuditEvent, host: string): boolean =>
  isAuditDetails(event.details) && event.details.destination.host === host

const isAuditDetails = (
  value: unknown
): value is {
  readonly rule: { readonly id: string }
  readonly destination: { readonly host: string }
} =>
  typeof value === "object" &&
  value !== null &&
  "rule" in value &&
  "destination" in value &&
  typeof value.rule === "object" &&
  value.rule !== null &&
  "id" in value.rule &&
  typeof value.rule.id === "string" &&
  typeof value.destination === "object" &&
  value.destination !== null &&
  "host" in value.destination &&
  typeof value.destination.host === "string"
