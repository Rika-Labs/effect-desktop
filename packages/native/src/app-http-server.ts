import { Context, Effect, Layer, Scope } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

const APP_CSP_TEMPLATE =
  "default-src 'self'; script-src 'self' 'nonce-{N}'; style-src 'self' 'nonce-{N}'; style-src-attr 'unsafe-inline'; connect-src 'self' app:; img-src 'self' app: data: https:; font-src 'self' app: data:; media-src 'self' app:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'"

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

const mintNonce = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

const renderCsp = (nonce: string): string => APP_CSP_TEMPLATE.replaceAll("{N}", nonce)

const injectNonceIntoHtml = (html: string, nonce: string): string =>
  html
    .replaceAll("<script", `<script nonce="${nonce}"`)
    .replaceAll("<link", `<link nonce="${nonce}"`)
    .replaceAll("<style", `<style nonce="${nonce}"`)

const computeEtag = (bytes: Uint8Array): string => {
  let hash = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i] ?? 0
    hash = (hash * 16777619) >>> 0
  }
  return `"${hash.toString(16)}"`
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
  csp: string
): HttpServerResponse.HttpServerResponse => {
  if (!asset.contentType.startsWith("text/html")) {
    const etag = computeEtag(asset.bytes)
    if (ifNoneMatch !== undefined && ifNoneMatch === etag) {
      return HttpServerResponse.empty({
        status: 304,
        headers: { etag, "content-security-policy": csp }
      })
    }
    return HttpServerResponse.uint8Array(asset.bytes, {
      contentType: asset.contentType,
      headers: { etag, "content-security-policy": csp }
    })
  }

  const htmlText = new TextDecoder().decode(asset.bytes)
  const nonce = mintNonce()
  const htmlCsp = renderCsp(nonce)
  const rewritten = injectNonceIntoHtml(htmlText, nonce)
  const rewrittenBytes = new TextEncoder().encode(rewritten)
  const etag = computeEtag(rewrittenBytes)

  if (ifNoneMatch !== undefined && ifNoneMatch === etag) {
    return HttpServerResponse.empty({
      status: 304,
      headers: { etag, "content-security-policy": htmlCsp }
    })
  }

  return HttpServerResponse.uint8Array(rewrittenBytes, {
    contentType: asset.contentType,
    headers: { etag, "content-security-policy": htmlCsp }
  })
}

const normalizePath = (rawPath: string): string =>
  rawPath === "/" || rawPath === "" ? "/index.html" : rawPath

export const AppHttpServerLive: Layer.Layer<AppHttpServer, never, AppAssetResolver> = Layer.effect(
  AppHttpServer
)(
  Effect.gen(function* () {
    const resolver = yield* AppAssetResolver

    return Object.freeze({
      handle: (request) =>
        Effect.gen(function* () {
          const url = new URL(request.url, "http://localhost")
          const normalizedPath = normalizePath(url.pathname)
          const asset = yield* resolver.resolve(normalizedPath)

          if (asset === null) {
            return HttpServerResponse.text("app asset not found", {
              status: 404,
              headers: { "content-security-policy": renderCsp(mintNonce()) }
            })
          }

          const nonce = mintNonce()
          const defaultCsp = renderCsp(nonce)
          const ifNoneMatch = request.headers["if-none-match"]

          return buildAssetResponse(asset, ifNoneMatch, defaultCsp)
        })
    } satisfies AppHttpServerApi)
  })
)

export const makeAppHttpServerLayer = (
  resolver: AppAssetResolverApi
): Layer.Layer<AppHttpServer, never, never> =>
  Layer.provide(AppHttpServerLive, Layer.succeed(AppAssetResolver)(resolver))

export const AppAssetRoutes: Layer.Layer<never, never, HttpRouter.HttpRouter | AppHttpServer> =
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const server = yield* AppHttpServer
      yield* router.add("GET", "/*", (req) => Effect.scoped(server.handle(req)))
    })
  )
