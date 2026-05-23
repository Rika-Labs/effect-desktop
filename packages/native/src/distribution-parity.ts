import {
  type BridgeClientExchange,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
  RpcGroup
} from "@orika/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  permissionAuditEvent
} from "@orika/core"
import { Clock, Context, Effect, Layer, PubSub, Schema, Stream } from "effect"

import {
  DistributionParityEvent,
  DistributionParitySupportedResult,
  DistributionParityVerifyRequest,
  DistributionParityVerifyResult
} from "./contracts/distribution-parity.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/distribution-parity.js"

const Surface = "DistributionParity"
const EventMethod = "DistributionParity.Event"
const UnsupportedReason = "host-adapter-unimplemented"

export type DistributionParityError = HostProtocolError

export const DistributionParityVerify = NativeSurface.rpc(Surface, "verify", {
  payload: DistributionParityVerifyRequest,
  success: DistributionParityVerifyResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["verify"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const DistributionParityIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: DistributionParitySupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const DistributionParityRpcEvents = Object.freeze({
  Event: { payload: DistributionParityEvent }
})

const DistributionParityRpcGroup = RpcGroup.make(
  DistributionParityVerify,
  DistributionParityIsSupported
)

export type DistributionParityRpc = RpcGroup.Rpcs<typeof DistributionParityRpcGroup>
export type DistributionParityRpcHandlers<R = never> = NativeRpcHandlers<
  typeof DistributionParityRpcGroup,
  R
>
export const DistributionParityRpcs: RpcGroup.RpcGroup<DistributionParityRpc> =
  DistributionParityRpcGroup
export const DistributionParityMethodNames = Object.freeze(["verify", "isSupported"] as const)

const DistributionParityCapabilityMethods = Object.freeze([
  "verify"
] as const satisfies readonly (typeof DistributionParityMethodNames)[number][])

export interface DistributionParityClientApi {
  readonly verify: (
    input: DistributionParityVerifyRequest
  ) => Effect.Effect<DistributionParityVerifyResult, DistributionParityError, never>
  readonly isSupported: () => Effect.Effect<
    DistributionParitySupportedResult,
    DistributionParityError,
    never
  >
  readonly events: () => Stream.Stream<DistributionParityEvent, DistributionParityError, never>
}

export class DistributionParityClient extends Context.Service<
  DistributionParityClient,
  DistributionParityClientApi
>()("@orika/native/distribution-parity/DistributionParityClient") {}

export interface DistributionParityServiceApi extends DistributionParityClientApi {}

export interface DistributionParityServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
}

export class DistributionParity extends Context.Service<
  DistributionParity,
  DistributionParityServiceApi
>()("@orika/native/distribution-parity/DistributionParity") {
  static readonly layer = Layer.effect(DistributionParity)(
    Effect.gen(function* () {
      const client = yield* DistributionParityClient
      const permissions = yield* PermissionRegistry
      return yield* makeDistributionParityService(client, { permissions })
    })
  )
}

export const DistributionParityLive = DistributionParity.layer

export const makeDistributionParityServiceLayer = (
  client: DistributionParityClientApi,
  options: DistributionParityServiceOptions
): Layer.Layer<DistributionParity> =>
  Layer.effect(DistributionParity)(makeDistributionParityService(client, options))

export const DistributionParityHandlersLive = DistributionParityRpcGroup.toLayer({
  "DistributionParity.verify": (input) =>
    Effect.gen(function* () {
      const parity = yield* DistributionParity
      return yield* parity.verify(input)
    }),
  "DistributionParity.isSupported": () =>
    Effect.gen(function* () {
      const parity = yield* DistributionParity
      return yield* parity.isSupported()
    })
})

export const DistributionParitySurface = NativeSurface.make(Surface, DistributionParityRpcGroup, {
  service: DistributionParityClient,
  capabilities: DistributionParityCapabilityMethods,
  handlers: DistributionParityHandlersLive,
  client: (client) => distributionParityClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => distributionParityClientFromRpcClient(client, exchange)
})

export const makeHostDistributionParityRpcRuntime = <R = never>(
  handlers: DistributionParityRpcHandlers<R>,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
) => DistributionParitySurface.hostRuntime(handlers, runtimeOptions)

export interface DistributionParityMemoryClientOptions {
  readonly failure?: Partial<Record<"verify", DistributionParityError>>
}

export const makeDistributionParityMemoryClient = (
  options: DistributionParityMemoryClientOptions = {}
): Effect.Effect<DistributionParityClientApi, never, never> =>
  Effect.gen(function* () {
    const events = yield* PubSub.bounded<DistributionParityEvent>({ capacity: 128, replay: 32 })

    return Object.freeze({
      verify: (input) =>
        validateVerify(input).pipe(
          Effect.flatMap((request) =>
            failOr(
              options.failure?.verify,
              Effect.gen(function* () {
                yield* validateParityEvidence(request)
                const result = resultFromRequest(request)
                yield* publishEvent(events, "verified", request)
                return result
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new DistributionParitySupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(events)
    } satisfies DistributionParityClientApi)
  })

export const makeDistributionParityUnsupportedClient = (): DistributionParityClientApi =>
  Object.freeze({
    verify: (input) =>
      validateVerify(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("DistributionParity.verify")))
      ),
    isSupported: () =>
      Effect.succeed(
        new DistributionParitySupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("DistributionParity.events"))
  } satisfies DistributionParityClientApi)

const makeDistributionParityService = (
  client: DistributionParityClientApi,
  options: DistributionParityServiceOptions
): Effect.Effect<DistributionParityServiceApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      verify: (input) =>
        Effect.gen(function* () {
          const request = yield* validateVerify(input)
          yield* authorize(options, request.traceId)
          yield* validateParityEvidence(request).pipe(
            Effect.tapError((error) => emitFailureAudit(options, request, error))
          )
          const result = yield* client
            .verify(request)
            .pipe(Effect.tapError((error) => emitFailureAudit(options, request, error)))
          yield* emitUseAudit(options, request, result)
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies DistributionParityServiceApi)
  )

const distributionParityClientFromRpcClient = (
  client: DesktopRpcClient<DistributionParityRpc>,
  exchange: BridgeClientExchange | undefined
): DistributionParityClientApi =>
  Object.freeze({
    verify: (input) =>
      validateVerify(input).pipe(
        Effect.flatMap((valid) =>
          runDistributionParityRpc(
            client["DistributionParity.verify"](valid),
            "DistributionParity.verify"
          )
        )
      ),
    isSupported: () =>
      runDistributionParityRpc(
        client["DistributionParity.isSupported"](undefined),
        "DistributionParity.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, EventMethod, DistributionParityEvent)
  } satisfies DistributionParityClientApi)

const validateVerify = (
  input: unknown
): Effect.Effect<DistributionParityVerifyRequest, DistributionParityError, never> =>
  decodeNativeInput(DistributionParityVerifyRequest, input, "DistributionParity.verify")

const runDistributionParityRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DistributionParityError, never> => runNativeRpc(effect, operation, Surface)

const validateParityEvidence = (
  request: DistributionParityVerifyRequest
): Effect.Effect<void, DistributionParityError, never> => {
  const expected = canonicalCapabilities(request.capabilities)
  const kinds = new Set<string>()
  for (const evidence of request.evidence) {
    kinds.add(evidence.kind)
    if (canonicalCapabilities(evidence.capabilities) !== expected) {
      return Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "evidence.capabilities",
          `${evidence.kind}:${evidence.id} does not match package capabilities`,
          "DistributionParity.verify"
        )
      )
    }
  }
  for (const kind of ["package-artifact", "plugin-registration", "template", "docs"]) {
    if (!kinds.has(kind)) {
      return Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "evidence",
          `missing ${kind} evidence`,
          "DistributionParity.verify"
        )
      )
    }
  }
  return Effect.void
}

const resultFromRequest = (
  request: DistributionParityVerifyRequest
): DistributionParityVerifyResult =>
  new DistributionParityVerifyResult({
    packageId: request.packageId,
    version: request.version,
    capabilityCount: request.capabilities.length,
    evidenceCount: request.evidence.length
  })

const canonicalCapabilities = (capabilities: readonly unknown[]): string =>
  JSON.stringify(capabilities.map(canonicalJson).sort(compareJson))

const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalJson)
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)])
    )
  }
  return value
}

