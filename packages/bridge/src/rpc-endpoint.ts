import { Context, Option } from "effect"
import { Rpc } from "effect/unstable/rpc"

interface AnnotatableRpc extends Rpc.Any {
  annotate<I, S>(tag: Context.Key<I, S>, value: S): Rpc.Any
}

export type RpcEndpointKind = "query" | "mutation"

export interface RpcCapabilityMetadata {
  readonly kind: string
  readonly [key: string]: unknown
}

export type RpcSupportMetadata =
  | {
      readonly status: "supported"
    }
  | {
      readonly status: "unsupported"
      readonly reason: string
    }

declare const RpcEndpointKindTypeId: unique symbol
declare const RpcCapabilityTypeId: unique symbol
declare const RpcSupportTypeId: unique symbol

export interface RpcEndpointKindMarker<Kind extends RpcEndpointKind> {
  readonly [RpcEndpointKindTypeId]: Kind
}

export interface RpcCapabilityMarker<Capability extends RpcCapabilityMetadata> {
  readonly [RpcCapabilityTypeId]: Capability
}

export interface RpcSupportMarker<Support extends RpcSupportMetadata> {
  readonly [RpcSupportTypeId]: Support
}

export type WithRpcEndpointKind<R extends Rpc.Any, Kind extends RpcEndpointKind> = R &
  RpcEndpointKindMarker<Kind>

export type WithRpcCapability<R extends Rpc.Any, Capability extends RpcCapabilityMetadata> = R &
  RpcCapabilityMarker<Capability>

export type WithRpcSupport<R extends Rpc.Any, Support extends RpcSupportMetadata> = R &
  RpcSupportMarker<Support>

export const RpcEndpointKindAnnotation = Context.Service<RpcEndpointKind>(
  "@rikalabs/effect-desktop/bridge/RpcEndpointKind"
)

export const RpcCapabilityAnnotation = Context.Service<RpcCapabilityMetadata>(
  "@rikalabs/effect-desktop/bridge/RpcCapability"
)

export const RpcSupportAnnotation = Context.Service<RpcSupportMetadata>(
  "@rikalabs/effect-desktop/bridge/RpcSupport"
)

export const RpcEndpoint = Object.freeze({
  query: <R extends Rpc.Any>(rpc: R): WithRpcEndpointKind<R, "query"> =>
    annotateRpc(rpc, RpcEndpointKindAnnotation, "query") as WithRpcEndpointKind<R, "query">,

  mutation: <R extends Rpc.Any>(rpc: R): WithRpcEndpointKind<R, "mutation"> =>
    annotateRpc(rpc, RpcEndpointKindAnnotation, "mutation") as WithRpcEndpointKind<R, "mutation">
})

export const RpcCapability =
  <Capability extends RpcCapabilityMetadata>(capability: Capability) =>
  <R extends Rpc.Any>(rpc: R): WithRpcCapability<R, Capability> =>
    annotateRpc(rpc, RpcCapabilityAnnotation, Object.freeze(capability)) as WithRpcCapability<
      R,
      Capability
    >

export const RpcSupport = Object.freeze({
  supported: <R extends Rpc.Any>(rpc: R): WithRpcSupport<R, { readonly status: "supported" }> =>
    annotateRpc(rpc, RpcSupportAnnotation, { status: "supported" }) as WithRpcSupport<
      R,
      { readonly status: "supported" }
    >,

  unsupported:
    (reason: string) =>
    <R extends Rpc.Any>(
      rpc: R
    ): WithRpcSupport<R, { readonly status: "unsupported"; readonly reason: string }> =>
      annotateRpc(rpc, RpcSupportAnnotation, { status: "unsupported", reason }) as WithRpcSupport<
        R,
        { readonly status: "unsupported"; readonly reason: string }
      >
})

export const rpcEndpointKind = (rpc: Rpc.Any): RpcEndpointKind =>
  Option.getOrElse(Context.getOption(rpc.annotations, RpcEndpointKindAnnotation), () => "mutation")

export const rpcCapability = (rpc: Rpc.Any): Option.Option<RpcCapabilityMetadata> =>
  Context.getOption(rpc.annotations, RpcCapabilityAnnotation)

export const rpcSupport = (rpc: Rpc.Any): RpcSupportMetadata =>
  Option.getOrElse(Context.getOption(rpc.annotations, RpcSupportAnnotation), () => ({
    status: "supported"
  }))

export const rpcEndpointName = (tag: string): string => {
  const segment = tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag
  if (segment.length === 0) {
    return tag
  }

  const first = segment[0]
  return first === undefined ? segment : `${first.toLowerCase()}${segment.slice(1)}`
}

const annotateRpc = <R extends Rpc.Any, I, S>(rpc: R, tag: Context.Key<I, S>, value: S): R =>
  (rpc as R & AnnotatableRpc).annotate(tag, value) as R
