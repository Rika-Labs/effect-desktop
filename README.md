# Effect Desktop

A Bun-powered, Rust-hosted, React-friendly desktop application framework where native desktop capabilities, renderer communication, long-running resources, permissions, worker processes, and runtime observability are modeled through Effect.

The build specification is the source of truth: see [`docs/SPEC.md`](docs/SPEC.md).

## Status

Pre-v1.0.0. The repository is currently at **Phase 0 (Repository bootstrap)** of the milestone plan in `docs/SPEC.md` §24. Public APIs are not yet stable.

## Validation gate

```bash
bun install
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```
