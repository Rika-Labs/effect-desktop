# ADR-0012: Adopt effect/unstable/http for the app:// protocol handler (T11)

## Status

Accepted

## Context

The Rust host's WebView protocol bridge (`app://localhost/`) hand-rolls static asset serving and CSP header emission. Every additional endpoint — devtools API, admin/health, updater download, telemetry submission, crash report POST — would grow its own bespoke handler. The result is a scattered set of raw handlers with no shared middleware, no typed routes, and no composable error handling.

`effect/unstable/http` ships `HttpServer`, `HttpRouter`, and `HttpMiddleware` with typed routes, composable middleware, and an `HttpClient` for outbound calls. `@effect/platform-bun` provides `BunHttpServer.layer` as the concrete server implementation (T03).

The architectural model is: mount one `BunHttpServer` on the Bun side, route all concerns through `HttpRouter`, and reduce the Rust host's `app://` bridge to a thin transparent proxy that relays requests into the Bun server and streams responses back.

## Decision

Mount a `BunHttpServer` in the runtime tier and compose routes via `HttpRouter`. Reduce the Rust host's `app://localhost/` protocol bridge to a relay.

- A single `HttpRouter` composes: static assets (renderer bundle), devtools API endpoints, admin/health, and framework-internal routes.
- CSP defaults are applied as `HttpMiddleware` on the asset router — one rule, not per-handler.
- The Rust host's protocol bridge stops parsing requests; it forwards them into the Bun server and streams the response back. The change requires Rust-side coordination scoped to the relay reduction.
- Outbound paths (updater download, telemetry POST, crash report POST) use `HttpClient` from the same module for consistency.
- Auth on internal endpoints is `HttpMiddleware` — applied uniformly, not per-route.

Cross-links: [ADR-0004](adr-0004-platform-bun.md) (BunHttpServer depends on platform-bun), [ADR-0007](adr-0007-opentelemetry.md) (outbound HttpClient calls produce spans in the OTel pipeline).

## Alternatives considered

**Keep Rust-side asset serving**: static assets served from Rust require a Rust rebuild for any CSP change; adding devtools endpoints in Rust is prohibitively expensive. Rejected.

**Use a separate Node/Bun HTTP process**: a second process adds a network hop and complicates the startup/shutdown lifecycle. Rejected.

**Minimal per-endpoint handlers without HttpRouter**: each new endpoint grows its own handler; CSP and auth are duplicated. Rejected.

## Consequences

**Positive**

- CSP is one `HttpMiddleware` rule; adding or changing a CSP directive is one line.
- New internal endpoints are `Route.add` calls in the relevant `HttpRouter`; no Rust changes needed.
- `HttpClient` for outbound calls gives consistent retry, timeout, and OTel span semantics.

**Negative**

- Rust-side protocol bridge modification is required to reduce it to a relay — cross-language coordination cost.
- `effect/unstable/http` is beta; router/middleware API may shift before stable.

**Neutral**

- The `app://localhost/` scheme stays; only the handler responsibility moves from Rust to Bun.

## Validation

Renderer asset loads under `app://localhost/` produce identical bytes and CSP headers as before; a synthetic devtools API call routes through the Bun server with the expected typed response; outbound updater/telemetry/crash POSTs go through `HttpClient` with retries observable via T06 OTel; no asset-serving or CSP logic remains in the Rust host's protocol code.

## Migration notes

1. Add `effect/unstable/http` to `packages/core`.
2. Mount `BunHttpServer.layer` (T03) in the runtime spine.
3. Create an asset router with `HttpMiddleware` CSP defaults.
4. Create devtools and admin/health routers.
5. Reduce the Rust bridge to a relay (coordinate with `crates/host`).
6. Replace ad-hoc outbound HTTP calls with `HttpClient` from the same module.
