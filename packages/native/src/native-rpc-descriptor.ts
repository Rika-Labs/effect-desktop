import {
  HostProtocolError as HostProtocolErrorSchema,
  RpcCapability,
  type RpcCapabilityMetadata,
  RpcEndpoint,
  type RpcEndpointKind,
  type RpcPlatformSupportMetadata,
  RpcSupport,
  type RpcSupportMetadata
} from "@orika/bridge"
import { Schema } from "effect"
import { Rpc, RpcSchema } from "effect/unstable/rpc"

type NativeRpcPayloadInput = Schema.Codec<unknown, unknown, never, never> | Schema.Struct.Fields

type NativeRpcPayloadSchema<Input extends NativeRpcPayloadInput> =
  Input extends Schema.Struct.Fields ? Schema.Struct<Input> : Input

export type NativeRpcAuthority =
  | {
      readonly kind: "native"
      readonly primitive?: string
    }
  | {
      readonly kind: "none"
    }
  | {
      readonly kind: "custom"
      readonly capability: Parameters<typeof RpcCapability>[0]
    }

export interface NativeRpcOptions<
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
> {
  readonly payload: Payload
  readonly success: Success
  readonly authority: NativeRpcAuthority
  readonly endpoint: RpcEndpointKind
  readonly support: RpcSupportMetadata
}

export interface NativeEventOptions<Payload extends Schema.Codec<unknown, unknown, never, never>> {
  readonly payload: Payload
  readonly support: RpcSupportMetadata
  readonly authority?: NativeRpcAuthority
}

export interface NativeEventStreamOptions<
  Input extends NativeRpcPayloadInput,
  Payload extends Schema.Codec<unknown, unknown, never, never>
> {
  readonly input: Input
  readonly payload: Payload
  readonly support: RpcSupportMetadata
  readonly authority?: NativeRpcAuthority
}

export type NativeEventRpc<
  Surface extends string = string,
  EventName extends string = string,
  Payload extends Schema.Codec<unknown, unknown, never, never> = Schema.Codec<
    unknown,
    unknown,
    never,
    never
  >
> = Rpc.Rpc<
  `${Surface}.events.${EventName}`,
  typeof Schema.Void,
  RpcSchema.Stream<Payload, typeof HostProtocolErrorSchema>,
  typeof Schema.Never
>

export type NativeEventStreamRpc<
  Surface extends string = string,
  EventName extends string = string,
  Input extends NativeRpcPayloadInput = Schema.Codec<unknown, unknown, never, never>,
  Payload extends Schema.Codec<unknown, unknown, never, never> = Schema.Codec<
    unknown,
    unknown,
    never,
    never
  >
> = Rpc.Rpc<
  `${Surface}.events.${EventName}`,
  NativeRpcPayloadSchema<Input>,
  RpcSchema.Stream<Payload, typeof HostProtocolErrorSchema>,
  typeof Schema.Never
>

export interface NativeCapabilityFactOptions {
  readonly authority: NativeRpcAuthority
  readonly support: RpcSupportMetadata
}

export interface NativeCapabilityFact {
  readonly tag: string
  readonly capability: RpcCapabilityMetadata
  readonly support: RpcSupportMetadata
}

export const nativeAuthority = Object.freeze({
  native: (primitive?: string): NativeRpcAuthority =>
    primitive === undefined
      ? Object.freeze({ kind: "native" })
      : Object.freeze({ kind: "native", primitive }),
  none: Object.freeze({ kind: "none" } satisfies NativeRpcAuthority),
  custom: (capability: Parameters<typeof RpcCapability>[0]): NativeRpcAuthority =>
    Object.freeze({ kind: "custom", capability })
})

