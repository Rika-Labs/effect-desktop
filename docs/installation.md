---
title: Installation
description: Install Bun, clone the repository, verify the workspace.
kind: reference
audience: app-developers
effect_version: 4
---

# Installation

> The full guide lives at [`start/install.md`](start/install.md). This page is the release-gated reference.

Effect Desktop is a Bun + Rust monorepo. There is no published npm package yet — develop against this repository directly.

## Requirements

| Tool                 | Version                            | Source                                                                      |
| -------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| Bun                  | `1.3.13`                           | `package.json#packageManager`                                               |
| Rust                 | toolchain in `rust-toolchain.toml` | installed by `rustup`                                                       |
| Platform build tools | per OS                             | macOS Xcode CLI, Windows VS Build Tools, Linux gcc + libgtk + libwebkit2gtk |

## Get the workspace

```bash
git clone https://github.com/Rika-Labs/effect-desktop.git
cd effect-desktop
bun install --frozen-lockfile
```

## Verify

```bash
bun run desktop --help
```

You should see top-level CLI usage — `check`, `build`, `package`, `sign`, `notarize`, `publish`, `doctor`, `release`.

## Verify the CLI Contract

```ts run
import { runCli } from "../packages/cli/src/index.js"

const documentedCommand = "desktop --help"

if (typeof runCli !== "function" || documentedCommand.length === 0) {
  throw new Error("desktop CLI is unavailable")
}
```

## Run the framework's own checks

```bash
bun run check       # Ultracite (oxlint + oxfmt)
bun run typecheck   # tsgo across all packages
bun test
cargo check --workspace
```

## Next

- [Build your first app in 5 minutes](start/first-app.md)
- [Where to go next](start/next-steps.md)
- [Architecture overview](explanation/architecture.md)

## App scaffolding

There is **no** `bun create effect-desktop` today. Use [`apps/inspector/`](../apps/inspector) as a reference scaffold and read the [first-app guide](start/first-app.md) for the manual setup.