const compareJson = (left: unknown, right: unknown): number =>
  JSON.stringify(left).localeCompare(JSON.stringify(right))

const authorize = (
  options: DistributionParityServiceOptions,
  traceId: string | undefined
): Effect.Effect<void, DistributionParityError, never> =>
  options.permissions
    .check(
      P.nativeInvoke({ primitive: Surface, methods: ["verify"] }),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource: "distribution-parity",
        traceId: traceId ?? "DistributionParity.verify"
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.tapError((error) =>
        error instanceof PermissionDeniedError
          ? emitDeniedAudit(options, error, traceId)
          : Effect.void
      ),
      Effect.mapError((error: PermissionRegistryError): DistributionParityError => {
        if (error instanceof PermissionDeniedError) {
          return new HostProtocolPermissionDeniedError({
            tag: "PermissionDenied",
            message: "permission denied for native.invoke",
            operation: "DistributionParity.verify",
            capability: P.nativeInvoke({ primitive: Surface, methods: ["verify"] }).kind,
            resource: error.traceId,
            recoverable: false
          })
        }
        return makeHostProtocolInternalError(
          `distribution parity permission failure: ${error._tag}`,
          "DistributionParity.verify"
        )
      })
    )

const emitDeniedAudit = (
  options: DistributionParityServiceOptions,
  error: PermissionDeniedError,
  traceId: string | undefined
): Effect.Effect<void, never, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-denied",
      source: "DistributionParity.verify",
      traceId: traceId ?? error.traceId,
      outcome: "denied",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: ["verify"] }),
      actor: new PermissionActor({ kind: "app", id: "app" }),
      resource: "distribution-parity",
      details: { reason: error.reason }
    })
  ).pipe(Effect.ignore)

