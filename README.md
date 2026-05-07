# Effect Desktop

Effect Desktop is a Bun-powered, Rust-hosted, React-friendly desktop framework where native desktop capabilities, renderer communication, long-running resources, permissions, worker processes, and runtime observability are modeled through Effect.

```txt
Rust owns the shell.
Bun owns the runtime.
React owns the UI.
Effect owns correctness.
```

The build specification is the source of truth: [`docs/SPEC.md`](docs/SPEC.md).

## Status

Pre-v1.0.0. Public APIs are not yet stable, and milestone work is tracked against `docs/SPEC.md` §24. The current tree contains typed host protocol schemas, bridge contracts, native service definitions, React renderer hooks, runtime services, devtools projections, packaging/release gates, a Rust host, and a basic React + Tailwind template.

## Open Source

Effect Desktop is published by Rika Labs, LLC under either the MIT license or the Apache License 2.0, at your option. See [`LICENSE`](LICENSE), [`LICENSE-MIT`](LICENSE-MIT), and [`LICENSE-APACHE`](LICENSE-APACHE).

Security issues should be reported privately. See [`SECURITY.md`](SECURITY.md).

Contribution expectations are documented in [`CONTRIBUTING.md`](CONTRIBUTING.md), with repository-specific implementation rules in [`AGENTS.md`](AGENTS.md).

Use this README as a tour of the intended developer experience and the implemented slices. Use `docs/SPEC.md` for normative behavior, milestone order, and release criteria.

## What It Is

Effect Desktop is for local-first desktop applications that need more than a WebView wrapper:

- a Rust host for windows, WebViews, app protocol handling, and native platform adapters;
- a Bun runtime for TypeScript application services;
- a generated typed bridge between renderer code and runtime services;
- Effect services, schemas, layers, streams, resources, and typed failures at authority boundaries;
- React integration that keeps renderer code ordinary while making privileged operations explicit;
- permission, approval, audit, telemetry, devtools, packaging, signing, and update primitives.

The framework does not put application logic in Rust, expose raw native authority to the renderer, or make long-lived resources ambient. Privileged work crosses named services and returns typed data, streams, resource handles, or typed errors.

## Repository Map

| Path                                                               | Purpose                                                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`crates/host`](crates/host)                                       | Rust native host and WebView shell.                                                                                                                              |
| [`crates/host-protocol`](crates/host-protocol)                     | Shared host protocol fixtures and Rust schemas.                                                                                                                  |
| [`packages/bridge`](packages/bridge)                               | Typed contracts, clients, handlers, events, streams, resources, redaction, and host protocol mirrors.                                                            |
| [`packages/core`](packages/core)                                   | Public framework entry point plus runtime services such as filesystem, processes, jobs, workers, settings, SQLite, permissions, audit, telemetry, and resources. |
| [`packages/native`](packages/native)                               | TypeScript-facing native services backed by host calls.                                                                                                          |
| [`packages/react`](packages/react)                                 | Renderer provider and hooks for desktop clients, windows, streams, resources, and permissions.                                                                   |
| [`packages/cli`](packages/cli)                                     | Build, package, signing, release, doctor, and reproducibility gates.                                                                                             |
| [`packages/devtools`](packages/devtools)                           | Runtime diagnostics panels and shell projections.                                                                                                                |
| [`templates/basic-react-tailwind`](templates/basic-react-tailwind) | First-party renderer template.                                                                                                                                   |
| [`apps/playground`](apps/playground)                               | Local playground app used while framework slices land.                                                                                                           |

## Quick Start

From this repository:

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

The v1.0.0 target developer flow is:

```bash
bun create effect-desktop my-app
cd my-app
bun desktop dev
bun desktop package
```

That create/package flow is still pre-release. For current runnable code, start with the template and package READMEs.

## Effect Desktop In Action

### 1. Describe A Desktop App

The template keeps app metadata, windows, and permissions in plain configuration:

```ts
export default {
  app: {
    id: "dev.effect-desktop.basic-react-tailwind",
    name: "Basic React Tailwind"
  },
  windows: [
    {
      id: "main",
      title: "Basic React Tailwind",
      width: 960,
      height: 640
    }
  ],
  permissions: []
} as const
```

The v1.0.0 shape is intentionally small: configuration declares identity and capability posture; Effect services own behavior.

### 2. Call Native Services From React Without Raw IPC

Renderer code receives a typed desktop client from React context. Missing provider state is explicit through `Option`, and native calls are still Effect values:

