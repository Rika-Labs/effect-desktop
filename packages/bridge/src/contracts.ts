import { Data, Effect, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import { RpcCapability, RpcEndpoint, RpcSupport, type RpcSupportMetadata } from "./rpc-endpoint.js"

export interface BridgeRpcMethodSpec {
  readonly input: Schema.Schema<unknown>
  readonly output: Schema.Schema<unknown> | BridgeRpcStreamSpec | BridgeRpcResourceSpec
  readonly error: Schema.Schema<unknown>
  readonly permission?: string
  readonly timeoutMs?: number
  readonly cachedResultMs?: number
  readonly idempotent?: boolean
  readonly cancellable?: boolean
  readonly backpressure?: BackpressureSpec
  readonly support?: RpcSupportMetadata
}

export interface BridgeRpcEventSpec {
  readonly payload: Schema.Schema<unknown>
  readonly backpressure?: BackpressureSpec
}

export interface BridgeRpcStreamSpec {
  readonly _tag: "BridgeRpcStreamSpec"
  readonly chunk: Schema.Schema<unknown>
  readonly error: Schema.Schema<unknown>
  readonly backpressure?: BackpressureSpec
}

export interface BridgeResourceHandle<Kind extends string = string, State extends string = string> {
  readonly kind: Kind
  readonly id: string
  readonly generation: number
  readonly ownerScope: string
  readonly state: State
}

export class BridgeResourceHandleShape extends Schema.Class<BridgeResourceHandleShape>(
  "BridgeResourceHandle"
)({
  kind: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ownerScope: Schema.NonEmptyString,
  state: Schema.String
}) {}

export interface BridgeRpcResourceSpec<
  Kind extends string = string,
  State extends string = string
> {
  readonly _tag: "BridgeRpcResourceSpec"
  readonly kind: Kind
  readonly state: State
  readonly schema: typeof BridgeResourceHandleShape
}

type BridgeRpcOutputType<Output> = Output extends BridgeRpcStreamSpec
  ? Stream.Stream<Schema.Schema.Type<Output["chunk"]>, Schema.Schema.Type<Output["error"]>, unknown>
  : Output extends BridgeRpcResourceSpec<infer Kind, infer State>
    ? BridgeResourceHandle<Kind, State>
    : Output extends Schema.Schema<unknown>
      ? Schema.Schema.Type<Output>
      : never

export interface BackpressureSpec {
  readonly strategy: "buffer" | "drop" | "block"
  readonly size?: number
  readonly overflow?: "error" | "dropOldest" | "dropNewest" | "block"
}

export type BridgeRpcSpec = Readonly<Record<string, BridgeRpcMethodSpec>>
export type BridgeRpcEvents = Readonly<Record<string, BridgeRpcEventSpec>>

export interface BridgeRpcGroup<
  Tag extends string = string,
  Spec extends BridgeRpcSpec = BridgeRpcSpec,
  Events extends BridgeRpcEvents = BridgeRpcEvents
> extends RpcGroup.RpcGroup<Rpc.Any> {
  readonly tag: Tag
  readonly spec: Spec
  readonly events: Events
}

export type BridgeRpcHandlers<Spec extends BridgeRpcSpec> = {
  readonly [Method in keyof Spec]: (
    input: Schema.Schema.Type<Spec[Method]["input"]>
  ) => Spec[Method]["output"] extends BridgeRpcStreamSpec
    ? BridgeRpcOutputType<Spec[Method]["output"]>
    : Effect.Effect<
        BridgeRpcOutputType<Spec[Method]["output"]>,
        Schema.Schema.Type<Spec[Method]["error"]>,
        unknown
      >
}

export interface BridgeRpcLayer<
  Tag extends string,
  Spec extends BridgeRpcSpec,
  Handlers extends BridgeRpcHandlers<Spec>,
  Events extends BridgeRpcEvents = BridgeRpcEvents
> {
  readonly group: BridgeRpcGroup<Tag, Spec, Events>
  readonly handlers: Handlers
}

export class InvalidBridgeRpcSpec extends Data.TaggedError("InvalidBridgeRpcSpec")<{
  readonly tag: string
  readonly method: string
  readonly reason: string
  readonly message: string
}> {}

export type BridgeRpcSpecError = InvalidBridgeRpcSpec

export const BridgeRpc = Object.freeze({
  Resource: <Kind extends string, State extends string>(
    kind: Kind,
    state: State
  ): BridgeRpcResourceSpec<Kind, State> =>
    Object.freeze({
      _tag: "BridgeRpcResourceSpec",
      kind,
      state,
      schema: BridgeResourceHandleShape
    }),
  Stream: <Chunk extends Schema.Schema<unknown>, Error extends Schema.Schema<unknown>>(
    chunk: Chunk,
    error: Error,
    backpressure?: BackpressureSpec
  ): BridgeRpcStreamSpec & {
    readonly chunk: Chunk
    readonly error: Error
  } =>
    Object.freeze({
      _tag: "BridgeRpcStreamSpec",
      chunk,
      error,
      ...(backpressure === undefined ? {} : { backpressure: Object.freeze(backpressure) })
    }),
  group: <Tag extends string, Spec extends BridgeRpcSpec, Events extends BridgeRpcEvents>(
    tag: Tag,
    spec: Spec,
    events: Events
  ): BridgeRpcGroup<Tag, Spec, Events> => makeBridgeRpcGroup(tag, spec, events),
  layer:
    <Tag extends string, Spec extends BridgeRpcSpec, Events extends BridgeRpcEvents>(
      group: BridgeRpcGroup<Tag, Spec, Events>
    ) =>
    <Handlers extends BridgeRpcHandlers<Spec>>(
      handlers: Handlers
    ): BridgeRpcLayer<Tag, Spec, Handlers, Events> => {
      validateHandlers(group.tag, group.spec, handlers)
      return Object.freeze({
        group,
        handlers: Object.freeze(handlers)
      })
    }
})

export const makeBridgeRpcGroup = <
  Tag extends string,
  Spec extends BridgeRpcSpec,
  Events extends BridgeRpcEvents
>(
  tag: Tag,
  spec: Spec,
  events: Events
): BridgeRpcGroup<Tag, Spec, Events> => {
  if (!isPrintableName(tag)) {
    throw invalidSpec(tag, "<group>", "tag must be non-empty printable text")
  }
  validateBridgeRpcSpec(tag, spec)
  validateBridgeRpcEvents(tag, events)
  const frozenSpec = freezeRpcSpec(spec)
  const frozenEvents = freezeRpcEvents(events)
  const rpcs: Rpc.Any[] = []

  for (const [method, methodSpec] of Object.entries(frozenSpec)) {
    rpcs.push(bridgeMethodToRpc(tag, method, methodSpec))
  }
  for (const [event, eventSpec] of Object.entries(frozenEvents)) {
    rpcs.push(bridgeEventToRpc(tag, event, eventSpec))
  }

  return Object.freeze(
    Object.assign(RpcGroup.make(...rpcs), {
      tag,
      spec: frozenSpec,
      events: frozenEvents
    })
  ) as BridgeRpcGroup<Tag, Spec, Events>
}

const validateBridgeRpcSpec = (tag: string, spec: BridgeRpcSpec): void => {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw invalidSpec(tag, "<group>", "RPC spec must be an object")
  }

  for (const [method, methodSpec] of Object.entries(spec)) {
    if (method === "events") {
      throw invalidSpec(tag, method, "events is a reserved method name")
    }
    if (!isWireSegmentName(method)) {
      throw invalidSpec(tag, method, "method name must be non-empty printable text without dots")
    }
    validateMethodSpec(tag, method, methodSpec)
  }
}

