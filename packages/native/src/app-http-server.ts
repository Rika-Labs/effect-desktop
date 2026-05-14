import {
  DEFAULT_CSP_POLICY,
  mintCspNonce,
  renderCspPolicy,
  type CspNonce,
  type CspPolicy
} from "@effect-desktop/config"
import { cspInspectorEvent, type CspInspectorEvent } from "@effect-desktop/core"
import { Context, Data, Effect, Layer, Option, PubSub, Schema, Scope, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiScalar,
  HttpApiSchema,
  OpenApi
} from "effect/unstable/httpapi"

const MIME_MAP: ReadonlyMap<string, string> = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"]
])

const mimeTypeForPath = (path: string): string => {
  const dot = path.lastIndexOf(".")
  if (dot < 0) return "application/octet-stream"
  const ext = path.slice(dot)
  return MIME_MAP.get(ext) ?? "application/octet-stream"
}

export { mimeTypeForPath }

class HtmlNonceRewriteError extends Data.TaggedError("HtmlNonceRewriteError")<{
  readonly cause: unknown
}> {}

const rewriteHtmlWithNonce = (
  html: string,
  nonce: CspNonce
): Effect.Effect<string, HtmlNonceRewriteError, never> =>
  Effect.tryPromise({
    try: async () => {
      const nonceValue = nonce.value
      const response = new HTMLRewriter()
        .on("script", {
          element: (element) => {
            element.setAttribute("nonce", nonceValue)
          }
        })
        .on("style", {
          element: (element) => {
            element.setAttribute("nonce", nonceValue)
          }
        })
        .on("link[rel]", {
          element: (element) => {
            const rel = element.getAttribute("rel")
            if (rel?.split(/\s+/u).some((token) => token.toLowerCase() === "stylesheet") === true) {
              element.setAttribute("nonce", nonceValue)
            }
          }
        })
        .transform(new Response(html, { headers: { "content-type": "text/html" } }))

      return response.text()
    },
    catch: (cause) => new HtmlNonceRewriteError({ cause })
  })

const ALLOWED_HOSTS: ReadonlySet<string> = new Set(["", "localhost", "127.0.0.1"])
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["app:", "http:", "https:"])

const TRAVERSAL_PATTERN = /(^|[\\/])\.\.([\\/]|$)|%2e%2e/i

const hasTraversal = (rawPath: string): boolean =>
  rawPath.includes("\\") || TRAVERSAL_PATTERN.test(rawPath)

const computeEtag = (bytes: Uint8Array): string => {
  let hash = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i] ?? 0
    hash = (hash * 16777619) >>> 0
  }
  return `"${hash.toString(16)}"`
}

const cspHeaders = (policy: CspPolicy, nonce: CspNonce): Record<string, string> => {
  const csp = renderCspPolicy(policy, nonce)
  return csp === "" ? {} : { "content-security-policy": csp }
}

export interface ResolvedAsset {
  readonly bytes: Uint8Array
  readonly contentType: string
}

export interface AppAssetResolverApi {
  readonly resolve: (path: string) => Effect.Effect<ResolvedAsset | null, never, never>
}

export class AppAssetResolver extends Context.Service<AppAssetResolver, AppAssetResolverApi>()(
  "@effect-desktop/native/AppAssetResolver"
) {}

export interface AppCspPolicyApi {
  readonly policy: CspPolicy
}

export class AppCspPolicy extends Context.Service<AppCspPolicy, AppCspPolicyApi>()(
  "@effect-desktop/native/AppCspPolicy"
) {}

export interface AppCspInspectorApi {
  readonly emit: (event: CspInspectorEvent) => Effect.Effect<void, never, never>
  readonly observe: () => Stream.Stream<CspInspectorEvent, never, never>
}

