import { Context, Data, Effect, Option, Schema, Stream } from "effect"
import { RpcGroup, RpcSchema } from "effect/unstable/rpc"
import type { Any as RpcAny, AnyWithProps as RpcAnyWithProps } from "effect/unstable/rpc/Rpc"

import { rpcCapability, rpcSupport, type RpcSupportMetadata } from "./rpc-endpoint.js"

interface AnnotatableRpc extends RpcAny {
  annotate<I, S>(tag: Context.Key<I, S>, value: S): RpcAny
}

export type BridgeContractCodec<Type = unknown, Encoded = unknown> = Schema.Codec<
  Type,
  Encoded,
  never,
  never
>
export type BridgeContractCodecType<Codec extends BridgeContractCodec> = Codec["Type"]

export interface BridgeMethodSpec<
  Input extends BridgeContractCodec = BridgeContractCodec,
  Output extends BridgeContractCodec | BridgeStreamSpec = BridgeContractCodec | BridgeStreamSpec,
  Error extends BridgeContractCodec = BridgeContractCodec
> {
  readonly input: Input
  readonly output: Output
  readonly error: Error
  readonly permission?: string
  readonly timeoutMs?: number
  readonly cachedResultMs?: number
  readonly cancellable?: boolean
  readonly backpressure?: BackpressureSpec
  readonly support?: RpcSupportMetadata
}

export interface BridgeEventSpec<Payload extends BridgeContractCodec = BridgeContractCodec> {
  readonly payload: Payload
  readonly backpressure?: BackpressureSpec
}

export interface BridgeStreamSpec<
  Chunk extends BridgeContractCodec = BridgeContractCodec,
  Error extends BridgeContractCodec = BridgeContractCodec
> {
  readonly _tag: "BridgeStreamSpec"
  readonly chunk: Chunk
  readonly error: Error
  readonly backpressure?: BackpressureSpec
}

type BridgeOutputType<Output> = Output extends BridgeStreamSpec
  ? Stream.Stream<
      BridgeContractCodecType<Output["chunk"]>,
      BridgeContractCodecType<Output["error"]>,
      unknown
    >
  : Output extends BridgeContractCodec
    ? BridgeContractCodecType<Output>
    : never

export interface BackpressureSpec {
  readonly strategy: "buffer" | "drop" | "block"
  readonly size?: number
  readonly overflow?: "error" | "dropOldest" | "dropNewest" | "block"
}

export type BridgeStreamSchema = RpcSchema.Stream<BridgeContractCodec, BridgeContractCodec>
export type BridgeSuccessSchema = BridgeContractCodec | BridgeStreamSchema
export type BridgeContractRpc = RpcAnyWithProps & {
  readonly payloadSchema: BridgeContractCodec
  readonly successSchema: BridgeSuccessSchema
  readonly errorSchema: BridgeContractCodec
}

export type BridgeContractRpcGroup<Rpcs extends BridgeContractRpc = BridgeContractRpc> =
  RpcGroup.Any & {
    readonly requests: ReadonlyMap<string, Rpcs>
  }

export type BridgeContractSpec = Readonly<Record<string, BridgeMethodSpec>>
export type BridgeContractEvents = Readonly<Record<string, BridgeEventSpec>>

type BridgeContractOutput<Success extends BridgeSuccessSchema> =
  Success extends RpcSchema.Stream<
    infer Chunk extends BridgeContractCodec,
    infer Error extends BridgeContractCodec
  >
    ? BridgeStreamSpec<Chunk, Error>
    : Success

type BridgeContractEvent<Success extends BridgeSuccessSchema> =
  Success extends RpcSchema.Stream<infer Payload extends BridgeContractCodec, BridgeContractCodec>
    ? BridgeEventSpec<Payload>
    : never

type LastSegment<Value extends string> = Value extends `${string}.${infer Tail}`
  ? LastSegment<Tail>
  : Value

type BridgeMethodName<RpcTag extends string> = RpcTag extends `${string}.events.${string}`
  ? never
  : LastSegment<RpcTag>

type BridgeEventName<RpcTag extends string> = RpcTag extends `${string}.events.${infer Event}`
  ? LastSegment<Event>
  : never

