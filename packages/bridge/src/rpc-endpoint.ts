import { Context, Option } from "effect"
import type { Any as RpcAny } from "effect/unstable/rpc/Rpc"

interface AnnotatableRpc extends RpcAny {
  annotate<I, S>(tag: Context.Key<I, S>, value: S): RpcAny
}

export type RpcEndpointKind = "query" | "mutation"

export interface RpcCapabilityMetadata {
  readonly kind: string
  readonly [key: string]: unknown
}

export type RpcSupportPlatform = "macos" | "windows" | "linux"

export type RpcSupportStatus = "supported" | "partial" | "unsupported"

export type RpcPlatformSupportMetadata =
  | {
      readonly platform: RpcSupportPlatform
      readonly status: "supported"
    }
  | {
      readonly platform: RpcSupportPlatform
      readonly status: "partial" | "unsupported"
      readonly reason: string
    }

export type RpcSupportMetadata =
  | {
      readonly status: "supported"
      readonly platforms?: readonly RpcPlatformSupportMetadata[]
    }
  | {
      readonly status: "partial"
      readonly reason: string
      readonly platforms?: readonly RpcPlatformSupportMetadata[]
    }
  | {
      readonly status: "unsupported"
      readonly reason: string
      readonly platforms?: readonly RpcPlatformSupportMetadata[]
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

export type WithRpcEndpointKind<R extends RpcAny, Kind extends RpcEndpointKind> = R &
  RpcEndpointKindMarker<Kind>

export type WithRpcCapability<R extends RpcAny, Capability extends RpcCapabilityMetadata> = R &
  RpcCapabilityMarker<Capability>

export type WithRpcSupport<R extends RpcAny, Support extends RpcSupportMetadata> = R &
  RpcSupportMarker<Support>

class RpcEndpointKindAnnotation extends Context.Service<
  RpcEndpointKindAnnotation,
  RpcEndpointKind
>()("@effect-desktop/bridge/rpc-endpoint/RpcEndpointKindAnnotation") {}

class RpcCapabilityAnnotation extends Context.Service<
  RpcCapabilityAnnotation,
  RpcCapabilityMetadata
>()("@effect-desktop/bridge/rpc-endpoint/RpcCapabilityAnnotation") {}

class RpcSupportAnnotation extends Context.Service<RpcSupportAnnotation, RpcSupportMetadata>()(
  "@effect-desktop/bridge/rpc-endpoint/RpcSupportAnnotation"
) {}

export const RpcEndpoint = Object.freeze({
  query: <R extends RpcAny>(rpc: R): WithRpcEndpointKind<R, "query"> =>
    annotateRpc(rpc, RpcEndpointKindAnnotation, "query") as WithRpcEndpointKind<R, "query">,

  mutation: <R extends RpcAny>(rpc: R): WithRpcEndpointKind<R, "mutation"> =>
    annotateRpc(rpc, RpcEndpointKindAnnotation, "mutation") as WithRpcEndpointKind<R, "mutation">
})

export const RpcCapability =
  <Capability extends RpcCapabilityMetadata>(capability: Capability) =>
  <R extends RpcAny>(rpc: R): WithRpcCapability<R, Capability> =>
    annotateRpc(rpc, RpcCapabilityAnnotation, Object.freeze(capability)) as WithRpcCapability<
      R,
      Capability
    >

export const RpcSupport = Object.freeze({
  supported: <R extends RpcAny>(
    rpc: R,
    options: { readonly platforms?: readonly RpcPlatformSupportMetadata[] } = {}
  ): WithRpcSupport<
    R,
    { readonly status: "supported"; readonly platforms?: readonly RpcPlatformSupportMetadata[] }
  > =>
    annotateRpc(
      rpc,
      RpcSupportAnnotation,
      freezeSupport({ status: "supported", ...options })
    ) as WithRpcSupport<
      R,
      { readonly status: "supported"; readonly platforms?: readonly RpcPlatformSupportMetadata[] }
    >,

  partial:
    (
      reason: string,
      options: { readonly platforms?: readonly RpcPlatformSupportMetadata[] } = {}
    ) =>
    <R extends RpcAny>(
      rpc: R
    ): WithRpcSupport<
      R,
      {
        readonly status: "partial"
        readonly reason: string
        readonly platforms?: readonly RpcPlatformSupportMetadata[]
      }
    > =>
      annotateRpc(
        rpc,
        RpcSupportAnnotation,
        freezeSupport({ status: "partial", reason, ...options })
      ) as WithRpcSupport<
        R,
        {
          readonly status: "partial"
          readonly reason: string
          readonly platforms?: readonly RpcPlatformSupportMetadata[]
        }
      >,

  unsupported:
    (
      reason: string,
      options: { readonly platforms?: readonly RpcPlatformSupportMetadata[] } = {}
    ) =>
    <R extends RpcAny>(
      rpc: R
    ): WithRpcSupport<
      R,
      {
        readonly status: "unsupported"
        readonly reason: string
        readonly platforms?: readonly RpcPlatformSupportMetadata[]
      }
    > =>
      annotateRpc(
        rpc,
        RpcSupportAnnotation,
        freezeSupport({ status: "unsupported", reason, ...options })
      ) as WithRpcSupport<
        R,
        {
          readonly status: "unsupported"
          readonly reason: string
          readonly platforms?: readonly RpcPlatformSupportMetadata[]
        }
      >
})

export const rpcEndpointKind = (rpc: RpcAny): RpcEndpointKind =>
  Option.getOrElse(Context.getOption(rpc.annotations, RpcEndpointKindAnnotation), () => "mutation")

export const rpcCapability = (rpc: RpcAny): Option.Option<RpcCapabilityMetadata> =>
  Context.getOption(rpc.annotations, RpcCapabilityAnnotation)

export const rpcSupport = (rpc: RpcAny): RpcSupportMetadata =>
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

const annotateRpc = <R extends RpcAny, I, S>(rpc: R, tag: Context.Key<I, S>, value: S): R =>
  (rpc as R & AnnotatableRpc).annotate(tag, value) as R

const freezeSupport = <Support extends RpcSupportMetadata>(support: Support): Support => {
  if (support.platforms === undefined) {
    return Object.freeze(support)
  }
  return Object.freeze({
    ...support,
    platforms: Object.freeze(support.platforms.map((platform) => Object.freeze(platform)))
  }) as Support
}