const validateMethodSpec = (tag: string, method: string, spec: BridgeRpcMethodSpec): void => {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw invalidSpec(tag, method, "method spec must be an object")
  }

  if (!isSchema(spec.input)) {
    throw invalidSpec(tag, method, "input schema is required")
  }
  if (!isSchema(spec.output) && !isStreamSpec(spec.output) && !isResourceSpec(spec.output)) {
    throw invalidSpec(tag, method, "output schema, stream, or resource is required")
  }
  if (isResourceSpec(spec.output)) {
    validateResourceSpec(tag, method, spec.output)
  }
  if (!isSchema(spec.error)) {
    throw invalidSpec(tag, method, "error schema is required")
  }
  if (spec.permission !== undefined && typeof spec.permission !== "string") {
    throw invalidSpec(tag, method, "permission must be a string")
  }
  if (typeof spec.permission === "string" && spec.permission.trim().length === 0) {
    throw invalidSpec(tag, method, "permission must be non-empty")
  }
  if (spec.timeoutMs !== undefined && (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 0)) {
    throw invalidSpec(tag, method, "timeoutMs must be a non-negative integer")
  }
  if (
    spec.cachedResultMs !== undefined &&
    (!Number.isInteger(spec.cachedResultMs) || spec.cachedResultMs < 0)
  ) {
    throw invalidSpec(tag, method, "cachedResultMs must be a non-negative integer")
  }
  if (spec.idempotent !== undefined && typeof spec.idempotent !== "boolean") {
    throw invalidSpec(tag, method, "idempotent must be a boolean")
  }
  if (spec.idempotent === true && spec.cachedResultMs === undefined) {
    throw invalidSpec(tag, method, "idempotent methods must declare cachedResultMs")
  }
  if (spec.idempotent === true && spec.cachedResultMs === 0) {
    throw invalidSpec(tag, method, "idempotent methods must declare positive cachedResultMs")
  }
  if (spec.cancellable !== undefined && typeof spec.cancellable !== "boolean") {
    throw invalidSpec(tag, method, "cancellable must be a boolean")
  }
  if (spec.backpressure !== undefined) {
    validateBackpressureSpec(tag, method, spec.backpressure, { requirePositiveSize: true })
  }
  if (isStreamSpec(spec.output) && spec.output.backpressure !== undefined) {
    validateBackpressureSpec(tag, method, spec.output.backpressure, { requirePositiveSize: true })
  }
  if (spec.support !== undefined) {
    validateSupportSpec(tag, method, spec.support)
  }
}

