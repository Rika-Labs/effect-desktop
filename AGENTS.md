# AGENTS.md — Effect Desktop

Repo-local rules for implementation agents and human contributors. The framework spec is the source of truth: `docs/SPEC.md`. This file captures cross-phase rules and conventions that the spec implies but does not codify in one place.

## Spec hierarchy

1. `docs/SPEC.md` — the build specification. Normative.
2. This file (`AGENTS.md`) — repo-local rules.
3. The user's global engineering bar (`~/.claude/CLAUDE.md`) — defaults when neither of the above applies.

When the spec and this file conflict, the spec wins. When this file fills a spec gap, prefer the rule here.

## Phase discipline

Implement milestones in §24 order. Each phase produces a `docs/milestones/phase-NN-<slug>.md` capturing the §A.3 template and the §28.4 completion report. The milestone doc is the durable record; chat reports are not.

## Stub marker contract

Phase 0 left every package and crate with placeholder content. The repo-shape test (`tests/repo-shape.test.ts`) enforces a deletion contract:

- A package is "still a stub" iff `src/index.ts` is exactly `export {}\n`.
- A crate is "still a stub" iff `src/lib.rs` contains the doc comment line `//! Phase 0 stub.`.

When a contributor adds real code:

1. **TypeScript packages** — the moment `src/index.ts` exports anything real, `src/index.test.ts` must no longer contain the test name `"phase 0 stub compiles and runs"`. Replace the placeholder with a real assertion.
2. **Rust crates** — when implementation lands, delete the `//! Phase 0 stub.` doc comment first; then the placeholder `fn it_compiles` must also be replaced with a real test.

The repo-shape test fails CI if either contract is violated.

## Effect v4 baseline

Per `docs/SPEC.md` §4.4.1, the framework targets Effect v4. v3 patterns are forbidden:

- import every Effect symbol from `effect` (never `@effect/schema`);
- use `Effect.Effect<A, E, R>` (three params, never elide `R`);
- define services with `class X extends Context.Service<X, XApi>()("X", { make: Effect.gen(...) }) {}`;
- define schema classes with `class T extends Schema.Class<T>("T")({...}) {}`;
- use `Effect.gen(function* () { ... yield* effect })` (no `$` adapter);
- compose layers with `Layer.provide` / `Layer.provideMerge` / `Layer.succeed` / `Layer.effect`.

## Layer-first framework contract

Effect Desktop exists because Effect lets the framework make native desktop authority type-safe, testable, and replaceable. Treat this as the governing implementation contract:

The concrete review checklist lives in `docs/architecture/layer-first-contract.md`. Keep this section and that document aligned; `docs/SPEC.md` remains the source of truth when they disagree.

- every effectful public capability is an Effect service requirement with a stable service tag;
- every capability exposes a live layer and a deterministic test layer before it is considered complete;
- capabilities that cross renderer/runtime/host boundaries also expose a client layer generated from the typed contract;
- public effectful TypeScript APIs return `Effect.Effect<A, E, R>`, not `Promise<A>`, except at explicit integration edges;
- public boundary data uses `Schema.Class`; expected failures use stable tagged errors;
- streams, resources, background fibers, processes, workers, sockets, windows, subscriptions, and handles have explicit owners through `Scope`, scoped layers, `Stream`, `Resource`, `RcMap`, `FiberSet`, or equivalent Effect primitives;
- concrete runtimes, WebViews, storage engines, transports, host adapters, and package providers are selected by data and supplied as layers;
- app code must depend on service requirements, not on Bun, Node, WebView, host, filesystem, clock, random, environment, or test-double globals.

When adding a framework abstraction, first identify the Effect primitive that already owns the concept. Add an Effect Desktop abstraction only when it hides real desktop-specific complexity or stabilizes a policy boundary.

`ManagedRuntime` and `Effect.run*` belong at composition edges: CLI entrypoints, renderer framework hooks, Vite callbacks, tests, and host/bootstrap glue. Library internals should keep programs as `Effect` values and receive dependencies through layers.

## Testability gate

A public capability is not complete until a user can test application code against it without a native host, OS permission prompt, real process, real WebView, real filesystem mutation, or real network service unless the capability is explicitly an integration-only adapter.

For each capability, prefer this shape:

- `Capability` service tag or class;
- `CapabilityLive`;
- `CapabilityClientLive` when the capability crosses a process or RPC boundary;
- `CapabilityTest` or a named test-layer constructor;
- schema-coded request/response/error models;
- shared contract tests that run against every implementation layer.

