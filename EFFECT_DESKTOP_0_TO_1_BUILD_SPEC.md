# Effect Desktop v1.0.0 - 0-to-1 Framework Build Specification

**Document type:** Agent-executable product, architecture, implementation, and verification specification  
**Audience:** framework maintainers, implementation agents, technical leads, contributors, QA, release engineering  
**Status:** Draft specification for v1.0.0  
**Generated:** 2026-05-03  
**Primary artifact:** `EFFECT_DESKTOP_0_TO_1_BUILD_SPEC.md`  

This document is the source-of-truth build specification for Effect Desktop v1.0.0. It is intentionally detailed. It is not a marketing document, not a short product brief, and not a loose roadmap. An implementation agent should be able to read this specification, work through the milestones in order, run the validation gates, and produce a production-grade framework.

The specification is strictly focused on the framework. It does not define any particular end-user product. It does not include application-specific packages. It defines the platform primitives, build system, native shell, runtime, bridge, permissions, observability, tests, release gates, and documentation required for a mature desktop framework.

## Contents

- 0. Executive Specification Summary
- 1. Product Constitution
- 2. Decision-Making Hierarchy
- 3. Scope and Non-Goals
- 4. Technology Stack
- 5. Monorepo Architecture
- 6. Package Architecture
- 7. Rust Crate Architecture
- 8. System Architecture
- 9. Host Protocol
- 10. Typed Bridge Architecture
- 11. Native Primitive Requirements
- 12. Runtime Primitive Requirements
- 13. Resource Model
- 14. Permissions and Security
- 15. CLI Specification
- 16. Configuration Specification
- 17. Templates and Examples
- 18. Public API Requirements
- 19. Developer Experience Requirements
- 20. Verification Requirements
- 21. Performance Requirements
- 22. Observability and Devtools
- 23. Packaging, Signing, and Updating
- 24. Implementation Milestones
- 25. v1.0.0 Release Criteria
- 26. Risk Register
- 27. Required Architecture Decision Records
- 28. Implementation Agent Operating Instructions
- Appendix A-J. Templates, sketches, verification matrices, security/performance checklists, glossary, references, module acceptance matrices, documentation plan, and versioning.

## How to read this document

Read this document in order the first time. The early chapters define the product laws and architectural boundaries. Later chapters define package responsibilities, runtime protocols, validation gates, milestones, and release criteria. When implementing, always resolve conflicts according to the decision hierarchy in Chapter 2.

A contributor should treat this document as executable guidance:

1. Identify the active milestone.
2. Read the milestone goal, non-goals, required files, and acceptance criteria.
3. Implement the smallest coherent vertical slice that satisfies the milestone.
4. Run the required validation gate.
5. Fix every failing check before expanding scope.
6. Update examples and documentation for any public behavior.
7. Avoid introducing concepts that are explicitly listed as non-goals.

The document is intentionally repetitive in checklists. Repetition is used to reduce ambiguity for automated and human implementers.


\newpage

# 0. Executive Specification Summary

Effect Desktop is a Bun-powered, Rust-hosted, React-friendly desktop framework where native desktop capabilities, renderer communication, long-running resources, permissions, worker processes, and runtime observability are modeled through Effect.

The core formula is:

```txt
Rust owns the shell.
Bun owns the runtime.
React owns the UI.
Effect owns correctness.
```

The framework must make it straightforward to build complex, local-first desktop applications while keeping the public developer experience simple. The core developer should write React for the renderer, TypeScript plus Effect for application services, and minimal configuration for native desktop behavior. The native host should be powerful but mostly invisible.

The v1.0.0 release must include:

- A monorepo using Bun workspaces and task orchestration.
- A Rust native host using a system WebView stack.
- A Bun runtime process supervised by the native host.
- A generated typed bridge between renderer and runtime.
- Effect-based APIs, services, resources, errors, streams, and layers.
- React and Tailwind templates.
- Cross-platform native primitives for windows, WebViews, dialogs, menus, tray, clipboard, notifications, screen, protocol, safe storage, updater, and paths.
- Runtime primitives for filesystem, process, PTY, workers, jobs, settings, SQLite, event logs, and resources.
- A generic permission and capability system.
- Runtime devtools and telemetry primitives.
- A first-party CLI for development, build, packaging, signing, updating, diagnostics, and release checks.
- Examples that validate framework primitives without becoming product-specific.
- Verification gates that make quality measurable.

The v1.0.0 release must not include compatibility layers for other desktop frameworks, app-specific SDKs, native widget frameworks, cloud product features, billing, marketplace functionality, or vertical packages. The framework must provide composable primitives, not product assumptions.


\newpage

# 1. Product Constitution

## 1.1 North star

Effect Desktop is the simplest type-safe way to build fast, local-first desktop applications using React, Bun, Rust, and Effect.

The framework should feel obvious to a TypeScript developer:

```ts
Desktop.run({
  app: { id: "dev.example.app", name: "Example", version: "1.0.0" },
  windows: [MainWindow],
  layer: AppLive
})
```

The renderer should feel like a normal React application. The backend should feel like an Effect service graph. The native host should feel like a reliable desktop substrate, not a second application language.

## 1.2 Product laws

These laws override local convenience:

1. **No untyped renderer bridge.** Every renderer-callable API must be generated from an Effect API contract.
2. **No renderer-native access by default.** The renderer cannot directly access filesystem, process, native host, secrets, or runtime internals.
3. **No unscoped long-lived resources.** Every window, WebView, file watcher, process, PTY, worker, stream, database, and native resource must have a lifecycle.
4. **No application logic in Rust.** Rust implements native shell behavior and platform bindings. Application behavior belongs in Bun and Effect.
5. **No product-specific packages in core.** Core packages expose desktop primitives, not assumptions about what applications are being built.
6. **No broad native binding surface for users.** Native functionality is provided through typed services and host protocol messages.
7. **No compatibility-first design.** The framework should be clean, modern, and coherent rather than shaped around compatibility with older APIs.
8. **No hidden dangerous operations.** Filesystem writes, process execution, secret access, network host access, native script execution, update installation, and external opening must be permissioned.
9. **No invisible work.** Long-running operations must be observable in devtools and traceable in logs.
10. **No packaging afterthought.** Development, build, package, sign, notarize, publish, and update are framework responsibilities.
11. **No leaking implementation complexity.** The app author should not need to understand native event loops, WebView quirks, host protocol framing, or platform packaging internals to build a basic app.
12. **No premature extensibility sprawl.** Add public extension points only when a concrete v1.0.0 requirement needs them.

## 1.3 Simplicity contract

A new user should be able to create, run, and package a basic app with:

```bash
bun create effect-desktop my-app
cd my-app
bun desktop dev
bun desktop package
```

A serious user should be able to build complex desktop systems by composing primitives:

- windows and WebViews;
- typed APIs and generated clients;
- streams and resource handles;
- processes and PTYs;
- workers and jobs;
- storage and event logs;
- permissions and approvals;
- tracing, metrics, and devtools.

## 1.4 Framework identity

Effect Desktop is not a native widget toolkit. It is not a browser. It is not a cloud platform. It is not a general operating system automation framework. It is a desktop application framework where:

- the UI is web-rendered;
- the runtime is TypeScript on Bun;
- the native shell is Rust;
- cross-boundary communication is generated and typed;
- resources are scoped;
- effects, streams, services, and errors are explicit.


\newpage

# 2. Decision-Making Hierarchy

When a contributor or implementation agent faces competing choices, resolve them in this order:

1. **Correctness and safety.** Unsafe behavior, resource leaks, privilege bypasses, or unverifiable code must be rejected.
2. **Framework coherence.** The design must preserve the core formula: Rust shell, Bun runtime, React UI, Effect correctness.
3. **Type safety.** Prefer compile-time and schema-enforced safety over dynamic runtime conventions.
4. **Simplicity of mental model.** Avoid features that make the framework harder to understand unless they are required for v1.0.0 maturity.
5. **Runtime performance.** The default path should be fast; avoid unnecessary process hops, expensive serialization, eager initialization, and bloated renderer bundles.
6. **Developer experience.** APIs should be easy to discover, autocomplete, test, and debug.
7. **Cross-platform consistency.** Platform differences should be normalized where possible and explicitly documented where not possible.
8. **Extensibility.** Extension points should be generic and capability-scoped.
9. **Native polish.** Native behaviors should feel correct on each platform, but not at the cost of the laws above.
10. **Backward compatibility.** Before v1.0.0, breaking changes are allowed when they improve the architecture. At v1.0.0, compatibility becomes a release discipline.

## 2.1 Tie-breaking examples

- If a faster native implementation requires unstable unsafe memory sharing, choose the safer protocol and optimize later.
- If a convenient renderer API bypasses typed contracts, reject it.
- If a feature requires Rust application logic, move the behavior to Bun and keep Rust as a shell primitive.
- If a native feature works on one platform but cannot be made consistent, hide it behind a capability with platform guards and documented behavior.
- If an app-specific abstraction seems attractive, replace it with a generic primitive that applications can compose.
- If a broad API surface makes v1.0.0 take longer and does not unlock a required primitive, defer it.

## 2.2 Decision review checklist

Before accepting a design decision, answer:

- Does it preserve the product laws?
- Does it create a stable public API or an implementation detail?
- Does it introduce application-specific vocabulary?
- Can it be validated by tests?
- Can it be observed in devtools?
- Can it fail safely?
- Can it be disabled or permissioned?
- Does it work across target platforms?
- Is it the smallest design that satisfies the requirement?
- Is there a clear migration path if the design changes before v1.0.0?


\newpage

# 3. Scope and Non-Goals

## 3.1 In scope for v1.0.0

Effect Desktop v1.0.0 includes the framework substrate required for production desktop applications:

- monorepo tooling;
- Rust native host;
- Bun runtime process;
- React and Tailwind templates;
- generated bridge;
- native desktop services;
- runtime resources;
- processes and PTYs;
- filesystem and watchers;
- storage, settings, secrets, and event logs;
- permissions and capabilities;
- commands, menus, shortcuts, and approvals;
- devtools and observability;
- testing harness;
- packaging, signing, and updating;
- documentation and examples.

## 3.2 Out of scope for v1.0.0

Effect Desktop v1.0.0 will not include:

- compatibility APIs for other desktop frameworks;
- a Chromium provider by default;
- native widget components;
- mobile support;
- marketplace infrastructure;
- billing or account management;
- cloud-hosted product services;
- product-specific SDK packages;
- model provider abstractions;
- code editor packages;
- terminal frontend packages;
- source-control product abstractions;
- domain-specific indexing packages;
- application templates that define a complete vertical product;
- remote collaboration services;
- database-specific client frameworks;
- design tool primitives;
- notebook systems;
- workflow-builder primitives;
- specialized protocol packages beyond generic transports.

## 3.3 Allowed examples

Examples are allowed only when they validate framework primitives. Example applications must remain generic and must not become product strategy. Valid examples include:

- `basic-react-tailwind`;
- `multi-window`;
- `native-services`;
- `streams`;
- `process-pty`;
- `permissions`;
- `local-first`;
- `heavy-workbench`.

The examples exist to prove that the framework can support demanding applications. They must not introduce public APIs that only make sense for one application category.

## 3.4 Boundary test

When considering a feature, ask:

> Would two unrelated desktop applications both benefit from this primitive?

If yes, it may belong in the framework. If no, it likely belongs in an application, template, plugin, or ecosystem package.


\newpage

# 4. Technology Stack

## 4.1 Stack summary

The v1.0.0 stack is:

| Layer | Required choice | Purpose |
|---|---|---|
| Monorepo package manager | Bun workspaces | Package installation, workspace linking, Bun-first development |
| Task orchestration | Turborepo | Cached and ordered workspace tasks |
| Runtime | Bun | TypeScript runtime, package tooling, filesystem, subprocesses, SQLite |
| Application model | Effect | Services, layers, resource scopes, errors, streams, concurrency |
| Contract validation | Effect Schema | Runtime validation and generated bridge contracts |
| Native host language | Rust | Cross-platform native shell and host process |
| Native window/WebView stack | WRY + TAO | System WebView and native window event loop |
| Renderer | React | Web UI model |
| Styling | Tailwind CSS | Utility-first styling in renderer templates |
| Dev server/build | Vite-compatible pipeline | Fast renderer development and HMR |
| Type checking | TypeScript strict mode | Compile-time correctness |
| Linting | Oxlint | Fast TypeScript linting |
| Formatting | Prettier for TS/MD, rustfmt for Rust | Formatting consistency |
| Rust quality | cargo test, clippy | Native host correctness |
| Testing | bun test, cargo test, integration harness | Unit and integration validation |
| Packaging | first-party CLI | Package, sign, notarize, publish, update |

## 4.2 Bun usage

Bun is used for:

