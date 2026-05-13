import {
  DEFAULT_CSP_POLICY,
  mintCspNonce,
  renderCspPolicy,
  type CspNonce,
  type CspPolicy
} from "@effect-desktop/config"
import { Context, Data, Effect, Layer, Scope } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

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

export interface AppHttpServerApi {
  readonly handle: (
    request: HttpServerRequest.HttpServerRequest
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope>
}

export class AppHttpServer extends Context.Service<AppHttpServer, AppHttpServerApi>()(
  "@effect-desktop/native/AppHttpServer"
) {}

const buildAssetResponse = (
  asset: ResolvedAsset,
  ifNoneMatch: string | undefined,
  policy: CspPolicy
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> =>
  Effect.gen(function* () {
    const nonce = yield* mintCspNonce
    const headers = cspHeaders(policy, nonce)

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
              return yield* reject(400)
            }

            const url = new URL(request.url, "app://localhost")
            if (!ALLOWED_SCHEMES.has(url.protocol) || !ALLOWED_HOSTS.has(url.hostname)) {
              return yield* reject(404)
            }

            const normalizedPath = normalizePath(url.pathname)
            const asset = yield* resolver.resolve(normalizedPath)

            if (asset === null) {
              return yield* reject(404)
            }

            const ifNoneMatch = request.headers["if-none-match"]

            return yield* buildAssetResponse(asset, ifNoneMatch, cspPolicy.policy)
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

export const AppAssetRoutes: Layer.Layer<never, never, HttpRouter.HttpRouter | AppHttpServer> =
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const server = yield* AppHttpServer
      yield* router.add("GET", "/*", (req) => Effect.scoped(server.handle(req)))
    })
  )
