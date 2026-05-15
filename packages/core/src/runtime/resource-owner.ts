import { Context, Data, Effect, Layer, Option, Schema } from "effect"

import { PermissionActor } from "./permission-registry.js"

const ResourceOwnerText = Schema.NonEmptyString.check(
  // eslint-disable-next-line no-control-regex -- Owner ids become audit metadata.
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)

export type ResourceOwnerKind = "app" | "window" | "job" | "test"

export interface ResourceOwnerApi {
  readonly kind: ResourceOwnerKind
  readonly scopeId: string
  readonly actor: PermissionActor
  readonly attributes: Readonly<Record<string, string>>
}

export class ResourceOwnerInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class ResourceOwner extends Context.Service<ResourceOwner, ResourceOwnerApi>()(
  "@effect-desktop/core/ResourceOwner"
) {
  static app(appId: string): Layer.Layer<ResourceOwner, ResourceOwnerInvalidArgumentError> {
    return resourceOwnerLayer("ResourceOwner.app", {
      kind: "app",
      scopeId: appId,
      actor: new PermissionActor({ kind: "app", id: appId }),
      attributes: { appId }
    })
  }

  static window(input: {
    readonly registrationId: string
    readonly hostWindowId: string
  }): Layer.Layer<ResourceOwner, ResourceOwnerInvalidArgumentError> {
    return Layer.unwrap(
      Effect.gen(function* () {
        const registrationId = yield* decodeOwnerText(
          input.registrationId,
          "registrationId",
          "ResourceOwner.window"
        )
        const hostWindowId = yield* decodeOwnerText(
          input.hostWindowId,
          "hostWindowId",
          "ResourceOwner.window"
        )
        const scopeId = `window:${hostWindowId}`
        return resourceOwnerLayer("ResourceOwner.window", {
          kind: "window",
          scopeId,
          actor: new PermissionActor({ kind: "window", id: scopeId }),
          attributes: { registrationId, hostWindowId }
        })
      })
    )
  }

  static job(jobId: string): Layer.Layer<ResourceOwner, ResourceOwnerInvalidArgumentError> {
    return resourceOwnerLayer("ResourceOwner.job", {
      kind: "job",
      scopeId: `job:${jobId}`,
      actor: new PermissionActor({ kind: "resource", id: `job:${jobId}` }),
      attributes: { jobId }
    })
  }

  static test(scopeId: string): Layer.Layer<ResourceOwner, ResourceOwnerInvalidArgumentError> {
    return resourceOwnerLayer("ResourceOwner.test", {
      kind: "test",
      scopeId,
      actor: new PermissionActor({ kind: "resource", id: scopeId }),
      attributes: { scopeId }
    })
  }
}

export const makeResourceOwner = (
  owner: ResourceOwnerApi,
  operation = "ResourceOwner.make"
): Effect.Effect<ResourceOwnerApi, ResourceOwnerInvalidArgumentError> =>
  Effect.gen(function* () {
    const scopeId = yield* decodeOwnerText(owner.scopeId, "scopeId", operation)
    const attributes: Record<string, string> = {}
    for (const [key, value] of Object.entries(owner.attributes)) {
      attributes[yield* decodeOwnerText(key, "attributes.key", operation)] = yield* decodeOwnerText(
        value,
        `attributes.${key}`,
        operation
      )
    }
    return Object.freeze({
      kind: owner.kind,
      scopeId,
      actor: owner.actor,
      attributes: Object.freeze(attributes)
    })
  })

const resourceOwnerLayer = (
  operation: string,
  owner: ResourceOwnerApi
): Layer.Layer<ResourceOwner, ResourceOwnerInvalidArgumentError> =>
  Layer.effect(ResourceOwner, makeResourceOwner(owner, operation))

const decodeOwnerText = (
  value: unknown,
  field: string,
  operation: string
): Effect.Effect<string, ResourceOwnerInvalidArgumentError> =>
  Schema.decodeUnknownEffect(ResourceOwnerText)(value).pipe(
    Effect.mapError(
      (error) =>
        new ResourceOwnerInvalidArgumentError({
          operation,
          field,
          message: error instanceof Error ? error.message : String(error),
          cause: Option.some(error)
        })
    )
  )