- workspace package management;
- running the TypeScript runtime process;
- running scripts and tests;
- bundling framework packages where appropriate;
- managing application dependencies;
- SQLite through `bun:sqlite`;
- child processes where TypeScript orchestration is sufficient;
- developer commands through the CLI.

Bun must not be used to bypass the native host for windowing. Bun does not own native event loops or WebViews in this architecture.

## 4.3 Rust usage

Rust is used for:

- native host binary;
- window creation;
- WebView creation and lifecycle;
- native menus;
- dialogs;
- tray;
- clipboard;
- notifications;
- platform-specific paths;
- safe storage integration;
- updater hooks;
- crash reporting hooks;
- low-level PTY or process integration where required.

Rust must not own app logic, domain logic, renderer state, business workflows, storage schemas beyond host state, or public application service contracts.

## 4.4 Effect usage

Effect is used for:

- service dependency graph;
- long-lived resource management;
- typed errors;
- stream processing;
- concurrency control;
- worker supervision;
- retry and scheduling policies;
- logging, tracing, and metrics;
- test layers and mocks;
- API contracts with generated bridge clients.

Every runtime primitive should have an Effect-facing interface. Even when the underlying operation is implemented by Bun or Rust, the app author should consume it as an Effect service or generated client.

## 4.5 Renderer usage

The renderer is ordinary web code. v1.0.0 officially supports React and Tailwind templates. The framework should not prevent other UI libraries, but v1.0.0 documentation and examples focus on React and Tailwind.

Renderer rules:

- no direct native access;
- no direct Bun runtime access;
- no raw host protocol access;
- only generated desktop clients for privileged operations;
- external navigation goes through the Shell service;
- local assets are loaded through the app protocol;
- dev mode supports hot reload;
- production mode enforces content security policy.

## 4.6 Native bindings policy

The native boundary for v1.0.0 is a host protocol, not a broad native binding API.

Allowed:

- Rust host protocol messages;
- Node-API modules for narrow hot paths when justified;
- native libraries hidden behind framework services;
- platform-specific Rust modules inside the host crate.

Not allowed as v1.0.0 foundation:

- a public native binding API for application authors;
- direct Bun FFI as a required production dependency;
- renderer access to native bindings;
- app-defined unsafe native calls;
- Rust application services that bypass Effect contracts.

## 4.7 Third-party dependency rules

A dependency may be added only when:

- it solves a required v1.0.0 problem;
- it is actively maintained or stable enough for production use;
- its license is compatible with the framework;
- its API can be wrapped behind framework boundaries;
- it does not force app-specific vocabulary into core;
- it has a testable integration path.

Every added dependency must be recorded in `docs/decisions` or in the relevant package README if it becomes part of the public design.


\newpage

# 5. Monorepo Architecture

## 5.1 Monorepo requirement

Effect Desktop must be built as a monorepo. The framework has tightly coupled packages, native crates, examples, templates, docs, and validation tooling. A single repository prevents version drift while v1.0.0 is being developed.

The monorepo provides:

- one lockfile;
- one workspace dependency graph;
- one source of truth for docs and decisions;
- one validation pipeline;
- one release process;
- one place for examples and templates;
- easier cross-package refactors;
- better agent execution context.

## 5.2 Root structure

```txt
effect-desktop/
  apps/
    playground/
    docs/
    examples/
      basic-react-tailwind/
      multi-window/
      native-services/
      streams/
      process-pty/
      permissions/
      local-first/
      heavy-workbench/

  packages/
    core/
    bridge/
    native/
    react/
    cli/
    devtools/
    test/
    config/
    create-effect-desktop/

  crates/
    host/
    host-protocol/
    native-pty/
    native-updater/

  templates/
    basic-react-tailwind/
    local-first/
    multi-window/
    heavy-workbench/

  docs/
    EFFECT_DESKTOP_0_TO_1_BUILD_SPEC.md
    architecture/
    decisions/
    milestones/
    validation/

  scripts/
    build.ts
    check.ts
    package.ts
    release.ts
    doctor.ts

  package.json
  bun.lock
  turbo.json
  tsconfig.base.json
  oxlint.json
  Cargo.toml
  rust-toolchain.toml
```

## 5.3 Workspace package rules

- Public packages live under `packages/`.
- Examples live under `apps/examples/` and must use the public APIs.
- Internal scripts live under `scripts/` and must not be imported by applications.
- Rust crates live under `crates/`.
- Templates live under `templates/` and are copied by `create-effect-desktop`.
- Generated files must be explicitly marked and should not be hand-edited.
- Package boundaries must be enforced by TypeScript path rules and lint rules.
- Application examples must not import private internals.

## 5.4 Root package.json requirements

The root `package.json` must declare Bun workspaces and shared scripts.

```json
{
  "name": "effect-desktop-repo",
  "private": true,
  "packageManager": "bun@latest",
  "workspaces": [
    "apps/*",
    "apps/examples/*",
    "packages/*",
    "templates/*"
  ],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "check": "turbo check",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "lint": "turbo lint",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "cargo:check": "cargo check --workspace",
    "cargo:test": "cargo test --workspace",
    "cargo:clippy": "cargo clippy --workspace --all-targets -- -D warnings",
    "cargo:fmt": "cargo fmt --check"
  }
}
```

## 5.5 Turborepo requirements