const validateBridgeRpcEvents = (tag: string, events: BridgeRpcEvents): void => {
  if (typeof events !== "object" || events === null || Array.isArray(events)) {
    throw invalidSpec(tag, "<events>", "events spec must be an object")
  }

  for (const [event, eventSpec] of Object.entries(events)) {
    if (!isWireSegmentName(event)) {
      throw invalidSpec(tag, event, "event name must be non-empty printable text without dots")
    }
    validateEventSpec(tag, event, eventSpec)
  }
}

const validateEventSpec = (tag: string, event: string, spec: BridgeRpcEventSpec): void => {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw invalidSpec(tag, event, "event spec must be an object")
  }

  if (!isSchema(spec.payload)) {
    throw invalidSpec(tag, event, "event payload schema is required")
  }
  if (spec.backpressure !== undefined) {
    validateBackpressureSpec(tag, event, spec.backpressure, { requirePositiveSize: false })
  }
}

const validateBackpressureSpec = (
  tag: string,
  method: string,
  spec: BackpressureSpec,
  options: { readonly requirePositiveSize: boolean }
): void => {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw invalidSpec(tag, method, "backpressure must be an object")
  }

  if (!backpressureStrategies.has(spec.strategy)) {
    throw invalidSpec(tag, method, "backpressure.strategy must be buffer, drop, or block")
  }
  if (spec.size !== undefined && (!Number.isInteger(spec.size) || spec.size < 0)) {
    throw invalidSpec(tag, method, "backpressure.size must be a non-negative integer")
  }
  if (options.requirePositiveSize && spec.size === 0) {
    throw invalidSpec(tag, method, "backpressure.size must be a positive integer")
  }
  if (spec.overflow !== undefined && !backpressureOverflows.has(spec.overflow)) {
    throw invalidSpec(
      tag,
      method,
      "backpressure.overflow must be error, dropOldest, dropNewest, or block"
    )
  }
}

const validateSupportSpec = (tag: string, method: string, spec: RpcSupportMetadata): void => {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw invalidSpec(tag, method, "support must be an object")
  }

  if (!supportStatuses.has(spec.status)) {
    throw invalidSpec(tag, method, "support.status must be supported or unsupported")
  }

  if (spec.status === "supported") {
    if ("reason" in spec && spec.reason !== undefined) {
      throw invalidSpec(tag, method, "support.reason is only allowed when status is unsupported")
    }
    return
  }

  if (typeof spec.reason !== "string" || spec.reason.length === 0) {
    throw invalidSpec(tag, method, "unsupported methods must declare a non-empty support.reason")
  }
}

const validateResourceSpec = (tag: string, method: string, spec: BridgeRpcResourceSpec): void => {
  if (!isPrintableName(spec.kind) || !isPrintableName(spec.state)) {
    throw invalidSpec(tag, method, "resource kind and state must be non-empty printable text")
  }
}

const validateHandlers = <Spec extends BridgeRpcSpec>(
  tag: string,
  spec: Spec,
  handlers: unknown
): void => {
  if (typeof handlers !== "object" || handlers === null) {
    throw invalidSpec(tag, "<handlers>", "handlers must be an object")
  }

  for (const method of Object.keys(spec)) {
    if (typeof Reflect.get(handlers, method) !== "function") {
      throw invalidSpec(tag, method, "handler must be a function")
    }
  }
}

