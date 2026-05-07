# Effect Desktop

A Bun-powered, Rust-hosted, React-friendly desktop application framework where native desktop capabilities, renderer communication, long-running resources, permissions, worker processes, and runtime observability are modeled through Effect.

The build specification is the source of truth: see [`docs/SPEC.md`](docs/SPEC.md).

## Status

Pre-v1.0.0. Public APIs are not yet stable, and milestone work is tracked against `docs/SPEC.md` §24.

## Open Source

Effect Desktop is published by Rika Labs, LLC under either the MIT license or the Apache License 2.0, at your option. See [`LICENSE`](LICENSE), [`LICENSE-MIT`](LICENSE-MIT), and [`LICENSE-APACHE`](LICENSE-APACHE).

Security issues should be reported privately. See [`SECURITY.md`](SECURITY.md).

Contribution expectations are documented in [`CONTRIBUTING.md`](CONTRIBUTING.md), with repository-specific implementation rules in [`AGENTS.md`](AGENTS.md).

## Validation gate

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
