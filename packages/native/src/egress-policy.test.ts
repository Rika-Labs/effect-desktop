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
import { Cause, Effect, Exit, ManagedRuntime, Option, Stream } from "effect"

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
  EgressPolicyRecordInput,
  EgressPolicyRecordRequest,
  EgressPolicyRule
} from "./contracts/egress-policy.js"

test("EgressPolicy service allows matching egress and records an auditable decision event", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* makePermissionRegistry({
        audit: memoryAudit(rows),
        traceId: () => "trace-permission",
        nextToken: () => "grant-1",
        now: () => 1_710_000_000_000
      })
      yield* permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }), {
        source: "test"
      })
      const client = yield* makeEgressPolicyMemoryClient({
        nextDecisionId: () => "decision-allow"
      })
      const layer = makeEgressPolicyServiceLayer(client, {
        permissions,
        audit: memoryAudit(rows),
        rules: [allowRule()],
        nextTraceId: () => "trace-egress"
      })
      const runtime = ManagedRuntime.make(layer)
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const policy = yield* EgressPolicy
            const decision = yield* policy.decide(decisionRequest())
            const record = yield* policy.record(
              new EgressPolicyRecordRequest({ decisionId: decision.decisionId })
            )
            const event = yield* policy.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
            return { decision, event, record }
          })
        )
      )

      expect(result.decision.outcome).toBe("allowed")
      expect(result.decision.rule.id).toBe("allow-api")
      expect(result.record.recorded).toBe(true)
      expect(result.event.decision.decisionId).toBe("decision-allow")
      expect(result.event.decision.outcome).toBe("allowed")
      expect(result.event.decision.rule.id).toBe("allow-api")
      expect(result.event.decision.actor.id).toBe("extension-1")
      expect(result.event.decision.destination.host).toBe("api.example.test")
      expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("EgressPolicy service fails denied policy decisions and audits actor destination and rule", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* makePermissionRegistry({
        audit: memoryAudit(rows),
        traceId: () => "trace-permission",
        nextToken: () => "grant-1"
      })
      yield* permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }), {
        source: "test"
      })
      const client = yield* makeEgressPolicyMemoryClient({ nextDecisionId: () => "decision-deny" })
      const layer = makeEgressPolicyServiceLayer(client, {
        permissions,
        audit: memoryAudit(rows),
        rules: [denyRule(), allowRule()],
        nextTraceId: () => "trace-egress"
      })
      const runtime = ManagedRuntime.make(layer)
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const policy = yield* EgressPolicy
            return yield* Effect.exit(policy.decide(decisionRequest()))
          })
        )
      )

      expectExitFailure(result, (error) => {
        expect(error).toMatchObject({ tag: "PermissionDenied", operation: "EgressPolicy.decide" })
      })
      expect(
        rows.some(
          (row) =>
            row.kind === "permission-denied" &&
            hasAuditRule(row, "deny-api") &&
            hasAuditDestination(row, "api.example.test")
        )
      ).toBe(true)
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("EgressPolicy service checks permission before client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* makePermissionRegistry({
        audit: memoryAudit(rows),
        traceId: () => "trace-permission",
        nextToken: () => "grant-1"
      })
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
      const layer = makeEgressPolicyServiceLayer(client, {
        permissions,
        audit: memoryAudit(rows),
        rules: [allowRule()],
        nextTraceId: () => "trace-egress"
      })
      const runtime = ManagedRuntime.make(layer)
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const policy = yield* EgressPolicy
            return yield* Effect.exit(policy.decide(decisionRequest()))
          })
        )
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "PermissionDenied", operation: "EgressPolicy.decide" })
      })
      expect(
        rows.some(
          (row) => row.kind === "permission-denied" && hasAuditRule(row, "permission-registry")
        )
      ).toBe(true)
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("EgressPolicy service receives typed unknown decision failures from the host client", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* makePermissionRegistry()
      const client = yield* makeEgressPolicyMemoryClient()
      const layer = makeEgressPolicyServiceLayer(client, {
        permissions,
        audit: memoryAudit(rows),
        rules: [allowRule()]
      })
      const runtime = ManagedRuntime.make(layer)
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const policy = yield* EgressPolicy
            return yield* Effect.exit(
              policy.record(new EgressPolicyRecordRequest({ decisionId: "forged" }))
            )
          })
        )
      )

      expect(rows).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "InvalidArgument", operation: "EgressPolicy.record" })
      })
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("EgressPolicy service does not emit recorded events when host recording fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* makePermissionRegistry()
      yield* permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }), {
        source: "test"
      })
      const client = yield* makeEgressPolicyMemoryClient({
        failure: {
          record: makeHostProtocolInternalError("host record failed", "EgressPolicy.record")
        }
      })
      const layer = makeEgressPolicyServiceLayer(client, {
        permissions,
        audit: memoryAudit(rows),
        rules: [allowRule()],
        nextTraceId: () => "trace-egress"
      })
      const runtime = ManagedRuntime.make(layer)
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const policy = yield* EgressPolicy
            const decision = yield* policy.decide(decisionRequest())
            const recordExit = yield* Effect.exit(
              policy.record(new EgressPolicyRecordRequest({ decisionId: decision.decisionId }))
            )
            const event = yield* policy
              .events()
              .pipe(Stream.take(1), Stream.runCollect, Effect.timeoutOption("20 millis"))
            return { event, recordExit }
          })
        )
      )

      expectExitFailure(result.recordExit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "EgressPolicy.record" })
      })
      expect(Option.isNone(result.event)).toBe(true)
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("EgressPolicy service mints unique default decision ids", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      yield* permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }), {
        source: "test"
      })
      const client = yield* makeEgressPolicyMemoryClient()
      const layer = makeEgressPolicyServiceLayer(client, {
        permissions,
        rules: [allowRule()]
      })
      const runtime = ManagedRuntime.make(layer)
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const policy = yield* EgressPolicy
            const first = yield* policy.decide(decisionRequest())
            const second = yield* policy.decide(decisionRequest())
            return { first, second }
          })
        )
      )

      expect(result.first.decisionId).toBe("egress-decision-1")
      expect(result.second.decisionId).toBe("egress-decision-2")
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("EgressPolicy bridge client rejects malformed input before native transport", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({ kind: "success", payload: allowDecision() })
    },
    subscribe: () => Stream.empty
  }
  const runtime = ManagedRuntime.make(makeEgressPolicyBridgeClientLayer(exchange))
  return runtime.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicyClient
      const exit = yield* Effect.exit(policy.decide(invalidDecisionInput()))

      expect(requests).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "InvalidArgument", operation: "EgressPolicy.decide" })
      })
    })
  )
})

