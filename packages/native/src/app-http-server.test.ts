import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"

import {
  AppAssetResolver,
  AppHttpServer,
  AppHttpServerLive,
  makeAppHttpServerLayer,
  mimeTypeForPath,
  type AppAssetResolverApi,
  type ResolvedAsset
} from "./app-http-server.js"

const TEXT_ENCODER = new TextEncoder()

const makeRequest = (
  url: string,
  headers: Record<string, string> = {}
): HttpServerRequest.HttpServerRequest =>
  ({
    url,
    method: "GET",
    headers,
    source: {},
    originalUrl: url,
    cookies: {},
    modify: (opts: { url?: string; headers?: Record<string, string> }) =>
      makeRequest(opts.url ?? url, (opts.headers as Record<string, string>) ?? headers)
  }) as unknown as HttpServerRequest.HttpServerRequest

const htmlAsset: ResolvedAsset = {
  bytes: TEXT_ENCODER.encode(
    "<!doctype html><html><head></head><body><script src='/app.js'></script></body></html>"
  ),
  contentType: "text/html; charset=utf-8"
}

const jsAsset: ResolvedAsset = {
  bytes: TEXT_ENCODER.encode("console.log('hello')"),
  contentType: "text/javascript; charset=utf-8"
}

const staticResolver: AppAssetResolverApi = {
  resolve: (path) =>
    Effect.succeed(
      path === "/index.html" || path === "/" ? htmlAsset : path === "/app.js" ? jsAsset : null
    )
}

const makeServer = (resolver: AppAssetResolverApi = staticResolver) =>
  Effect.gen(function* () {
    return yield* AppHttpServer
  }).pipe(Effect.provide(makeAppHttpServerLayer(resolver)))

test("serves HTML with nonce injected into script tags and CSP header set", async () => {
  const response = await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* makeServer()
      return yield* Effect.scoped(server.handle(makeRequest("/")))
    })
  )

  expect(response.status).toBe(200)
  const csp = (response.headers as Record<string, string>)["content-security-policy"]
  expect(typeof csp).toBe("string")
  expect(csp).toContain("script-src 'self' 'nonce-")
  expect(csp).toContain("style-src 'self' 'nonce-")
  expect(csp).not.toContain("unsafe-eval")
  expect(csp).toContain("style-src-attr 'unsafe-inline'")
})

test("injects matching nonce into script element in HTML body", async () => {
  const response = await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* makeServer()
      return yield* Effect.scoped(server.handle(makeRequest("/")))
    })
  )

  const csp = (response.headers as Record<string, string>)["content-security-policy"] ?? ""
  const nonceMatch = /nonce-([a-f0-9]+)/.exec(csp)
  expect(nonceMatch).not.toBeNull()
  const nonce = nonceMatch![1]!

  const body = response.body as { _tag: string; body: ReadableStream<Uint8Array> | Uint8Array }
  let bodyBytes: Uint8Array
  if (body._tag === "Uint8Array") {
    bodyBytes = body.body as Uint8Array
  } else {
    const chunks: Uint8Array[] = []
    const reader = (body.body as ReadableStream<Uint8Array>).getReader()
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0)
    bodyBytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset)
      offset += chunk.length
    }
  }

  const bodyText = new TextDecoder().decode(bodyBytes)
  expect(bodyText).toContain(`nonce="${nonce}"`)
})

test("mints a fresh nonce on every response", async () => {
  const server = await Effect.runPromise(makeServer())

  const [r1, r2] = await Promise.all([
    Effect.runPromise(Effect.scoped(server.handle(makeRequest("/")))),
    Effect.runPromise(Effect.scoped(server.handle(makeRequest("/"))))
  ])

  const csp1 = (r1.headers as Record<string, string>)["content-security-policy"] ?? ""
  const csp2 = (r2.headers as Record<string, string>)["content-security-policy"] ?? ""
  expect(csp1).not.toBe(csp2)
})

test("serves non-HTML asset with content-type and ETag but no nonce rewrite", async () => {
  const response = await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* makeServer()
      return yield* Effect.scoped(server.handle(makeRequest("/app.js")))
    })
  )

  expect(response.status).toBe(200)
  const etag = (response.headers as Record<string, string>)["etag"]
  expect(typeof etag).toBe("string")
  expect(etag).toMatch(/^"[a-f0-9]+"$/)
})

test("returns 304 for conditional GET with matching ETag", async () => {
  const server = await Effect.runPromise(makeServer())

  const first = await Effect.runPromise(Effect.scoped(server.handle(makeRequest("/app.js"))))
  const etag = (first.headers as Record<string, string>)["etag"]!
  expect(first.status).toBe(200)

  const second = await Effect.runPromise(
    Effect.scoped(server.handle(makeRequest("/app.js", { "if-none-match": etag })))
  )
  expect(second.status).toBe(304)
})

test("returns 404 with CSP header for unknown paths", async () => {
  const response = await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* makeServer()
      return yield* Effect.scoped(server.handle(makeRequest("/missing.js")))
    })
  )

  expect(response.status).toBe(404)
  const csp = (response.headers as Record<string, string>)["content-security-policy"]
  expect(typeof csp).toBe("string")
})

test("traversal URLs are rejected before normalization", async () => {
  const response = await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* makeServer()
      return yield* Effect.scoped(server.handle(makeRequest("/assets/../secret")))
    })
  )

  expect(response.status).toBe(400)
})

test("encoded traversal URLs are rejected before normalization", async () => {
  const response = await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* makeServer()
      return yield* Effect.scoped(server.handle(makeRequest("/%2e%2e/secret")))
    })
  )

  expect(response.status).toBe(400)
})

test("backslash traversal URLs are rejected before normalization", async () => {
  const response = await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* makeServer()
      return yield* Effect.scoped(server.handle(makeRequest("/assets\\..\\secret")))
    })
  )

  expect(response.status).toBe(400)
})

test("AppHttpServerLive requires AppAssetResolver", async () => {
  const server = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* AppHttpServer
    }).pipe(
      Effect.provide(
        Layer.provide(AppHttpServerLive, Layer.succeed(AppAssetResolver)(staticResolver))
      )
    )
  )

  const response = await Effect.runPromise(Effect.scoped(server.handle(makeRequest("/"))))
  expect(response.status).toBe(200)
})

test("mimeTypeForPath returns correct types for known extensions", () => {
  expect(mimeTypeForPath("/index.html")).toBe("text/html; charset=utf-8")
  expect(mimeTypeForPath("/app.js")).toBe("text/javascript; charset=utf-8")
  expect(mimeTypeForPath("/style.css")).toBe("text/css; charset=utf-8")
  expect(mimeTypeForPath("/icon.png")).toBe("image/png")
  expect(mimeTypeForPath("/font.woff2")).toBe("font/woff2")
  expect(mimeTypeForPath("/unknown.xyz")).toBe("application/octet-stream")
  expect(mimeTypeForPath("/no-extension")).toBe("application/octet-stream")
})
