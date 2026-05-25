import {
  rpcCapability,
  rpcEndpointKind,
  rpcEndpointName,
  rpcSupport,
  type RpcCapabilityMetadata,
  type RpcSupportMarker,
  type RpcSupportMetadata
} from "@orika/bridge"
import { Context, Data, Effect, Layer, Option, Schema } from "effect"
import { Rpc, RpcClient, RpcClientError, RpcGroup, RpcSchema, RpcServer } from "effect/unstable/rpc"

import {
  rpc as desktopRpc,
  type DesktopRpcBoundServerRequirements,
  type DesktopRpcsLayer
} from "./desktop-app.js"

export type DesktopRpcClient<Rpcs extends Rpc.AnyWithProps> = RpcClient.RpcClient<
  Rpcs,
  RpcClientError.RpcClientError
>

export type SupportedRpc<R extends Rpc.AnyWithProps> =
  R extends RpcSupportMarker<infer Support>
    ? Support extends { readonly status: "unsupported" }
      ? never
      : R
    : R

export type SupportedDesktopRpcClient<Rpcs extends Rpc.AnyWithProps> = DesktopRpcClient<
  SupportedRpc<Rpcs>
>

export type SupportedDesktopRpcGroup<
  Group extends RpcGroup.RpcGroup<Rpcs>,
  Rpcs extends Rpc.AnyWithProps = RpcGroup.Rpcs<Group>
> = RpcGroup.RpcGroup<SupportedRpc<RpcGroup.Rpcs<Group>>>

type RpcGroupRequests<Rpcs extends Rpc.AnyWithProps = Rpc.AnyWithProps> = {
  readonly requests: ReadonlyMap<string, Rpcs>
}

export interface DesktopRpcSchemaDoc {
  readonly name: string
  readonly tag: string
  readonly kind: "query" | "mutation" | "stream"
  readonly callable: boolean
  readonly payload: Option.Option<Schema.Top>
  readonly success: Option.Option<Schema.Top>
  readonly error: Option.Option<Schema.Top>
  readonly stream: Option.Option<{
    readonly chunk: Schema.Top
    readonly error: Schema.Top
  }>
  readonly capability: Option.Option<RpcCapabilityMetadata>
  readonly support: RpcSupportMetadata
}

