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
