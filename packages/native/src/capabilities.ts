import type { RpcCapabilityMetadata, RpcSupportMetadata } from "@effect-desktop/bridge"
import { type DesktopNativeLayer, type DesktopRpcSchemaDoc } from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schema } from "effect"

import { all as NativeAll, available as nativeAvailable } from "./native.js"

const NativeCapabilityPlatforms = ["macos", "windows", "linux"] as const

export const NativeCapabilityPlatformSchema = Schema.Literals(NativeCapabilityPlatforms)

export type NativeCapabilityPlatform = Schema.Schema.Type<typeof NativeCapabilityPlatformSchema>

export const NativeCapabilityStatusSchema = Schema.Literals(["supported", "partial", "unsupported"])

export type NativeCapabilityStatus = Schema.Schema.Type<typeof NativeCapabilityStatusSchema>

export const NativeCapabilityPlatformSupportSchema = Schema.Union([
  Schema.Struct({
    platform: NativeCapabilityPlatformSchema,
    status: Schema.Literal("supported")
  }),
  Schema.Struct({
    platform: NativeCapabilityPlatformSchema,
    status: Schema.Literal("partial"),
    reason: Schema.NonEmptyString
  }),
  Schema.Struct({
    platform: NativeCapabilityPlatformSchema,
    status: Schema.Literal("unsupported"),
    reason: Schema.NonEmptyString
  })
])

export type NativeCapabilityPlatformSupport = Schema.Schema.Type<
  typeof NativeCapabilityPlatformSupportSchema
>

export const NativeCapabilitySupportSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("supported"),
    platforms: Schema.optionalKey(Schema.Array(NativeCapabilityPlatformSupportSchema))
  }),
  Schema.Struct({
    status: Schema.Literal("partial"),
    reason: Schema.NonEmptyString,
    platforms: Schema.optionalKey(Schema.Array(NativeCapabilityPlatformSupportSchema))
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    reason: Schema.NonEmptyString,
    platforms: Schema.optionalKey(Schema.Array(NativeCapabilityPlatformSupportSchema))
  })
])

export type NativeCapabilitySupport = Schema.Schema.Type<typeof NativeCapabilitySupportSchema>

export interface NativeCapabilityFact {
  readonly tag: string
  readonly callable: boolean
  readonly capability: RpcCapabilityMetadata
  readonly support: NativeCapabilitySupport
}

export interface NativeCapabilitySurface {
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
}

export class NativeCapabilityLookupError extends Schema.TaggedErrorClass<NativeCapabilityLookupError>()(
  "NativeCapabilityLookupError",
  {
    tag: Schema.NonEmptyString,
    message: Schema.NonEmptyString
  }
) {}

export class NativeCapabilityManifestError extends Schema.TaggedErrorClass<NativeCapabilityManifestError>()(
  "NativeCapabilityManifestError",
  {
    tag: Schema.NonEmptyString,
    message: Schema.NonEmptyString
  }
) {}

export class UnsupportedCapability extends Schema.TaggedErrorClass<UnsupportedCapability>()(
  "UnsupportedCapability",
  {
    tag: Schema.NonEmptyString,
    platform: Schema.optionalKey(NativeCapabilityPlatformSchema),
    reason: Schema.NonEmptyString,
    message: Schema.NonEmptyString
  }
) {}

export interface NativeCapabilitiesApi {
  readonly manifest: readonly NativeCapabilityFact[]
  readonly support: (
    tag: string
  ) => Effect.Effect<NativeCapabilitySupport, NativeCapabilityLookupError, never>
  readonly require: (
    tag: string
  ) => Effect.Effect<void, NativeCapabilityLookupError | UnsupportedCapability, never>
  readonly requirePlatform: (
    tag: string,
    platform: NativeCapabilityPlatform
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
        const support = normalizeSupport(doc.support)
        if (support._tag === "invalid") {
          return Effect.fail(
            new NativeCapabilityManifestError({
              tag: doc.tag,
              message: support.message
            })
          )
        }
        seen.add(doc.tag)
        facts.push(
          Object.freeze({
            tag: doc.tag,
            callable: doc.callable,
            capability,
            support: support.value
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
  nativeLayer: DesktopNativeLayer = nativeAvailable(NativeAll)
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
          metadata.status === "unsupported"
            ? Effect.fail(unsupportedCapability(tag, metadata))
            : Effect.void
        )
      ),
    requirePlatform: (tag: string, platform: NativeCapabilityPlatform) =>
      support(tag).pipe(
        Effect.flatMap((metadata) => {
          if (metadata.status === "unsupported") {
            return Effect.fail(unsupportedCapability(tag, metadata))
          }
          const platformSupport = metadata.platforms?.find((entry) => entry.platform === platform)
          if (platformSupport?.status !== "unsupported") {
            return Effect.void
          }
          return Effect.fail(unsupportedCapability(tag, platformSupport, platform))
        })
      )
  })
}