export const NativeRpcSupport = Object.freeze({
  supported: Object.freeze({ status: "supported" } satisfies RpcSupportMetadata),
  partial: (
    reason: string,
    options: { readonly platforms?: readonly RpcPlatformSupportMetadata[] } = {}
  ): RpcSupportMetadata => Object.freeze({ status: "partial", reason, ...options }),
  unsupported: (
    reason: string,
    options: { readonly platforms?: readonly RpcPlatformSupportMetadata[] } = {}
  ): RpcSupportMetadata => Object.freeze({ status: "unsupported", reason, ...options })
})

export const nativeRpc = <
  const Surface extends string,
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  surface: Surface,
  method: Method,
  options: NativeRpcOptions<Payload, Success>
) => {
  const base = Rpc.make(`${surface}.${method}` as const, {
    payload: options.payload,
    success: options.success,
    error: HostProtocolErrorSchema
  })

  return applySupport(
    applyCapability(applyEndpoint(base, options.endpoint), surface, method, options.authority),
    options.support
  )
}

export const nativeEvent = <
  const Surface extends string,
  const EventName extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(
  surface: Surface,
  eventName: EventName,
  options: NativeEventOptions<Payload>
): NativeEventRpc<Surface, EventName, Payload> => {
  const base = Rpc.make(`${surface}.events.${eventName}` as const, {
    success: options.payload,
    error: HostProtocolErrorSchema,
    stream: true
  })

  return applySupport(
    applyCapability(
      base,
      surface,
      `events.${eventName}`,
      options.authority ?? nativeAuthority.none
    ),
    options.support
  )
}

export const nativeEventStream = <
  const Surface extends string,
  const EventName extends string,
  Input extends NativeRpcPayloadInput,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(
  surface: Surface,
  eventName: EventName,
  options: NativeEventStreamOptions<Input, Payload>
): NativeEventStreamRpc<Surface, EventName, Input, Payload> => {
  const base = Rpc.make(`${surface}.events.${eventName}` as const, {
    payload: options.input,
    success: options.payload,
    error: HostProtocolErrorSchema,
    stream: true
  })

  return applySupport(
    applyCapability(
      base,
      surface,
      `events.${eventName}`,
      options.authority ?? nativeAuthority.none
    ),
    options.support
  )
}

export const nativeCapabilityFact = <const Surface extends string, const Method extends string>(
  surface: Surface,
  method: Method,
  options: NativeCapabilityFactOptions
): NativeCapabilityFact =>
  Object.freeze({
    tag: `${surface}.${method}` as const,
    capability: capabilityFor(surface, method, options.authority),
    support: options.support
  })

const applyEndpoint = <R extends Rpc.Any>(rpc: R, endpoint: RpcEndpointKind): R =>
  endpoint === "query" ? RpcEndpoint.query(rpc) : RpcEndpoint.mutation(rpc)

const applyCapability = <R extends Rpc.Any>(
  rpc: R,
  surface: string,
  method: string,
  authority: NativeRpcAuthority
): R => RpcCapability(capabilityFor(surface, method, authority))(rpc)

const applySupport = <R extends Rpc.Any>(rpc: R, support: RpcSupportMetadata): R =>
  support.status === "supported"
    ? RpcSupport.supported(
        rpc,
        support.platforms === undefined ? {} : { platforms: support.platforms }
      )
    : support.status === "partial"
      ? RpcSupport.partial(
          support.reason,
          support.platforms === undefined ? {} : { platforms: support.platforms }
        )(rpc)
      : RpcSupport.unsupported(
          support.reason,
          support.platforms === undefined ? {} : { platforms: support.platforms }
        )(rpc)

const capabilityFor = (
  surface: string,
  method: string,
  authority: NativeRpcAuthority
): RpcCapabilityMetadata => {
  switch (authority.kind) {
    case "custom":
      return authority.capability
    case "native":
      return Object.freeze({
        kind: "native.invoke",
        primitive: authority.primitive ?? surface,
        methods: [method],
        audit: "always"
      })
    case "none":
      return { kind: "none" }
  }
}
