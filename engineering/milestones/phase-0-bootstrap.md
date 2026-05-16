# Milestone 0: Repository bootstrap

Tracks `engineering/SPEC.md` §24.0 (Phase 0). Format follows §A.3.

## Goal

Establish the monorepo, tooling, docs skeleton, and validation gate so every later phase has a coherent ground state.

## Non-goals

Per §24.0:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: WRY/TAO native code (Phase 1), Bun runtime supervision (Phase 2), Effect-using code in any form (Phase 4+), real CLI commands (Phase 17 area), templates with content (Phase 6+), packaging/signing (Phase 21+).

## Required files

- `package.json`, `bun.lock`, `turbo.json`, `tsconfig.base.json`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`.
- `.gitignore`, `.editorconfig`, `.prettierrc`, `.prettierignore`, `oxlint.json`, `README.md`, `AGENTS.md`.
- `.github/workflows/ci.yml`, `.github/dependabot.yml`.
- `engineering/SPEC.md` (renamed from repo root), `engineering/decisions/adr-0000-template.md`, `engineering/architecture/`, `engineering/milestones/`, `engineering/validation/`.
- 9 stub TypeScript packages under `packages/{core,bridge,native,react,cli,devtools,test,config,create-effect-desktop}`.
- 4 stub Rust crates under `crates/{host,host-protocol,native-pty,native-updater}`.
- Skeleton `apps/*`, `apps/examples/*`, `templates/*`, `scripts/` (`.gitkeep`).
- `tests/repo-shape.test.ts` enforcing the workspace and stub-marker contracts.

## Public APIs

None added. Every package's `src/index.ts` is `export {}`. Every crate's `src/lib.rs` is a doc-commented stub plus a placeholder unit test.

## Acceptance criteria

From §24.0 — all green:

- [x] `bun install` succeeds.
- [x] `bun run check` exists and passes.
- [x] `cargo check --workspace` succeeds.

## Validation commands

```bash
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run lint
bun run format:check
bun test
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo check --workspace
cargo test --workspace
```

All pass on the bootstrap working tree.

## Risks

Documented in `engineering/SPEC.md` §26 — none specific to Phase 0.

## Completion notes

### Code review applied

Multi-agent review (`/code-review`) surfaced 14 findings across 6 reviewers. All 14 were addressed in this phase before merge:

- workspaces glob restored to the §5.4 four-glob shape;
- DOM types removed from `tsconfig.base.json`; renderer-only override added in `packages/react/tsconfig.json`;
- `.github/workflows/ci.yml` declares `permissions: contents: read`;
- every GitHub Action SHA-pinned; `.github/dependabot.yml` automates bumps;
- CI now runs `bun run check`, `bun run lint`, `bun run format:check`, `cargo fmt --check`, and `cargo clippy --workspace --all-targets -- -D warnings` in addition to the spec's four required commands;
- `setup-bun@v2` pinned to `bun-version: 1.3.13`;
- `rust-toolchain.toml` channel pinned to `1.83.0`;
- Cargo cache key now hashes `**/Cargo.lock`; loose `restore-keys` removed;
- `Cargo.toml` `repository` updated to the real GitHub remote;
- `turbo.json` dropped the dead `dependsOn: ["^build"]` edge from `test`;
- `tests/repo-shape.test.ts` enforces workspace member shape and the Phase 0 stub-marker deletion contract (catches placeholder tests left in place after real code lands);
- this milestone document captures the durable completion record;
- the project-memory `effect-v4-baseline.md` was updated to reference `engineering/SPEC.md` (the post-rename path).

### Out-of-repo follow-ups

- GitHub branch protection (`main` ≥1 review, release branches ≥2 including security reviewer) per §25.4 — set in repo settings, not via files.
- HSM-backed signing key custody (§25.4) — Phase 21+ when packaging lands.