export type BridgeContractSpecFromGroup<Group extends BridgeContractRpcGroup> =
  Group extends BridgeContractRpcGroup<infer Rpcs>
    ? {
        readonly [RpcTag in Rpcs["_tag"] as BridgeMethodName<RpcTag>]: Extract<
          Rpcs,
          { readonly _tag: RpcTag }
        > extends infer Current extends BridgeContractRpc
          ? BridgeMethodSpec<
              Current["payloadSchema"],
              BridgeContractOutput<Current["successSchema"]>,
              Current["errorSchema"]
            >
          : never
      }
    : BridgeContractSpec

export type BridgeContractEventsFromGroup<Group extends BridgeContractRpcGroup> =
  Group extends BridgeContractRpcGroup<infer Rpcs>
    ? {
        readonly [RpcTag in Rpcs["_tag"] as BridgeEventName<RpcTag>]: Extract<
          Rpcs,
          { readonly _tag: RpcTag }
        > extends infer Current extends BridgeContractRpc
          ? BridgeContractEvent<Current["successSchema"]>
          : never
      }
    : BridgeContractEvents

export type BridgeContract<
  Tag extends string = string,
  Spec extends BridgeContractSpec = BridgeContractSpec,
  Events extends BridgeContractEvents = BridgeContractEvents,
  Group extends BridgeContractRpcGroup = BridgeContractRpcGroup
> = Group & {
  readonly tag: Tag
  readonly spec: Spec
  readonly events: Events
}

export type BridgeContractHandlers<Spec extends BridgeContractSpec> = {
  readonly [Method in keyof Spec]: (
    input: BridgeContractCodecType<Spec[Method]["input"]>
  ) => Spec[Method]["output"] extends BridgeStreamSpec
    ? BridgeOutputType<Spec[Method]["output"]>
    : Effect.Effect<
        BridgeOutputType<Spec[Method]["output"]>,
        BridgeContractCodecType<Spec[Method]["error"]>,
        unknown
      >
}

export interface BridgeHandlerLayer<
  Tag extends string,
  Spec extends BridgeContractSpec,
  Handlers extends BridgeContractHandlers<Spec>,
  Events extends BridgeContractEvents = BridgeContractEvents
> {
  readonly group: BridgeContract<Tag, Spec, Events>
  readonly handlers: Handlers
}

export class InvalidBridgeMetadataError extends Data.TaggedError("InvalidBridgeMetadataError")<{
  readonly tag: string
  readonly method: string
  readonly reason: string
  readonly message: string
}> {}

export type BridgeContractSpecError = InvalidBridgeMetadataError

export interface BridgeRuntimeMetadata {
  readonly timeoutMs?: number
  readonly cachedResultMs?: number
  readonly cancellable?: boolean
  readonly backpressure?: BackpressureSpec
}

const BridgeRuntimeAnnotation = Context.Service<BridgeRuntimeMetadata>(
  "@effect-desktop/bridge/BridgeRuntime"
)

export const BridgeRuntime =
  (metadata: BridgeRuntimeMetadata) =>
  <R extends RpcAny>(rpc: R): R =>
    annotateRpc(rpc, BridgeRuntimeAnnotation, Object.freeze(metadata))

export const bridgeRuntime = (rpc: RpcAny): Option.Option<BridgeRuntimeMetadata> =>
  Context.getOption(rpc.annotations, BridgeRuntimeAnnotation)

export const bridgeContractFromRpcGroup = <
  Tag extends string,
  Group extends BridgeContractRpcGroup = BridgeContractRpcGroup
>(
  tag: Tag,
  group: Group
): BridgeContract<
  Tag,
  BridgeContractSpecFromGroup<Group>,
  BridgeContractEventsFromGroup<Group>,
  Group
> => {
  if (!isPrintableName(tag)) {
    throw invalidSpec(tag, "<group>", "tag must be non-empty printable text")
  }
  const { spec, events } = bridgeMetadataFromRpcGroup(tag, group)
  validateBridgeContractSpec(tag, spec)
  validateBridgeContractEvents(tag, events)
  const frozenSpec = freezeRpcSpec(spec)
  const frozenEvents = freezeRpcEvents(events)

  const contract: BridgeContract<Tag, BridgeContractSpec, BridgeContractEvents, Group> =
    Object.assign(group, {
      tag,
      spec: frozenSpec,
      events: frozenEvents
    })

  return Object.freeze(contract) as BridgeContract<
    Tag,
    BridgeContractSpecFromGroup<Group>,
    BridgeContractEventsFromGroup<Group>,
    Group
  >
}

