## Hard Rules

Every active goal includes an architecture-debt sweep. For each ticket or issue, look for adapters, thin wrapper layers, custom DSLs, bridge specs, or parallel abstractions over Effect in the area being touched.

Effect primitives are the default architecture. Custom abstractions must justify themselves by owning durable desktop-specific policy, lifecycle, security, or protocol translation. If an abstraction only renames, mirrors, narrows, or partially reimplements Effect APIs, treat it as design debt.

If a wrapper is not adding durable desktop-specific semantics, remove it as part of the current work.

If removal is larger than the current ticket, open a follow-up GitHub issue with a concrete before/after that shows the current custom abstraction and the desired Effect-native shape. The issue must make the simplification legible enough that a future agent can remove the wrapper without rediscovering the whole design.

Track follow-up issues in the roadmap when they unblock or simplify later work. Do not preserve legacy compatibility solely for prerelease APIs; prefer the simpler Effect-native interface and migrate call sites fully.

# Repository Guidelines

## Project Structure & Module Organization

Effect Desktop is a Bun/TypeScript monorepo with Rust host crates. Framework packages live in `packages/*`, example and docs apps in `apps/*`, reusable starters in `templates/*`, Rust code in `crates/*`, repo-level tests in `tests/*`, and API snapshots in `api/snapshots`. Design notes, ADRs, milestones, and operational docs live under `docs/`. External reference repositories are vendored as read-only git subtrees under `repos/`; do not import from or edit them unless explicitly updating a subtree.

## Build, Test, and Development Commands

Use Bun 1.3.13, as pinned in `package.json`.

- `bun install --frozen-lockfile`: install dependencies exactly from `bun.lock`.
- `bun run dev`: run package/app development tasks through Turbo.
- `bun run build`: build all workspace targets.
- `bun run check`: run package check scripts.
- `bun run typecheck`: run TypeScript type checks.
- `bun run lint` and `bun run lint:types`: run normal and type-aware linting.
- `bun run format:check`: verify Prettier formatting.
- `bun test`: run Bun tests.
- `cargo check --workspace`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`: validate Rust crates.

## Coding Style & Naming Conventions

TypeScript uses strict compiler settings and type-aware oxlint. Keep public effectful APIs as `Effect.Effect<A, E, R>` except at explicit integration edges. Import Effect symbols from `effect`, use `Schema.Class` for boundary data, and model expected failures with stable tagged errors. Prefer small, explicit modules and avoid shallow wrappers. Formatting is Prettier-managed; do not hand-format vendored files.

Public effectful capability design must follow the Layer-first contract in `docs/architecture/layer-first-contract.md`.

## Testing Guidelines

Place package tests beside source as `src/*.test.ts` or in package test directories following existing patterns. Use Bun test for TypeScript and Cargo test for Rust. When replacing a Phase 0 stub, replace the placeholder test with a real assertion. Public capabilities should include deterministic test layers or fixtures that avoid real OS prompts, network services, or native hosts.

## Commit & Pull Request Guidelines

Follow the existing history: concise Conventional Commit-style subjects such as `fix(react): ...`, `refactor(core): ...`, or `docs: ...`; include issue references when applicable. PRs should explain the user-visible change, link the issue, and note verification performed. Include screenshots only for UI-facing changes.

## Vendored repositories

External source repositories are vendored under `repos/` as squashed git subtrees, not submodules. Treat them as read-only reference material for humans and agents.

- Do not edit files under `repos/` unless explicitly asked to update or patch a subtree.
- Do not import from `repos/`; application and framework code must import from declared package dependencies.
- Prefer vendored source, tests, and examples over generated guesses or generic web search when grounding library behavior.
- When writing Effect v4 code, inspect `repos/effect-smol/` for idiomatic usage, tests, module structure, and API design.
- Use `repos/effect/` as the regular upstream Effect repository reference when comparing broader upstream history, package layout, or non-smol implementation details.
- Before writing Effect code, read `repos/effect-smol/LLMS.md`, then inspect the relevant `repos/effect-smol/ai-docs/src/**` examples and `repos/effect-smol/packages/**` source/tests.

Add new reference repositories as subtrees under `repos/<name>`:

```bash
git subtree add \
  --prefix=repos/<name> \
  <repository-url> \
  <branch> \
  --squash
```

Subtrees need no post-clone initialization. A fresh clone already contains the vendored source; do not run `git submodule update --init`.

Update an existing subtree with:

```bash
git subtree pull \
  --prefix=repos/<name> \
  <repository-url> \
  <branch> \
  --squash
```

Effect v4 smol is vendored at `repos/effect-smol` from `https://github.com/Effect-TS/effect-smol.git` on `main`:

```bash
git subtree pull \
  --prefix=repos/effect-smol \
  https://github.com/Effect-TS/effect-smol.git \
  main \
  --squash
```

Regular upstream Effect is vendored at `repos/effect` from `https://github.com/Effect-TS/effect.git` on `main`:

```bash
git subtree pull \
  --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git \
  main \
  --squash
```
