import {
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolPermissionDeniedError,
  type HostProtocolError
} from "@orika/bridge"
import {
  PermissionActor,
  PermissionContext,
  PermissionRegistry,
  type NormalizedCapability as NormalizedCapabilityType,
  type PermissionRegistryError
} from "@orika/core"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  OpenApi
} from "effect/unstable/httpapi"

import { WindowCreateInput, WindowResource } from "./contracts/window.js"
import { Window } from "./window.js"

const DesktopHttpError = HostProtocolErrorSchema.pipe(HttpApiSchema.status(403))

export const DesktopHttpWindowCreateCapability: NormalizedCapabilityType = Object.freeze({
  kind: "native.invoke",
  primitive: "Window",
  methods: ["Window.create"],
  audit: "always"
})

export class DesktopHttpPermission extends HttpApiMiddleware.Service<
  DesktopHttpPermission,
  {
    requires: PermissionRegistry
  }
>()("@orika/native/DesktopHttpPermission", {
  error: DesktopHttpError
}) {}

export const DesktopHttpPermissionLive: Layer.Layer<
  DesktopHttpPermission,
  never,
  PermissionRegistry
> = Layer.effect(
  DesktopHttpPermission,
  Effect.gen(function* () {
    const registry = yield* PermissionRegistry

    return (effect, { endpoint }) =>
      Effect.gen(function* () {
        const capability = capabilityForEndpoint(endpoint.name)
        const context = new PermissionContext({
          actor: new PermissionActor({ kind: "app", id: "desktop-http" }),
          resource: `http:${endpoint.path}`,
          traceId: `desktop-http:${endpoint.name}`
        })
        const grant = yield* registry
          .check(capability, context, { source: "desktop-http" })
          .pipe(Effect.mapError((error) => permissionError(error, capability)))
        return yield* registry
          .use(grant, effect)
          .pipe(
            Effect.mapError((error) =>
              isPermissionRegistryError(error) ? permissionError(error, capability) : error
            )
          )
      })
  })
)

export class DesktopWindowApiGroup extends HttpApiGroup.make("window")
  .add(
    HttpApiEndpoint.post("create", "/window", {
      payload: WindowCreateInput,
      success: WindowResource,
      error: DesktopHttpError
    }).middleware(DesktopHttpPermission)
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Window",
      description: "Schema-first local desktop window endpoints."
    })
  ) {}

export class DesktopHttpApi extends HttpApi.make("DesktopHttpApi")
  .add(DesktopWindowApiGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "ORIKA HTTP API",
      description: "Loopback-only schema-first desktop APIs backed by Effect services."
    })
  ) {}

export const DesktopWindowApiHandlers = HttpApiBuilder.group(
  DesktopHttpApi,
  "window",
  Effect.fn(function* (handlers) {
    const window = yield* Window

    return handlers.handle("create", ({ payload }) => window.create(payload))
  })
).pipe(Layer.provide(DesktopHttpPermissionLive))

export const DesktopHttpApiRoutes = HttpApiBuilder.layer(DesktopHttpApi, {
  openapiPath: "/openapi.json"
}).pipe(Layer.provide(DesktopWindowApiHandlers))

export const DesktopHttpApiHttpServer = HttpRouter.serve(DesktopHttpApiRoutes)

const capabilityForEndpoint = (endpointName: string): NormalizedCapabilityType => {
  switch (endpointName) {
    case "create":
      return DesktopHttpWindowCreateCapability
    default:
      return Object.freeze({
        kind: "native.invoke",
        primitive: "DesktopHttpApi",
        methods: [endpointName],
        audit: "always"
      })
  }
}

const permissionError = (
  error: PermissionRegistryError,
  capability: NormalizedCapabilityType
): HostProtocolError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: capability.kind,
    resource: "desktop-http",
    operation: "DesktopHttpPermission",
    recoverable: false,
    message: error instanceof Error ? error.message : "permission denied",
    cause: error
  })

const isPermissionRegistryError = (error: unknown): error is PermissionRegistryError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error._tag === "InvalidArgument" ||
    error._tag === "PermissionDenied" ||
    error._tag === "PermissionAuditFailed" ||
    error._tag === "PermissionGrantNotFound" ||
    error._tag === "PermissionRevoked")