export const makeBridgeHandlerLayer =
  <Tag extends string, Spec extends BridgeContractSpec, Events extends BridgeContractEvents>(
    group: BridgeContract<Tag, Spec, Events>
  ) =>
  <Handlers extends BridgeContractHandlers<Spec>>(
    handlers: Handlers
  ): BridgeHandlerLayer<Tag, Spec, Handlers, Events> => {
    validateHandlers(group.tag, group.spec, handlers)
    return Object.freeze({
      group,
      handlers: Object.freeze(handlers)
    })
  }

const bridgeMetadataFromRpcGroup = (
  tag: string,
  group: BridgeContractRpcGroup
): {
  readonly spec: BridgeContractSpec
  readonly events: BridgeContractEvents
} => {
  const methods: Array<readonly [string, BridgeMethodSpec]> = []
  const events: Array<readonly [string, BridgeEventSpec]> = []
  for (const [rpcTag, rpc] of group.requests.entries()) {
    if (!rpcTag.startsWith(`${tag}.`)) {
      throw invalidSpec(tag, rpcTag, "RpcGroup request tag must start with the bridge group tag")
    }
    if (rpcTag.startsWith(`${tag}.events.`)) {
      const event = rpcTag.slice(`${tag}.events.`.length)
      if (!isWireSegmentName(event)) {
        throw invalidSpec(tag, event, "event name must be non-empty printable text without dots")
      }
      events.push([event, rpcToBridgeEventSpec(tag, event, rpc)])
      continue
    }
    const method = rpcTag.slice(tag.length + 1)
    if (!isWireSegmentName(method)) {
      throw invalidSpec(tag, method, "method name must be non-empty printable text without dots")
    }
    methods.push([method, rpcToBridgeMethodSpec(rpc)])
  }

  return Object.freeze({
    spec: Object.freeze(Object.fromEntries(methods)),
    events: Object.freeze(Object.fromEntries(events))
  })
}

