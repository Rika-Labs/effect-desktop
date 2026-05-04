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
- define services with `class X extends Effect.Service<X>()("X", { effect: Effect.gen(...) }) {}`;
- define schema classes with `class T extends Schema.Class<T>("T")({...}) {}`;
- use `Effect.gen(function* () { ... yield* effect })` (no `$` adapter);
- compose layers with `Layer.provide` / `Layer.provideMerge` / `Layer.succeed` / `Layer.effect`.

## Tooling pinning

- Bun version is pinned in `package.json#packageManager` and in `.github/workflows/ci.yml` (`bun-version`). Update both together.
- Rust toolchain is pinned in `rust-toolchain.toml`. CI honors the file via `dtolnay/rust-toolchain` with no `toolchain:` argument.
- Every GitHub Action is SHA-pinned with the version tag in a trailing comment. Dependabot manages bumps via `.github/dependabot.yml`.

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
