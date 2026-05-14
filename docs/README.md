---
title: Effect Desktop documentation
description: Build local-first desktop apps with a Rust host, a Bun runtime, and Effect services at every privileged boundary.
kind: index
audience: app-developers
effect_version: 4
---

# Effect Desktop documentation

Effect Desktop is a desktop application framework with three process boundaries — a **Rust host** that owns the native shell, a **Bun runtime** that owns application services, and a **renderer** (React, Solid, Vue, or your own) that owns UI. Every privileged operation crosses a typed Effect service. Permissions are deny-by-default. Resources are scoped. Failures are tagged.

> **Pre-v1.** Public APIs are stable in shape but not in version. Workspace packages are `private: true` and not yet published to npm — develop against this repository directly.

## Pick your path

This site is organized as **[Diátaxis](https://diataxis.fr/)**: four quadrants for four kinds of need.

|                           | Practical                                                 | Theoretical                                                  |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| **Learning** (study)      | [Tutorials →](tutorials/) — guided walkthroughs            | [Explanation →](explanation/) — why the framework looks the way it does |
| **Working** (apply)       | [How-to guides →](how-to/) — recipes for specific tasks    | [Reference →](reference/) — every public symbol, looked up   |

If you have never opened the framework before, **start here**: [Install](start/install.md) → [Build your first app in 5 minutes](start/first-app.md) → [Where to go next](start/next-steps.md).

## Tutorials — learn by building

Long, narrative walkthroughs. You'll end with something running.

- [01 — Build a notes app](tutorials/01-build-a-notes-app.md) (settings, RPC, React)
- [02 — Add a second window](tutorials/02-add-a-second-window.md) (multi-window state, restoration)
- [03 — Stream from the runtime](tutorials/03-stream-from-the-runtime.md) (long-running jobs, cancellation)
- [04 — Package, sign, and ship](tutorials/04-package-and-sign.md) (build → sign → notarize → publish)

## How-to guides — solve a specific problem

Short, task-oriented recipes. Assume you know the basics.

**App composition**
- [Define an RPC surface](how-to/define-an-rpc-surface.md)
- [Add a window](how-to/add-a-window.md)
- [Integrate native services](how-to/integrate-native-services.md)

**State and storage**
- [Persist settings](how-to/persist-settings.md)
- [Store secrets safely](how-to/store-secrets.md)
- [Use SQLite](how-to/use-sqlite.md)
- [Read and write files](how-to/read-write-files.md)

**Long-lived work**
- [Spawn a worker](how-to/spawn-a-worker.md)
- [Run a child process](how-to/run-a-child-process.md)
- [Open a PTY](how-to/open-a-pty.md)
- [Schedule background jobs](how-to/schedule-background-jobs.md)

**Permissions and observability**
- [Declare a permission](how-to/declare-a-permission.md)
- [Handle an approval prompt](how-to/handle-an-approval-prompt.md)
- [Add telemetry and logs](how-to/add-telemetry-and-logs.md)

**Testing**
- [Write a test with layers](how-to/write-a-test-with-layers.md)
- [Inject a mock host and bridge](how-to/inject-mock-host-and-bridge.md)

**Release**
- [Package for macOS](how-to/package-for-macos.md)
- [Sign and notarize](how-to/sign-and-notarize.md)
- [Ship an update](how-to/ship-an-update.md)
- [Diagnose with `desktop doctor`](how-to/diagnose-with-doctor.md)

## Reference — look up an API

Information-oriented. Each page lists the contract, layers, errors, and a minimal example.

- [`Desktop` API](reference/desktop-api.md) — `make`, `manifest`, `app`, `Rpc.surface`
- [Configuration](reference/config.md) — `defineDesktopConfig`, schema
- [CLI commands](reference/cli.md) — `check`, `build`, `package`, `sign`, …
- [Runtime services](reference/services/) — Permission, Resource, Settings, Secrets, …
- [Native RPC groups](reference/native/) — Window, Clipboard, Dialog, Menu, …
- [React hooks](reference/react/) — `useDesktop`, `useMutation`, `useDesktopStream`, …
- [Bridge protocol](reference/bridge/) — envelopes, framing, redaction
- [Test layers](reference/test/) — headless runtime, mock host, mock bridge
- [Devtools](reference/devtools.md) — inspector panels and snapshots
- [Renderer storage (browser)](reference/platform-browser.md) — IndexedDB, SQLite WASM, PGlite
- [Errors catalog](reference/errors.md) — every typed failure

## Explanation — understand the design

Essays on why the framework is shaped the way it is.

- [Architecture overview](explanation/architecture.md) — three process roles
- [The boundary rule](explanation/boundary-rule.md) — why renderers never get raw native authority
- [Permissions model](explanation/permissions-model.md) — deny-by-default, decision order, audit
- [Layer-first design](explanation/layer-first-design.md) — how services compose
- [RPC surface vs. mapped surface](explanation/rpc-surface-vs-mapped.md)
- [Resource lifecycle](explanation/resource-lifecycle.md) — scopes, ownership, cleanup
- [Audit and redaction](explanation/audit-and-redaction.md)
- [Testability](explanation/testability.md)
- [Effect-first philosophy](explanation/effect-first-philosophy.md) — why thin wrappers are debt

## Contributing to the framework

- [Updating the docs](contributing/docs.md)
- [Architecture-debt sweep](contributing/architecture-debt.md)
- [Contribution guide](contribution-guide.md)
- See also [`AGENTS.md`](../AGENTS.md) at the repo root for the day-to-day rules

## Operating the framework as it stands today

Concrete pages anchored to the repository's current state. These pages back the `desktop check --docs` release gate.

- [Installation](installation.md) · [Quickstart](quickstart.md) · [Concepts](concepts.md)
- [Architecture overview](architecture-overview.md) · [App config](app-config.md)
- [Windows](windows.md) · [Typed APIs](typed-apis.md) · [Bridge](bridge.md)
- [Native services](native-services.md) · [Permissions](permissions.md)
- [Resources](resources.md) · [Processes](processes.md) · [PTYs](ptys.md)
- [Filesystem](filesystem.md) · [Storage](storage.md) · [Commands](commands.md)
- [Devtools](devtools.md) · [Testing](testing.md)
- [Packaging](packaging.md) · [Signing](signing.md) · [Updating](updating.md)
- [Troubleshooting](troubleshooting.md) · [Contribution guide](contribution-guide.md)

## For LLMs and AI agents

Read [`llms.txt`](llms.txt) at the docs root, or [`/llms.txt`](../llms.txt) at the repo root. It links to the markdown sources of every page in this site so agents can navigate without HTML.
