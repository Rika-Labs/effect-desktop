import type { RpcCapabilityMetadata, RpcSupportMetadata } from "@effect-desktop/bridge"
import {
  DesktopNativeRegistry,
  DesktopNativeRegistryLive,
  DesktopPermissionRegistryLive,
  type DesktopNativeLayer,
  type DesktopRpcSchemaDoc
} from "@effect-desktop/core"
import { Context, Data, Effect, Layer, Option } from "effect"

import { all as NativeAll } from "./native.js"

export type NativeCapabilitySupport = RpcSupportMetadata

export interface NativeCapabilityFact {
  readonly tag: string
  readonly capability: RpcCapabilityMetadata
  readonly support: NativeCapabilitySupport
}

export interface NativeCapabilitySurface {
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
}

export class NativeCapabilityLookupError extends Data.TaggedError("NativeCapabilityLookupError")<{
  readonly tag: string
  readonly message: string
}> {}

export class NativeCapabilityManifestError extends Data.TaggedError(
  "NativeCapabilityManifestError"
)<{
  readonly tag: string
  readonly message: string
}> {}

export class NativeCapabilityRegistryError extends Data.TaggedError(
  "NativeCapabilityRegistryError"
)<{
  readonly message: string
  readonly cause: unknown
}> {}

export class UnsupportedCapability extends Data.TaggedError("UnsupportedCapability")<{
  readonly tag: string
  readonly reason: string
  readonly message: string
}> {}

export interface NativeCapabilitiesApi {
  readonly manifest: readonly NativeCapabilityFact[]
  readonly support: (
    tag: string
  ) => Effect.Effect<NativeCapabilitySupport, NativeCapabilityLookupError, never>
  readonly require: (
    tag: string
  ) => Effect.Effect<void, NativeCapabilityLookupError | UnsupportedCapability, never>
}

export class NativeCapabilities extends Context.Service<
  NativeCapabilities,
  NativeCapabilitiesApi
>()("@effect-desktop/native/NativeCapabilities") {}

export const makeNativeCapabilityManifest = (
  surfaces: Iterable<NativeCapabilitySurface>
): Effect.Effect<readonly NativeCapabilityFact[], NativeCapabilityManifestError, never> =>
  Effect.suspend(() => {
    const seen = new Set<string>()
    const facts: NativeCapabilityFact[] = []

    for (const surface of surfaces) {
      for (const doc of surface.schemaDocs) {
        if (seen.has(doc.tag)) {
          return Effect.fail(
            new NativeCapabilityManifestError({
              tag: doc.tag,
              message: `duplicate native capability tag: ${doc.tag}`
            })
          )
        }
        const capability = Option.getOrUndefined(doc.capability)
        if (capability === undefined) {
          return Effect.fail(
            new NativeCapabilityManifestError({
              tag: doc.tag,
              message: `missing native capability metadata: ${doc.tag}`
            })
          )
        }
        if (doc.support.status === "unsupported" && doc.support.reason.trim().length === 0) {
          return Effect.fail(
            new NativeCapabilityManifestError({
              tag: doc.tag,
              message: `unsupported native capability must include a reason: ${doc.tag}`
            })
          )
        }
        seen.add(doc.tag)
        facts.push(
          Object.freeze({
            tag: doc.tag,
            capability,
            support: freezeSupport(doc.support)
          })
        )
      }
    }

    return Effect.succeed(Object.freeze(facts))
  })

export const makeNativeCapabilities = (
  surfaces: Iterable<NativeCapabilitySurface>
): Effect.Effect<NativeCapabilitiesApi, NativeCapabilityManifestError, never> =>
  makeNativeCapabilityManifest(surfaces).pipe(Effect.map(capabilitiesFromManifest))

export const makeNativeCapabilitiesLayer = (
  nativeLayer: DesktopNativeLayer = NativeAll
): Layer.Layer<NativeCapabilities, NativeCapabilityManifestError, never> =>
  Layer.effect(
    NativeCapabilities,
    makeNativeCapabilities(snapshotNativeCapabilitySurfacesSync(nativeLayer))
  )

export const NativeCapabilitiesLive: Layer.Layer<
  NativeCapabilities,
  NativeCapabilityManifestError,
  never
> = makeNativeCapabilitiesLayer()

function capabilitiesFromManifest(
  manifest: readonly NativeCapabilityFact[]
): NativeCapabilitiesApi {
  const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

  const support = (
    tag: string
  ): Effect.Effect<NativeCapabilitySupport, NativeCapabilityLookupError, never> =>
    Effect.suspend(() => {
      const fact = byTag.get(tag)
      if (fact === undefined) {
        return Effect.fail(
          new NativeCapabilityLookupError({
            tag,
            message: `unknown native capability tag: ${tag}`
          })
        )
      }
      return Effect.succeed(fact.support)
    })

  return Object.freeze({
    manifest,
    support,
    require: (tag: string) =>
      support(tag).pipe(
        Effect.flatMap((metadata) =>
          metadata.status === "supported"
            ? Effect.void
            : Effect.fail(unsupportedCapability(tag, metadata))
        )
      )
  })
}

const freezeSupport = (support: RpcSupportMetadata): NativeCapabilitySupport =>
  support.status === "supported"
    ? Object.freeze({ status: "supported" })
    : Object.freeze({ status: "unsupported", reason: support.reason })

const unsupportedCapability = (
  tag: string,
  support: Extract<RpcSupportMetadata, { readonly status: "unsupported" }>
): UnsupportedCapability =>
  new UnsupportedCapability({
    tag,
    reason: support.reason,
    message: `unsupported native capability: ${tag}`
  })

function snapshotNativeCapabilitySurfacesSync(
  nativeLayer: DesktopNativeLayer
): readonly NativeCapabilitySurface[] {
  const composed = Layer.provideMerge(
    nativeLayer,
    Layer.mergeAll(DesktopNativeRegistryLive, DesktopPermissionRegistryLive)
  )
  try {
    return Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(composed)
          const registry = Context.get(context, DesktopNativeRegistry)
          const registrations = yield* registry.snapshot
          return registrations.map((registration) =>
            Object.freeze({ schemaDocs: registration.schemaDocs })
          )
        })
      )
    )
  } catch (cause) {
    throw new NativeCapabilityRegistryError({
      message: "NativeCapabilities requires the native layer to build synchronously.",
      cause
    })
  }
}
