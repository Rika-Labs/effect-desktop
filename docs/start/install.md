---
title: Install
description: Install the toolchain and clone the workspace.
kind: start
audience: app-developers
effect_version: 4
---

# Install

ORIKA is a Bun + Rust monorepo. There is no published npm package yet, so you develop **against this repository directly**.

## Requirements

| Tool                 | Version                            | Source                                                                               |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| **Bun**              | `1.3.13`                           | pinned in `package.json#packageManager`                                              |
| **Rust**             | toolchain in `rust-toolchain.toml` | installed automatically by `rustup`                                                  |
| Platform build tools | per OS, for native packaging       | macOS: Xcode CLI tools · Windows: VS Build Tools · Linux: gcc, libgtk, libwebkit2gtk |

You only need the platform build tools when you intend to package or run `cargo check`. The TypeScript layer alone needs only Bun.

## Get the workspace

```bash
git clone https://github.com/Rika-Labs/effect-desktop.git
cd effect-desktop
bun install --frozen-lockfile
```

`--frozen-lockfile` matters: this repo pins exact versions across many Effect/Effect-RPC packages, and a free install can drift.

## Verify

```bash
bun run desktop --help
```

You should see the top-level CLI usage — `check`, `build`, `package`, `sign`, `notarize`, `publish`, `doctor`, `release`. If `bun run desktop` does not resolve, your `bun install` did not complete.

Run the framework's own checks to confirm a healthy environment:

```bash
bun run check       # Ultracite (oxlint + oxfmt)
bun run typecheck   # tsgo across all packages
bun test            # Bun test runner
cargo check --workspace
```

The install step runs the repo `postinstall` hook, which patches `@typescript/native-preview`
with `@effect/tsgo`. That makes the local `tsgo` command and compatible editors use the Effect
language service without a manual setup step.

If any of those fail on a clean clone, file an issue — it is not your machine.

## What you just installed

A thirteen-package TypeScript workspace plus Rust crates:

| Layer             | Packages                                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| Public framework  | `@orika/core`, `@orika/native`, `@orika/bridge`, `@orika/config`           |
| Renderer adapters | `@orika/react`, `@orika/solid`, `@orika/vue`, `@orika/next`, `@orika/vite` |
| Renderer runtime  | `@orika/platform-browser`                                                  |
| Tooling           | `@orika/cli`, `@orika/test`, `@orika/devtools`                             |
| Native (Rust)     | `host`, `host-protocol`, `native-pty`, `native-updater`                    |

The only checked-in app is [`apps/inspector`](../../apps/inspector) — a Vite + React renderer for live and recorded framework sessions. There are **no scaffolders** today; building an app means writing one against `@orika/core` and friends. The next page does that in five minutes.

## Next

→ [Build your first app](first-app.md)
