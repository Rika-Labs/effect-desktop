# Milestone 1: Native host spike

Tracks `docs/SPEC.md` §24.1 and GitHub issue #3. Format follows the repo milestone convention and includes the §28.4 completion report.

## Goal

Open a native window and load a static local renderer from the canonical Rust host binary.

## Non-goals

Per §24.1:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: Bun runtime supervision (Phase 2), host protocol framing (Phase 3), typed bridge contracts (Phase 4), renderer build pipeline and production CSP manifest wiring (Phase 6), and native service surfaces (Phase 7+).

## Required files

- `crates/host/Cargo.toml`, `crates/host/src/main.rs`, `crates/host/src/window.rs`, `crates/host/src/webview.rs`, `crates/host/src/scheme.rs`, `crates/host/src/assets.rs`.
- `crates/host/tests/startup_smoke.rs`.
- `apps/playground/dist/index.html`, `apps/playground/dist/style.css`, `apps/playground/dist/app.js`.
- `.github/workflows/ci.yml` for the finite host smoke path under Xvfb on Linux.
- `docs/security/exemptions/2026-05-04-host-wry-gtk-stack.md` for the WRY/TAO GTK advisory acceptance and re-review triggers.

## Public APIs

None added. `crates/host` exposes a binary and keeps host spike helpers private to the crate.

## Acceptance criteria

From §24.1:

- [x] native window opens through `tao`;
- [x] renderer displays text through a `wry` WebView;
- [x] host exits cleanly on the close path and through the finite smoke-test event path.

## Appendix C verification rows

No Appendix C row is directly gated by Phase 1. The phase proves the native host substrate only; protocol, bridge, permissions, and security rows begin in later phases.

## Validation commands

```bash
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run lint
bun run lint:types
bun run format:check
bun test
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo check --workspace
cargo test --workspace
```

Specialized native-host evidence:

- CI runs `cargo run -p host -- --window-smoke-test`; Linux wraps that path in `xvfb-run -a`.
- PR #149 local verification ran the built `target/debug/host` binary from outside the repo and OCR-confirmed the WebView rendered `Effect Desktop playground renderer` and hydrated `app://localhost/` text.

## Completion report

```txt
Milestone: Phase 1 - Native host spike
Files changed: crates/host native host modules; apps/playground/dist static renderer files; host smoke test; GTK/WebView security exemption evidence.
Public APIs added: None.
Tests added: host startup smoke; window smoke mode; scheme/assets/webview/window unit tests; repo shape coverage for the real host crate.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run typecheck; bun run lint; bun run lint:types; bun run format:check; bun test; cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo check --workspace; cargo test --workspace.
Validation results: all pass locally on the milestone-close branch; Phase 1 implementation PRs #145 through #149 were green in CI before merge.
Known limitations: renderer assets are committed static bytes; no runtime process, host protocol, bridge, renderer build manifest, navigation policy, or production asset manifest exists yet.
Follow-up items: Phase 2 adds runtime supervision; Phase 3 adds framed protocol; Phase 6 replaces the committed playground artifact with a build pipeline and production manifest.
```

## Completion notes

Phase 1 shipped as five small PRs:

- #145 wired the host binary and native dependencies, added deterministic startup logging, and documented Linux native packages plus the GTK-stack security exemption.
- #146 opened a Tao window on the platform main thread and added a finite smoke-test exit path.
- #147 attached the first WRY WebView using supported inline HTML after grounding that WRY does not support `data:` URLs through `with_url`.
- #148 registered the first private `app://localhost/` scheme handler with hard-coded HTML and static CSP.
- #149 embedded the playground renderer files, enforced canonical `localhost` authority, and proved the built binary renders committed assets through `app://localhost/`.

The durable lesson from the phase is that native-host substrate work is only complete when the exact binary path is finite under CI, the privileged origin boundary is explicit, and security-exemption evidence names the PR that widened the accepted native surface.
