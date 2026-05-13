# Issue 1221: Centralize CSP and Nonce Policy

## Problem

CSP defaults and nonce rendering currently live in three places: `packages/config`, `packages/native/src/app-http-server.ts`, and `crates/host/src/csp.rs`. That makes security policy drift possible, and the TypeScript app server still rewrites nonce attributes with a regex while the Rust host already uses a parser-backed HTML rewriter.

## Plan

1. Make the default CSP an ordered data artifact in `packages/config/src/default-csp-policy.json`.
2. Decode that artifact into Schema-backed `CspDirective`, `CspPolicy`, and `CspNonce` values in `packages/config/src/index.ts`.
3. Keep raw user configuration separate as `CspConfig`, then derive effective policy data with `effectiveCspPolicy`.
4. Update `renderDefaultCsp`, `renderEffectiveCsp`, and `cspWeakenings` to use the same structured policy model.
5. Make `packages/native/src/app-http-server.ts` render CSP headers through `@effect-desktop/config`, mint nonces from cryptographic entropy, and replace regex rewriting with Bun `HTMLRewriter`.
6. Make `crates/host/build.rs` generate Rust default CSP directives from the same JSON artifact and update `crates/host/src/csp.rs` to render structured directives.
7. Write `rendererManifest.csp` as structured effective policy data during `desktop build`.
8. Have the Rust app-scheme host load the built manifest policy when packaged, falling back to generated defaults only when no packaged manifest exists.

## Architecture Debt Sweep

Remove now:

- Duplicate CSP string constants in TypeScript native serving and Rust host serving.
- `EFFECT_DESKTOP_CSP_TEMPLATE`; prerelease compatibility should not keep a parallel string policy channel.
- Regex nonce rewriting in the TypeScript native app server.

Track later if discovered larger than this ticket:

- Full CLI config decoding is still broader than CSP and should remain part of the schema config roadmap instead of being expanded here.

## Verification

- Focused Bun tests for config, native app server, and CLI manifest output.
- Focused Rust tests for `csp` and `html_csp`.
- Full local validation before pushing.