const validateBridgeContractSpec = (tag: string, spec: BridgeContractSpec): void => {
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

const validateMethodSpec = (tag: string, method: string, spec: BridgeMethodSpec): void => {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw invalidSpec(tag, method, "method spec must be an object")
  }

  if (!isSchema(spec.input)) {
    throw invalidSpec(tag, method, "input schema is required")
  }
  if (!isSchema(spec.output) && !isStreamSpec(spec.output)) {
    throw invalidSpec(tag, method, "output schema or stream is required")
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

const validateBridgeContractEvents = (tag: string, events: BridgeContractEvents): void => {
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

const validateEventSpec = (tag: string, event: string, spec: BridgeEventSpec): void => {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw invalidSpec(tag, event, "event spec must be an object")
  }

  if (!isSchema(spec.payload)) {
    throw invalidSpec(tag, event, "event payload schema is required")
  }
  if (spec.backpressure !== undefined) {
    validateBackpressureSpec(tag, event, spec.backpressure, {
      requirePositiveSize: true,
      allowOverflowError: false
    })
  }
}

const validateBackpressureSpec = (
  tag: string,
  method: string,
  spec: BackpressureSpec,
  options: { readonly requirePositiveSize: boolean; readonly allowOverflowError?: boolean }
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
  if (options.allowOverflowError === false && spec.overflow === "error") {
    throw invalidSpec(tag, method, "backpressure.overflow error is not supported here")
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

const validateHandlers = <Spec extends BridgeContractSpec>(
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

const freezeRpcSpec = <Spec extends BridgeContractSpec>(spec: Spec): Spec => {
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
    Object.freeze(methodSpec)
  }

  return Object.freeze(spec)
}

const freezeRpcEvents = <Events extends BridgeContractEvents>(events: Events): Events => {
  for (const eventSpec of Object.values(events)) {
    if (eventSpec.backpressure !== undefined) {
      Object.freeze(eventSpec.backpressure)
    }
    Object.freeze(eventSpec)
  }

  return Object.freeze(events)
}

const invalidSpec = (tag: string, method: string, reason: string): InvalidBridgeMetadataError =>
  new InvalidBridgeMetadataError({
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

const rpcToBridgeMethodSpec = (rpc: BridgeContractRpc): BridgeMethodSpec => {
  const streamSchemas = streamSchemasFromRpcSuccess(rpc.successSchema)
  const capability = rpcCapability(rpc)
  const support = rpcSupport(rpc)
  const runtime = bridgeRuntime(rpc)
  const output = Option.isSome(streamSchemas)
    ? makeBridgeStreamSpec(
        streamSchemas.value.success,
        streamSchemas.value.error,
        Option.isSome(runtime) ? runtime.value.backpressure : undefined
      )
    : rpc.successSchema

  return Object.freeze({
    input: rpc.payloadSchema,
    output,
    error: Option.isSome(streamSchemas) ? streamSchemas.value.error : rpc.errorSchema,
    ...(Option.isSome(capability) ? { permission: capability.value.kind } : {}),
    ...(Option.isSome(runtime) && runtime.value.timeoutMs !== undefined
      ? { timeoutMs: runtime.value.timeoutMs }
      : {}),
    ...(Option.isSome(runtime) && runtime.value.cachedResultMs !== undefined
      ? { cachedResultMs: runtime.value.cachedResultMs }
      : {}),
    ...(Option.isSome(runtime) && runtime.value.cancellable !== undefined
      ? { cancellable: runtime.value.cancellable }
      : {}),
    ...(Option.isSome(runtime) && runtime.value.backpressure !== undefined
      ? { backpressure: runtime.value.backpressure }
      : {}),
    ...(support.status === "supported" ? {} : { support })
  })
}

const rpcToBridgeEventSpec = (
  tag: string,
  event: string,
  rpc: BridgeContractRpc
): BridgeEventSpec => {
  const streamSchemas = streamSchemasFromRpcSuccess(rpc.successSchema)
  if (Option.isNone(streamSchemas)) {
    throw invalidSpec(tag, event, "event RPC must be a stream")
  }
  const runtime = bridgeRuntime(rpc)
  return Object.freeze({
    payload: streamSchemas.value.success,
    ...(Option.isSome(runtime) && runtime.value.backpressure !== undefined
      ? { backpressure: runtime.value.backpressure }
      : {})
  })
}

const isBridgeStreamSchema = (schema: BridgeSuccessSchema): schema is BridgeStreamSchema =>
  RpcSchema.isStreamSchema(schema)

const streamSchemasFromRpcSuccess = (
  schema: BridgeSuccessSchema
): Option.Option<{
  readonly success: BridgeContractCodec
  readonly error: BridgeContractCodec
}> => {
  if (!isBridgeStreamSchema(schema)) {
    return Option.none()
  }
  return Option.some({ success: schema.success, error: schema.error })
}

const isSchema = (value: unknown): value is BridgeContractCodec => {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null && "ast" in value
  )
}

export const isStreamSpec = (value: unknown): value is BridgeStreamSpec =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { readonly _tag?: unknown })._tag === "BridgeStreamSpec" &&
  "chunk" in value &&
  "error" in value &&
  isSchema((value as { readonly chunk?: unknown }).chunk) &&
  isSchema((value as { readonly error?: unknown }).error)

const makeBridgeStreamSpec = <Chunk extends BridgeContractCodec, Error extends BridgeContractCodec>(
  chunk: Chunk,
  error: Error,
  backpressure?: BackpressureSpec
): BridgeStreamSpec<Chunk, Error> =>
  Object.freeze({
    _tag: "BridgeStreamSpec",
    chunk,
    error,
    ...(backpressure === undefined ? {} : { backpressure: Object.freeze(backpressure) })
  })

const annotateRpc = <R extends RpcAny, I, S>(rpc: R, tag: Context.Key<I, S>, value: S): R =>
  (rpc as R & AnnotatableRpc).annotate(tag, value) as R

const backpressureStrategies = new Set<BackpressureSpec["strategy"]>(["buffer", "drop", "block"])
const backpressureOverflows = new Set<NonNullable<BackpressureSpec["overflow"]>>([
  "error",
  "dropOldest",
  "dropNewest",
  "block"
])
const supportStatuses = new Set<RpcSupportMetadata["status"]>(["supported", "unsupported"])
