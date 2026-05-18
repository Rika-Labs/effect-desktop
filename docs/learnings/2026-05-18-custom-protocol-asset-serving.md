---
title: Custom protocol asset serving hardening
date: 2026-05-18
issue: 1365
---

# Custom Protocol Asset Serving Hardening

Custom protocol asset serving is implemented through the Protocol host adapter and the WebView custom-scheme router. The host stores route and deny policy paths in decoded canonical form, so encoded policy payloads and encoded requests match the same path.

Registered custom schemes without an asset root fail closed with `403 Forbidden`. Custom protocol requests must use canonical `localhost` authority, because the policy key is the scheme plus path, not arbitrary caller-chosen origins. Successful custom asset responses include the active CSP, and HTML served through custom protocol asset roots receives the same nonce rewrite as the fixed app protocol.

Protocol registration is startup-only host policy. Once a WebView builder consumes the protocol registry, later mutations return `Unsupported`; Wry does not attach new custom protocol handlers to existing WebViews.

## Architecture-Debt Sweep

Touched area inspected: `crates/host/src/methods/protocol.rs`, `crates/host/src/scheme.rs`, `docs/reference/native/protocol.md`, Protocol host routing, custom-scheme tests, and the existing Protocol Effect/native surface.

No wrappers were removed. The remaining Protocol service is the public Effect service for this capability, and the Rust host registry owns durable native/web protocol policy: scheme registration, asset-root containment, route/deny policy, CSP rewriting for HTML, and fail-closed request handling.

No follow-up issue is needed from this sweep.

## Verification

- `cargo test -p host protocol`
- `cargo test -p host custom_scheme`
- `cargo test -p host-protocol protocol_payloads --lib`
- `cargo test -p host --test startup_smoke`
- `bun test packages/native/src/index.test.ts -t Protocol`
- `cargo fmt --check`
- `git diff --check`

The strongest safe CI loop for custom scheme serving is the request-level Rust custom-scheme test path. The existing startup smoke test proves WebView creation for the fixed app protocol, but it does not navigate a live WebView through a registered custom scheme.
