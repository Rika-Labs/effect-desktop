# Effect Desktop

Effect Desktop is a pre-1.0 desktop framework for building local-first apps with a
Rust shell, a Bun runtime, React renderers, and Effect services.

```txt
Rust owns the shell.
Bun owns the runtime.
React owns the UI.
Effect owns correctness.
```

The source of truth is [`docs/SPEC.md`](docs/SPEC.md). This README is the short
path for understanding the repo and getting something running.

## Status

Effect Desktop is not a stable public framework yet.

- Public APIs are still changing.
- `bun create effect-desktop` is implemented in this repo, but the package is not
  ready to treat as a stable published installer.
- The current desktop CLI exposes `build`, `package`, `sign`, `notarize`,
  `publish`, `doctor`, and `check`.
- The target v1 developer loop includes `bun desktop dev`, but that command is
  not implemented in the current CLI.

Use the checked-in templates and package READMEs for the current runnable
surface. Use the spec for required v1 behavior.

## What It Is

Effect Desktop is for desktop apps that need typed native capabilities instead
of raw renderer access to the machine.

The framework provides:

- a Rust host for windows, WebViews, app protocol handling, and platform work;
- a Bun runtime for TypeScript application services;
- typed bridge contracts between renderer code and runtime services;
- Effect services for native APIs, permissions, resources, jobs, audit, and
  telemetry;
- React hooks and providers for renderer code;
- CLI gates for build, packaging, signing, publishing, diagnostics, and release
  checks.

The core rule is simple: privileged work crosses named, typed services. The
renderer does not get broad filesystem, process, secret, shell, or host access.

## Get Started In This Repo

Install the pinned toolchain dependencies:

```bash
bun install --frozen-lockfile
```

Run the basic React renderer template:

```bash
cd templates/basic-react-tailwind
bun run dev
```

In another terminal, run the template checks:

```bash
cd templates/basic-react-tailwind
bun run typecheck
bun test
```

From the repo root, inspect the current desktop CLI:

```bash
bun run desktop --help
bun run desktop doctor --config apps/playground/desktop.config.ts
```

The `templates/basic-react-tailwind` app is the smallest working renderer
surface. It demonstrates `DesktopProvider`, a typed `Window.create` Effect value,
Tailwind through Vite, and public `@effect-desktop/*` imports.

## Scaffold A Template Locally

The scaffolder can copy a first-party template from this checkout:

```bash
bun packages/create-effect-desktop/src/bin.ts my-app
cd my-app
```

The generated app reflects the intended published flow, but standalone install
depends on published `@effect-desktop/*` packages. Until the framework is
released, the most reliable path is to work with templates inside this monorepo.

Available templates:

| Template               | Status                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `basic-react-tailwind` | Smallest runnable React and Tailwind renderer template.    |
| `todo-sqlite`          | First-party todo/storage verification template.            |
| `multi-window`         | Reserved for cluster-backed multi-window work; not stable. |

Scaffold options:

```bash
bun packages/create-effect-desktop/src/bin.ts my-app \
  --template basic-react-tailwind \
  --renderer-storage none
```

## Validate The Repo

The full phase gate is:

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

For README-only changes, `bun run format:check` is the tightest automated check.

## Repository Map

| Path                                                               | Purpose                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| [`docs/SPEC.md`](docs/SPEC.md)                                     | Normative v1 framework specification.                  |
| [`crates/host`](crates/host)                                       | Rust native host and WebView shell.                    |
| [`crates/host-protocol`](crates/host-protocol)                     | Shared host protocol fixtures and Rust schemas.        |
| [`packages/bridge`](packages/bridge)                               | Typed contracts, clients, handlers, events, resources. |
| [`packages/core`](packages/core)                                   | Runtime services and public framework primitives.      |
| [`packages/native`](packages/native)                               | TypeScript-facing native services.                     |
| [`packages/react`](packages/react)                                 | Renderer provider and hooks.                           |
| [`packages/cli`](packages/cli)                                     | Build, package, release, doctor, and check commands.   |
| [`packages/create-effect-desktop`](packages/create-effect-desktop) | Template scaffolder.                                   |
| [`packages/devtools`](packages/devtools)                           | Runtime diagnostics projections.                       |
| [`templates/basic-react-tailwind`](templates/basic-react-tailwind) | First-party minimal renderer template.                 |
| [`apps/playground`](apps/playground)                               | Local framework playground.                            |

## Design Rules

- Rust owns shell behavior, not application behavior.
- Application logic belongs in TypeScript and Effect.
- Renderer-callable APIs are typed contracts, not raw IPC.
- Long-lived resources have an owner and a disposal path.
- Dangerous operations are permissioned and auditable.
- Errors are typed data, not swallowed exceptions.

## Project Links

- [`docs/SPEC.md`](docs/SPEC.md): source of truth for v1 behavior.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): contribution expectations.
- [`AGENTS.md`](AGENTS.md): repo-local implementation rules.
- [`SECURITY.md`](SECURITY.md): private vulnerability reporting.
- [`LICENSE`](LICENSE): MIT or Apache-2.0, at your option.