`turbo.json` must define cacheable package tasks and persistent dev tasks.

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "target/**"]
    },
    "check": {
      "dependsOn": ["^check"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

## 5.6 Cargo workspace requirements

The root `Cargo.toml` must define a Cargo workspace for native crates.

```toml
[workspace]
members = [
  "crates/host",
  "crates/host-protocol",
  "crates/native-pty",
  "crates/native-updater"
]
resolver = "2"

[workspace.package]
edition = "2021"
license = "MIT OR Apache-2.0"
repository = "https://example.invalid/effect-desktop"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
```

## 5.7 Repository boundaries

Do not let packages import via deep relative paths across package boundaries. Use package exports. Internal files may be imported only within their package.

Allowed:

```ts
import { Desktop } from "@effect-desktop/core"
```

Not allowed:

```ts
import { createHostClient } from "../../bridge/src/internal/createHostClient"
```

Every public symbol must be exported intentionally through package exports.


\newpage

# 6. Package Architecture

The package architecture must stay small and intentional. Packages should be grouped by responsibility rather than by every native primitive. The goal is to make package boundaries meaningful while avoiding package sprawl.

The initial public package set is:

```txt
@effect-desktop/core
@effect-desktop/bridge
@effect-desktop/native
@effect-desktop/react
@effect-desktop/cli
@effect-desktop/devtools
@effect-desktop/test
@effect-desktop/config
create-effect-desktop
```

## 6.1 `packages/core`

**Purpose:** Public framework API and runtime contracts.

### Required exports

- `Desktop.run`
- `Desktop.window`
- `Desktop.Api`
- `Desktop.Resource`
- `Desktop.Command`
- `Desktop.Capability`
- `Desktop.Errors`
- `Desktop.Config`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- Do not depend on React.
- Do not contain Rust host implementation.
- Do not expose raw host protocol.
- Do not expose raw IPC.

## 6.2 `packages/bridge`

**Purpose:** Typed renderer-runtime bridge, code generation, protocol runtime.

### Required exports

- `contract registry`
- `client generation`
- `handler generation`
- `request response`
- `events`
- `streams`
- `resource handles`
- `cancellation`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- No app-specific commands.
- No untyped public invoke.
- No renderer-native shortcuts.

## 6.3 `packages/native`

**Purpose:** TypeScript-facing native services backed by the Rust host.

### Required exports

- `Window`
- `WebView`
- `Dialog`
- `Menu`
- `Tray`
- `Clipboard`
- `Notification`
- `Shell`
- `Screen`
- `Path`
- `SafeStorage`
- `Updater`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- No platform-specific API leaks without guards.
- No app logic.
- No direct FFI.

## 6.4 `packages/react`

**Purpose:** Thin React integration for renderer clients.

### Required exports

- `DesktopProvider`
- `useDesktop`
- `useDesktopStream`
- `usePermission`
- `useWindow`
- `useResource`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- No UI component library.
- No domain-specific widgets.
- No backend logic.

## 6.5 `packages/cli`

**Purpose:** Developer CLI for creation, development, validation, packaging, and release.

### Required exports

- `create`
- `dev`
- `check`
- `build`
- `package`
- `sign`
- `notarize`
- `publish`
- `doctor`
- `inspect`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- No hidden global state.
- No package-manager assumptions beyond Bun for v1.
- No release without validation gates.

## 6.6 `packages/devtools`

**Purpose:** Runtime inspector for framework primitives.

### Required exports

- `windows`
- `bridge calls`
- `streams`
- `resources`
- `permissions`
- `processes`
- `logs`
- `traces`
- `metrics`
- `performance`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- No app-specific panels in core.
- No production data leak.
- No secret display.

## 6.7 `packages/test`

**Purpose:** Test harness and mock layers.

### Required exports

- `mock host`
- `mock bridge`
- `memory filesystem`
- `mock permissions`
- `mock process`
- `mock PTY`
- `headless runtime`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- No dependency on real native windows for unit tests.
- No platform-specific test-only behavior in public APIs.

## 6.8 `packages/config`

**Purpose:** Typed config loader and validator.

### Required exports

- `defineDesktopConfig`
- `config schema`
- `platform config`
- `build config`
- `security config`
- `template config`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- No unvalidated config.
- No implicit dangerous defaults.

## 6.9 `packages/create-effect-desktop`

**Purpose:** Scaffolding command for new applications.

### Required exports

- `template selection`
- `package installation hints`
- `initial config`
- `example API`
- `renderer template`

### Required implementation traits

- APIs must be tree-shakeable where practical.
- Public types must be exported through package exports.
- Internal files must not be imported by examples or applications.
- Package tests must include both success and failure behavior.
- Each package must include a README explaining responsibility, public API, non-goals, and test commands.
- Each package must publish ESM output and TypeScript declarations.
- Each package must avoid cyclic dependencies.

### Verification requirements

- `bun run typecheck` passes for this package.
- `bun test` passes for this package.
- Public exports are covered by a package API snapshot.
- Examples that depend on this package compile.
- No forbidden imports are detected.

### Non-goals

- No full vertical product templates.
- No excessive template choice in v1.


\newpage

# 7. Rust Crate Architecture

Rust crates must be few and deep. The native host should not split every platform feature into a public crate. Internal modules are preferred until a crate boundary is justified by reuse, testing, or platform-specific complexity.

## 7.1 `crates/host`

**Purpose:** Native host binary.

### Responsibilities

- start native event loop.
- create native windows.
- create WebViews.
- launch runtime process.
- route host protocol messages.
- emit native events.
- handle app protocol.
- supervise runtime lifecycle.
### Native crate rules

- Keep public Rust APIs minimal.
- Keep application behavior out of Rust.
- Use strongly typed protocol messages.
- Every platform-specific branch must have a test or documented manual validation path.
- Every operation that can fail must return a structured error.
- Resource cleanup must be deterministic.
- Panics must not cross the host boundary.
- Logs must include operation IDs where relevant.

### Validation

- `cargo check --workspace` passes.
- `cargo test --workspace` passes.
- `cargo clippy --workspace --all-targets -- -D warnings` passes.
- Host protocol compatibility tests pass.
- Platform smoke tests pass on target operating systems.

## 7.2 `crates/host-protocol`

**Purpose:** Shared Rust protocol schema.

### Responsibilities

- host request types.
- host response types.
- runtime event types.
- error types.
- version negotiation.
- serde encoding.
- protocol tests.
### Native crate rules

- Keep public Rust APIs minimal.
- Keep application behavior out of Rust.
- Use strongly typed protocol messages.
- Every platform-specific branch must have a test or documented manual validation path.
- Every operation that can fail must return a structured error.
- Resource cleanup must be deterministic.
- Panics must not cross the host boundary.
- Logs must include operation IDs where relevant.

### Validation

- `cargo check --workspace` passes.
- `cargo test --workspace` passes.
- `cargo clippy --workspace --all-targets -- -D warnings` passes.
- Host protocol compatibility tests pass.
- Platform smoke tests pass on target operating systems.

## 7.3 `crates/native-pty`

**Purpose:** Cross-platform PTY support.

### Responsibilities

- create PTY.
- write bytes.
- resize.
- stream output.
- kill.
- cleanup process tree.
- platform-specific adapters.
### Native crate rules

- Keep public Rust APIs minimal.
- Keep application behavior out of Rust.
- Use strongly typed protocol messages.
- Every platform-specific branch must have a test or documented manual validation path.
- Every operation that can fail must return a structured error.
- Resource cleanup must be deterministic.
- Panics must not cross the host boundary.
- Logs must include operation IDs where relevant.

### Validation

- `cargo check --workspace` passes.
- `cargo test --workspace` passes.
- `cargo clippy --workspace --all-targets -- -D warnings` passes.
- Host protocol compatibility tests pass.
- Platform smoke tests pass on target operating systems.

## 7.4 `crates/native-updater`

**Purpose:** Update integration primitives.

### Responsibilities

- manifest parsing.
- signature verification hooks.
- download progress.
- install staging.
- restart integration.
- rollback metadata.
### Native crate rules

- Keep public Rust APIs minimal.
- Keep application behavior out of Rust.
- Use strongly typed protocol messages.
- Every platform-specific branch must have a test or documented manual validation path.
- Every operation that can fail must return a structured error.
- Resource cleanup must be deterministic.
- Panics must not cross the host boundary.
- Logs must include operation IDs where relevant.

### Validation

- `cargo check --workspace` passes.
- `cargo test --workspace` passes.
- `cargo clippy --workspace --all-targets -- -D warnings` passes.
- Host protocol compatibility tests pass.
- Platform smoke tests pass on target operating systems.


\newpage

# 8. System Architecture

## 8.1 Layered architecture

Effect Desktop uses three primary layers:

```txt
+--------------------------------------+
| React Renderer                       |
| Generated desktop client only        |
+-----------------+--------------------+
                  | typed bridge
+-----------------v--------------------+
| Bun + Effect Runtime                 |
| Services, resources, workers, APIs   |
+-----------------+--------------------+
                  | host protocol
+-----------------v--------------------+
| Rust Native Host                     |
| Windows, WebViews, OS integrations   |
+--------------------------------------+
```

The architecture intentionally separates responsibilities. The native host owns platform integration. The Bun runtime owns application services. The renderer owns UI. The bridge owns safe communication.

## 8.2 Process model

Required v1.0.0 process model:

```txt
effect-desktop-host
  Rust native binary
  Owns native event loop
  Owns native windows and WebViews
  Launches and supervises runtime
  Routes host protocol messages
  Emits native events

effect-desktop-runtime
  Bun process
  Runs Effect application
  Owns service graph
  Owns bridge handlers
  Owns workers, jobs, processes, PTYs
  Talks to host through protocol

renderer:webview:<window-id>
  WebView renderer process
  Runs React application
  Has generated desktop client
  Has no direct native privileges
```

## 8.3 Startup sequence

The startup sequence must be deterministic and observable:

1. CLI launches Rust host in dev or packaged app launches host in production.
2. Host validates native environment and app manifest.
3. Host starts logging and crash handling.
4. Host launches Bun runtime with app config path and host protocol endpoint.
5. Runtime initializes Effect runtime and service graph.
6. Runtime registers API contracts and permissions.
7. Runtime sends `runtime.ready` to host.
8. Host creates initial window.
9. Host loads dev server URL in dev or `app://` route in production.
10. Renderer loads React application.
11. Renderer connects generated bridge client.
12. Runtime and host emit startup performance timeline.

## 8.4 Shutdown sequence

Shutdown must avoid orphaned resources:

1. Host receives app quit request or OS lifecycle event.
2. Host sends `app.shutdown.requested` to runtime.
3. Runtime stops accepting new bridge calls unless marked shutdown-safe.
4. Runtime closes application scopes in dependency order.
5. Runtime terminates file watchers, workers, processes, PTYs, and streams.
6. Runtime flushes logs, traces, metrics, event logs, and storage.
7. Runtime sends `runtime.shutdown.ready` to host.
8. Host closes WebViews and windows.
9. Host exits with appropriate status.

If runtime does not respond within timeout, host must show a controlled failure path and kill the runtime process tree.

## 8.5 Crash behavior

Crash behavior must be explicit:

- Renderer crash: host reports window crash, runtime updates window state, devtools shows crash event, app can reload or close window.
- Runtime crash: host keeps native shell alive, logs crash, optionally restarts in dev, shows production crash surface if configured.
- Host crash: crash reporter captures host state and native logs where possible.
- Worker crash: runtime supervisor applies configured restart policy.
- Process crash: resource handle emits exit event and cleanup runs.
- PTY crash: PTY resource closes and output stream terminates with typed error.

## 8.6 Version negotiation

Host and runtime must negotiate protocol versions at startup.

Required fields:

```ts
type ProtocolHello = {
  protocolVersion: string
  hostVersion: string
  runtimeVersion: string
  appId: string
  appVersion: string
  capabilities: string[]
}
```

If the host and runtime protocol versions are incompatible, startup must fail with a clear error before creating windows.


\newpage

# 9. Host Protocol

## 9.1 Protocol goals

The host protocol connects the Bun runtime to the Rust native host. It must be:

- versioned;
- typed;
- observable;
- cancellable where appropriate;
- able to carry events;
- able to carry binary payloads for hot paths;
- strict about request IDs;
- strict about errors;
- stable enough for v1.0.0 applications.

## 9.2 Initial transport

The initial implementation should use local process communication that is easy to debug. Acceptable transports:

- stdio with framed messages;
- Unix domain socket on macOS/Linux and named pipe on Windows;
- loopback TCP only if needed for development diagnostics.

The v1.0.0 default should be a pipe or socket transport, not raw unframed stdout parsing.

## 9.3 Message envelope

Every protocol message must use an envelope:

```ts
type HostProtocolEnvelope = {
  id?: string
  kind: "request" | "response" | "event" | "stream" | "cancel"
  method?: string
  resourceId?: string
  timestamp: number
  traceId: string
  payload?: unknown
  error?: HostProtocolError
}
```

Rules:

- Requests require `id` and `method`.
- Responses require `id`.
- Events require `method`.
- Stream frames require `resourceId` or `id`.
- Cancel messages require the target request or resource ID.
- Errors must be structured.
- Payloads must be schema-validated by the TypeScript-facing service.

## 9.4 Error envelope

```ts
type HostProtocolError = {
  tag: string
  message: string
  operation: string
  platform?: "macos" | "windows" | "linux"
  code?: string
  cause?: unknown
  recoverable: boolean
}
```

Errors must not be plain strings. Host errors must be mapped to typed runtime errors before crossing to the renderer.

## 9.5 Required host methods

The host protocol must support these method groups by v1.0.0:

```txt
app.*
window.*
webview.*
menu.*
contextMenu.*
tray.*
dialog.*
clipboard.*
notification.*
shell.*
screen.*
globalShortcut.*
protocol.*
safeStorage.*
updater.*
crashReporter.*
powerMonitor.*
```

Each method group must have:

- TypeScript service definition;
- Rust request/response type;
- schema validation;
- success tests;
- error tests;
- devtools event logging;
- documentation.

## 9.6 Protocol compatibility tests

Protocol compatibility tests must verify:

- TypeScript-generated request shape matches Rust deserialization.
- Rust response shape matches TypeScript decoding.
- Unknown methods fail with structured errors.
- Unknown fields are either rejected or ignored according to schema policy.
- Protocol version mismatch is detected.
- Request cancellation is acknowledged.
- Stream close events are delivered.
- Host crash produces recoverable diagnostics where possible.


\newpage

# 10. Typed Bridge Architecture

## 10.1 Bridge purpose

The typed bridge is the core differentiator of the framework. It connects renderer code to runtime services without exposing raw IPC, native access, or unvalidated payloads.

The bridge must generate:

- renderer clients;
- runtime handlers;
- schema validators;
- permission descriptors;
- trace metadata;
- test mocks;
- API documentation metadata.

## 10.2 Bridge law

If renderer code can call it, it came from an Effect API contract.

Allowed renderer code:

```ts
const result = await desktop.project.open({ path })
```

Not allowed as public default:

```ts
await invoke("project.open", { path })
```

A private low-level bridge may exist internally for generated clients, but application authors must not use it directly in production builds.

## 10.3 API contract shape

```ts
export class ProjectApi extends Desktop.Api.Tag("ProjectApi")<ProjectApi>()({
  open: {
    input: Schema.Struct({ path: Schema.String }),
    output: Project,
    error: Schema.Union(
      Desktop.Errors.PermissionDenied,
      Desktop.Errors.FileNotFound
    ),
    permission: "project:open",
    timeout: "30 seconds"
  },

  watch: {
    input: Schema.Struct({ projectId: Schema.String }),
    output: Desktop.Stream(ProjectEvent),
    error: Schema.Union(
      Desktop.Errors.PermissionDenied,
      Desktop.Errors.NotFound
    ),
    permission: "project:watch",
    backpressure: { strategy: "buffer", size: 1024 }
  }
}) {}
```

## 10.4 Required call types

The bridge must support:

- request/response;
- fire-and-forget events;
- runtime-to-renderer events;
- renderer-to-runtime events;
- streams;
- duplex streams;
- binary streams;
- cancelable operations;
- typed resource handles;
- batched operations where safe.

## 10.5 Stream requirements

Streams must support:

- cancellation from renderer;
- cancellation from runtime;
- end-of-stream events;
- structured stream errors;
- backpressure policies;
- devtools visibility;
- binary frames where configured;
- resource cleanup on window close;
- resource cleanup on scope close;
- reconnection policy where explicitly declared.

## 10.6 Resource handle requirements

A resource handle represents a runtime-owned resource referenced by the renderer.

```ts
type ResourceHandle<Name extends string> = {
  id: string
  type: Name
  dispose(): Promise<void>
}
```

Required handle behavior:

- handles are scoped to the creating window unless explicitly shared;
- handles are revoked when permissions are revoked;
- handles are disposed when the owning scope closes;
- handle methods are permission-checked;
- handle events are stream-backed;
- stale handles fail with typed errors;
- devtools can show owner, lifetime, methods, events, and status.

## 10.7 Bridge failure modes

The bridge must gracefully handle:

- runtime unavailable;
- host unavailable;
- renderer disconnected;
- stale resource handle;
- method not registered;
- schema validation failure;
- permission denied;
- timeout;
- canceled call;
- stream closed;
- binary frame decode failure;
- backpressure overflow.

Every failure mode must have a typed error and a test.


\newpage

# 11. Native Primitive Requirements

Native primitives are TypeScript-facing services backed by Rust host operations. Each primitive must have a typed public API, host protocol messages, tests, permission behavior where needed, and documentation.

Native primitives should be boring and predictable. They should not express product behavior. They expose desktop capabilities that applications can compose.

## 11.1 `App`

**Purpose:** Application lifecycle, single instance behavior, app metadata, quit, restart, open events.

### Minimum method surface

- `App.getInfo`
- `App.quit`
- `App.restart`
- `App.setSingleInstance`
- `App.onOpenFile`
- `App.onOpenUrl`
- `App.onBeforeQuit`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.2 `Window`

**Purpose:** Native windows that host routes or WebViews.

### Minimum method surface

- `Window.create`
- `Window.show`
- `Window.hide`
- `Window.focus`
- `Window.close`
- `Window.setTitle`
- `Window.setSize`
- `Window.setPosition`
- `Window.setFullscreen`
- `Window.persistState`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.3 `WebView`

**Purpose:** Embedded web content surface controlled by the native host.

### Minimum method surface

- `WebView.create`
- `WebView.loadRoute`
- `WebView.loadUrl`
- `WebView.reload`
- `WebView.goBack`
- `WebView.goForward`
- `WebView.captureScreenshot`
- `WebView.destroy`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.4 `Menu`

**Purpose:** Application menu and window menu integration.

### Minimum method surface

- `Menu.setApplicationMenu`
- `Menu.setWindowMenu`
- `Menu.clear`
- `Menu.bindCommand`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.5 `ContextMenu`

**Purpose:** Contextual menus associated with renderer or native events.

### Minimum method surface

- `ContextMenu.show`
- `ContextMenu.buildFromTemplate`
- `ContextMenu.bindCommand`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.6 `Tray`

**Purpose:** System tray or status item integration.

### Minimum method surface

- `Tray.create`
- `Tray.setIcon`
- `Tray.setTooltip`
- `Tray.setMenu`
- `Tray.destroy`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.7 `Dialog`

**Purpose:** Native open, save, message, and confirmation dialogs.

### Minimum method surface

- `Dialog.openFile`
- `Dialog.openDirectory`
- `Dialog.saveFile`
- `Dialog.message`
- `Dialog.confirm`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.8 `Clipboard`

**Purpose:** Text and structured clipboard support.

### Minimum method surface

- `Clipboard.readText`
- `Clipboard.writeText`
- `Clipboard.readImage`
- `Clipboard.writeImage`
- `Clipboard.clear`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.9 `Notification`

**Purpose:** Platform notification delivery.

### Minimum method surface

- `Notification.show`
- `Notification.close`
- `Notification.onClick`
- `Notification.isSupported`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.10 `Shell`

**Purpose:** External opening and platform shell actions.

### Minimum method surface

- `Shell.openExternal`
- `Shell.showItemInFolder`
- `Shell.openPath`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.11 `Screen`

**Purpose:** Display enumeration and pointer/screen geometry.

### Minimum method surface

- `Screen.getDisplays`
- `Screen.getPrimaryDisplay`
- `Screen.getPointerPoint`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.12 `GlobalShortcut`

**Purpose:** Application-level keyboard shortcuts.

### Minimum method surface

- `GlobalShortcut.register`
- `GlobalShortcut.unregister`
- `GlobalShortcut.unregisterAll`
- `GlobalShortcut.isRegistered`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.13 `Protocol`

**Purpose:** Custom app protocol for assets and controlled local resources.

### Minimum method surface

- `Protocol.registerAppProtocol`
- `Protocol.serveAsset`
- `Protocol.serveRoute`
- `Protocol.deny`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.14 `SafeStorage`

**Purpose:** Platform-backed secret storage and encryption helpers.

### Minimum method surface

- `SafeStorage.set`
- `SafeStorage.get`
- `SafeStorage.delete`
- `SafeStorage.list`
- `SafeStorage.isAvailable`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.15 `Path`

**Purpose:** Platform-specific app, cache, temp, logs, and data paths.

### Minimum method surface

- `Path.appData`
- `Path.cache`
- `Path.logs`
- `Path.temp`
- `Path.home`
- `Path.downloads`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.16 `Updater`

**Purpose:** Signed update check, download, stage, and restart integration.

### Minimum method surface

- `Updater.check`
- `Updater.download`
- `Updater.install`
- `Updater.installAndRestart`
- `Updater.getStatus`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.17 `CrashReporter`

**Purpose:** Crash capture and diagnostic upload hooks.

### Minimum method surface

- `CrashReporter.start`
- `CrashReporter.recordBreadcrumb`
- `CrashReporter.flush`
- `CrashReporter.setUploadHandler`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.

## 11.18 `PowerMonitor`

**Purpose:** Sleep, wake, resume, suspend, and power events.

### Minimum method surface

- `PowerMonitor.onSuspend`
- `PowerMonitor.onResume`
- `PowerMonitor.onShutdown`
- `PowerMonitor.onPowerSourceChanged`
### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Host protocol messages are defined in TypeScript and Rust.
- All input is schema-validated before crossing the host boundary.
- All output is decoded into typed results.
- Platform errors are mapped to framework errors.
- Permission checks happen before dangerous behavior.
- Every operation emits trace metadata.
- Every long-lived object is registered in the resource registry.
- Cleanup behavior is deterministic and testable.

### Required tests

- success path;
- invalid input;
- host error mapping;
- permission denial where relevant;
- resource cleanup where relevant;
- platform capability unavailable;
- devtools event emission;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Public TypeScript signature.
- Permission requirements.
- Platform differences.
- Failure modes.
- Example usage.
- Testing strategy.


\newpage

# 12. Runtime Primitive Requirements

Runtime primitives are implemented in Bun and Effect. They are the framework's application substrate. Each runtime primitive must be composable, scoped, typed, and observable.

## 12.1 `Filesystem`

**Purpose:** Read, write, atomic write, copy, move, delete, stat, exists, list, walk, watch, normalize paths, enforce path policies.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.2 `Process`

**Purpose:** Spawn, kill, kill tree, stdin, stdout, stderr, exit status, environment, cwd, restart policy, timeout policy.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.3 `PTY`

**Purpose:** Create pseudo-terminal, write, resize, output stream, kill, cleanup, platform terminal integration.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.4 `Worker`

**Purpose:** Run isolated background TypeScript work, supervised by runtime, with bounded concurrency and progress streams.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.5 `Job`

**Purpose:** Represent long-running cancelable tasks with progress, result, timeout, retry, and devtools visibility.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.6 `SQLite`

**Purpose:** Open databases, run migrations, transactions, prepared statements, app and workspace stores.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.7 `Settings`

**Purpose:** Store user, workspace, and app settings with schema validation, defaults, migrations, and change streams.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.8 `Secrets`

**Purpose:** Runtime facade over safe storage, never exposed directly to renderer without a typed API.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.9 `EventLog`

**Purpose:** Append-only event stream for audit, replay, debugging, and recovery.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.10 `Transport`

**Purpose:** JSON-RPC, stdio, socket, HTTP, WebSocket, and stream framing helpers for app-owned protocols.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.11 `CommandRegistry`

**Purpose:** Register typed commands that can be invoked from menus, keybindings, renderer actions, and extensions.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.12 `ApprovalBroker`

**Purpose:** Generic allow/ask/deny flow for dangerous operations with UI mediation and audit output.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.13 `PermissionRegistry`

**Purpose:** Window, resource, workspace, and operation-scoped permission resolution.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.14 `ResourceRegistry`

**Purpose:** Central registry for runtime-owned resources, lifetimes, owners, status, and disposal.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.

## 12.15 `Telemetry`

**Purpose:** Structured logs, traces, metrics, performance spans, crash breadcrumbs, and devtools feeds.

### Required properties

- Exposed through an Effect service or generated bridge API.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available.

### Required documentation

- public API;
- service dependencies;
- examples;
- cleanup behavior;
- permission behavior;
- test examples;
- performance considerations.


\newpage

# 13. Resource Model

## 13.1 Resource definition

A resource is any value that has a lifecycle beyond a single synchronous calculation. Examples include windows, WebViews, file watchers, child processes, PTYs, streams, database connections, workers, protocol sessions, and update downloads.

Every resource must have:

- ID;
- type;
- owner;
- scope;
- status;
- creation timestamp;
- disposal behavior;
- trace context;
- permission context;
- devtools representation.

## 13.2 Resource handle shape

```ts
type DesktopResourceHandle<Type extends string, State extends string> = {
  readonly id: string
  readonly type: Type
  readonly state: State
  dispose(): Effect.Effect<void, DesktopError>
}
```

Specialized handles may add methods:

```ts
type ProcessHandle = DesktopResourceHandle<"process", "running" | "exited"> & {
  stdin: Sink<Uint8Array>
  stdout: Stream<Uint8Array, ProcessError>
  stderr: Stream<Uint8Array, ProcessError>
  kill(signal?: ProcessSignal): Effect.Effect<void, ProcessError>
}
```

## 13.3 Ownership model

Resources can be owned by:

- application scope;
- window scope;
- WebView scope;
- runtime service scope;
- worker scope;
- operation scope;
- extension scope;
- test scope.

When an owner closes, all owned resources must be disposed in dependency order unless explicitly transferred to another scope.

## 13.4 Disposal rules

- Disposal must be idempotent.
- Disposal must emit a devtools event.
- Disposal must remove the resource from the registry.
- Disposal must close streams with a terminal status.
- Disposal must kill process trees where applicable.
- Disposal must not block forever; it must have a timeout.
- Forced disposal must be available after graceful disposal fails.

## 13.5 Resource registry

The resource registry must provide:

```ts
Desktop.Resources.list()
Desktop.Resources.get(id)
Desktop.Resources.dispose(id)
Desktop.Resources.observe()
Desktop.Resources.assertNoLeaks(scope)
```

The registry powers devtools, tests, leak detection, shutdown behavior, and debugging.

## 13.6 Leak detection

The test harness must support leak assertions:

```ts
yield* Desktop.Test.assertNoOpenResources()
```

Leak checks must fail if windows, WebViews, processes, PTYs, file watchers, workers, database handles, or streams remain open at test end.


\newpage

# 14. Permissions and Security

## 14.1 Default security posture

The renderer is unprivileged by default. The renderer cannot:

- read files directly;
- write files directly;
- spawn processes;
- access PTYs;
- read secrets;
- call native host methods directly;
- install updates;
- open arbitrary external URLs without the Shell service;
- access raw bridge internals;
- bypass schema validation.

## 14.2 Capability model

A capability grants a scoped permission to a window, resource, or operation.

```ts
const MainWindow = Desktop.window({ id: "main", route: "/" })
  .allow(ProjectApi)
  .allow(Desktop.Dialog, ["openFile", "openDirectory"])
  .allow(Desktop.Clipboard, ["readText", "writeText"])
```

Capabilities can be broad in development but must be explicit in production. The production checker must warn about broad privileges and fail on forbidden privileges unless explicitly acknowledged by configuration.

## 14.3 Policy shape

```ts
type CapabilityPolicy = {
  filesystem?: {
    read?: string[]
    write?: string[]
    deny?: string[]
    ask?: string[]
  }
  process?: {
    allow?: string[]
    ask?: string[]
    deny?: string[]
  }
  network?: {
    allow?: string[]
    ask?: string[]
    deny?: string[]
    askUnknownHosts?: boolean
  }
  secrets?: {
    allow?: string[]
    ask?: string[]
    deny?: string[]
  }
}
```

## 14.4 Approval broker

Dangerous operations can require approval. The approval broker is generic and does not assume a product domain.

Approval request fields:

```ts
type ApprovalRequest = {
  id: string
  operation: string
  actor: string
  resource?: string
  risk: "low" | "medium" | "high" | "critical"
  summary: string
  details: unknown
  expiresAt?: number
}
```

Approval outcomes:

- approved once;
- approved for scope;
- denied once;
- denied for scope;
- timed out;
- canceled by owner;
- revoked.

## 14.5 Audit events

The framework must emit audit events for:

- permission granted;
- permission denied;
- approval requested;
- approval granted;
- approval denied;
- file read when audited;
- file written;
- file deleted;
- process spawned;
- process killed;
- PTY created;
- secret accessed;
- external URL opened;
- update installed;
- plugin or extension activated if extension support is enabled.

Audit events must be structured and exportable.

## 14.6 Production security checker

`bun desktop check --production` must fail on:

- renderer importing backend modules;
- raw bridge call usage;
- native host protocol access from renderer;
- filesystem write permission without scope;
- process permission without allow/ask/deny policy;
- secret access without audit policy;
- update installation without signature verification;
- app protocol path traversal risk;
- disabled content security policy;
- unsafe external navigation handler;
- unscoped resource creation.


\newpage

# 15. CLI Specification

The CLI is a first-class product surface. It should make development and shipping boring.

## 15.1 Required commands

```bash
bun create effect-desktop <name>
bun desktop dev
bun desktop check
bun desktop build
bun desktop package
bun desktop sign
bun desktop notarize
bun desktop publish
bun desktop doctor
bun desktop inspect
bun desktop replay
```

## 15.2 `bun desktop dev`

Responsibilities:

- load config;
- validate environment;
- build or locate Rust host;
- start renderer dev server;
- start Bun runtime;
- start native host;
- connect logs;
- generate bridge clients;
- watch API contracts;
- support runtime reload;
- support renderer HMR;
- open devtools when configured.

Required output shape:

```txt
Effect Desktop dev
config            loaded
native host       ready
runtime           ready
renderer          ready
bridge            generated
window:main       opened
```

## 15.3 `bun desktop check`

Responsibilities:

- typecheck packages;
- lint code;
- validate config;
- validate bridge contracts;
- validate permissions;
- detect forbidden renderer imports;
- detect raw bridge usage;
- detect unscoped resources;
- run security checks;
- run package boundary checks;
- optionally run production budget checks.

## 15.4 `bun desktop build`

Responsibilities:

- build renderer;
- build runtime;
- compile bridge artifacts;
- build native host;
- embed or stage assets;
- generate app manifest;
- produce build report.

## 15.5 `bun desktop package`

Responsibilities:

- produce platform artifacts;
- include native host;
- include runtime bundle;
- include renderer assets;
- include metadata;
- include update metadata if configured;
- validate package structure.

## 15.6 `bun desktop doctor`

The doctor command must inspect:

- Bun version;
- Rust toolchain;
- platform dependencies;
- WebView runtime availability where applicable;
- signing credentials;
- build tools;
- package manager state;
- native host build cache;
- common misconfiguration.

## 15.7 CLI design rules

- Every command must have `--help`.
- Every command must support `--json` for automation where practical.
- Errors must include next steps.
- Long-running commands must show progress.
- CI mode must disable interactive prompts.
- Production commands must fail safely.


\newpage

# 16. Configuration Specification

## 16.1 Config file

The default config file is `desktop.config.ts`.

```ts
import { defineDesktopConfig } from "@effect-desktop/config"

export default defineDesktopConfig({
  app: {
    id: "dev.example.app",
    name: "Example App",
    version: "1.0.0"
  },

  runtime: {
    engine: "bun",
    entry: "src/app.ts"
  },

  renderer: {
    framework: "react",
    styling: "tailwind",
    entry: "src/renderer/main.tsx"
  },

  native: {
    host: "rust-wry-tao",
    renderer: "system-webview"
  },

  security: {
    requireTypedBridge: true,
    rendererNativeAccess: false,
    requirePermissions: true
  },

  build: {
    targets: ["macos", "windows", "linux"]
  }
})
```

## 16.2 Config validation

Config must be schema-validated before any dev, build, or package command proceeds.

Validation must check:

- app ID format;
- app name presence;
- version format;
- runtime entry existence;
- renderer entry existence;
- target platform support;
- invalid security combinations;
- unavailable native capabilities;
- missing signing data for release builds;
- update config consistency.

## 16.3 Environment resolution

Config may read environment variables only through explicit helpers. The config loader must distinguish:

- development environment;
- CI environment;
- packaging environment;
- release environment.

Secrets must not be printed in logs or build reports.

## 16.4 Config output

The resolved config must produce:

- app manifest;
- host manifest;
- runtime manifest;
- renderer manifest;
- bridge manifest;
- permission manifest;
- package manifest;
- update manifest input.


\newpage

# 17. Templates and Examples

## 17.1 Template rules

Templates must be minimal but complete. A template should demonstrate the framework path without adding domain-specific assumptions.

Required template qualities:

- runs immediately after install;
- uses public APIs only;
- has no private package imports;
- has one typed API example;
- has one native service example;
- has one renderer call example;
- has tests;
- includes a valid config;
- includes README instructions.

## 17.2 Required templates

### `basic-react-tailwind`

Validates:

- React renderer;
- Tailwind styling;
- one window;
- one typed API;
- one dialog call;
- settings read/write.

### `local-first`

Validates:

- SQLite;
- migrations;
- settings;
- safe storage;
- event log;
- offline startup.

### `multi-window`

Validates:

- multiple windows;
- route loading;
- window-specific permissions;
- window state persistence;
- runtime-to-renderer events.

### `heavy-workbench`

Validates:

- large renderer application;
- Web Worker asset;
- WASM asset;
- binary stream;
- process spawn;
- PTY stream;
- file watcher;
- background job;
- resource handle;
- permission prompt.

## 17.3 Example rules

Examples are validation assets. They must not become product demos with app-specific public APIs. If an example needs a concept that is not generic, implement it inside the example application only.


\newpage

# 18. Public API Requirements

## 18.1 Application entry

```ts
import { Desktop } from "@effect-desktop/core"
import { MainWindow } from "./windows/main"
import { AppLive } from "./services"

Desktop.run({
  app: {
    id: "dev.example.app",
    name: "Example App",
    version: "1.0.0"
  },
  windows: [MainWindow],
  layer: AppLive
})
```

Requirements:

- `Desktop.run` validates app metadata.
- `Desktop.run` starts the Effect runtime.
- `Desktop.run` registers windows.
- `Desktop.run` registers service layer.
- `Desktop.run` coordinates with native host.
- Errors are typed and logged.

## 18.2 Window declaration

```ts
export const MainWindow = Desktop.window({
  id: "main",
  title: "Example App",
  route: "/",
  size: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600
  },
  titleBarStyle: "default"
}).allow(ProjectApi)
```

Requirements:

- window IDs are typed;
- routes are validated;
- capabilities are derived from `.allow` calls;
- options are mapped to host protocol;
- unsupported options fail clearly by platform;
- state persistence is configurable.

## 18.3 API contract

```ts
export class ProjectApi extends Desktop.Api.Tag("ProjectApi")<ProjectApi>()({
  list: {
    input: Schema.Void,
    output: Schema.Array(Project),
    error: Schema.Never,
    permission: "project:list"
  },

  open: {
    input: Schema.Struct({ path: Schema.String }),
    output: Project,
    error: Schema.Union(
      Desktop.Errors.PermissionDenied,
      Desktop.Errors.FileNotFound
    ),
    permission: "project:open"
  }
}) {}
```

Requirements:

- every method declares input schema;
- every method declares output schema;
- every method declares error schema;
- dangerous methods declare permission;
- methods can declare timeout;
- streaming methods declare backpressure;
- binary methods declare transport preferences.

## 18.4 Service implementation

```ts
export const ProjectApiLive = ProjectApi.layer({
  list: Effect.gen(function* () {
    const store = yield* ProjectStore
    return yield* store.list()
  }),

  open: ({ path }) =>
    Effect.gen(function* () {
      yield* Desktop.Permissions.require("project:open", { path })
      const store = yield* ProjectStore
      return yield* store.open(path)
    })
})
```

Requirements:

- implementation returns Effect values;
- dependencies are accessed through services;
- errors are typed;
- permission checks are explicit or generated according to policy;
- implementations are testable through layers.

## 18.5 Renderer usage

```ts
import { desktop } from "@effect-desktop/react/client"

const projects = await desktop.project.list()
const project = await desktop.project.open({ path })
```

Requirements:

- client is generated;
- method names are typed;
- input is typed;
- output is typed;
- errors are typed;
- no raw bridge API is required.


\newpage

# 19. Developer Experience Requirements

## 19.1 First-run experience

The generated app must run with:

```bash
bun create effect-desktop my-app
cd my-app
bun desktop dev
```

The first app must demonstrate:

- one native window;
- React rendering;
- Tailwind styling;
- one generated API call;
- one native dialog call;
- one settings call;
- devtools availability.

## 19.2 Error messages

Errors must be actionable.

Bad:

```txt
Error: failed
```

Good:

```txt
PermissionDenied: window "main" tried to call FileSystem.writeFile.
Required permission: filesystem:write
Declared permissions: dialog:openFile, clipboard:writeText
Fix: add .allow(Desktop.FileSystem, ["writeFile"]) to the window or call through an API that has scoped write permission.
```

## 19.3 Documentation locality

Each public API must have:

- reference documentation;
- one short example;
- one error example;
- one test example;
- permission notes;
- platform notes if applicable.

## 19.4 Hot reload requirements

Development mode must support:

- renderer HMR;
- API contract regeneration;
- runtime restart on backend changes;
- host restart only when native config changes;
- devtools persistence across runtime restart where practical;
- clear logs for each restart reason.

## 19.5 Build reports

Build commands must output reports:

- renderer bundle report;
- runtime bundle report;
- bridge generation report;
- native host build report;
- package artifact report;
- security report;
- performance budget report.


\newpage

# 20. Verification Requirements

## 20.1 TypeScript verification

- All packages compile with TypeScript strict mode.
- No implicit any is allowed.
- Public API declaration files are emitted.
- Generated clients compile in every example.
- Renderer cannot import backend-only modules.
- Package exports match public API snapshots.

## 20.2 Rust verification

- Cargo workspace checks pass.
- Native host unit tests pass.
- Host protocol serialization tests pass.
- Clippy passes with warnings denied.
- rustfmt check passes.
- Platform-specific modules have smoke tests or documented manual gates.

## 20.3 Bridge verification

- Request response success path works.
- Invalid input fails schema validation.
- Invalid output fails runtime validation in development.
- Typed errors cross from runtime to renderer.
- Permission denial crosses from runtime to renderer.
- Stream cancellation releases runtime resources.
- Resource handles become invalid after disposal.
- Binary streams preserve byte order and length.

## 20.4 Native service verification

- Each native service has success tests where possible.
- Unsupported platform behavior returns typed errors.
- Window creation and close are leak-free.
- Dialog operations can be mocked.
- Clipboard operations can be mocked.
- Shell external open is permission-checked.

## 20.5 Runtime verification

- Processes are killed on scope close.
- PTYs are killed on scope close.
- File watchers are closed on scope close.
- SQLite connections close on scope close.
- Settings changes emit streams.
- Event log append and replay work.
- Worker crashes trigger supervisor policies.

## 20.6 Security verification

- Renderer has no direct native access.
- Raw bridge calls fail production check.
- Filesystem write requires scoped permission.
- Process spawn requires policy.
- Secret access is audited.
- App protocol blocks path traversal.
- External navigation is blocked unless handled by Shell service.
- Unsigned updates are rejected.

## 20.7 Packaging verification

- macOS app package is created.
- macOS disk image is created.
- Windows installer is created.
- Linux package artifacts are created.
- Assets are loaded through app protocol.
- Runtime starts inside packaged app.
- Update manifest can be generated.

## 20.8 Global validation gate

No milestone is complete unless this gate passes or the milestone explicitly documents a narrower gate:

```bash
bun install
bun run typecheck
bun run lint
bun test
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
bun desktop check
```

## 20.9 Production validation gate

v1.0.0 release candidates must pass:

```bash
bun desktop check --production
bun desktop build --release
bun desktop package --all-targets
bun desktop doctor --ci
```

Release candidate validation must run on macOS, Windows, and Linux runners.


\newpage

# 21. Performance Requirements

## 21.1 Performance philosophy

The framework should make the fast path the default path. Performance must be measured, reported, and enforced by budgets. The goal is not to make every application fast automatically, but to ensure the framework substrate does not impose avoidable overhead.

## 21.2 Startup budgets

Development targets:

| Operation | Target |
|---|---:|
| CLI config load | < 100ms |
| native host boot | < 150ms |
| runtime boot | < 250ms |
| renderer dev server ready | project-dependent, reported |
| first window created | < 500ms after runtime ready |
| bridge ready | < 100ms after runtime ready |

Production targets:

| Operation | Target |
|---|---:|
| native host boot | < 100ms |
| runtime boot | < 200ms |
| first window visible | < 700ms |
| initial bridge ready | < 100ms after renderer load |
| basic app interactive | < 1200ms |

These are framework targets. Example apps must report their own measured values.

## 21.3 Bridge budgets

| Operation | Target |
|---|---:|
| small request/response p50 | < 2ms local overhead |
| small request/response p95 | < 10ms local overhead |
| stream subscription setup | < 25ms |
| cancellation acknowledgment | < 50ms |
| resource handle disposal | < 100ms for normal resources |

## 21.4 Resource budgets

The framework must report:

- number of open windows;
- number of WebViews;
- number of open streams;
- number of file watchers;
- number of child processes;
- number of PTYs;
- number of workers;
- number of SQLite handles;
- memory usage for host and runtime where available.

## 21.5 Performance checks

`bun desktop check --production` must warn or fail on:

- eager initialization of native services not used at startup;
- renderer bundle growth above configured budget;
- bridge methods without timeout;
- streams without backpressure policy;
- resources without disposal behavior;
- excessive startup operations;
- dev-only dependencies in production bundle;
- unbounded worker pools.


\newpage

# 22. Observability and Devtools

## 22.1 Observability requirements

Every framework subsystem must emit structured diagnostics. Observability is not optional because complex desktop applications fail in cross-process, cross-platform, and long-running ways.

Required telemetry types:

- structured logs;
- traces/spans;
- metrics;
- performance marks;
- audit events;
- crash reports;
- resource lifecycle events;
- bridge call events;
- stream lifecycle events;
- permission decisions.

## 22.2 Trace identity

Every operation that crosses a boundary must preserve trace context:

- renderer call ID;
- bridge request ID;
- runtime operation ID;
- host protocol request ID;
- resource ID if relevant;
- window ID if relevant;
- worker ID if relevant.

## 22.3 Devtools required panels

The v1.0.0 devtools must include panels for:

- Overview;
- Windows;
- WebViews;
- Bridge calls;
- Streams;
- Resources;
- Processes;
- PTYs;
- Workers;
- Permissions;
- Commands;
- Storage;
- Logs;
- Traces;
- Metrics;
- Crashes;
- Performance.

## 22.4 Devtools rules

- Devtools must not expose secrets.
- Devtools must not require production build flags.
- Devtools must support app-defined panels through a generic extension mechanism.
- Devtools must show stale resources.
- Devtools must show permission denials with remediation hints.
- Devtools must show bridge call latency and errors.
- Devtools must show process and PTY ownership.

## 22.5 Logging requirements

Logs must be structured and include:

- level;
- timestamp;
- subsystem;
- operation;
- trace ID;
- resource ID where applicable;
- window ID where applicable;
- message;
- safe structured fields.

Secrets must be redacted before logs are emitted.


\newpage

# 23. Packaging, Signing, and Updating

## 23.1 Packaging philosophy

Packaging is part of the framework. A desktop framework that cannot reliably ship applications is incomplete.

v1.0.0 must provide first-party commands for:

- building renderer assets;
- building runtime bundle;
- building native host;
- staging app resources;
- packaging platform artifacts;
- signing artifacts;
- notarizing where required;
- generating update manifests;
- verifying packaged app startup.

## 23.2 Required artifacts

v1.0.0 should support:

- macOS `.app`;
- macOS `.dmg`;
- macOS `.zip`;
- Windows user installer;
- Windows system installer if feasible by v1.0.0;
- Linux AppImage;
- Linux `.deb`;
- Linux `.rpm`.

## 23.3 Signing requirements

The framework must support:

- macOS Developer ID signing;
- macOS hardened runtime configuration;
- macOS notarization command integration;
- Windows Authenticode signing;
- Linux package signing hooks;
- unsigned local development packages with clear warnings.

## 23.4 Update requirements

Required updater capabilities:

- signed update manifest;
- update check;
- version comparison;
- platform targeting;
- architecture targeting;
- update download;
- progress stream;
- signature verification;
- stage update;
- install and restart;
- rollback metadata;
- update error reporting.

## 23.5 Package verification

Packaged apps must be smoke-tested:

- launches native host;
- launches runtime;
- loads app protocol assets;
- opens initial window;
- performs one bridge call;
- writes settings;
- emits logs;
- shuts down without leaks.


\newpage

# 24. Implementation Milestones

Milestones must be implemented in order unless a technical lead explicitly reorders them. Each milestone should produce a coherent vertical slice, not a pile of unrelated code.

## 24.0 Phase 0: Repository bootstrap

**Goal:** Establish monorepo, tooling, docs skeleton, and validation commands.

### Deliverables

- root package.json.
- bun workspace.
- turbo config.
- TypeScript base config.
- Rust workspace.
- initial docs.
- CI skeleton.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- bun install succeeds.
- bun run check exists.
- cargo check --workspace succeeds.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.1 Phase 1: Native host spike

**Goal:** Open a native window and load a static local renderer.

### Deliverables

- crates/host.
- WRY/TAO window.
- app protocol stub.
- static renderer asset.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- native window opens.
- renderer displays text.
- host exits cleanly.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.2 Phase 2: Runtime supervision

**Goal:** Host launches and supervises Bun runtime process.

### Deliverables

- runtime entry.
- host process launcher.
- ready event.
- restart in dev.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- runtime ready received.
- runtime crash is detected.
- host does not crash.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.3 Phase 3: Host protocol MVP

**Goal:** Implement framed host-runtime messages.

### Deliverables

- host-protocol crate.
- TS protocol types.
- request response.
- structured errors.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- roundtrip works.
- unknown method errors.
- version mismatch fails.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.4 Phase 4: Typed bridge MVP

**Goal:** Generate renderer client and runtime handler from API contract.

### Deliverables

- bridge generator.
- contract registry.
- generated client.
- generated handler.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- renderer calls typed API.
- invalid input fails.
- typed error crosses bridge.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.5 Phase 5: Window service

**Goal:** Expose window creation and lifecycle as typed service.

### Deliverables

- Window service.
- host methods.
- window registry.
- state events.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- create/show/close works.
- window events stream.
- resource cleanup works.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.6 Phase 6: Renderer template

**Goal:** Ship React/Tailwind template with generated client.

### Deliverables

- template.
- create package.
- renderer build.
- dev HMR.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- create command works.
- dev command opens app.
- renderer call works.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.7 Phase 7: Native service set A

**Goal:** Dialogs, clipboard, shell, path.

### Deliverables

- Dialog.
- Clipboard.
- Shell.
- Path.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- services work.
- mock tests pass.
- permissions work.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.8 Phase 8: Native service set B

**Goal:** Menu, context menu, tray, notifications, screen.

### Deliverables

- Menu.
- ContextMenu.
- Tray.
- Notification.
- Screen.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- services work where supported.
- platform gaps typed.
- docs updated.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.9 Phase 9: Resources and scopes

**Goal:** Central resource registry and leak checks.

### Deliverables

- ResourceRegistry.
- Scope integration.
- devtools feed.
- test assertNoLeaks.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- resources listed.
- scope cleanup.
- leak tests fail when expected.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.10 Phase 10: Streams and cancellation

**Goal:** Bridge streams, cancellation, and backpressure.

### Deliverables

- stream frames.
- cancel messages.
- backpressure policy.
- stream tests.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- stream values reach renderer.
- cancel disposes resource.
- backpressure configured.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.11 Phase 11: Filesystem

**Goal:** Runtime filesystem service with watchers and policies.

### Deliverables

- FileSystem service.
- watchers.
- path policies.
- mock FS.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- read/write/watch works.
- policy denial works.
- watcher cleanup works.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.12 Phase 12: Process

**Goal:** Process spawn, stdout/stderr streams, kill tree.

### Deliverables

- Process service.
- process handles.
- stdout/stderr stream.
- kill tree.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- spawn works.
- streams work.
- scope cleanup kills process.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.13 Phase 13: PTY

**Goal:** Cross-platform PTY resource.

### Deliverables

- native-pty crate.
- PTY service.
- resize.
- output stream.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- PTY opens.
- write works.
- resize works.
- cleanup works.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.14 Phase 14: Storage

**Goal:** SQLite, settings, event log, migrations.

### Deliverables

- SQLite service.
- Settings.
- EventLog.
- migration runner.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- migrations run.
- settings persist.
- events replay.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.15 Phase 15: Secrets

**Goal:** Safe storage facade and mocks.

### Deliverables

- SafeStorage host methods.
- Secrets service.
- mock secrets.
- audit.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- set/get/delete works.
- renderer cannot direct access.
- audit emitted.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.16 Phase 16: Permissions

**Goal:** Capabilities, policies, approval broker.

### Deliverables

- PermissionRegistry.
- Capability DSL.
- ApprovalBroker.
- production checker.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- allow/deny/ask works.
- devtools shows decision.
- production checks fail unsafe config.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.17 Phase 17: Commands and shortcuts

**Goal:** Generic command registry and menu/keybinding integration.

### Deliverables

- CommandRegistry.
- keyboard shortcuts.
- global shortcuts.
- menu bindings.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- command invoked.
- permissions applied.
- shortcut unregisters.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.18 Phase 18: Workers and jobs

**Goal:** Supervised background tasks with progress streams.

### Deliverables

- Worker service.
- Job service.
- worker pool.
- progress stream.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- job starts.
- job cancels.
- worker crash handled.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.19 Phase 19: Devtools

**Goal:** Runtime inspector for framework primitives.

### Deliverables

- devtools UI.
- logs.
- resources.
- bridge.
- permissions.
- performance.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- panels display live data.
- no secrets shown.
- devtools works after runtime restart.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.20 Phase 20: Testing harness

**Goal:** Mocks and integration runner.

### Deliverables

- mock host.
- mock bridge.
- mock process.
- headless runtime.
- example tests.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- unit tests use mocks.
- integration tests run.
- leak assertions work.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.21 Phase 21: Build and package

**Goal:** Build renderer/runtime/host and package app artifacts.

### Deliverables

- build command.
- package command.
- asset staging.
- app manifest.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- packaged app launches.
- asset loading works.
- bridge call works.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.22 Phase 22: Signing and update

**Goal:** Signing, notarization hooks, signed update manifests.

### Deliverables

- sign command.
- notarize command.
- update manifest.
- signature verification.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- signed artifact path works.
- unsigned update rejected.
- update check works.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.23 Phase 23: Cross-platform hardening

**Goal:** Run and fix platform matrix.

### Deliverables

- macOS validation.
- Windows validation.
- Linux validation.
- platform docs.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- examples pass on all platforms.
- platform gaps documented.
- doctor command works.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.

## 24.24 Phase 24: v1.0.0 release candidate

**Goal:** Lock API, run full validation, publish docs and packages.

### Deliverables

- API snapshot.
- release notes.
- docs.
- examples.
- package publish dry run.
### Non-goals

- Do not expand public API beyond the milestone.
- Do not introduce product-specific concepts.
- Do not skip tests because later milestones will add tests.
- Do not solve cross-platform polish before the primitive is validated.

### Acceptance criteria

- all gates pass.
- examples pass.
- docs complete.
- release approved.
### Required validation

```bash
bun run typecheck
bun test
cargo check --workspace
cargo test --workspace
```

If this milestone touches packaging, native host behavior, security, or production checks, also run the relevant specialized gate from Chapter 20.


\newpage

# 25. v1.0.0 Release Criteria

## 25.1 Release is allowed only when

- All required packages are implemented.
- All required native primitives are implemented or explicitly documented as platform-unavailable with typed errors.
- The generated bridge supports request/response, events, streams, binary streams, cancellation, and resource handles.
- The renderer has no direct native access.
- Production checks fail on raw bridge usage.
- Resource registry and leak detection work.
- Process and PTY primitives work.
- File watching works.
- SQLite, settings, secrets, and event log work.
- Permission and approval systems work.
- Devtools display framework primitives.
- Examples pass.
- Packaging works.
- Signing path works.
- Updater path works.
- Docs are complete.
- CI is green on target platforms.

## 25.2 Public API freeze checklist

Before v1.0.0:

- Review every package export.
- Remove accidental exports.
- Mark experimental APIs explicitly.
- Generate API snapshots.
- Confirm examples use only public APIs.
- Confirm templates do not import internals.
- Confirm docs match API signatures.
- Confirm breaking-change policy is written.

## 25.3 Documentation release checklist

Required docs:

- installation;
- quickstart;
- concepts;
- architecture overview;
- app config;
- windows;
- typed APIs;
- bridge;
- native services;
- resources;
- processes;
- PTYs;
- filesystem;
- storage;
- permissions;
- commands;
- devtools;
- testing;
- packaging;
- signing;
- updating;
- troubleshooting;
- migration within pre-1.0 APIs;
- contribution guide.

## 25.4 CI release checklist

CI must run:

- TypeScript typecheck;
- lint;
- TypeScript tests;
- Rust check;
- Rust tests;
- Clippy;
- Rust formatting;
- bridge generation tests;
- example builds;
- native host build;
- package smoke test;
- docs build;
- production checker.


\newpage

# 26. Risk Register

## 26.1 System WebView inconsistency

- **Likelihood:** High
- **Impact:** High
- **Mitigation:** Define supported browser APIs, test examples on all platforms, document platform gaps, avoid relying on unsupported APIs.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.2 Bridge becomes stringly

- **Likelihood:** Medium
- **Impact:** Critical
- **Mitigation:** No public raw invoke API, production check blocks raw bridge usage, generated clients required.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.3 Rust host accumulates app logic

- **Likelihood:** Medium
- **Impact:** High
- **Mitigation:** Keep host protocol primitive-only, add architectural review for Rust changes, move app behavior to Bun services.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.4 Resource leaks

- **Likelihood:** High
- **Impact:** High
- **Mitigation:** Resource registry, scope integration, leak tests, shutdown checks, devtools resource panel.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.5 PTY instability

- **Likelihood:** Medium
- **Impact:** High
- **Mitigation:** Isolate PTY implementation, stress tests, platform-specific adapters, deterministic cleanup.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.6 Packaging complexity

- **Likelihood:** High
- **Impact:** High
- **Mitigation:** Build packaging early, validate examples, add doctor command, document platform prerequisites.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.7 Permissions too complex

- **Likelihood:** Medium
- **Impact:** Medium
- **Mitigation:** Begin with simple allow APIs, add advanced policies gradually, keep diagnostics excellent.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.8 Devtools leak secrets

- **Likelihood:** Low
- **Impact:** Critical
- **Mitigation:** Redaction layer, secret metadata tags, tests for sensitive fields.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.9 Examples become vertical products

- **Likelihood:** Medium
- **Impact:** Medium
- **Mitigation:** Keep examples generic and validation-focused, ban app-specific public APIs.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.10 Bun runtime behavior changes

- **Likelihood:** Medium
- **Impact:** Medium
- **Mitigation:** Pin tested Bun versions, doctor command, compatibility matrix.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.11 Native dependencies fail on Linux

- **Likelihood:** Medium
- **Impact:** High
- **Mitigation:** Document prerequisites, CI Linux matrix, fallback behavior where possible.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.12 Scope creep before v1

- **Likelihood:** High
- **Impact:** High
- **Mitigation:** Follow non-goals, milestone order, ADRs, release gates.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.


\newpage

# 27. Required Architecture Decision Records

## 27.1 ADR-0001: Use a Rust native host

**Decision:** Use a Rust native host.

**Reason:** Rust provides memory-safe native platform integration and a strong ecosystem for WebView/windowing.

**ADR file:** `docs/decisions/adr-0001-use-a-rust-native-host.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.2 ADR-0002: Use a Bun runtime process

**Decision:** Use a Bun runtime process.

**Reason:** Bun provides the TypeScript runtime and developer toolchain while keeping app logic in TypeScript.

**ADR file:** `docs/decisions/adr-0002-use-a-bun-runtime-process.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.3 ADR-0003: Use system WebView by default

**Decision:** Use system WebView by default.

**Reason:** System WebView keeps the native shell smaller and faster for v1.0.0.

**ADR file:** `docs/decisions/adr-0003-use-system-webview-by-default.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.4 ADR-0004: No compatibility layer for other desktop frameworks

**Decision:** No compatibility layer for other desktop frameworks.

**Reason:** Compatibility would distort the API and increase surface area before the core is mature.

**ADR file:** `docs/decisions/adr-0004-no-compatibility-layer-for-other-desktop-frameworks.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.5 ADR-0005: Generate bridge clients from Effect contracts

**Decision:** Generate bridge clients from Effect contracts.

**Reason:** Generated clients enforce type safety, schema validation, permissions, and observability.

**ADR file:** `docs/decisions/adr-0005-generate-bridge-clients-from-effect-contracts.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.6 ADR-0006: Native host protocol before native bindings

**Decision:** Native host protocol before native bindings.

**Reason:** A protocol is easier to test, isolate, and evolve than a broad in-process binding layer.

**ADR file:** `docs/decisions/adr-0006-native-host-protocol-before-native-bindings.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.7 ADR-0007: Effect scopes for all resources

**Decision:** Effect scopes for all resources.

**Reason:** Resources must be safely acquired and released to avoid leaks in long-running apps.

**ADR file:** `docs/decisions/adr-0007-effect-scopes-for-all-resources.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.8 ADR-0008: Generic primitives over vertical packages

**Decision:** Generic primitives over vertical packages.

**Reason:** The framework should enable many application categories without owning their product abstractions.

**ADR file:** `docs/decisions/adr-0008-generic-primitives-over-vertical-packages.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.9 ADR-0009: Packaging is first-party

**Decision:** Packaging is first-party.

**Reason:** A desktop framework must own the path from development to shipped artifacts.

**ADR file:** `docs/decisions/adr-0009-packaging-is-first-party.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.10 ADR-0010: Renderer remains unprivileged

**Decision:** Renderer remains unprivileged.

**Reason:** Security and correctness require that privileged work happen through generated APIs.

**ADR file:** `docs/decisions/adr-0010-renderer-remains-unprivileged.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.


\newpage

# 28. Implementation Agent Operating Instructions

## 28.1 Required behavior

An implementation agent working on this repository must:

1. Read this specification before making changes.
2. Identify the active milestone.
3. State which milestone and acceptance criteria are being implemented.
4. Modify only files required for that milestone unless a dependency is discovered.
5. Prefer boring implementations.
6. Preserve product laws.
7. Add or update tests.
8. Run validation gates.
9. Report exact commands run and results.
10. Avoid claiming completion when gates are not green.

## 28.2 Forbidden behavior

An implementation agent must not:

- add compatibility APIs for other desktop frameworks;
- add application-specific packages;
- expose raw IPC as a public API;
- put application logic in Rust;
- use renderer-native access as a shortcut;
- add unsafe native code without a written reason;
- add new dependencies without documenting them;
- skip resource cleanup;
- skip permission checks for dangerous operations;
- hide test failures;
- expand scope beyond the active milestone.

## 28.3 Implementation style

- Write small, composable modules.
- Use typed errors instead of strings.
- Use schemas at process boundaries.
- Keep public API names stable and simple.
- Prefer explicit configuration over magic.
- Prefer generated code over duplicated hand-written bridge code.
- Prefer tests that assert failure behavior as well as success behavior.
- Prefer internal helpers over new packages until a package boundary is clearly needed.

## 28.4 Completion report format

Every completed milestone should produce a report:

```txt
Milestone:
Files changed:
Public APIs added:
Tests added:
Validation commands run:
Validation results:
Known limitations:
Follow-up items:
```


\newpage

# Appendix A. Required File Templates

## A.1 Package README template

```md
# @effect-desktop/<package>

## Purpose

## Public API

## Non-goals

## Usage

## Testing

## Platform notes

## Internal architecture
```

## A.2 ADR template

```md
# ADR-0000: Title

## Status

Proposed | Accepted | Rejected | Superseded

## Context

## Decision

## Alternatives considered

## Consequences

## Validation

## Migration notes
```

## A.3 Milestone document template

```md
# Milestone NN: Title

## Goal

## Non-goals

## Required files

## Public APIs

## Acceptance criteria

## Validation commands

## Risks

## Completion notes
```


\newpage

# Appendix B. Native Service API Sketches

## B.1 `App` sketch

```ts
export interface AppService {

  getInfo(input: unknown): Effect.Effect<unknown, DesktopError>
  quit(input: unknown): Effect.Effect<unknown, DesktopError>
  restart(input: unknown): Effect.Effect<unknown, DesktopError>
  setSingleInstance(input: unknown): Effect.Effect<unknown, DesktopError>
  onOpenFile(input: unknown): Effect.Effect<unknown, DesktopError>
  onOpenUrl(input: unknown): Effect.Effect<unknown, DesktopError>
  onBeforeQuit(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.2 `Window` sketch

```ts
export interface WindowService {

  create(input: unknown): Effect.Effect<unknown, DesktopError>
  show(input: unknown): Effect.Effect<unknown, DesktopError>
  hide(input: unknown): Effect.Effect<unknown, DesktopError>
  focus(input: unknown): Effect.Effect<unknown, DesktopError>
  close(input: unknown): Effect.Effect<unknown, DesktopError>
  setTitle(input: unknown): Effect.Effect<unknown, DesktopError>
  setSize(input: unknown): Effect.Effect<unknown, DesktopError>
  setPosition(input: unknown): Effect.Effect<unknown, DesktopError>
  setFullscreen(input: unknown): Effect.Effect<unknown, DesktopError>
  persistState(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.3 `WebView` sketch

```ts
export interface WebViewService {

  create(input: unknown): Effect.Effect<unknown, DesktopError>
  loadRoute(input: unknown): Effect.Effect<unknown, DesktopError>
  loadUrl(input: unknown): Effect.Effect<unknown, DesktopError>
  reload(input: unknown): Effect.Effect<unknown, DesktopError>
  goBack(input: unknown): Effect.Effect<unknown, DesktopError>
  goForward(input: unknown): Effect.Effect<unknown, DesktopError>
  captureScreenshot(input: unknown): Effect.Effect<unknown, DesktopError>
  destroy(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.4 `Menu` sketch

```ts
export interface MenuService {

  setApplicationMenu(input: unknown): Effect.Effect<unknown, DesktopError>
  setWindowMenu(input: unknown): Effect.Effect<unknown, DesktopError>
  clear(input: unknown): Effect.Effect<unknown, DesktopError>
  bindCommand(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.5 `ContextMenu` sketch

```ts
export interface ContextMenuService {

  show(input: unknown): Effect.Effect<unknown, DesktopError>
  buildFromTemplate(input: unknown): Effect.Effect<unknown, DesktopError>
  bindCommand(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.6 `Tray` sketch

```ts
export interface TrayService {

  create(input: unknown): Effect.Effect<unknown, DesktopError>
  setIcon(input: unknown): Effect.Effect<unknown, DesktopError>
  setTooltip(input: unknown): Effect.Effect<unknown, DesktopError>
  setMenu(input: unknown): Effect.Effect<unknown, DesktopError>
  destroy(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.7 `Dialog` sketch

```ts
export interface DialogService {

  openFile(input: unknown): Effect.Effect<unknown, DesktopError>
  openDirectory(input: unknown): Effect.Effect<unknown, DesktopError>
  saveFile(input: unknown): Effect.Effect<unknown, DesktopError>
  message(input: unknown): Effect.Effect<unknown, DesktopError>
  confirm(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.8 `Clipboard` sketch

```ts
export interface ClipboardService {

  readText(input: unknown): Effect.Effect<unknown, DesktopError>
  writeText(input: unknown): Effect.Effect<unknown, DesktopError>
  readImage(input: unknown): Effect.Effect<unknown, DesktopError>
  writeImage(input: unknown): Effect.Effect<unknown, DesktopError>
  clear(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.9 `Notification` sketch

```ts
export interface NotificationService {

  show(input: unknown): Effect.Effect<unknown, DesktopError>
  close(input: unknown): Effect.Effect<unknown, DesktopError>
  onClick(input: unknown): Effect.Effect<unknown, DesktopError>
  isSupported(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.10 `Shell` sketch

```ts
export interface ShellService {

  openExternal(input: unknown): Effect.Effect<unknown, DesktopError>
  showItemInFolder(input: unknown): Effect.Effect<unknown, DesktopError>
  openPath(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.11 `Screen` sketch

```ts
export interface ScreenService {

  getDisplays(input: unknown): Effect.Effect<unknown, DesktopError>
  getPrimaryDisplay(input: unknown): Effect.Effect<unknown, DesktopError>
  getPointerPoint(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.12 `GlobalShortcut` sketch

```ts
export interface GlobalShortcutService {

  register(input: unknown): Effect.Effect<unknown, DesktopError>
  unregister(input: unknown): Effect.Effect<unknown, DesktopError>
  unregisterAll(input: unknown): Effect.Effect<unknown, DesktopError>
  isRegistered(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.13 `Protocol` sketch

```ts
export interface ProtocolService {

  registerAppProtocol(input: unknown): Effect.Effect<unknown, DesktopError>
  serveAsset(input: unknown): Effect.Effect<unknown, DesktopError>
  serveRoute(input: unknown): Effect.Effect<unknown, DesktopError>
  deny(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.14 `SafeStorage` sketch

```ts
export interface SafeStorageService {

  set(input: unknown): Effect.Effect<unknown, DesktopError>
  get(input: unknown): Effect.Effect<unknown, DesktopError>
  delete(input: unknown): Effect.Effect<unknown, DesktopError>
  list(input: unknown): Effect.Effect<unknown, DesktopError>
  isAvailable(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.15 `Path` sketch

```ts
export interface PathService {

  appData(input: unknown): Effect.Effect<unknown, DesktopError>
  cache(input: unknown): Effect.Effect<unknown, DesktopError>
  logs(input: unknown): Effect.Effect<unknown, DesktopError>
  temp(input: unknown): Effect.Effect<unknown, DesktopError>
  home(input: unknown): Effect.Effect<unknown, DesktopError>
  downloads(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.16 `Updater` sketch

```ts
export interface UpdaterService {

  check(input: unknown): Effect.Effect<unknown, DesktopError>
  download(input: unknown): Effect.Effect<unknown, DesktopError>
  install(input: unknown): Effect.Effect<unknown, DesktopError>
  installAndRestart(input: unknown): Effect.Effect<unknown, DesktopError>
  getStatus(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.17 `CrashReporter` sketch

```ts
export interface CrashReporterService {

  start(input: unknown): Effect.Effect<unknown, DesktopError>
  recordBreadcrumb(input: unknown): Effect.Effect<unknown, DesktopError>
  flush(input: unknown): Effect.Effect<unknown, DesktopError>
  setUploadHandler(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.18 `PowerMonitor` sketch

```ts
export interface PowerMonitorService {

  onSuspend(input: unknown): Effect.Effect<unknown, DesktopError>
  onResume(input: unknown): Effect.Effect<unknown, DesktopError>
  onShutdown(input: unknown): Effect.Effect<unknown, DesktopError>
  onPowerSourceChanged(input: unknown): Effect.Effect<unknown, DesktopError>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.


\newpage

# Appendix C. Verification Matrix

## C.1 TypeScript verification: All packages compile with TypeScript strict mode.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: All packages compile with TypeScript strict mode.
Test file:
Command:
Result:
Notes:
```

## C.2 TypeScript verification: No implicit any is allowed.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: No implicit any is allowed.
Test file:
Command:
Result:
Notes:
```

## C.3 TypeScript verification: Public API declaration files are emitted.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Public API declaration files are emitted.
Test file:
Command:
Result:
Notes:
```

## C.4 TypeScript verification: Generated clients compile in every example.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Generated clients compile in every example.
Test file:
Command:
Result:
Notes:
```

## C.5 TypeScript verification: Renderer cannot import backend-only modules.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Renderer cannot import backend-only modules.
Test file:
Command:
Result:
Notes:
```

## C.6 TypeScript verification: Package exports match public API snapshots.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Package exports match public API snapshots.
Test file:
Command:
Result:
Notes:
```

## C.7 Rust verification: Cargo workspace checks pass.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Cargo workspace checks pass.
Test file:
Command:
Result:
Notes:
```

## C.8 Rust verification: Native host unit tests pass.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Native host unit tests pass.
Test file:
Command:
Result:
Notes:
```

## C.9 Rust verification: Host protocol serialization tests pass.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Host protocol serialization tests pass.
Test file:
Command:
Result:
Notes:
```

## C.10 Rust verification: Clippy passes with warnings denied.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Clippy passes with warnings denied.
Test file:
Command:
Result:
Notes:
```

## C.11 Rust verification: rustfmt check passes.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: rustfmt check passes.
Test file:
Command:
Result:
Notes:
```

## C.12 Rust verification: Platform-specific modules have smoke tests or documented manual gates.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Platform-specific modules have smoke tests or documented manual gates.
Test file:
Command:
Result:
Notes:
```

## C.13 Bridge verification: Request response success path works.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Request response success path works.
Test file:
Command:
Result:
Notes:
```

## C.14 Bridge verification: Invalid input fails schema validation.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Invalid input fails schema validation.
Test file:
Command:
Result:
Notes:
```

## C.15 Bridge verification: Invalid output fails runtime validation in development.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Invalid output fails runtime validation in development.
Test file:
Command:
Result:
Notes:
```

## C.16 Bridge verification: Typed errors cross from runtime to renderer.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Typed errors cross from runtime to renderer.
Test file:
Command:
Result:
Notes:
```

## C.17 Bridge verification: Permission denial crosses from runtime to renderer.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Permission denial crosses from runtime to renderer.
Test file:
Command:
Result:
Notes:
```

## C.18 Bridge verification: Stream cancellation releases runtime resources.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Stream cancellation releases runtime resources.
Test file:
Command:
Result:
Notes:
```

## C.19 Bridge verification: Resource handles become invalid after disposal.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Resource handles become invalid after disposal.
Test file:
Command:
Result:
Notes:
```

## C.20 Bridge verification: Binary streams preserve byte order and length.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Binary streams preserve byte order and length.
Test file:
Command:
Result:
Notes:
```

## C.21 Native service verification: Each native service has success tests where possible.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Each native service has success tests where possible.
Test file:
Command:
Result:
Notes:
```

## C.22 Native service verification: Unsupported platform behavior returns typed errors.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Unsupported platform behavior returns typed errors.
Test file:
Command:
Result:
Notes:
```

## C.23 Native service verification: Window creation and close are leak-free.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Window creation and close are leak-free.
Test file:
Command:
Result:
Notes:
```

## C.24 Native service verification: Dialog operations can be mocked.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Dialog operations can be mocked.
Test file:
Command:
Result:
Notes:
```

## C.25 Native service verification: Clipboard operations can be mocked.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Clipboard operations can be mocked.
Test file:
Command:
Result:
Notes:
```

## C.26 Native service verification: Shell external open is permission-checked.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Shell external open is permission-checked.
Test file:
Command:
Result:
Notes:
```

## C.27 Runtime verification: Processes are killed on scope close.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Processes are killed on scope close.
Test file:
Command:
Result:
Notes:
```

## C.28 Runtime verification: PTYs are killed on scope close.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: PTYs are killed on scope close.
Test file:
Command:
Result:
Notes:
```

## C.29 Runtime verification: File watchers are closed on scope close.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: File watchers are closed on scope close.
Test file:
Command:
Result:
Notes:
```

## C.30 Runtime verification: SQLite connections close on scope close.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: SQLite connections close on scope close.
Test file:
Command:
Result:
Notes:
```

## C.31 Runtime verification: Settings changes emit streams.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Settings changes emit streams.
Test file:
Command:
Result:
Notes:
```

## C.32 Runtime verification: Event log append and replay work.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Event log append and replay work.
Test file:
Command:
Result:
Notes:
```

## C.33 Runtime verification: Worker crashes trigger supervisor policies.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Worker crashes trigger supervisor policies.
Test file:
Command:
Result:
Notes:
```

## C.34 Security verification: Renderer has no direct native access.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Renderer has no direct native access.
Test file:
Command:
Result:
Notes:
```

## C.35 Security verification: Raw bridge calls fail production check.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Raw bridge calls fail production check.
Test file:
Command:
Result:
Notes:
```

## C.36 Security verification: Filesystem write requires scoped permission.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Filesystem write requires scoped permission.
Test file:
Command:
Result:
Notes:
```

## C.37 Security verification: Process spawn requires policy.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Process spawn requires policy.
Test file:
Command:
Result:
Notes:
```

## C.38 Security verification: Secret access is audited.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Secret access is audited.
Test file:
Command:
Result:
Notes:
```

## C.39 Security verification: App protocol blocks path traversal.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: App protocol blocks path traversal.
Test file:
Command:
Result:
Notes:
```

## C.40 Security verification: External navigation is blocked unless handled by Shell service.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: External navigation is blocked unless handled by Shell service.
Test file:
Command:
Result:
Notes:
```

## C.41 Security verification: Unsigned updates are rejected.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Unsigned updates are rejected.
Test file:
Command:
Result:
Notes:
```

## C.42 Packaging verification: macOS app package is created.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: macOS app package is created.
Test file:
Command:
Result:
Notes:
```

## C.43 Packaging verification: macOS disk image is created.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: macOS disk image is created.
Test file:
Command:
Result:
Notes:
```

## C.44 Packaging verification: Windows installer is created.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Windows installer is created.
Test file:
Command:
Result:
Notes:
```

## C.45 Packaging verification: Linux package artifacts are created.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Linux package artifacts are created.
Test file:
Command:
Result:
Notes:
```

## C.46 Packaging verification: Assets are loaded through app protocol.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Assets are loaded through app protocol.
Test file:
Command:
Result:
Notes:
```

## C.47 Packaging verification: Runtime starts inside packaged app.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Runtime starts inside packaged app.
Test file:
Command:
Result:
Notes:
```

## C.48 Packaging verification: Update manifest can be generated.

### Required proof

- Automated test or documented platform smoke test.
- Failure mode test where practical.
- CI command that exercises the check.
- Documentation note if user-visible.

### Evidence format

```txt
Requirement: Update manifest can be generated.
Test file:
Command:
Result:
Notes:
```


\newpage

# Appendix D. Security Checklist

- [ ] Renderer cannot import backend modules.
- [ ] Renderer cannot access native host protocol.
- [ ] Renderer cannot access Bun runtime globals for privileged operations.
- [ ] Every generated API has an input schema.
- [ ] Every generated API has an output schema.
- [ ] Every generated API has an error model.
- [ ] Dangerous APIs have permissions.
- [ ] Filesystem writes are scoped.
- [ ] Process execution has allow/ask/deny policy.
- [ ] Secret access is audited.
- [ ] Update installation verifies signatures.
- [ ] App protocol blocks path traversal.
- [ ] External navigation is controlled.
- [ ] Devtools redacts secrets.
- [ ] Logs redact secrets.
- [ ] Crash reports redact secrets.


\newpage

# Appendix E. Performance Checklist

- [ ] Startup timeline is emitted.
- [ ] Renderer bundle report is emitted.
- [ ] Runtime bundle report is emitted.
- [ ] Bridge latency metrics are emitted.
- [ ] Stream backpressure metrics are emitted.
- [ ] Resource count metrics are emitted.
- [ ] Process count metrics are emitted.
- [ ] Worker count metrics are emitted.
- [ ] Production checker enforces budgets.
- [ ] Examples include performance smoke reports.


\newpage

# Appendix F. Glossary

**Native host:** The Rust process that owns native event loops, windows, WebViews, and platform integrations.

**Runtime:** The Bun process that runs the Effect application and service graph.

**Renderer:** The WebView page running the React application.

**Bridge:** The generated typed communication layer between renderer and runtime.

**Host protocol:** The structured communication layer between runtime and native host.

**Resource:** A long-lived value with ownership, lifecycle, cleanup, and observability.

**Scope:** An Effect-managed lifetime boundary for resources.

**Capability:** A scoped permission granted to a window, resource, or operation.

**Approval:** A user- or policy-mediated decision to allow a dangerous operation.

**Event log:** An append-only stream of structured events for audit, replay, and recovery.

**Devtools:** The runtime inspector for framework primitives and diagnostics.


\newpage

# Appendix G. Official Reference Links

These references are used to anchor technology choices and implementation assumptions. They are intentionally limited to framework-relevant technology documentation.

- Bun documentation: https://bun.com/docs
- Bun workspaces: https://bun.com/docs/pm/workspaces
- Bun SQLite: https://bun.com/docs/runtime/sqlite
- Bun child processes: https://bun.com/docs/runtime/child-process
- Bun executables: https://bun.com/docs/bundler/executables
- Bun FFI: https://bun.com/docs/runtime/ffi
- Effect documentation: https://effect.website/docs
- Effect Schema: https://effect.website/docs/schema/introduction/
- Effect Layers: https://effect.website/docs/requirements-management/layers/
- Effect Scope: https://effect.website/docs/resource-management/scope/
- Effect Streams: https://effect.website/docs/stream/introduction/
- WRY crate docs: https://docs.rs/wry
- TAO crate docs: https://docs.rs/tao
- Turborepo docs: https://turborepo.dev/docs
- Vite features: https://vite.dev/guide/features
- React createRoot: https://react.dev/reference/react-dom/client/createRoot
- Tailwind CSS: https://tailwindcss.com/
- Cargo workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html
- Node-API: https://nodejs.org/api/n-api.html


\newpage

# Appendix H. Detailed Module Acceptance Matrices

## H.1 `core` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.2 `bridge` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.3 `native` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.4 `react` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.5 `cli` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.6 `devtools` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.7 `test` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.8 `config` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.9 `create-effect-desktop` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.10 `host` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.11 `host-protocol` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.12 `native-pty` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.13 `native-updater` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.14 `App` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.15 `Window` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.16 `WebView` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.17 `Menu` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.18 `ContextMenu` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.19 `Tray` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.20 `Dialog` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.21 `Clipboard` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.22 `Notification` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.23 `Shell` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.24 `Screen` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.25 `GlobalShortcut` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.26 `Protocol` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.27 `SafeStorage` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.28 `Path` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.29 `Updater` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.30 `CrashReporter` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.31 `PowerMonitor` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.32 `Filesystem` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.33 `Process` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.34 `PTY` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.35 `Worker` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.36 `Job` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.37 `SQLite` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.38 `Settings` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.39 `Secrets` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.40 `EventLog` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.41 `Transport` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.42 `CommandRegistry` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.43 `ApprovalBroker` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.44 `PermissionRegistry` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.45 `ResourceRegistry` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.

## H.46 `Telemetry` acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only intentional public symbols.
- The module includes a README or architecture note.

### Functional requirements

- Happy path behavior is implemented.
- Invalid input behavior is implemented.
- Failure behavior is implemented.
- Cancellation behavior is implemented where applicable.
- Cleanup behavior is implemented where applicable.
- Permission behavior is implemented where applicable.
- Devtools telemetry is emitted where applicable.

### Test requirements

- Unit tests cover core behavior.
- Integration tests cover cross-boundary behavior where applicable.
- Mock tests exist for application usage.
- Failure tests assert typed errors.
- Leak tests assert no open resources after scope close.

### Documentation requirements

- Public API examples compile.
- Failure examples are documented.
- Platform differences are documented.
- Security implications are documented.
- Performance considerations are documented.

### Release requirements

- The module passes CI.
- The module has no unresolved critical issues.
- The module's public API is included in the API snapshot.
- The module's behavior is covered by at least one example or direct integration test.


\newpage

# Appendix I. Documentation Plan

## I.1 Getting started

The `Getting started` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.2 Installation

The `Installation` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.3 Project structure

The `Project structure` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.4 Desktop config

The `Desktop config` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.5 App lifecycle

The `App lifecycle` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.6 Windows

The `Windows` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.7 WebViews

The `WebViews` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.8 Renderer setup

The `Renderer setup` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.9 Typed APIs

The `Typed APIs` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.10 Bridge

The `Bridge` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.11 Streams

The `Streams` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.12 Resource handles

The `Resource handles` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.13 Native services

The `Native services` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.14 Filesystem

The `Filesystem` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.15 Processes

The `Processes` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.16 PTYs

The `PTYs` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.17 Workers

The `Workers` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.18 Jobs

The `Jobs` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.19 SQLite

The `SQLite` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.20 Settings

The `Settings` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.21 Secrets

The `Secrets` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.22 Event log

The `Event log` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.23 Permissions

The `Permissions` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.24 Approvals

The `Approvals` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.25 Commands

The `Commands` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.26 Menus

The `Menus` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.27 Shortcuts

The `Shortcuts` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.28 Devtools

The `Devtools` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.29 Testing

The `Testing` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.30 Mocking

The `Mocking` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.31 Packaging

The `Packaging` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.32 Signing

The `Signing` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.33 Updating

The `Updating` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.34 Troubleshooting

The `Troubleshooting` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.35 Contributing

The `Contributing` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.

## I.36 Release process

The `Release process` documentation page must include:

- purpose;
- prerequisites;
- minimal example;
- complete example;
- common errors;
- validation command;
- related APIs;
- security notes where applicable;
- platform notes where applicable;
- links to example applications where applicable.


\newpage

# Appendix J. Versioning and Release Management

## J.1 Pre-v1 behavior

Before v1.0.0, breaking changes are allowed when they improve architecture, safety, type soundness, or developer experience. Breaking changes must still be documented in release notes.

## J.2 v1 behavior

At v1.0.0, public APIs become stable unless explicitly marked experimental. Experimental APIs must be namespaced or annotated.

## J.3 Package versioning

All official packages should ship with aligned versions for v1.0.0. Internal packages may remain private.

## J.4 Release notes

Release notes must include:

- major changes;
- new APIs;
- changed APIs;
- removed APIs;
- migration notes;
- security notes;
- platform notes;
- known issues;
- validation status.

## J.5 Backward compatibility rules

Post-v1 changes require:

- deprecation period for public APIs;
- migration guide;
- test coverage for old and new behavior during deprecation;
- clear removal version.

