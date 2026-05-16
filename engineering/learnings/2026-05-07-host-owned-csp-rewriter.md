---
date: 2026-05-07
type: architectural-reversal
topic: Move CSP nonce attribution from a build-time placeholder to a host-owned runtime rewriter
supersedes: engineering/learnings/2026-05-05-vite-compatible-build-pipeline.md
prior-decision: PR #182 (commit 9d6f683) — feat(host): enforce app protocol CSP nonces
---

# Host-owned CSP rewriter — reversing the build-time placeholder

## What we set out to do

Replace a per-renderer build-time CSP placeholder (`__APP_NONCE__`) with a single runtime rewriter inside `crates/host`, so any frontend framework whose static export lands in `apps/<x>/dist` plugs in without renderer-side CSP knowledge.

## What changed and why

PR #182 introduced the `__APP_NONCE__` placeholder so renderer bundlers could emit `nonce="__APP_NONCE__"` at build time, and the `app://` protocol handler substituted the actual nonce per response. That worked while the only renderer was a hand-written Vite + React app whose entry script lived in `index.html`. Once the playground migrated to Next.js 16 + Fumadocs, the placeholder had to be threaded into every prerendered page, every chunked `<script>`, and every inline `<style>` via a post-build Node script (`apps/playground/scripts/inject-nonce.mjs`). Adding a third or fourth framework would require a third or fourth such script. The contract scaled with renderers instead of being paid once.

The new design moves nonce attribution into a single Rust module, `crates/host/src/html_csp.rs`, that uses the `lol_html` streaming HTML rewriter. Selectors are `script`, `style`, and `link[rel=stylesheet]`. The module's only public entry returns `Result<RewriteOutcome, RewriteError>` with per-element counts. `csp_body` in `crates/host/src/scheme.rs` calls it, emits `tracing::debug` with the counts on success, `tracing::warn` when an HTML response carries no targeted elements, and on parser failure emits `tracing::error` and returns HTTP 500 with the trace id — never the un-rewritten body.

## Why this is the simplest version

Considered and discarded: keep the placeholder and add per-framework plugins (scales with frameworks, drift-prone); use `kuchikiki`/`scraper` (allocates a full DOM tree, broader API surface, no streaming benefit); make the rewriter infallible by panicking on parser error (turns a 500 into a host crash). The chosen design is one new module, one dependency, three selectors, and a typed error.

## What surfaced in review

`/review` flagged three blocking issues against the first draft of the architecture and we revised before any code landed:

1. The first signature `rewrite_with_nonce -> Vec<u8>` was infallible and would have rewarded silent fallback on parser failure. Changed to `Result<RewriteOutcome, RewriteError>`; the protocol handler turns Err into HTTP 500 with the trace id.
2. The migration scope listed only the playground; `templates/basic-react-tailwind` was a second consumer of the placeholder and `engineering/SPEC.md` committed to the placeholder contract. Both are updated in this PR.
3. The verification plan was unit-only. Added a scheme-level invariant test that parses the response body and asserts every `<script>` and `<style>` carries the same nonce as the CSP header, that `__APP_NONCE__` appears nowhere, and that two sequential requests yield distinct nonces and distinct bodies. Added a 500-path test that injects a faulty rewriter via a fn-pointer seam.

## First-principles postmortem

The invariant that mattered: same nonce on the response and on every CSP-attributed element. Today only the host can mint the nonce; previously only the renderer's build emitted the element attribute. The placeholder bridged them through a string contract — one more place where two pieces of code had to agree on something they did not need to agree on. Putting both halves in the host removes the contract.

## Game-theory postmortem

Players: host author (one), framework author (many), app author (template consumer), attacker (XSS injector). Old equilibrium: every framework author owned a slice of CSP attribution and each had its own bug surface. New equilibrium: host owns CSP attribution end-to-end; framework authors and app authors do not need to know CSP exists. The cheapest implementation choice (typed `Result` propagated to a 500 with a tracing event) is now also the safe choice — the previous infallible signature would have made silent fallback the cheapest choice.

## Failure mode that drove this

While migrating the playground we shipped a CSP that bound inline `style="..."` attributes to the same `style-src` directive that nonced `<style>` blocks. Prerendered Fumadocs HTML used inline `style=` for layout grids; the browser stripped them; the renderer painted blank. The white-screen incident did not happen because `__APP_NONCE__` itself was wrong — the nonce script worked. It happened because the placeholder design encouraged us to think "framework writes nonces, host substitutes them" and pulled our attention away from the half of the CSP that the framework cannot write at all (inline `style=` attributes need `style-src-attr 'unsafe-inline'`, which only the host can grant). Centralising CSP in the host makes that whole-policy view the default mental model.

## Mechanism that should keep this honest

`scheme::tests::app_scheme_response_returns_embedded_index_html` parses the response body and asserts (1) every nonce attribute equals the CSP header nonce and (2) `__APP_NONCE__` appears nowhere. `scheme::tests::html_rewrite_failure_returns_500_with_trace_id_and_no_un_rewritten_body` proves the loud-fail path. Together they make the bad equilibrium (silently emitting a body that does not match the policy) untestable as a passing build.
