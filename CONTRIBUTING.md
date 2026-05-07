# Contributing

Effect Desktop follows the repository specification in `docs/SPEC.md`. The
spec is normative; code changes should implement the smallest correct slice
that preserves its boundaries.

## Ground Rules

- Read `AGENTS.md` and the relevant section of `docs/SPEC.md` before changing
  code.
- Keep app logic out of Rust. Rust owns the host boundary; TypeScript and
  Effect own framework and application behavior.
- Keep public APIs typed, schema-backed, and explicit about failures.
- Add or update tests for behavior changes.
- Do not swallow errors or bypass permission checks.
- Do not add dependencies without the ADR or README note required by
  `AGENTS.md`.

## Local Verification

Run the tightest gate that exercises your change. Before marking a phase
complete, run the full validation gate from `AGENTS.md`:

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

## Pull Requests

- Keep PRs scoped to one issue, milestone, or behavior boundary.
- Include the evidence you ran and any remaining unverified risk.
- Update docs when public behavior changes.
- Security-sensitive changes need tests that prove the denied path, not only
  the happy path.