export class AppCspInspector extends Context.Service<AppCspInspector, AppCspInspectorApi>()(
  "@effect-desktop/native/AppCspInspector",
  {
    make: Effect.succeed({
      emit: () => Effect.void,
      observe: () => Stream.empty
    } satisfies AppCspInspectorApi)
  }
) {}

const noopCspInspector: AppCspInspectorApi = {
  emit: () => Effect.void,
  observe: () => Stream.empty
}

export interface AppHttpServerApi {
  readonly handle: (
    request: HttpServerRequest.HttpServerRequest
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope>
}

export class AppHttpServer extends Context.Service<AppHttpServer, AppHttpServerApi>()(
  "@effect-desktop/native/AppHttpServer"
) {}

const AppAssetHeaders = Schema.Struct({
  "if-none-match": Schema.optional(Schema.String)
})

const AppAssetBytes = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" })
)

export class AppAssetApiGroup extends HttpApiGroup.make("appAssets", { topLevel: true }).add(
  HttpApiEndpoint.get("asset", "/*", {
    headers: AppAssetHeaders,
    success: [AppAssetBytes, HttpApiSchema.Empty(304)],
    error: [HttpApiError.BadRequest, HttpApiError.NotFound]
  }).annotateMerge(
    OpenApi.annotations({
      title: "App asset",
      description: "Serves local desktop application assets with CSP and cache policy."
    })
  )
) {}

export class DesktopLocalApi extends HttpApi.make("DesktopLocalApi")
  .add(AppAssetApiGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Effect Desktop Local API",
      description: "Loopback-only local HTTP surfaces exposed by the desktop runtime."
    })
  ) {}

export const DesktopLocalHandlers = HttpApiBuilder.group(
  DesktopLocalApi,
  "appAssets",
  Effect.fn(function* (handlers) {
    const server = yield* AppHttpServer
    return handlers.handleRaw("asset", ({ request }) => Effect.scoped(server.handle(request)))
  })
)