```tsx
import type { WindowCreateOptions } from "@effect-desktop/native"
import { useDesktop, useWindow } from "@effect-desktop/react"
import { Effect, Exit, Option } from "effect"
import { useState } from "react"

const windowRequest: WindowCreateOptions = {
  title: "Inspector",
  width: 960,
  height: 640
}

export function Toolbar() {
  const desktop = useDesktop()
  const currentWindow = useWindow()
  const [message, setMessage] = useState("Ready.")

  const openInspector = () => {
    if (Option.isNone(desktop)) {
      setMessage("Desktop runtime is unavailable.")
      return
    }

    void Effect.runPromiseExit(desktop.value.Window.create(windowRequest)).then((exit) => {
      if (Exit.isSuccess(exit)) {
        setMessage(`Opened ${exit.value.id}.`)
        return
      }

      setMessage(String(exit.cause))
    })
  }

  return (
    <button disabled={Option.isNone(currentWindow)} type="button" onClick={openInspector}>
      Open inspector
    </button>
  )
}
```

The renderer asks for a window through the generated client. It does not receive raw host transport, filesystem, process, secret, or native shell access.

### 3. Use A Native Service As An Effect Dependency

Runtime code depends on native capabilities as services. Tests can substitute the service layer; live adapters bind the service to host protocol calls.

```ts
import { Window } from "@effect-desktop/native"
import { Effect } from "effect"

export const openMainWindow = Effect.gen(function* () {
  const window = yield* Window

  return yield* window.create({
    title: "Effect Desktop",
    width: 1200,
    height: 800
  })
})
```

This is the core pattern: application logic is TypeScript + Effect, native behavior is a service boundary, and the Rust host stays a shell primitive.

### 4. Define A Typed Bridge Contract

Bridge contracts describe renderer-callable methods with schemas, metadata, and typed handler/client generation.

```ts
import { Api } from "@effect-desktop/bridge"
import { Effect, Schema } from "effect"

class ProjectOpenInput extends Schema.Class<ProjectOpenInput>("ProjectOpenInput")({
  path: Schema.String
}) {}

class ProjectOpenOutput extends Schema.Class<ProjectOpenOutput>("ProjectOpenOutput")({
  id: Schema.String,
  name: Schema.String
}) {}

export const registerProjectApi = Effect.gen(function* () {
  return yield* Api.Tag("Project")<unknown>()({
    open: {
      input: ProjectOpenInput,
      output: ProjectOpenOutput,
      error: Schema.Never,
      permission: "project:open"
    }
  })
})
```

The contract is the authority boundary. Inputs and outputs are decoded, privileged methods carry capability metadata, and callers receive typed failures instead of ad hoc transport exceptions.

### 5. Guard Privileged Runtime Work

The permission registry is deny-by-default. It records declarations, grants, denials, expiry, one-time use, revocation, and audit events.

```ts
import { Effect } from "effect"
import { PermissionActor, PermissionContext, PermissionRegistry } from "@effect-desktop/core"

export const readProjectFile = Effect.gen(function* () {
  const permissions = yield* PermissionRegistry
  const capability = {
    kind: "filesystem.read",
    roots: ["/workspace"],
    audit: "always"
  } as const
  const actor = new PermissionActor({ kind: "window", id: "main" })

  yield* permissions.declare(capability, { source: "desktop.config.ts" })

  const grant = yield* permissions.check(
    capability,
    new PermissionContext({
      actor,
      resource: "/workspace/README.md",
      traceId: "trace-read-project-file"
    })
  )

  return yield* permissions.use(
    grant,
    Effect.sync(() => "privileged read happens behind the grant")
  )
})
```

The exact capability shapes are owned by the runtime services, but the rule is stable: permission checks happen before adapter activity, and failures are typed Effect values.

### 6. Scope Long-Lived Work

Runtime services register long-lived resources under owner scopes so shutdown, cancellation, and renderer disconnects have observable cleanup behavior.

```ts
import { Job, ResourceRegistry } from "@effect-desktop/core"
import { Effect, Schema } from "effect"

class Progress extends Schema.Class<Progress>("Progress")({
  completed: Schema.Number,
  total: Schema.Number
}) {}

export const importProject = Effect.gen(function* () {
  const resources = yield* ResourceRegistry
  const jobs = yield* Job

  yield* resources.declareScope("window:main", "app")

  return yield* jobs.run({
    ownerScope: "window:main",
    progressSchema: Progress,
    effect: Effect.succeed("done")
  })
})
```

Jobs, workers, processes, PTYs, database connections, file watchers, streams, windows, and WebViews follow the same principle: the owner scope is explicit, and cleanup is part of the contract.

## Design Laws

- Rust owns shell behavior, not application behavior.
- The renderer never gets broad native authority by default.
- Every renderer-callable API is typed and generated from a contract.
- Every long-lived object has an owner, state, and disposal path.
- Dangerous operations are permissioned and auditable.
- Errors are data, not swallowed exceptions.
- Devtools observe runtime state from the owning service, not a panel-side cache.

## Validation Gate

Before a phase is complete, the repo-local gate is:

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

For docs-only README changes, `bun run format:check` is the tightest automated check that exercises the edited file.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) is normative.
- Package READMEs describe the currently implemented public surface.
- Milestone reports under `docs/milestones/` record completed phase work.
- ADRs under `docs/decisions/` record dependency and architecture decisions.
