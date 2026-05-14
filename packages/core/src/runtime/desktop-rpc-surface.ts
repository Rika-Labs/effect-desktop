import {
  rpcCapability,
  rpcEndpointKind,
  rpcEndpointName,
  rpcSupport,
  type RpcCapabilityMetadata,
  type RpcSupportMarker,
  type RpcSupportMetadata
} from "@effect-desktop/bridge"
import { Context, Data, Effect, Layer, Option, Schema } from "effect"
import { Rpc, RpcClient, RpcClientError, RpcGroup, RpcSchema, RpcTest } from "effect/unstable/rpc"

import { rpc as desktopRpc, type DesktopRpcsLayer } from "./desktop-app.js"
import type { DesktopRpcRegistrationGroup } from "./desktop-rpc-registry.js"

type RpcGroupWithRequests = DesktopRpcRegistrationGroup

export type DesktopRpcClient<Rpcs extends Rpc.Any> = RpcClient.RpcClient<
  Rpcs,
  RpcClientError.RpcClientError
>

export type SupportedRpc<R extends Rpc.Any> =
  R extends RpcSupportMarker<infer Support>
    ? Support extends { readonly status: "unsupported" }
      ? never
      : R
    : R

export type SupportedDesktopRpcClient<Rpcs extends Rpc.Any> = DesktopRpcClient<SupportedRpc<Rpcs>>

export type SupportedDesktopRpcGroup<Group extends RpcGroup.Any> = RpcGroup.RpcGroup<
  SupportedRpc<RpcGroup.Rpcs<Group>>
>

export interface DesktopRpcSchemaDoc {
  readonly name: string
  readonly tag: string
  readonly kind: "query" | "mutation" | "stream"
  readonly payload: Schema.Top
  readonly success: Schema.Top
  readonly error: Schema.Top
  readonly stream: Option.Option<{
    readonly chunk: Schema.Top
    readonly error: Schema.Top
  }>
  readonly capability: Option.Option<RpcCapabilityMetadata>
  readonly support: RpcSupportMetadata
}

export interface DesktopRpcContractLaw {
  readonly name: string
  readonly description: string
  readonly check: Effect.Effect<void, DesktopRpcSurfaceError, never>
}

export class DesktopRpcSurfaceError extends Data.TaggedError("DesktopRpcSurfaceError")<{
  readonly reason: "duplicate-endpoint" | "invalid-tag" | "missing-schema"
  readonly message: string
  readonly tag: string
}> {}

export interface DesktopRpcSurfaceOptionsBase<Rpcs extends Rpc.Any, ServerE, ServerR> {
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, ServerE, ServerR>
}

export interface DesktopRpcSurfaceDirectOptions<
  Rpcs extends Rpc.Any,
  ServiceId,
  ServerE,
  ServerR
> extends DesktopRpcSurfaceOptionsBase<Rpcs, ServerE, ServerR> {
  readonly service: Context.Key<ServiceId, DesktopRpcClient<Rpcs>>
}

export interface DesktopRpcSurfaceMappedOptions<
  Rpcs extends Rpc.Any,
  ServiceId,
  Service,
  ServerE,
  ServerR
> extends DesktopRpcSurfaceOptionsBase<Rpcs, ServerE, ServerR> {
  readonly service: Context.Key<ServiceId, Service>
  readonly client: (client: DesktopRpcClient<Rpcs>) => Service
}

export interface DesktopRpcSurface<
  Tag extends string,
  Group extends RpcGroupWithRequests,
  Rpcs extends Rpc.Any,
  ServiceId,
  ServerE,
  ServerR
> {
  readonly _tag: "DesktopRpcSurface"
  readonly tag: Tag
  readonly group: Group
  readonly serverLayer: DesktopRpcsLayer<ServerE, ServerR>
  readonly clientLayer: Layer.Layer<
    ServiceId,
    never,
    RpcClient.Protocol | Rpc.MiddlewareClient<Rpcs>
  >
  readonly testClientLayer: Layer.Layer<
    ServiceId,
    ServerE,
    ServerR | Rpc.Middleware<Rpcs> | Rpc.MiddlewareClient<Rpcs>
  >
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
  readonly contractLaws: readonly DesktopRpcContractLaw[]
}