const buildAssetResponse = (
  asset: ResolvedAsset,
  ifNoneMatch: string | undefined,
  policy: CspPolicy,
  inspector: AppCspInspectorApi
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> =>
  Effect.gen(function* () {
    const nonce = yield* mintCspNonce
    const headers = cspHeaders(policy, nonce)
    yield* inspector.emit(
      cspInspectorEvent({
        kind: "csp",
        decision:
          headers["content-security-policy"] === undefined ? "policy-applied" : "nonce-issued",
        source: "AppHttpServer",
        traceId: `csp:${nonce.value}`,
        outcome: headers["content-security-policy"] === undefined ? "disabled" : "applied",
        timestamp: Date.now(),
        directives: policy.directives
      })
    )

    if (!asset.contentType.startsWith("text/html")) {
      const etag = computeEtag(asset.bytes)
      if (ifNoneMatch !== undefined && ifNoneMatch === etag) {
        return HttpServerResponse.empty({
          status: 304,
          headers: { etag, ...headers }
        })
      }
      return HttpServerResponse.uint8Array(asset.bytes, {
        contentType: asset.contentType,
        headers: { etag, ...headers }
      })
    }

    const htmlText = new TextDecoder().decode(asset.bytes)
    const sourceEtag = `"${computeEtag(asset.bytes).slice(1, -1)}-html"`
    return yield* rewriteHtmlWithNonce(htmlText, nonce).pipe(
      Effect.match({
        onFailure: () =>
          HttpServerResponse.text("app html rewrite failed", {
            status: 500,
            headers
          }),
        onSuccess: (html) => {
          const rewrittenBytes = new TextEncoder().encode(html)
          return HttpServerResponse.uint8Array(rewrittenBytes, {
            contentType: asset.contentType,
            headers: {
              etag: sourceEtag,
              "cache-control": "no-store",
              ...headers
            }
          })
        }
      })
    )
  })

const normalizePath = (rawPath: string): string =>
  rawPath === "/" || rawPath === "" ? "/index.html" : rawPath

export const AppCspPolicyDefault: Layer.Layer<AppCspPolicy, never, never> = Layer.succeed(
  AppCspPolicy
)({ policy: DEFAULT_CSP_POLICY })

export const AppHttpServerLive: Layer.Layer<AppHttpServer, never, AppAssetResolver | AppCspPolicy> =
  Layer.effect(AppHttpServer)(
    Effect.gen(function* () {
      const resolver = yield* AppAssetResolver
      const cspPolicy = yield* AppCspPolicy
      const cspInspector = Option.getOrElse(
        yield* Effect.serviceOption(AppCspInspector),
        () => noopCspInspector
      )

      return Object.freeze({
        handle: (request) =>
          Effect.gen(function* () {
            const reject = (status: 400 | 404) =>
              Effect.gen(function* () {
                const nonce = yield* mintCspNonce
                return HttpServerResponse.text(
                  status === 400 ? "bad request" : "app asset not found",
                  {
                    status,
                    headers: { "content-security-policy": renderCspPolicy(cspPolicy.policy, nonce) }
                  }
                )
              })

            if (hasTraversal(request.url)) {
              yield* cspInspector.emit(
                cspInspectorEvent({
                  kind: "csp",
                  decision: "blocked",
                  source: "AppHttpServer",
                  traceId: `csp:${Date.now()}`,
                  outcome: "blocked",
                  timestamp: Date.now(),
                  resource: request.url,
                  reason: "path-traversal"
                })
              )
              return yield* reject(400)
            }

            const url = new URL(request.url, "app://localhost")
            if (!ALLOWED_SCHEMES.has(url.protocol) || !ALLOWED_HOSTS.has(url.hostname)) {
              yield* cspInspector.emit(
                cspInspectorEvent({
                  kind: "csp",
                  decision: "blocked",
                  source: "AppHttpServer",
                  traceId: `csp:${Date.now()}`,
                  outcome: "blocked",
                  timestamp: Date.now(),
                  resource: request.url,
                  reason: "origin-not-allowed"
                })
              )
              return yield* reject(404)
            }

            const normalizedPath = normalizePath(url.pathname)
            const asset = yield* resolver.resolve(normalizedPath)

            if (asset === null) {
              return yield* reject(404)
            }

            const ifNoneMatch = request.headers["if-none-match"]

            return yield* buildAssetResponse(asset, ifNoneMatch, cspPolicy.policy, cspInspector)
          })
      } satisfies AppHttpServerApi)
    })
  )

export const makeAppHttpServerLayer = (
  resolver: AppAssetResolverApi,
  policy: CspPolicy = DEFAULT_CSP_POLICY
): Layer.Layer<AppHttpServer, never, never> =>
  Layer.provide(
    AppHttpServerLive,
    Layer.mergeAll(
      Layer.succeed(AppAssetResolver)(resolver),
      Layer.succeed(AppCspPolicy)({ policy })
    )
  )

export const makeAppCspInspector = (): Effect.Effect<AppCspInspectorApi, never, never> =>
  Effect.gen(function* () {
    const events = yield* PubSub.sliding<CspInspectorEvent>({ capacity: 1024, replay: 0 })
    return {
      emit: (event) => PubSub.publish(events, event).pipe(Effect.asVoid),
      observe: () => Stream.fromPubSub(events)
    }
  })

export const AppCspInspectorLive: Layer.Layer<AppCspInspector, never, never> = Layer.effect(
  AppCspInspector,
  makeAppCspInspector()
)

export const DesktopLocalApiRoutes = HttpApiBuilder.layer(DesktopLocalApi, {
  openapiPath: "/openapi.json"
}).pipe(Layer.provide(DesktopLocalHandlers))

export const DesktopLocalApiDocs = HttpApiScalar.layer(DesktopLocalApi, {
  path: "/docs"
})

export const AppAssetRoutes = Layer.mergeAll(DesktopLocalApiRoutes, DesktopLocalApiDocs)