const emitUseAudit = (
  options: DistributionParityServiceOptions,
  request: DistributionParityVerifyRequest,
  result: DistributionParityVerifyResult
): Effect.Effect<void, DistributionParityError, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: "DistributionParity.verify",
      traceId: request.traceId ?? "distribution-parity",
      outcome: "verified",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: ["verify"] }),
      actor: new PermissionActor({ kind: "app", id: "app" }),
      resource: request.packageId,
      details: {
        version: request.version,
        capabilityCount: result.capabilityCount,
        evidenceCount: result.evidenceCount
      }
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write distribution parity audit event: ${error.message}`,
        "DistributionParity.audit"
      )
    )
  )

const emitFailureAudit = (
  options: DistributionParityServiceOptions,
  request: DistributionParityVerifyRequest,
  error: DistributionParityError
): Effect.Effect<void, never, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: "DistributionParity.verify",
      traceId: request.traceId ?? "distribution-parity",
      outcome: "failed",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: ["verify"] }),
      actor: new PermissionActor({ kind: "app", id: "app" }),
      resource: request.packageId,
      details: { reason: error.tag, operation: error.operation }
    })
  ).pipe(Effect.ignore)

const publishEvent = (
  events: PubSub.PubSub<DistributionParityEvent>,
  phase: "verified" | "failed",
  request: DistributionParityVerifyRequest,
  reason?: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        events,
        new DistributionParityEvent({
          type: "distribution-parity-event",
          timestamp,
          phase,
          packageId: request.packageId,
          version: request.version,
          ...(reason === undefined ? {} : { reason })
        })
      )
    ),
    Effect.asVoid
  )

const failOr = <A>(
  error: DistributionParityError | undefined,
  effect: Effect.Effect<A, DistributionParityError, never>
): Effect.Effect<A, DistributionParityError, never> =>
  error === undefined ? effect : Effect.fail(error)

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported DistributionParity method: ${operation}`,
    operation,
    recoverable: false
  })
