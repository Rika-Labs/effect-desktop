---
title: Contribution guide
description: Public behavior changes need typed code, docs, and verification in the same PR.
kind: contributing
audience: contributors
effect_version: 4
---

# Contribution guide

> Repo-wide rules: [`AGENTS.md`](../AGENTS.md). Workflow basics: [`CONTRIBUTING.md`](../CONTRIBUTING.md). Security reports: [`SECURITY.md`](../SECURITY.md). Conduct: [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md).

Contributors keep public behavior typed, documented, and verified in the same change. The [`AGENTS.md`](../AGENTS.md) hard rules are normative; this page explains how to apply them.

## Before changing public behavior

- Read [`AGENTS.md`](../AGENTS.md), especially the architecture-debt rule.
- Read the relevant external docs page under `docs/`.
- Read the internal specification, ADR, or milestone under `engineering/` when changing framework architecture.
- Run the [architecture-debt sweep](contributing/architecture-debt.md) on the area you're touching. The sweep is part of every contribution, not a separate ticket.

## Local verification

This repo is pinned to **Bun 1.3.13** (see `package.json`) and **Rust 1.88.0** (see `rust-toolchain.toml`). Use the scripts in `package.json` directly; do not invent new ones.

The full validation gate from [`AGENTS.md`](../AGENTS.md):

```bash
bun install --frozen-lockfile
bun run check          # format:check + lint:types + turbo check
bun run typecheck      # turbo typecheck
bun run lint           # ultracite (Oxlint + Oxfmt) with type-aware checks
bun run lint:types     # alias for lint
bun run format:check   # oxfmt --check .
bun test               # turbo test
bun run cargo:fmt      # cargo fmt --check
bun run cargo:clippy   # cargo clippy --workspace --all-targets -- -D warnings
bun run cargo:check    # cargo check --workspace
bun run cargo:test     # cargo test --workspace
```

Other useful scripts:

- `bun run dev` — `turbo dev` across workspaces.
- `bun run build` — `turbo build`.
- `bun run desktop <args>` — runs the CLI entry at `packages/cli/src/bin.ts`.
- `bun run format` — write formatting changes with `oxfmt --write .`.

Formatting is **Oxfmt / Ultracite**, not Prettier. Run `bun x ultracite fix` for auto-fixes.

## Required docs gate

```bash
bun run desktop check --docs
```

The gate verifies every release-blocking page declared in [`docs/docs-manifest.json`](docs-manifest.json) exists, contains a runnable ` ```ts run ` example, and that the example covers the page's required tokens. See [Updating the docs](contributing/docs.md) for how to add or change pages.

## Verify docs gate exports

```ts run
import { runDocsReleaseGate } from "../packages/cli/src/index.js"

const command = "check --docs"

if (typeof runDocsReleaseGate !== "function" || command.length === 0) {
  throw new Error("runDocsReleaseGate is unavailable")
}
```

## Pull request rule

If a public API, command, config key, permission, or native capability changes, **update the matching page in `/docs`** in the same PR. Reference pages are grounded in source — every documented symbol should be findable by `grep`.

PRs follow Conventional Commit-style subjects (`fix(react): …`, `refactor(core): …`, `docs: …`), reference the issue, and record the architecture-debt sweep outcome in the description before close. See [`AGENTS.md`](../AGENTS.md) for the full rule.

## Where to go next

- [Contributing: docs](contributing/docs.md) — adding and updating pages, release gate mechanics
- [Contributing: architecture-debt sweep](contributing/architecture-debt.md) — the Effect-first wrapper rule in practice
- [`AGENTS.md`](../AGENTS.md) — repo-wide hard rules
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — workflow basics
- [`SECURITY.md`](../SECURITY.md) — vulnerability disclosure