If a live implementation cannot support the same behavior as the test/client layer, expose that difference as typed provider capability data rather than branching in user app code.

## Fast and small provider rule

Swappability must not force every provider into the default app. Optional providers must live behind explicit subpaths, lazy layer selection, or package boundaries so unused runtimes, WebView engines, storage engines, and native adapters do not inflate the default startup path or bundle.

## Tooling pinning

- Bun version is pinned in `package.json#packageManager` and in `.github/workflows/ci.yml` (`bun-version`). Update both together.
- Rust toolchain is pinned in `rust-toolchain.toml`. CI honors the file via `dtolnay/rust-toolchain` with no `toolchain:` argument.
- Every GitHub Action is SHA-pinned with the version tag in a trailing comment. Dependabot manages bumps via `.github/dependabot.yml`.

## Docs deployment

The deployable docs app lives in `apps/docs` and deploys through Alchemy v2 to Cloudflare Workers Static Assets. Production uses the `prod` stage and the `effect-desktop-docs` Worker. Pull request previews use disposable `pr-<number>` stages and must be destroyed after the PR closes.

Run Alchemy commands from `apps/docs` after `bun install --frozen-lockfile`:

```bash
bun run deploy -- --stage prod
bun run deploy -- --stage pr-123
bun run destroy -- --stage pr-123
```

Local deploys should use Alchemy's OAuth credential flow for Cloudflare and the GitHub CLI credential flow for GitHub. The first Cloudflare deploy may also prompt to create the `alchemy-state-store` Worker; accept that prompt for this repo/account. CI deploys use environment variables from GitHub Actions secrets:

```bash
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<token>
```

For local PR comment testing, also set `PULL_REQUEST` and `BUILD_SHA`; GitHub auth can come from `gh auth token`. Do not commit local Cloudflare credentials, Alchemy profiles, generated `.alchemy/` state/logs, or deploy output.

## Validation gate

Before marking a phase complete, every command must exit clean from a fresh checkout:

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

CI runs the same gate on `ubuntu-latest`, `macos-latest`, and `windows-latest`.

## Code-generation policy

Because most code is authored by agents, both the TypeScript compiler and oxlint are configured strictly so that the LLM's most common mistakes fail loudly at the gate, not silently at runtime.

`tsconfig.base.json` extends `strict: true` with the `@tsconfig/strictest` flag set: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `noUncheckedSideEffectImports`, `useUnknownInCatchVariables`. Together they kill the canonical `users[0].name`, "absent vs undefined", dot-access on dynamic objects, and dead-branch failure modes.

`oxlint.json` enables type-aware mode (`oxlint-tsgolint` plugin) so promise-related rules — `no-floating-promises`, `no-misused-promises`, `await-thenable`, `switch-exhaustiveness-check`, the `no-unsafe-*` family, `no-unnecessary-type-assertion` — fire on real semantic violations, not just syntax. Categories `correctness`, `suspicious`, and `perf` are all `error` (never `warn`); per `@nkzw/oxlint-config` philosophy, warnings get ignored by agents and the only useful state is "fail at the gate or pass clean". `no-explicit-any` is `error` (test files override to `off` for fixture flexibility); `no-console` is `error` outside `bin.ts` and `scripts/**`.

If a rule produces a false positive, prefer fixing the code over disabling the rule. If the rule must be disabled, do it at the smallest scope possible — line-level or file-level — with a comment that says why. Disabling at the config level requires a real reason and an entry in this section.

The repo-level type-aware lint gate runs against explicit Effect Desktop source paths, ignores generated app outputs, ignores `vendor/effect/**`, and disables nested oxlint config loading. `vendor/effect` is vendored upstream source with its own oxlint plugin configuration, not Effect Desktop-authored code, and loading its config from this workspace breaks the root gate before repo code is checked. The root `bun test` gate uses `bunfig.toml` to ignore the same vendored and generated paths for the same reason.

## Forbidden behavior

Per `docs/SPEC.md` §28.2:

- no app logic in Rust;
- no app-specific packages in core;
- no untyped renderer bridge;
- no swallowed errors;
- no skipped resource cleanup;
- no permission bypasses;
- no scope creep beyond the active milestone.

## Adding dependencies

Per `docs/SPEC.md` §4.7, every added dependency requires either an ADR under `docs/decisions/` or a note in the relevant package README. The toolchain devDeps already declared in §5.4 (`turbo`, `typescript`, `oxlint`, `prettier`, `@types/bun`) are spec-mandated and need no ADR.