export interface DesktopRpcCapabilityFact {
  readonly tag: string
  readonly capability: RpcCapabilityMetadata
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

export interface DesktopRpcSurfaceOptionsBase<Rpcs extends Rpc.AnyWithProps, ServerE, ServerR> {
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, ServerE, ServerR>
  readonly capabilityFacts?: readonly DesktopRpcCapabilityFact[]
}

export interface DesktopRpcSurfaceDirectOptions<
  Rpcs extends Rpc.AnyWithProps,
  ServiceId,
  ServerE,
  ServerR
> extends DesktopRpcSurfaceOptionsBase<Rpcs, ServerE, ServerR> {
  readonly service: Context.Key<ServiceId, DesktopRpcClient<Rpcs>>
}

export interface DesktopRpcSurfaceMappedOptions<
  Rpcs extends Rpc.AnyWithProps,
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
  Group extends RpcGroup.RpcGroup<Rpcs>,
  Rpcs extends Rpc.AnyWithProps,
  ServiceId,
  ServerE,
  ServerR
> {
  readonly _tag: "DesktopRpcSurface"
  readonly tag: Tag
  readonly group: Group
  readonly serverLayer: DesktopRpcsLayer<
    ServerE,
    DesktopRpcBoundServerRequirements<Rpcs, ServerR>,
    ServerR
  >
  readonly clientLayer: Layer.Layer<
    ServiceId,
    never,
    RpcClient.Protocol | Rpc.MiddlewareClient<Rpcs>
  >
  readonly testClientLayer: DesktopRpcTestClientLayerFactory<Rpcs, ServiceId, ServerE, ServerR>
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
  readonly contractLaws: readonly DesktopRpcContractLaw[]
}

export interface DesktopRpcTestClientLayerFactory<
  Rpcs extends Rpc.AnyWithProps,
  ServiceId,
  ServerE,
  ServerR
> {
  (): Layer.Layer<ServiceId, ServerE, ServerR | Rpc.Middleware<Rpcs> | Rpc.MiddlewareClient<Rpcs>>
  <DependencyE, DependencyR>(
    dependencies: Layer.Layer<ServerR, DependencyE, DependencyR>
  ): Layer.Layer<
    ServiceId,
    ServerE | DependencyE,
    DependencyR | Rpc.Middleware<Rpcs> | Rpc.MiddlewareClient<Rpcs>
  >
}

export function surface<
  const Tag extends string,
  Rpcs extends Rpc.AnyWithProps,
  Group extends RpcGroup.RpcGroup<Rpcs>,
  ServiceId,
  ServerE,
  ServerR
>(
  tag: Tag,
  group: RpcGroup.RpcGroup<Rpcs> & Group,
  options: DesktopRpcSurfaceDirectOptions<Rpcs, ServiceId, ServerE, ServerR>
): DesktopRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR>
export function surface<
  const Tag extends string,
  Rpcs extends Rpc.AnyWithProps,
  Group extends RpcGroup.RpcGroup<Rpcs>,
  ServiceId,
  Service,
  ServerE,
  ServerR
>(
  tag: Tag,
  group: RpcGroup.RpcGroup<Rpcs> & Group,
  options: DesktopRpcSurfaceMappedOptions<Rpcs, ServiceId, Service, ServerE, ServerR>
): DesktopRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR>
export function surface<
  const Tag extends string,
  Rpcs extends Rpc.AnyWithProps,
  Group extends RpcGroup.RpcGroup<Rpcs>,
  ServiceId,
  Service,
  ServerE,
  ServerR
>(
  tag: Tag,
  group: RpcGroup.RpcGroup<Rpcs> & Group,
  options:
    | DesktopRpcSurfaceDirectOptions<Rpcs, ServiceId, ServerE, ServerR>
    | DesktopRpcSurfaceMappedOptions<Rpcs, ServiceId, Service, ServerE, ServerR>
): DesktopRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR> {
  const facts = options.capabilityFacts ?? []
  assertCapabilityFacts(tag, group, facts)

  const makeSurface = <SurfaceService>(
    service: Context.Key<ServiceId, SurfaceService>,
    toService: (client: DesktopRpcClient<Rpcs>) => SurfaceService
  ): DesktopRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR> => {
    const baseTestClientLayer: Layer.Layer<
      ServiceId,
      never,
      Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs> | Rpc.MiddlewareClient<Rpcs>
    > = Layer.effectContext(
      Effect.gen(function* () {
        const serverContext = yield* Effect.context<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>>()
        let rpcClient!: Effect.Success<
          ReturnType<typeof RpcClient.makeNoSerialization<Rpcs, never>>
        >
        const server = yield* RpcServer.makeNoSerialization(group, {
          onFromServer: (response) => rpcClient.write(response)
        })
        rpcClient = yield* RpcClient.makeNoSerialization(group, {
          supportsAck: true,
          onFromClient: ({ message }) =>
            Effect.withFiber((fiber) =>
              server
                .write(0, message)
                .pipe(
                  Effect.provideContext(
                    Context.merge(serverContext, Context.omit(service)(fiber.context))
                  )
                )
            )
        })
        return Context.make(service, toService(rpcClient.client))
      })
    )
    const testClientLayerFromHandlers = <E, R>(
      handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
    ): Layer.Layer<ServiceId, E, R | Rpc.Middleware<Rpcs> | Rpc.MiddlewareClient<Rpcs>> =>
      Layer.provide(baseTestClientLayer, handlers)
    function testClientLayer(): Layer.Layer<
      ServiceId,
      ServerE,
      ServerR | Rpc.Middleware<Rpcs> | Rpc.MiddlewareClient<Rpcs>
    >
    function testClientLayer<DependencyE, DependencyR>(
      dependencies: Layer.Layer<ServerR, DependencyE, DependencyR>
    ): Layer.Layer<
      ServiceId,
      ServerE | DependencyE,
      DependencyR | Rpc.Middleware<Rpcs> | Rpc.MiddlewareClient<Rpcs>
    >
    function testClientLayer<DependencyE, DependencyR>(
      dependencies?: Layer.Layer<ServerR, DependencyE, DependencyR>
    ) {
      return dependencies === undefined
        ? testClientLayerFromHandlers(options.handlers)
        : Layer.provide(testClientLayerFromHandlers(options.handlers), dependencies)
    }

    return Object.freeze({
      _tag: "DesktopRpcSurface" as const,
      tag,
      group,
      serverLayer: desktopRpc(group, options.handlers),
      clientLayer: Layer.effect(service, RpcClient.make(group).pipe(Effect.map(toService))),
      testClientLayer,
      schemaDocs: schemaDocs(group, facts),
      contractLaws: contractLaws(tag, group)
    })
  }

  return "client" in options
    ? makeSurface(options.service, options.client)
    : makeSurface(options.service, (client) => client)
}

export const supportedGroup = <Rpcs extends Rpc.AnyWithProps>(
  group: RpcGroup.RpcGroup<Rpcs>
): RpcGroup.RpcGroup<SupportedRpc<Rpcs>> =>
  RpcGroup.make(...Array.from(group.requests.values()).filter(isSupportedRpc))

export const DesktopRpc = Object.freeze({
  surface,
  supportedGroup
})

const isSupportedRpc = <R extends Rpc.AnyWithProps>(rpc: R): rpc is SupportedRpc<R> =>
  rpcSupport(rpc).status !== "unsupported"

const assertCapabilityFacts = (
  tag: string,
  group: RpcGroupRequests,
  facts: readonly DesktopRpcCapabilityFact[]
): void => {
  const seen = new Set<string>(group.requests.keys())
  for (const fact of facts) {
    if (!fact.tag.startsWith(`${tag}.`)) {
      throw new TypeError(`Capability fact tag "${fact.tag}" must start with "${tag}.".`)
    }
    if (seen.has(fact.tag)) {
      throw new TypeError(
        `Capability fact tag "${fact.tag}" collides with a callable RPC on surface "${tag}".`
      )
    }
    seen.add(fact.tag)
  }
}

const callableSchemaDocs = <Rpcs extends Rpc.AnyWithProps>(
  group: RpcGroupRequests<Rpcs>
): readonly DesktopRpcSchemaDoc[] =>
  Array.from(group.requests.values()).map((rpc) => {
    const stream = streamSchemasFromRpcSuccess(rpc.successSchema)
    return Object.freeze({
      name: rpcEndpointName(rpc._tag),
      tag: rpc._tag,
      kind: Option.isSome(stream) ? "stream" : rpcEndpointKind(rpc),
      callable: true,
      payload: Option.some(rpc.payloadSchema),
      success: Option.some(Option.isSome(stream) ? stream.value.success : rpc.successSchema),
      error: Option.some(Option.isSome(stream) ? stream.value.error : rpc.errorSchema),
      stream: Option.map(stream, ({ success, error }) => ({ chunk: success, error })),
      capability: rpcCapability(rpc),
      support: rpcSupport(rpc)
    } satisfies DesktopRpcSchemaDoc)
  })

const factSchemaDoc = (fact: DesktopRpcCapabilityFact): DesktopRpcSchemaDoc =>
  Object.freeze({
    name: rpcEndpointName(fact.tag),
    tag: fact.tag,
    kind: "query",
    callable: false,
    payload: Option.none(),
    success: Option.none(),
    error: Option.none(),
    stream: Option.none(),
    capability: Option.some(fact.capability),
    support: fact.support
  } satisfies DesktopRpcSchemaDoc)

const schemaDocs = (
  group: RpcGroupRequests,
  facts: readonly DesktopRpcCapabilityFact[]
): readonly DesktopRpcSchemaDoc[] =>
  Object.freeze([...callableSchemaDocs(group), ...facts.map(factSchemaDoc)])

const contractLaws = (tag: string, group: RpcGroupRequests): readonly DesktopRpcContractLaw[] =>
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
  group: RpcGroupRequests
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
  group: RpcGroupRequests
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
  group: RpcGroupRequests
): Effect.Effect<void, DesktopRpcSurfaceError, never> =>
  Effect.suspend(() => {
    for (const rpc of group.requests.values()) {
      if (
        !Schema.isSchema(rpc.payloadSchema) ||
        !Schema.isSchema(rpc.successSchema) ||
        !Schema.isSchema(rpc.errorSchema)
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

const streamSchemasFromRpcSuccess = (
  schema: Schema.Top
): Option.Option<{
  readonly success: Schema.Top
  readonly error: Schema.Top
}> =>
  RpcSchema.isStreamSchema(schema)
    ? Option.some({ success: schema.success, error: schema.error })
    : Option.none()

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