const freezeRpcSpec = <Spec extends BridgeRpcSpec>(spec: Spec): Spec => {
  for (const methodSpec of Object.values(spec)) {
    if (methodSpec.backpressure !== undefined) {
      Object.freeze(methodSpec.backpressure)
    }
    if (methodSpec.support !== undefined) {
      Object.freeze(methodSpec.support)
    }
    if (isStreamSpec(methodSpec.output) && methodSpec.output.backpressure !== undefined) {
      Object.freeze(methodSpec.output.backpressure)
    }
    if (isStreamSpec(methodSpec.output)) {
      Object.freeze(methodSpec.output)
    }
    if (isResourceSpec(methodSpec.output)) {
      Object.freeze(methodSpec.output)
    }
    Object.freeze(methodSpec)
  }

  return Object.freeze(spec)
}

const freezeRpcEvents = <Events extends BridgeRpcEvents>(events: Events): Events => {
  for (const eventSpec of Object.values(events)) {
    if (eventSpec.backpressure !== undefined) {
      Object.freeze(eventSpec.backpressure)
    }
    Object.freeze(eventSpec)
  }

  return Object.freeze(events)
}

const invalidSpec = (tag: string, method: string, reason: string): InvalidBridgeRpcSpec =>
  new InvalidBridgeRpcSpec({
    tag,
    method,
    reason,
    message: `Invalid RPC group ${tag}.${method}: ${reason}`
  })

const isWireSegmentName = (value: string): boolean => isPrintableName(value) && !value.includes(".")

const isPrintableName = (value: string): boolean => {
  if (value.trim().length === 0) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }
  return true
}

const bridgeMethodToRpc = (tag: string, method: string, spec: BridgeRpcMethodSpec): Rpc.Any => {
  const rpc = isStreamSpec(spec.output)
    ? Rpc.make(`${tag}.${method}`, {
        payload: spec.input,
        success: spec.output.chunk,
        error: spec.output.error,
        stream: true
      })
    : Rpc.make(`${tag}.${method}`, {
        payload: spec.input,
        success: bridgeMethodSuccessSchema(spec.output),
        error: spec.error
      })

  return annotateBridgeMethodRpc(rpc, spec)
}

const bridgeEventToRpc = (tag: string, event: string, spec: BridgeRpcEventSpec): Rpc.Any =>
  Rpc.make(`${tag}.events.${event}`, {
    success: spec.payload,
    error: Schema.Never,
    stream: true
  })

const bridgeMethodSuccessSchema = (
  output: Schema.Schema<unknown> | BridgeRpcStreamSpec | BridgeRpcResourceSpec
): Schema.Schema<unknown> => {
  if (isResourceSpec(output)) {
    return output.schema
  }
  if (isStreamSpec(output)) {
    return output.chunk
  }
  return output
}

const annotateBridgeMethodRpc = (rpc: Rpc.Any, spec: BridgeRpcMethodSpec): Rpc.Any => {
  const endpointRpc = spec.idempotent === true ? RpcEndpoint.query(rpc) : RpcEndpoint.mutation(rpc)
  const capabilityRpc =
    spec.permission === undefined
      ? endpointRpc
      : RpcCapability({ kind: spec.permission })(endpointRpc)

  if (spec.support === undefined) {
    return capabilityRpc
  }

  return spec.support.status === "supported"
    ? RpcSupport.supported(capabilityRpc)
    : RpcSupport.unsupported(spec.support.reason)(capabilityRpc)
}

const isSchema = (value: unknown): value is Schema.Schema<unknown> => {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null && "ast" in value
  )
}

export const isStreamSpec = (value: unknown): value is BridgeRpcStreamSpec =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { readonly _tag?: unknown })._tag === "BridgeRpcStreamSpec" &&
  "chunk" in value &&
  "error" in value &&
  isSchema((value as { readonly chunk?: unknown }).chunk) &&
  isSchema((value as { readonly error?: unknown }).error)

export const isResourceSpec = (value: unknown): value is BridgeRpcResourceSpec =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { readonly _tag?: unknown })._tag === "BridgeRpcResourceSpec" &&
  "kind" in value &&
  "state" in value &&
  "schema" in value &&
  typeof (value as { readonly kind?: unknown }).kind === "string" &&
  typeof (value as { readonly state?: unknown }).state === "string" &&
  isSchema((value as { readonly schema?: unknown }).schema)

const backpressureStrategies = new Set<BackpressureSpec["strategy"]>(["buffer", "drop", "block"])
const backpressureOverflows = new Set<NonNullable<BackpressureSpec["overflow"]>>([
  "error",
  "dropOldest",
  "dropNewest",
  "block"
])
const supportStatuses = new Set<RpcSupportMetadata["status"]>(["supported", "unsupported"])
