# Effect Desktop

Effect Desktop is a pre-v1 desktop application framework for building local-first apps with a Rust host, a Bun TypeScript runtime, React renderers, and Effect services at every privileged boundary.

```txt
Rust owns the shell.
Bun owns the runtime.
React owns the UI.
Effect owns correctness.
```

The framework specification is the source of truth: [docs/SPEC.md](docs/SPEC.md).

## Framework Thesis

Effect Desktop is designed around one foundation: every effectful dependency should be supplied by an Effect `Layer`.

That means app code should depend on typed service requirements, not concrete runtimes, WebViews, storage engines, native hosts, clocks, random sources, permission prompts, or test doubles. A capability should be swappable by replacing a layer. The same user-level program should run against live providers, client/RPC providers, and deterministic test providers.

The goal is:

- full-stack type safety through Effect Schema and typed RPC boundaries;
- testability through public test layers and contract test suites;
- switchable providers for runtime, WebView, storage, transport, native services, and packaging;
- fast rebuilds by rebuilding only the selected provider graph;
- small defaults by keeping optional providers lazy and behind explicit package subpaths.

The working order for the current roadmap is captured in [docs/roadmap/layer-first-issue-order.md](docs/roadmap/layer-first-issue-order.md).
The concrete review contract for new public effectful APIs is
[docs/architecture/layer-first-contract.md](docs/architecture/layer-first-contract.md).

## Status

Effect Desktop is not published to npm yet.

The package manifests in this repository are still `private: true` and `version: 0.0.0`. The intended npm flow is implemented in `packages/create-effect-desktop`, but it cannot produce a standalone installable app until the `create-effect-desktop` package and the `@effect-desktop/*` packages are published.

Use this repository today if you want to inspect or test the framework. Treat public APIs as unstable until v1.0.0.

## Quick Start

### Today, from this repository

Requirements:

- Bun `1.3.13`, pinned in [package.json](package.json).
- Rust, pinned by [rust-toolchain.toml](rust-toolchain.toml).

Install the workspace:

```bash
bun install --frozen-lockfile
```

Run the safest starter template:

```bash
cd templates/basic-react-tailwind
bun run dev
```

Run the main repository checks while developing:

```bash
bun run check
bun run typecheck
bun run lint
bun test
cargo check --workspace
cargo test --workspace
```

The full phase-completion gate lives in [AGENTS.md](AGENTS.md).

### From npm, once published

This is the intended user-facing flow after the packages are published:

```bash
bun create effect-desktop my-app
cd my-app
bun install
bun run dev
```

The scaffold command supports:

```bash
bun create effect-desktop my-app --template basic-react-tailwind
bun create effect-desktop my-app --template todo-sqlite --renderer-storage sqlite-wasm
```

Supported templates are `basic-react-tailwind`, `todo-sqlite`, and `multi-window`. Supported renderer storage adapters are `none`, `indexeddb`, `sqlite-wasm`, and `pglite`.

## What You Get

- A Rust host for windows, WebViews, app protocol handling, and native platform adapters.
- A Bun runtime for TypeScript application services.
- Typed bridge contracts between renderer code and runtime services.
- Effect services, schemas, layers, resources, streams, and typed failures around native authority.
- A Layer-first architecture where live, client, and test implementations can satisfy the same service requirement.
- React hooks and providers for renderer code.
- CLI slices for build, package, sign, notarize, publish, doctor, and release checks.

The renderer does not receive raw native authority. Privileged work crosses named services, typed contracts, permissions, and resource lifecycles.

## Templates

| Template               | Use it for                                                  | Current state                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `basic-react-tailwind` | First app, React 19, Tailwind 4, Vite, one window           | Best starting point                      |
| `todo-sqlite`          | Bridge-crossing todo flow and storage-oriented verification | Active first-party verification material |
| `multi-window`         | Multi-window and cluster coordination shape                 | Reserved until cluster support lands     |

Inside this monorepo, templates use `workspace:*` dependencies so framework and template changes stay atomic. Generated apps will use published package versions once npm publication is enabled.

## CLI

The current CLI package is [packages/cli](packages/cli). Its implemented commands are:

```bash
bun run desktop doctor
bun run desktop build
bun run desktop package
bun run desktop sign
bun run desktop notarize
bun run desktop publish
bun run desktop check --production
```

There is no `desktop dev` command today. Template development currently runs through Vite with `bun run dev`.

## Repository Map

| Path                                                             | Purpose                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| [crates/host](crates/host)                                       | Rust native host and WebView shell                        |
| [packages/bridge](packages/bridge)                               | Typed contracts, clients, handlers, events, and resources |
| [packages/core](packages/core)                                   | Runtime services and public framework entry point         |
| [packages/native](packages/native)                               | TypeScript-facing native service definitions              |
| [packages/react](packages/react)                                 | React provider and hooks                                  |
| [packages/cli](packages/cli)                                     | Build, package, release, doctor, and validation commands  |
| [packages/create-effect-desktop](packages/create-effect-desktop) | Future `bun create effect-desktop` scaffolder             |
| [templates/basic-react-tailwind](templates/basic-react-tailwind) | Safest first-party starter template                       |
| [docs/SPEC.md](docs/SPEC.md)                                     | Normative framework specification                         |

## Documentation

- [docs/SPEC.md](docs/SPEC.md) defines the framework behavior and milestone order.
- Package READMEs describe implemented package surfaces.
- Milestone reports under [docs/milestones](docs/milestones) record completed phase work.
- [CONTRIBUTING.md](CONTRIBUTING.md) describes contribution expectations.
- [SECURITY.md](SECURITY.md) describes private security reporting.

## License

Effect Desktop is provided by Rika Labs, LLC under either the MIT license or the Apache License 2.0, at your option. See [LICENSE](LICENSE), [LICENSE-MIT](LICENSE-MIT), and [LICENSE-APACHE](LICENSE-APACHE).