export function surface<
  const Tag extends string,
  Group extends RpcGroup.Any & RpcGroupWithRequests,
  ServiceId,
  ServerE,
  ServerR
>(
  tag: Tag,
  group: Group,
  options: DesktopRpcSurfaceDirectOptions<RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR>
): DesktopRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR>
export function surface<
  const Tag extends string,
  Group extends RpcGroup.Any & RpcGroupWithRequests,
  ServiceId,
  Service,
  ServerE,
  ServerR
>(
  tag: Tag,
  group: Group,
  options: DesktopRpcSurfaceMappedOptions<
    RpcGroup.Rpcs<Group>,
    ServiceId,
    Service,
    ServerE,
    ServerR
  >
): DesktopRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR>
export function surface<
  const Tag extends string,
  Group extends RpcGroup.Any & RpcGroupWithRequests,
  ServiceId,
  Service,
  ServerE,
  ServerR
>(
  tag: Tag,
  group: Group,
  options:
    | DesktopRpcSurfaceDirectOptions<RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR>
    | DesktopRpcSurfaceMappedOptions<RpcGroup.Rpcs<Group>, ServiceId, Service, ServerE, ServerR>
): DesktopRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR> {
  type Rpcs = RpcGroup.Rpcs<Group>
  const rpcGroup = group as unknown as RpcGroup.RpcGroup<Rpcs>
  const service = options.service as Context.Key<ServiceId, DesktopRpcClient<Rpcs> | Service>
  const toService = (client: DesktopRpcClient<Rpcs>): DesktopRpcClient<Rpcs> | Service =>
    "client" in options ? options.client(client) : client

  return Object.freeze({
    _tag: "DesktopRpcSurface" as const,
    tag,
    group,
    serverLayer: desktopRpc(rpcGroup, options.handlers),
    clientLayer: Layer.effect(service, RpcClient.make(rpcGroup).pipe(Effect.map(toService))),
    testClientLayer: Layer.effect(
      service,
      RpcTest.makeClient(rpcGroup).pipe(
        Effect.map((client) => toService(client as DesktopRpcClient<Rpcs>))
      )
    ).pipe(Layer.provide(options.handlers)),
    schemaDocs: schemaDocs(group),
    contractLaws: contractLaws(tag, group)
  })
}

export const supportedGroup = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>
): RpcGroup.RpcGroup<SupportedRpc<Rpcs>> =>
  RpcGroup.make(...Array.from(group.requests.values()).filter(isSupportedRpc))

export const DesktopRpc = Object.freeze({
  surface,
  supportedGroup
})

const isSupportedRpc = <R extends Rpc.Any>(rpc: R): rpc is SupportedRpc<R> =>
  rpcSupport(rpc).status === "supported"

const schemaDocs = (group: RpcGroupWithRequests): readonly DesktopRpcSchemaDoc[] =>
  Object.freeze(
    Array.from(group.requests.values()).map((rpc) => {
      const withSchemas = rpc as Rpc.AnyWithProps
      const stream = streamSchemasFromRpcSuccess(withSchemas.successSchema)
      return Object.freeze({
        name: rpcEndpointName(rpc._tag),
        tag: rpc._tag,
        kind: Option.isSome(stream) ? "stream" : rpcEndpointKind(rpc),
        payload: withSchemas.payloadSchema,
        success: Option.isSome(stream) ? stream.value.success : withSchemas.successSchema,
        error: Option.isSome(stream) ? stream.value.error : withSchemas.errorSchema,
        stream: Option.map(stream, ({ success, error }) => ({ chunk: success, error })),
        capability: rpcCapability(rpc),
        support: rpcSupport(rpc)
      })
    })
  )