test("EgressPolicy unsupported client exposes typed unsupported failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeEgressPolicyUnsupportedClient()
      const supported = yield* client.isSupported()
      const exit = yield* Effect.exit(client.decide(allowInput()))

      expect(supported).toEqual({ supported: false, reason: "host-adapter-unimplemented" })
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "EgressPolicy.decide" })
      })
    })
  ))

test("EgressPolicy memory client exposes typed host failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeEgressPolicyMemoryClient({
        failure: {
          decide: makeHostProtocolInternalError("host egress policy failed", "EgressPolicy.decide")
        }
      })

      const exit = yield* Effect.exit(client.decide(allowInput()))

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "EgressPolicy.decide" })
      })
    })
  ))

test("EgressPolicy bridge client does not forward caller-supplied rules", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({ kind: "success", payload: allowDecision() })
    },
    subscribe: () => Stream.empty
  }
  const runtime = ManagedRuntime.make(makeEgressPolicyBridgeClientLayer(exchange))
  return runtime.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicyClient
      const exit = yield* Effect.exit(policy.decide(callerSuppliedRuleInput()))

      expect(requests).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "InvalidArgument", operation: "EgressPolicy.decide" })
      })
    })
  )
})

test("EgressPolicy bridge client records issued decisions through the native payload", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: { decisionId: "decision-allow", recorded: true }
      })
    },
    subscribe: () => Stream.empty
  }
  const runtime = ManagedRuntime.make(makeEgressPolicyBridgeClientLayer(exchange))
  return runtime.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicyClient
      const result = yield* policy.record(recordInput())

      expect(result.recorded).toBe(true)
      expect(requests).toHaveLength(1)
      expect(requests[0]?.method).toBe("EgressPolicy.record")
      expect(requests[0]?.payload).toMatchObject({
        decisionId: "decision-allow",
        actor: { id: "extension-1", kind: "extension" },
        destination: { host: "api.example.test", protocol: "https" },
        traceId: "trace-record"
      })
    })
  )
})

test("EgressPolicy bridge client rejects malformed record input before native transport", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({ kind: "success", payload: { decisionId: "forged", recorded: true } })
    },
    subscribe: () => Stream.empty
  }
  const runtime = ManagedRuntime.make(makeEgressPolicyBridgeClientLayer(exchange))
  return runtime.runPromise(
    Effect.gen(function* () {
      const policy = yield* EgressPolicyClient
      const exit = yield* Effect.exit(
        policy.record({
          decisionId: "",
          actor: actor(),
          destination: destination(),
          traceId: "trace-record"
        })
      )

      expect(requests).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "InvalidArgument", operation: "EgressPolicy.record" })
      })
    })
  )
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

const recordInput = (): EgressPolicyRecordInput =>
  new EgressPolicyRecordInput({
    decisionId: "decision-allow",
    actor: actor(),
    destination: destination(),
    traceId: "trace-record"
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