const normalizeSupport = (
  support: RpcSupportMetadata
):
  | { readonly _tag: "valid"; readonly value: NativeCapabilitySupport }
  | {
      readonly _tag: "invalid"
      readonly message: string
    } => {
  const decoded = Schema.decodeUnknownOption(NativeCapabilitySupportSchema)(support)
  if (Option.isNone(decoded)) {
    return {
      _tag: "invalid",
      message: "native capability support metadata must match the maturity schema"
    }
  }

  const reasonError = supportReasonError(decoded.value)
  if (reasonError !== undefined) {
    return { _tag: "invalid", message: reasonError }
  }

  return { _tag: "valid", value: freezeSupport(decoded.value) }
}

const supportReasonError = (support: NativeCapabilitySupport): string | undefined => {
  if (support.status !== "supported" && support.reason.trim().length === 0) {
    return "partial and unsupported native capabilities must include a reason"
  }
  if (support.status === "partial" && support.platforms === undefined) {
    return "partial native capabilities must include macos, windows, and linux platform entries"
  }
  const coverageError = supportPlatformCoverageError(support.platforms)
  if (coverageError !== undefined) {
    return coverageError
  }
  const consistencyError = supportPlatformConsistencyError(support)
  if (consistencyError !== undefined) {
    return consistencyError
  }
  for (const platform of support.platforms ?? []) {
    if (platform.status === "supported") {
      if ("reason" in platform && platform.reason !== undefined) {
        return "supported platform entries must not include a reason"
      }
      continue
    }
    if (platform.reason.trim().length === 0) {
      return "partial and unsupported platform entries must include a reason"
    }
  }
  return undefined
}

const supportPlatformConsistencyError = (support: NativeCapabilitySupport): string | undefined => {
  const platforms = support.platforms
  if (platforms === undefined) {
    return undefined
  }
  const everyPlatformSupported = platforms.every((platform) => platform.status === "supported")
  const everyPlatformUnsupported = platforms.every((platform) => platform.status === "unsupported")
  if (support.status === "supported" && !everyPlatformSupported) {
    return "supported native capabilities cannot include partial or unsupported platform entries"
  }
  if (support.status === "unsupported" && !everyPlatformUnsupported) {
    return "unsupported native capabilities cannot include supported or partial platform entries"
  }
  if (support.status === "partial" && everyPlatformSupported) {
    return "partial native capabilities must not mark every platform supported"
  }
  if (support.status === "partial" && everyPlatformUnsupported) {
    return "partial native capabilities must not mark every platform unsupported"
  }
  return undefined
}

const supportPlatformCoverageError = (
  platforms: readonly NativeCapabilityPlatformSupport[] | undefined
): string | undefined => {
  if (platforms === undefined) {
    return undefined
  }
  const seen = new Set<NativeCapabilityPlatform>()
  for (const platform of platforms) {
    if (seen.has(platform.platform)) {
      return `native capability platform support has duplicate platform ${platform.platform}`
    }
    seen.add(platform.platform)
  }
  for (const platform of NativeCapabilityPlatforms) {
    if (!seen.has(platform)) {
      return "native capability platform support must include macos, windows, and linux"
    }
  }
  return undefined
}

const freezeSupport = (support: NativeCapabilitySupport): NativeCapabilitySupport => {
  if (support.platforms === undefined) {
    return Object.freeze(support)
  }
  return Object.freeze({
    ...support,
    platforms: Object.freeze(support.platforms.map((platform) => Object.freeze(platform)))
  })
}

const unsupportedCapability = (
  tag: string,
  support: Extract<
    NativeCapabilitySupport | NativeCapabilityPlatformSupport,
    { readonly status: "unsupported" }
  >,
  platform?: NativeCapabilityPlatform
): UnsupportedCapability =>
  platform === undefined
    ? new UnsupportedCapability({
        tag,
        reason: support.reason,
        message: `unsupported native capability: ${tag}`
      })
    : new UnsupportedCapability({
        tag,
        platform,
        reason: support.reason,
        message: `unsupported native capability on ${platform}: ${tag}`
      })

function snapshotNativeCapabilitySurfacesSync(
  nativeLayer: DesktopNativeLayer
): readonly NativeCapabilitySurface[] {
  return nativeLayer.map((registration) => Object.freeze({ schemaDocs: registration.schemaDocs }))
}