const contractLaws = (tag: string, group: RpcGroupWithRequests): readonly DesktopRpcContractLaw[] =>
  Object.freeze([
    Object.freeze({
      name: "bridge-compatible-tags",
      description: "Every RPC tag belongs to the surface namespace and maps to a bridge method.",
      check: checkBridgeCompatibleTags(tag, group)
    }),
    Object.freeze({
      name: "unique-endpoint-names",
      description: "Every RPC tag maps to one renderer endpoint name.",
      check: checkUniqueEndpointNames(group)
    }),
    Object.freeze({
      name: "schema-backed-endpoints",
      description: "Every RPC exposes payload, success, and error schemas.",
      check: checkSchemaBackedEndpoints(group)
    })
  ])

const checkUniqueEndpointNames = (
  group: RpcGroupWithRequests
): Effect.Effect<void, DesktopRpcSurfaceError, never> =>
  Effect.suspend(() => {
    const seen = new Map<string, string>()
    for (const rpc of group.requests.values()) {
      const name = rpcEndpointName(rpc._tag)
      const previous = seen.get(name)
      if (previous !== undefined) {
        return Effect.fail(
          new DesktopRpcSurfaceError({
            reason: "duplicate-endpoint",
            message: `RPC tags "${previous}" and "${rpc._tag}" both map to endpoint "${name}".`,
            tag: rpc._tag
          })
        )
      }
      seen.set(name, rpc._tag)
    }
    return Effect.void
  })

const checkBridgeCompatibleTags = (
  tag: string,
  group: RpcGroupWithRequests
): Effect.Effect<void, DesktopRpcSurfaceError, never> =>
  Effect.suspend(() => {
    if (!isPrintableName(tag)) {
      return Effect.fail(
        new DesktopRpcSurfaceError({
          reason: "invalid-tag",
          message: "Surface tag must be non-empty printable text.",
          tag
        })
      )
    }
    for (const rpcTag of group.requests.keys()) {
      if (!rpcTag.startsWith(`${tag}.`)) {
        return Effect.fail(
          new DesktopRpcSurfaceError({
            reason: "invalid-tag",
            message: `RPC tag "${rpcTag}" must start with "${tag}.".`,
            tag: rpcTag
          })
        )
      }
      if (rpcTag.startsWith(`${tag}.events.`)) {
        continue
      }
      const method = rpcTag.slice(tag.length + 1)
      if (!isWireSegmentName(method)) {
        return Effect.fail(
          new DesktopRpcSurfaceError({
            reason: "invalid-tag",
            message: `RPC tag "${rpcTag}" must map to one printable bridge method segment.`,
            tag: rpcTag
          })
        )
      }
    }
    return Effect.void
  })

const checkSchemaBackedEndpoints = (
  group: RpcGroupWithRequests
): Effect.Effect<void, DesktopRpcSurfaceError, never> =>
  Effect.suspend(() => {
    for (const rpc of group.requests.values()) {
      const withSchemas = rpc as Partial<Rpc.AnyWithProps>
      if (
        !Schema.isSchema(withSchemas.payloadSchema) ||
        !Schema.isSchema(withSchemas.successSchema) ||
        !Schema.isSchema(withSchemas.errorSchema)
      ) {
        return Effect.fail(
          new DesktopRpcSurfaceError({
            reason: "missing-schema",
            message: `RPC tag "${rpc._tag}" is missing payload, success, or error schema metadata.`,
            tag: rpc._tag
          })
        )
      }
    }
    return Effect.void
  })

interface RpcStreamSchema extends Schema.Schema<unknown> {
  readonly success: Schema.Schema<unknown>
  readonly error: Schema.Schema<unknown>
}

const streamSchemasFromRpcSuccess = (
  schema: Schema.Schema<unknown>
): Option.Option<{
  readonly success: Schema.Schema<unknown>
  readonly error: Schema.Schema<unknown>
}> => {
  if (!RpcSchema.isStreamSchema(schema)) {
    return Option.none()
  }
  const stream = schema as RpcStreamSchema
  return Option.some({ success: stream.success, error: stream.error })
}

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
