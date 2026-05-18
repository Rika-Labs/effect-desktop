# Effect Desktop v1.0.0 - 0-to-1 Framework Build Specification

**Document type:** Agent-executable product, architecture, implementation, and verification specification  
**Audience:** framework maintainers, implementation agents, technical leads, contributors, QA, release engineering  
**Status:** Draft specification for v1.0.0  
**Generated:** 2026-05-03  
**Primary artifact:** `SPEC.md`

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
- Appendix K. Cross-Platform Capability Matrix (normative per §11.0).
- Appendix L. Rust Error Mapping and Panic Safety.
- Appendix M. Security and Supply-Chain Checklist.
- Appendix N. Resource Handle and Lifecycle Semantics.
- Appendix O. Verification Matrix Additions (renumbered into the Appendix C namespace).

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

## Spec conformance rules

Normative words are used with their RFC 2119 meaning:

- **must** and **required** are release-blocking.
- **should** is the default expected path; deviations require a documented reason in the milestone report or an ADR if the behavior is public.
- **may** is optional and cannot block v1.0.0.

Code examples are non-normative unless the surrounding section says they are the canonical shape. Tables labeled normative are release-blocking.

Every public method added to the framework must have, in the same change:

- an input schema name and output schema name;
- a closed public error set;
- permission or capability behavior;
- resource ownership and disposal behavior where applicable;
- platform support in Appendix K;
- at least one verification row in Appendix C.

A public method whose contract still contains placeholder `unknown` input or output types is not v1.0.0-complete.

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

A new user should be able to create, run, and package a basic app by following the framework docs and composing public package APIs:

```bash
bun run desktop build --config path/to/desktop.config.ts
bun run desktop package --config path/to/desktop.config.ts
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

## 3.3 Example and template policy

The repository does not currently ship examples, templates, playground apps, or a scaffold package. Framework behavior is validated through package tests, CLI gates, the inspector app, and release evidence.

Future examples are allowed only when they validate framework primitives. Example applications must remain generic and must not become product strategy. They must not introduce public APIs that only make sense for one application category.

## 3.4 Boundary test

When considering a feature, ask:

> Would two unrelated desktop applications both benefit from this primitive?

If yes, it may belong in the framework. If no, it likely belongs in an application, template, plugin, or ecosystem package.

## 3.5 In-scope clarifications

Several desktop concerns sit close to the boundary. v1.0.0 explicitly includes:

- deep links and custom URL scheme registration;
- single-instance lock and second-instance event delivery;
- file association registration and `onOpenFile` delivery;
- drag-and-drop into the renderer (file paths, text, custom MIME);
- dock badge counts (macOS), taskbar overlay (Windows), launcher counters (Linux where supported);
- jump lists (Windows), dock menus (macOS);
- system appearance (light/dark/high-contrast) and accent color;
- `prefers-reduced-motion` and `prefers-color-scheme` propagation;
- HiDPI and per-window scale factor reporting.

The corresponding primitives appear under §11 (`App`, `Window`, `SystemAppearance`, `Dock`).

v1.0.0 explicitly excludes (moved here from informal omissions):

- IME composition events (renderer uses standard browser IME);
- accessibility tree exposure beyond what the WebView already provides;
- MIDI device access;
- Touch Bar (macOS) APIs;
- Services menu (macOS) integration;
- Spotlight / Search indexing integration;
- Continuity / Handoff;
- camera, microphone, and screen-capture APIs (renderer must use standard `getUserMedia` with system permission flow).

These exclusions exist because their cost-to-correctness ratio is unfavorable for v1.0.0. Each can become a v2 primitive when justified by two unrelated examples.

## 3.6 Security and disclosure scope

Effect Desktop is a security-sensitive substrate. v1.0.0 ships with:

- `security.txt` at `/.well-known/security.txt` in the documentation site and in the source repository at `docs/.well-known/security.txt`;
- a vulnerability disclosure SLA of 24 hours for critical, 7 days for high, 30 days for medium severity issues;
- a 90-day embargo policy for pre-release coordination with downstream apps;
- a `[Security]` section in every release changelog when applicable;
- an Appendix M supply-chain checklist that gates every release.

The security model is documented end-to-end in §14, §22, §23, and Appendix M.

\newpage

# 4. Technology Stack

## 4.1 Stack summary

The v1.0.0 stack is:

| Layer                       | Required choice                           | Purpose                                                               |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| Monorepo package manager    | Bun workspaces                            | Package installation, workspace linking, Bun-first development        |
| Task orchestration          | Turborepo                                 | Cached and ordered workspace tasks                                    |
| Runtime                     | Bun                                       | TypeScript runtime, package tooling, filesystem, subprocesses, SQLite |
| Application model           | Effect                                    | Services, layers, resource scopes, errors, streams, concurrency       |
| Contract validation         | Effect Schema                             | Runtime validation and generated bridge contracts                     |
| Native host language        | Rust                                      | Cross-platform native shell and host process                          |
| Native window/WebView stack | WRY + TAO                                 | System WebView and native window event loop                           |
| Renderer                    | React                                     | Web UI model                                                          |
| Styling                     | Tailwind CSS                              | Utility-first styling in renderer templates                           |
| Dev server/build            | Vite-compatible pipeline                  | Fast renderer development and HMR                                     |
| Type checking               | TypeScript strict mode                    | Compile-time correctness                                              |
| Linting                     | Oxlint                                    | Fast TypeScript linting                                               |
| Formatting                  | Prettier for TS/MD, rustfmt for Rust      | Formatting consistency                                                |
| Rust quality                | cargo test, clippy                        | Native host correctness                                               |
| Testing                     | bun test, cargo test, integration harness | Unit and integration validation                                       |
| Packaging                   | first-party CLI                           | Package, sign, notarize, publish, update                              |

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

### 4.4.1 Effect v4 baseline

The framework targets **Effect v4** as its baseline runtime. v3 patterns are forbidden in v1.0.0 source. Concretely:

- The package is a single import: `import { Effect, Schema, Layer, Stream, Context, Cause, Exit, Scope } from "effect"`. There is **no** separate `@effect/schema` package — `Schema` lives in core. A spec or example that imports `@effect/schema` must be updated.
- The canonical type is `Effect.Effect<A, E, R>` — success type first, error type second, requirements (services) third. `R = never` is required when no services are needed; do not omit it in public type signatures.
- The canonical class-based service shape is:

  ```ts
  class UserRepository extends Context.Service<UserRepository, UserRepositoryApi>()(
    "UserRepository",
    {
      make: Effect.gen(function* () {
        const ref = yield* Ref.make<Array<User>>([])
        return {
          findMany: () => Ref.get(ref),
          create: (name: string) => Ref.update(ref, (xs) => [...xs, { name }])
        }
      })
    }
  ) {}

  // Provide its default layer:
  // someProgram.pipe(Effect.provide(UserRepository.Default))
  ```

- The canonical schema-class shape is:

  ```ts
  class User extends Schema.Class<User>("User")({
    id: Schema.String,
    name: Schema.String
  }) {}
  ```

- `Effect.gen(function* () { ... yield* effect })` is used **without** the `$` adapter. The adapter form `Effect.gen(function* ($) { yield* $(effect) })` was a v3 workaround for TypeScript ≤ 5.4 type inference and is forbidden in v1.0.0 source.
- Service tags use `Context.Tag(...)` for ad-hoc shapes; the class-style `Context.Service` is preferred when the service has a default layer.
- Schemas decode and encode with `Schema.decodeUnknown(schema)(value)` returning an `Effect`; `Schema.decodeUnknownPromise` is allowed only at imperative boundaries.
- Layer composition uses `Layer.provide`, `Layer.provideMerge`, `Layer.succeed`, `Layer.effect`. Layer order in tests follows v4 semantics: dependencies are provided right-to-left in the pipe.
- `Stream` is a first-class part of core; the bridge's stream contracts compile to `Stream.Stream<A, E, R>` on the runtime side.

### 4.4.2 v3 → v4 migration policy

If a future external dependency is published only against Effect v3, the framework shims it inside its consuming package — never in core. The shim wraps the v3 surface in a v4 service before re-export. A direct v3 import in a `packages/*` source file is a check-time error:

```bash
bun desktop check  # fails on `from "@effect/schema"` or any other v3-only import
```

A failing v3 dependency that cannot be shimmed within one milestone is logged in the risk register and tracked toward replacement.

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

Every added dependency must be recorded in `engineering/decisions` or in the relevant package README if it becomes part of the public design.

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
- one explicit place for first-party apps;
- easier cross-package refactors;
- better agent execution context.

## 5.2 Root structure

```txt
effect-desktop/
  apps/
    inspector/

  packages/
    core/
    bridge/
    native/
    vite/
    react/
    vue/
    solid/
    next/
    astro/
    cli/
    devtools/
    test/
    config/

  crates/
    host/
    host-protocol/
    native-pty/
    native-updater/

  docs/
    README.md
    *.md

  engineering/
    SPEC.md
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
- First-party apps live under `apps/` and must use public package APIs unless they are explicitly testing an internal boundary.
- Internal scripts live under `scripts/` and must not be imported by applications.
- Rust crates live under `crates/`.
- Templates, examples, playground apps, and scaffold packages are not current repository surfaces.
- Generated files must be explicitly marked and should not be hand-edited.
- Package boundaries must be enforced by TypeScript path rules and lint rules.
- First-party apps must not import private internals unless the import is covered by a focused internal test.

## 5.4 Root package.json requirements

The root `package.json` must declare Bun workspaces and shared scripts.

```json
{
  "name": "effect-desktop-repo",
  "private": true,
  "packageManager": "bun@latest",
  "workspaces": ["apps/*", "packages/*"],
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
```

## 6.1 `packages/core`

**Purpose:** Public framework API and runtime contracts.

### Required exports

- `Desktop.run`
- `Desktop.window`
- `Desktop.Rpcs`
- `Desktop.Resource`
- `Desktop.Command`
- `Desktop.Capability`
- `Desktop.Errors`
- `Desktop.Config`

`Desktop.*` are thin facades over Effect v4 primitives (per §4.4.1). `Desktop.Errors.*` are `Schema.Class<E>` declarations. `Desktop.Rpcs.layer(...)` binds an Effect `RpcGroup` to its handler layer. `Desktop.Stream` is `Stream.Stream<A, E, R>` re-exported with stream-contract metadata. Framework facades exist to keep app-author code terse; they must not hide v4 semantics.

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

Every native primitive defined in §11 has exactly one TypeScript binding here. There are no orphaned primitives.

### Required exports

- `App`
- `Window`
- `WebView`
- `Dialog`
- `Menu`
- `ContextMenu`
- `Tray`
- `Clipboard`
- `Notification`
- `Shell`
- `Screen`
- `GlobalShortcut`
- `Protocol`
- `SafeStorage`
- `Path`
- `Updater`
- `CrashReporter`
- `PowerMonitor`
- `SystemAppearance`
- `Dock`

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

## 6.9 Scaffolding package

There is no scaffolding package. The repository does not ship `create-effect-desktop`.

### Required exports

None.

### Requirements

- Do not add a scaffolding package without a new architecture decision.
- Do not reintroduce repository templates as scaffolding input.

## 6.10 Service-to-package ownership matrix

Every primitive in §11 (native) and §12 (runtime) maps to exactly one package and (where relevant) exactly one Rust crate. A primitive without a row here cannot ship.

| Primitive            | TypeScript package       | Rust crate                              | Category |
| -------------------- | ------------------------ | --------------------------------------- | -------- |
| `App`                | `@effect-desktop/native` | `crates/host`                           | native   |
| `Window`             | `@effect-desktop/native` | `crates/host`                           | native   |
| `WebView`            | `@effect-desktop/native` | `crates/host`                           | native   |
| `Menu`               | `@effect-desktop/native` | `crates/host`                           | native   |
| `ContextMenu`        | `@effect-desktop/native` | `crates/host`                           | native   |
| `Tray`               | `@effect-desktop/native` | `crates/host`                           | native   |
| `Dialog`             | `@effect-desktop/native` | `crates/host`                           | native   |
| `Clipboard`          | `@effect-desktop/native` | `crates/host`                           | native   |
| `Notification`       | `@effect-desktop/native` | `crates/host`                           | native   |
| `Shell`              | `@effect-desktop/native` | `crates/host`                           | native   |
| `Screen`             | `@effect-desktop/native` | `crates/host`                           | native   |
| `GlobalShortcut`     | `@effect-desktop/native` | `crates/host`                           | native   |
| `Protocol`           | `@effect-desktop/native` | `crates/host`                           | native   |
| `SafeStorage`        | `@effect-desktop/native` | `crates/host`                           | native   |
| `Path`               | `@effect-desktop/native` | `crates/host`                           | native   |
| `Updater`            | `@effect-desktop/native` | `crates/host` + `crates/native-updater` | native   |
| `CrashReporter`      | `@effect-desktop/native` | `crates/host`                           | native   |
| `PowerMonitor`       | `@effect-desktop/native` | `crates/host`                           | native   |
| `SystemAppearance`   | `@effect-desktop/native` | `crates/host`                           | native   |
| `Dock`               | `@effect-desktop/native` | `crates/host`                           | native   |
| `Filesystem`         | `@effect-desktop/core`   | —                                       | runtime  |
| `Process`            | `@effect-desktop/core`   | —                                       | runtime  |
| `PTY`                | `@effect-desktop/core`   | `crates/native-pty`                     | runtime  |
| `Worker`             | `@effect-desktop/core`   | —                                       | runtime  |
| `Job`                | `@effect-desktop/core`   | —                                       | runtime  |
| `SqlClientLive`      | `@effect-desktop/core`   | —                                       | runtime  |
| `Settings`           | `@effect-desktop/core`   | —                                       | runtime  |
| `Secrets`            | `@effect-desktop/core`   | `crates/host` (SafeStorage backend)     | runtime  |
| `EventLog`           | `@effect-desktop/core`   | —                                       | runtime  |
| `Transport`          | `@effect-desktop/core`   | —                                       | runtime  |
| `CommandRegistry`    | `@effect-desktop/core`   | —                                       | runtime  |
| `ApprovalBroker`     | `@effect-desktop/core`   | `crates/host` (UI surface)              | runtime  |
| `PermissionRegistry` | `@effect-desktop/core`   | —                                       | runtime  |
| `ResourceRegistry`   | `@effect-desktop/core`   | —                                       | runtime  |
| `Telemetry`          | `@effect-desktop/core`   | —                                       | runtime  |
| `WindowState`        | `@effect-desktop/core`   | —                                       | runtime  |

A package may not export a primitive whose row says it lives elsewhere. A new primitive must add a row here in the same PR that introduces it.

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

### Panic safety contract

Every FFI entry point and every protocol-handler entry point wraps its body in `std::panic::catch_unwind` (or the `host_call!` macro that does so). A panic converts to a typed error before the boundary:

```rust
HostProtocolError::PanicInNativeCode {
    message: String,
    backtrace: Option<String>, // present only if RUST_BACKTRACE is set
    location: Option<String>,  // file:line if available
}
```

Forbidden idioms on FFI / protocol-handler paths:

- `unwrap()`, `expect()`, `panic!()`, `unreachable!()`, `todo!()` outside of compile-time constants;
- direct slice indexing (`xs[i]`) without prior bounds check;
- `Mutex::lock().unwrap()` — must use `try_lock` or recover from poisoning;
- `RefCell::borrow_mut()` without a documented invariant.

Clippy lints `clippy::unwrap_used`, `clippy::expect_used`, `clippy::indexing_slicing` are denied for modules under `crates/host/src/ffi/**` and `crates/host/src/protocol/**`. Other modules may opt in.

### Thread model

- Host runtime is `tokio` multi-threaded for protocol I/O, runtime supervision, and non-UI work.
- A dedicated single-threaded executor runs the OS event loop. On macOS this is the main thread; on Windows it is the message-pump thread; on Linux it is the GTK main loop.
- Operations on `Window`, `Menu`, `Tray`, `Dialog`, `ContextMenu`, `Dock`, `WebView` (creation, navigation, focus) **must** be posted to the event-loop thread. Calling them from a tokio worker is undefined and forbidden.
- Operations on `Filesystem`, `Process`, `PTY`, runtime SQLite, `Settings`, `Secrets`, `Clipboard`, `Shell`, `Path`, `SafeStorage`, `EventLog` may run on tokio workers and must be `Send + Sync` where they cross await points.
- `host_call!` macro encodes the routing decision: any handler that targets an event-loop primitive automatically posts via the loop's message channel and awaits the result.
- The runtime process itself runs in `bun` and communicates via the host protocol over the configured transport — no direct shared memory.

### Canonical error type

`crates/host` re-exports `HostProtocolError` from `crates/host-protocol` (see Appendix L). Native methods must return that enum — no `Box<dyn Error>` and no string-typed errors at the protocol boundary.

### Validation

- `cargo check --workspace` passes.
- `cargo test --workspace` passes.
- `cargo clippy --workspace --all-targets -- -D warnings` passes.
- `cargo clippy -p host -- -W clippy::unwrap_used -W clippy::expect_used -W clippy::indexing_slicing -D warnings` passes for FFI and protocol modules.
- Host protocol compatibility tests pass.
- Platform smoke tests pass on target operating systems.
- A `tests/panic_safety.rs` integration test asserts that a panicking handler returns `PanicInNativeCode` rather than aborting the process.

## 7.2 `crates/host-protocol`

**Purpose:** Shared Rust protocol schema.

### Responsibilities

- host request types.
- host response types.
- runtime event types.
- the canonical `HostProtocolError` enum (see Appendix L for the full set of tags and the platform-error mapping table).
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

The architecture intentionally separates responsibilities. The native host owns platform integration. The Bun runtime owns application services. The renderer owns UI.

The framework has three hard authority boundaries:

- **Host boundary:** the Rust host owns OS integration only. It owns native windows, WebViews, menus, tray, native dialogs, updater hooks, secure storage adapters, protocol registration, and host crash reporting. It must not own application services, Effect service graphs, product commands, business data, renderer policy, or domain-specific lifecycle.
- **Runtime boundary:** the Bun + Effect runtime owns application authority. It owns contracts, handlers, scopes, resources, policies, commands, filesystem/process abstractions, workers, jobs, event log, settings, telemetry, and permission decisions.
- **Renderer boundary:** the renderer owns UI only. It receives generated clients, plain data, streams, and resource handles. It must not receive raw transport access, native host access, ambient filesystem/process authority, or permission bypasses.

All privileged behavior must cross exactly one named capability boundary. If a feature requires native OS access, the runtime authorizes the operation and calls a host adapter. If a renderer needs privileged behavior, it calls a generated contract client and receives either data, a stream, a typed error, or a scoped resource handle.

Authority, lifecycle, and transport are separate concepts. A module that moves bytes must not decide permissions. A module that decides permissions must not own resource lifetime. A module that owns lifetime must not hide transport failure.

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

### Process group and parent-death cleanup

The host owns the runtime's process lifetime. Implementation requirements:

- **POSIX (macOS, Linux):** the host calls `setpgid(0, 0)` in the spawned runtime so the runtime becomes the leader of its own process group. On host exit (clean or crash), the host sends `SIGTERM` to the runtime's pgid, then `SIGKILL` after 5 seconds. If the host itself is killed by `SIGKILL` and cannot run cleanup, the runtime detects parent-death via `prctl(PR_SET_PDEATHSIG, SIGTERM)` on Linux, or by polling `getppid() == 1` on macOS, and exits its own process group.
- **Windows:** the host creates a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK` and assigns the runtime to it. On host exit (any cause) Windows terminates every process in the Job.
- **PTY children:** every PTY spawned by the runtime is in **its own process group**, separate from the runtime. Window/scope close issues `SIGTERM` to the PTY pgid then `SIGKILL` after 5 seconds, and the runtime calls `waitpid` to reap the zombie. On Windows, each PTY child is in its own Job Object owned by the runtime.

A runtime may have spawned children. Child cleanup is the runtime's responsibility, transitively. The host cleans up the runtime; the runtime cleans up everything it spawned. No process can outlive its registered owner.

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

### Heartbeat protocol

Host and runtime exchange heartbeats over the host protocol:

- host → runtime ping every 1 second, runtime must reply within 1 second;
- runtime → host event every 2 seconds (`runtime.heartbeat` with monotonic counter);
- 3 consecutive missed pings (≥3 seconds silence) trigger reconnect attempt;
- 6 consecutive missed pings (≥6 seconds silence) trigger forced restart of the silent peer.

Heartbeat misses are recorded in the trace ring buffer (§22.6) and surface in devtools.

### Recovery paths

- **Host restart (host crashed, supervisor relaunches):** the new host scans for orphaned runtime processes by their well-known process group / Job Object name, kills them, then respawns a fresh runtime.
- **Runtime restart (runtime crashed or was killed):** every open WebView displays a "Reconnecting…" overlay and disables user input until the new runtime sends `runtime.ready`. All in-flight bridge calls are failed with `RuntimeRestarted`. All open streams are terminated with terminal frame `Error { tag: "RuntimeRestarted" }` after a 30-second reconnect window. After reconnect, idempotent calls (per §10.3) may be replayed by the renderer client; non-idempotent calls return the typed error to user code.
- **Renderer disconnect (WebView reload, navigation, crash):** see §9.7. A 30-second reconnect window allows resumption with the same `originToken`. Past the window, the runtime tears down the renderer's resource scopes.
- **Worker crash:** see §12.4. Default supervisor strategy is `restart-with-exponential-backoff` capped at 5 attempts; on exceedance the worker fails open and emits `WorkerSupervisorGaveUp` to the audit log.

All four paths emit structured audit events that include the trace ID active at the time of the failure.

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

## 8.7 Lifecycle state machines

Lifecycle must be modeled explicitly. Desktop failures are usually lifecycle failures: startup races, renderer reloads, runtime crashes, orphaned streams, stale handles, duplicate shutdown, or partial initialization.

The implementation must define observable state machines for:

- host lifecycle;
- runtime lifecycle;
- renderer connection lifecycle;
- window lifecycle;
- bridge call lifecycle;
- stream lifecycle;
- resource lifecycle;
- updater lifecycle.

State machines may be implemented as plain TypeScript discriminated unions, Rust enums, or Effect data types. The required property is not a specific library. The required property is that invalid transitions are rejected, logged, and tested.

Minimum lifecycle rules:

- startup must not create renderer-visible windows before protocol compatibility is known;
- shutdown must reject new non-shutdown-safe work;
- renderer reload must revoke renderer-scoped handles and subscriptions;
- runtime crash must close or invalidate runtime-owned resources before restart;
- window close must cancel streams and dispose handles scoped to that window;
- stream completion, cancellation, and failure must be distinct terminal states;
- resource disposal must be idempotent and observable;
- stale handles must fail with typed errors, not no-op silently.

## 8.8 Multi-window event routing

Apps with more than one window need explicit answers to "which window receives this event?" The framework defines a routing mode per App-level event. Apps may override per-window via `App.subscribe(event, { route })`.

| Event                                                    | Default routing                       | Notes                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onOpenFile` (macOS Dock drop, Windows file association) | `firstResponder`                      | Delivered to the focused window. If no window is open, the event is buffered until the first window appears, max 1 buffered event of each kind.                                           |
| `onOpenUrl` (custom protocol handler)                    | `firstResponder`                      | Same buffering rule. URL is also recorded in `App.getCommandLine()` for late subscribers.                                                                                                 |
| `onSecondInstance`                                       | `broadcast`                           | Every window receives the second-instance event with the duplicate launch's argv. Apps typically focus the primary window in the handler.                                                 |
| `onActivated` (Dock click, taskbar restore)              | `firstResponder`                      | Re-emits even if the focused window is hidden; default behavior is to show it.                                                                                                            |
| `onWillQuit`                                             | `broadcast`                           | Every window receives it; any handler returning a refusal cancels the quit.                                                                                                               |
| `onAppearanceChanged`                                    | `broadcast`                           | Every window must update; renderer also receives `prefers-color-scheme` event.                                                                                                            |
| `GlobalShortcut` press                                   | `targeted(registrarWindowId)`         | Shortcut handler fires on the window that registered it, regardless of which window is focused.                                                                                           |
| `Tray` activation                                        | `targeted(trayOwnerWindowId)`         | Tray clicks deliver to the window that constructed the `Tray`.                                                                                                                            |
| `Notification` interaction                               | `targeted(notificationOwnerWindowId)` | Click and action callbacks deliver to the window that posted the notification. Notification survives the window only if `App.subscribe('onNotificationActivated')` registered a fallback. |

Routing modes:

- **firstResponder:** delivered to the currently key/focused window; if no key window, buffered (per-event-kind, max 1) until one exists; if buffer evicts, the older event is dropped and an `EventBufferEvicted` audit row is emitted.
- **broadcast:** delivered to every open window in creation order; handlers run sequentially; first refusal short-circuits if the event supports cancellation.
- **targeted(windowId):** delivered to the named window; if the target was closed before delivery, the event is dropped and an `EventDroppedTargetClosed` audit row is emitted.

Per-platform notes:

- macOS: `firstResponder` matches `NSApp.keyWindow` semantics.
- Windows: `firstResponder` matches the foreground HWND owned by this process.
- Linux (GNOME/KDE/Wayland): `firstResponder` matches the toplevel with `is_active` set; on Wayland this can be ambiguous if no window has explicit focus, in which case the event falls back to broadcast.

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
  windowId?: WindowId // required on requests originating in a renderer
  originToken?: string // required on requests originating in a renderer
  payload?: unknown
  error?: HostProtocolError
}
```

Rules:

- Requests require `id` and `method`.
- Responses require `id`.
- Events require `method`.
- Stream frames require `resourceId` or `id`.
- Renderer-originated requests require `windowId` **and** `originToken`. The runtime rejects the request with `OriginInvalid` if either is absent, mismatched, or revoked.

### Origin authentication

Each WebView is issued a per-launch `originToken` at creation time. The token is held in the host's protocol-handler closure and is **never** exposed to JavaScript or to the renderer process. The host injects the token into every privileged message it forwards from a WebView to the runtime; a renderer cannot mint or guess a valid token.

- Tokens are 256 bits of cryptographically secure randomness.
- Tokens rotate on top-level navigation and on WebView reload; the previous token is revoked immediately.
- Devtools connections use a separate token namespace; devtools cannot impersonate a renderer.

The runtime stores `(windowId → originToken)` and rejects any mismatched envelope. The combination defends against:

- a hostile page loaded into a misconfigured WebView trying to spoof the trusted renderer's origin;
- a malicious devtools session trying to invoke privileged bridge methods.

### Framing limits

| Limit                            | Value | Behavior on exceedance                                                                              |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `maxFrameBytes`                  | 4 MiB | Connection rejects frame with `FrameTooLarge`; offending peer is logged and may be reset on repeat. |
| `maxConcurrentRequestsPerWindow` | 256   | New request rejected with `RateLimited { retryAfterMs }`.                                           |
| `maxConcurrentStreamsPerWindow`  | 64    | New stream rejected with `RateLimited`.                                                             |
| `maxQueuedEventsPerSubscription` | 1024  | Backpressure policy applies (§10.6).                                                                |

These limits are configurable in `desktop.config.ts` under `protocol.limits` for power users; they cannot be set above 16 MiB / 4096 / 1024 / 65536 respectively.

- Cancel messages require the target request or resource ID.
- Errors must be structured.
- Payloads must be schema-validated by the TypeScript-facing service.

## 9.4 Error envelope

```ts
type HostProtocolError = {
  tag: HostProtocolErrorTag
  message: string
  operation: string
  platform?: "macos" | "windows" | "linux"
  code?: string
  cause?: unknown
  recoverable: boolean
  remediation?: string
  docsUrl?: string
}
```

`HostProtocolErrorTag` is a closed union versioned with the protocol. Appendix L is the canonical registry for host-wire errors and defines recoverability defaults. Bridge/runtime/updater/config errors are canonicalized in §10.8 and mapped into the public `DesktopError` shape from §19.7 before renderer exposure.

The v1.0.0 host-wire tag set is:

`FileNotFound | PermissionDenied | Timeout | Cancelled | Unsupported | InvalidArgument | ResourceBusy | DiskFull | RateLimited | FrameTooLarge | OriginInvalid | StaleHandle | CrossScopeHandle | BackpressureOverflow | RendererDisconnected | RuntimeRestarted | RuntimeUnavailable | HostUnavailable | MethodNotFound | InvalidOutput | PermissionRevoked | StreamClosed | BinaryDecodeError | ReconnectBackfillExhausted | PanicInNativeCode | NetworkError | NotFound | AlreadyExists | InvalidState | SymlinkEscapesRoot | EventLogFull | UpdateDowngradeRefused | UpdateDownloadTruncated | UpdateStaleNotarization | SettingsMigrationFailed | SettingsRecoveredFromBackup | EventLogSegmentCorrupt | PtyForceKillTimeout | Internal`.

Errors must not be plain strings. Host errors must be mapped to typed runtime errors before crossing to the renderer.

Each tag carries a documented `recoverable: boolean` default and a documented `retryAfterMs?: number` for transient errors.

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
- documentation;
- a documented **`Returns errors`** list naming every `HostProtocolErrorTag` the method may produce. This list is part of the public contract and is asserted by the bridge contract test suite.

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
- Renderer disconnect with reconnect inside the window resumes (per §9.7).
- Spoofed `windowId`/`originToken` is rejected with `OriginInvalid`.
- Frame larger than `maxFrameBytes` is rejected with `FrameTooLarge`.

## 9.7 Renderer reconnect

A renderer can disconnect for legitimate reasons: navigation, reload during dev, WebView crash recovery, runtime restart. The protocol must distinguish reconnect from a fresh launch.

### Token-bound resume

On disconnect, the host creates a host-owned `ResumeTicket`:

```ts
type ResumeTicket = {
  windowId: WindowId
  originTokenHash: string
  resumeNonce: string
  expiresAt: number
  lastStreamCursors: Record<string, string>
}
```

The raw `originToken` remains inside the host protocol-handler closure and is never exposed to JavaScript. The `ResumeTicket` is stored by the host and runtime for `reconnectWindowMs` (default 30 seconds, configurable). A replacement WebView resumes by asking the host to attach the ticket to the new privileged protocol handler; renderer JavaScript never presents or observes the token.

During the reconnect window:

- a fresh WebView can resume only when the host attaches a valid, unexpired `ResumeTicket` for the same `windowId`;
- the runtime replays missed events from each stream's cursor up to `maxBackfillEvents` (default 1024); if the stream's buffer has rotated past the cursor, the stream is terminated with `Error { tag: "ReconnectBackfillExhausted" }`.

Top-level navigation to an origin outside the active `WebView` navigation policy invalidates the ticket immediately. Development reloads and same-app `app://` route reloads rotate the underlying token but preserve the ticket until expiry. After the window closes, the scope graph for that renderer is torn down, all owned resources disposed, and the ticket is invalidated. A future connection must mint a new token via WebView creation.

### In-flight call disposition

| Call attribute                                         | Disconnect inside reconnect window                                                                                                                 | Reconnect window expired                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `idempotent: true`                                     | Replayed by the renderer client; runtime de-duplicates by `requestId`.                                                                             | Failed to user code with `RendererDisconnected { duration }`.   |
| `idempotent: false`, runtime side **not yet executed** | Auto-cancelled; renderer sees `RendererDisconnected`.                                                                                              | Failed to user code.                                            |
| `idempotent: false`, runtime side **executing**        | Effect runs to completion; result is cached for `cachedResultMs` (default 60 seconds) and returned on resume; otherwise dropped after that window. | Result discarded.                                               |
| Stream subscription                                    | Resumed with backfill if cursor still in buffer; otherwise terminated.                                                                             | Stream terminated with `Error { tag: "RendererDisconnected" }`. |

### Reconnect protocol sequence

```
renderer disconnect
  ↓ (host marks WebView gone, starts reconnect window timer)
runtime emits "renderer.disconnected" with windowId + traceId
  ↓
new WebView constructed (or existing one navigated)
  ↓
renderer client opens protocol, sends "renderer.resume" {
    windowId,
    resumeNonce,
    cursors: { streamId → lastEventId }
  }
host injects fresh originToken; runtime validates token hash + ticket window
  ↓ (yes) → runtime replays buffered events, emits "renderer.resumed"
  ↓ (no)  → runtime returns "renderer.resume.denied" with reason; renderer treats as fresh launch
```

The renderer SDK provides `useDesktopReconnectStatus()` so apps can render the "Reconnecting…" overlay (§19.4) automatically.

\newpage

# 10. Typed Bridge Architecture

## 10.1 Bridge purpose

The typed bridge is the core differentiator of the framework. It connects renderer code to runtime services without exposing raw IPC, native access, or unvalidated payloads.

The word bridge names the public developer surface, not one internal subsystem. Internally, the bridge must keep these concerns separate:

- **Transport:** moves frames between processes or execution contexts.
- **Protocol:** defines envelopes, request IDs, stream frames, cancellation, versioning, and compatibility rules.
- **Contracts:** define methods, inputs, outputs, typed errors, streams, resources, and metadata.
- **Authorization:** decides whether a call may execute for this actor, window, resource, and capability.
- **Handlers:** execute runtime services after validation and authorization.
- **Resource registry:** owns lifetime for handles returned to renderers.

The public bridge package may compose these pieces. It must not complect them. Transport must not perform authorization. Authorization must not know frame encoding. Contracts must not own resource lifetime.

The bridge public surface must generate:

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
import { Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Desktop } from "@effect-desktop/core"

export const ProjectOpen = Rpc.make("project.open", {
  payload: Schema.Struct({ path: Schema.String }),
  success: Project,
  error: Schema.Union(Desktop.Errors.PermissionDenied, Desktop.Errors.FileNotFound)
}).pipe(Desktop.RpcEndpoint.mutation, Desktop.RpcCapability({ kind: "project:open" }))

export const ProjectWatch = Rpc.make("project.watch", {
  payload: Schema.Struct({ projectId: Schema.String }),
  success: ProjectEvent,
  error: Schema.Union(Desktop.Errors.PermissionDenied, Desktop.Errors.NotFound)
}).pipe(Desktop.RpcEndpoint.query, Desktop.RpcCapability({ kind: "project:watch" }))
```

### Required and default fields

| Field                   | Type                                                 | Default   | Notes                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`             | `number`                                             | `30_000`  | Typed milliseconds. Strings such as `"30 seconds"` are not accepted. `0` disables the timeout (rare; must be justified per contract).                    |
| `idempotent`            | `boolean`                                            | `false`   | If `true`, the renderer client may auto-replay on reconnect (§9.7). Handler must produce the same result for the same input within `cachedResultMs`.     |
| `cancellable`           | `boolean`                                            | `true`    | If `false`, neither timeout nor renderer-side Effect interruption interrupts the handler; the result is delivered or dropped.                            |
| `backpressure.overflow` | `"error" \| "dropOldest" \| "dropNewest" \| "block"` | `"error"` | Behavior when the per-stream queue exceeds `size`. `"block"` applies upstream backpressure; `"error"` terminates the stream with `BackpressureOverflow`. |

A contract whose `idempotent` is `true` must declare a `cachedResultMs` (default `60_000`). The bridge generator emits a compile-time error on a contract that omits required fields.

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

## 10.5 Call lifecycle

Every bridge call must have an explicit lifecycle:

```ts
type BridgeCallState =
  | { tag: "Pending"; id: string; traceId: string; startedAt: number }
  | { tag: "Authorized"; id: string; capability: string }
  | { tag: "Running"; id: string; handler: string }
  | { tag: "Completed"; id: string; completedAt: number }
  | { tag: "Failed"; id: string; error: DesktopError }
  | { tag: "Canceled"; id: string; canceledBy: "renderer" | "runtime" | "host" }
  | { tag: "TimedOut"; id: string; timeoutMs: number }
```

Required call lifecycle rules:

- schema validation must happen before authorization;
- authorization must happen before handler execution;
- timeout and cancellation must interrupt running work where the handler supports interruption;
- terminal states must be emitted to observability;
- a completed, failed, canceled, or timed-out call must not emit later success frames;
- duplicate response frames must be rejected and logged.

### Interrupt and grace contract

Cancellation propagates from three sources: the renderer (via Effect fiber interruption, including runtime-edge `AbortSignal` run options), the runtime (timeout or scope close), and the host (window close). On cancellation:

1. The handler's owning Effect receives an interrupt within 50 ms of the cancellation signal.
2. The handler has up to 5 seconds (the **grace window**, configurable per contract via `interruptGraceMs`) to release resources and emit a final state.
3. If the handler has not reached a terminal state within the grace window, the runtime forces abort and emits an `BridgeCallAborted` audit event with the call ID, traceId, and grace exceedance metric.
4. Renderer-initiated cancellation remains Effect interruption for the caller. A typed `Cancelled` error is reserved for cancellation reported by the host/runtime protocol, not for the renderer client's local cancellation API.

Renderer cancel dispatch is best-effort protocol cleanup. Transport implementations must keep cancel sends bounded and interruption-friendly; an uninterruptible cancel send is a broken transport edge, not a supported cancellation mode.

Non-cancellable contracts (`cancellable: false`) skip steps 1–3; the result is delivered or dropped at the discretion of the runtime.

### Cancellation propagation

```
renderer Effect interrupt ─┐
runtime timeout            ─┤── any cancellation signal
host window close          ─┤
                            ▼
                     handler.interrupt()
                   ▼
            ≤5s grace window
                   ▼
        terminal ─or─ forced abort
                   ▼
          BridgeCallAborted audit
```

## 10.6 Stream requirements

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

### Stream identity

Every stream is identified by `streamId = (UUIDv7, generation)` minted by the runtime. The generation increments on each new subscription that reuses an `id` (rare, e.g., for resumable streams declared `idempotent: true`). The renderer client validates the generation; a frame whose generation is older than the local cursor is silently discarded with an audit row.

### Frame ordering and terminal state

A stream emits zero or more **data** frames followed by exactly one **terminal** frame. Terminal frames are:

- `Complete` — clean end of stream, no more data;
- `Error { tag, message, ... }` — stream errored mid-flight;
- `Closed` — owner disposed (scope close, window close, explicit cancel).

Rules:

- Terminal frame is always the last frame on the wire for that `streamId`.
- After a terminal frame, no further frames for that `streamId` are accepted; the runtime drops them with an audit row.
- Cleanup happens after both endpoints have observed the terminal frame **or** after a 30-second cleanup-grace timeout, whichever is first.
- A stream owner that disposes mid-stream emits `Closed` first; subsequent `Complete` or `Error` frames are dropped.

### Backpressure

Each subscription has a per-stream queue with capacity `size` (per contract). Overflow policy:

| `overflow`          | Behavior                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `"error"` (default) | Stream terminates with `Error { tag: "BackpressureOverflow", policy, lostFrames }`.                                     |
| `"dropOldest"`      | Older frames are evicted; an `EventBufferEvicted` audit row records the count.                                          |
| `"dropNewest"`      | New frames are discarded silently with an audit row.                                                                    |
| `"block"`           | Producer awaits room; back-pressure propagates to the source Effect. Use with care — slow consumers can stall handlers. |

Devtools surfaces queue depth, eviction counts, and current overflow policy per stream.

### Cleanup on window or scope close

When a window closes or its owning scope is disposed:

1. Streams owned by that scope emit terminal frame `Closed`.
2. The runtime waits up to `interruptGraceMs` (default 5 s) for the producer to drain.
3. On timeout, the producer is force-interrupted; remaining frames are dropped.
4. Resource handles bound to the stream are disposed in §13.4 order.

## 10.7 Resource handle requirements

A resource handle represents a runtime-owned resource referenced by the renderer.

```ts
import type { Effect } from "effect"

type ResourceHandle<Name extends string> = {
  readonly kind: Name
  readonly id: UUIDv7
  readonly generation: number
  readonly ownerScope: ScopeId
  dispose(): Effect.Effect<void, DesktopError, never>
}
```

Renderer-side wrappers may expose a `Promise`-based facade for ergonomic React usage; the underlying contract is `Effect.Effect<A, E, R>`.

Required handle behavior:

- handles are scoped to the creating window unless explicitly shared;
- handles are revoked when permissions are revoked;
- handles are disposed when the owning scope closes;
- handle methods are permission-checked;
- handle events are stream-backed;
- stale handles fail with typed errors;
- devtools can show owner, lifetime, methods, events, and status.

### Generation stamp

Every `(kind, id)` pair carries a monotonic `generation: u32`. The generation increments when:

- a previously disposed `id` is reused for a new resource (rare; only for handle kinds that explicitly opt in);
- the resource's authority changes substantively (e.g., capability migration).

Native methods that take a handle validate `generation`. A mismatch returns the typed error:

```ts
type StaleHandle = {
  tag: "StaleHandle"
  kind: ResourceKind
  id: UUIDv7
  expectedGeneration: number
  actualGeneration: number
}
```

The renderer SDK auto-discards handles after a `Closed` event and never re-presents stale handles to user code. User code that holds a handle past its `Closed` event sees `StaleHandle` on the next call.

### Cross-scope rules

A handle is owned by exactly one scope. Cross-scope use requires `Resource.share(handle, targetScope)` which returns a fresh handle with a new owner. Direct cross-scope use of a foreign handle:

- in development: emits a `CrossScopeHandle` warning and the call proceeds;
- in production: returns the `CrossScopeHandle` typed error.

## 10.8 Bridge failure modes

The bridge must gracefully handle every entry below. Each has a typed error and a corresponding Appendix C verification row.

| Failure mode                       | Typed error tag                               | Notes                                                                        |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| runtime unavailable                | `RuntimeUnavailable`                          | Renderer client retries with exponential backoff up to `runtimeReconnectMs`. |
| host unavailable                   | `HostUnavailable`                             | Fatal; renderer cannot recover.                                              |
| renderer disconnected              | `RendererDisconnected { duration }`           | See §9.7.                                                                    |
| runtime restarted                  | `RuntimeRestarted`                            | Streams terminate, idempotent calls auto-replay.                             |
| stale resource handle              | `StaleHandle`                                 | See §10.7.                                                                   |
| cross-scope handle                 | `CrossScopeHandle`                            | Dev-warn / prod-error.                                                       |
| method not registered              | `MethodNotFound`                              | Bridge generator catches at compile time; this is the runtime fallback.      |
| schema validation failure (input)  | `InvalidArgument`                             | Includes Zod / Schema decode trace in development.                           |
| schema validation failure (output) | `InvalidOutput`                               | Dev-only; surfaces handler bugs.                                             |
| permission denied                  | `PermissionDenied`                            | Includes the failing capability name.                                        |
| permission revoked mid-call        | `PermissionRevoked`                           | See §14.8.                                                                   |
| timeout                            | `Timeout { timeoutMs }`                       | Per §10.5 grace contract.                                                    |
| canceled by renderer               | `Cancelled { source: "renderer" }`            |                                                                              |
| canceled by runtime                | `Cancelled { source: "runtime" }`             |                                                                              |
| canceled by host                   | `Cancelled { source: "host" }`                | Window closed, etc.                                                          |
| stream closed                      | `StreamClosed`                                | Terminal frame `Closed`.                                                     |
| binary frame decode failure        | `BinaryDecodeError`                           |                                                                              |
| backpressure overflow              | `BackpressureOverflow { policy, lostFrames }` | See §10.6.                                                                   |
| frame too large                    | `FrameTooLarge { sizeBytes, limitBytes }`     | See §9.3.                                                                    |
| rate limited                       | `RateLimited { retryAfterMs }`                |                                                                              |
| origin invalid                     | `OriginInvalid`                               | Spoofed `windowId`/`originToken`.                                            |
| reconnect backfill exhausted       | `ReconnectBackfillExhausted`                  | See §9.7.                                                                    |
| handler panicked                   | `PanicInNativeCode` (Rust) / `Internal` (JS)  | Logged with backtrace.                                                       |

Every failure mode must have a typed error, an entry in Appendix C, and a test.

### Error registry ownership

Error tags are owned by the subsystem that first detects the failure:

| Registry                   | Tags                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host protocol              | `FileNotFound`, `PermissionDenied`, `Timeout`, `Cancelled`, `Unsupported`, `InvalidArgument`, `ResourceBusy`, `DiskFull`, `RateLimited`, `FrameTooLarge`, `OriginInvalid`, `PanicInNativeCode`, `NetworkError`, `NotFound`, `AlreadyExists`, `InvalidState`, `SymlinkEscapesRoot`, `Internal` |
| Bridge/runtime             | `RuntimeUnavailable`, `HostUnavailable`, `RendererDisconnected`, `RuntimeRestarted`, `StaleHandle`, `CrossScopeHandle`, `MethodNotFound`, `InvalidOutput`, `PermissionRevoked`, `StreamClosed`, `BinaryDecodeError`, `BackpressureOverflow`, `ReconnectBackfillExhausted`                     |
| Updater                    | `UpdateDowngradeRefused`, `UpdateDownloadTruncated`, `UpdateStaleNotarization`                                                                                                                                                                                                                |
| Storage/runtime primitives | `EventLogFull`, `SettingsMigrationFailed`, `SettingsRecoveredFromBackup`, `EventLogSegmentCorrupt`, `PtyForceKillTimeout`                                                                                                                                                                     |

All registries map to `DesktopError` before crossing to renderer code. Rust serializes only `HostProtocolError`; TypeScript services translate subsystem-local errors into renderer-facing `Desktop.Errors.*`.

\newpage

# 11. Native Primitive Requirements

Native primitives are TypeScript-facing services backed by Rust host operations. Each primitive must have a typed public API, host protocol messages, tests, permission behavior where needed, and documentation.

Native primitives should be boring and predictable. They should not express product behavior. They expose desktop capabilities that applications can compose.

## 11.0 Cross-platform support requirement

Every primitive in §11 must declare its cross-platform support shape. Declaration is normative: a primitive whose row is missing from **Appendix K — Cross-platform capability matrix** cannot ship.

Each primitive method has a per-platform status:

- **`✓` supported** — the operation works as documented;
- **`partial(reason)`** — the operation works with a documented reduction (e.g., no animation, no shadow, fallback rendering);
- **`error(tag, reason)`** — the operation returns the named typed error on this platform.

Apps must call `<Primitive>.isSupported(method)` (returns `boolean`) before invoking any method whose row is `partial` or `unsupported`. Calling without `isSupported` on an unsupported platform is a runtime error in development and returns the typed `Unsupported` error in production. The `bun desktop check --production` gate fails on contracts that omit guard calls for non-✓ methods.

Sizes, positions, and bounds returned or accepted by §11 primitives are in **logical pixels** unless explicitly named `Physical*`. Each window exposes `scaleFactor: number`. The `onScaleChanged` event fires when a window crosses display boundaries with different scale factors.

## 11.1 `App`

**Purpose:** Application lifecycle, single instance behavior, app metadata, quit, restart, open events. Open-at-login behavior belongs to `Autostart`, not `App`.

### Minimum method surface

- `App.getInfo`
- `App.getCommandLine`
- `App.quit`
- `App.restart`
- `App.requestSingleInstanceLock` — atomic OS-level lock; returns `{ acquired: boolean, primaryPid?: number }`. Implementation: macOS uses `flock` on a per-bundle path under `~/Library/Application Support/<bundle-id>/.single-instance.lock`; Windows uses a named mutex `Global\<bundle-id>`; Linux uses `flock` on `~/.config/<bundle-id>/.single-instance.lock`.
- `App.onSecondInstance` — receives `{ argv: string[], cwd: string, traceId: string }` from the duplicate launch attempt; routed `broadcast` per §8.8.
- `App.onOpenFile` — file association open event.
- `App.onOpenUrl` — custom URL scheme open event.
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
- `Window.setSize` — accepts logical pixels; emits `InvalidArgument` on non-positive size.
- `Window.setPosition`
- `Window.setBackgroundColor`
- `Window.setVibrancy(material)` — macOS only; `Unsupported` elsewhere.
- `Window.setHasShadow`
- `Window.enterFullScreen`
- `Window.exitFullScreen`
- `Window.onFullScreenChanged`
- `Window.getScaleFactor` — returns the current device pixel ratio (`1.0`, `1.5`, `2.0`, etc.).
- `Window.onScaleChanged` — fires when a window moves between displays with different scale factors.
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

- `WebView.create` — accepts `{ url, originPolicy: { allowedOrigins: string[], onDisallowed: "block" | "openExternal" } }`. The host mints a per-WebView `originToken` (§9.3) at construction.
- `WebView.loadRoute`
- `WebView.loadUrl`
- `WebView.reload`
- `WebView.goBack`
- `WebView.goForward`
- `WebView.captureScreenshot`
- `WebView.setNavigationPolicy({ allowedOrigins, onDisallowed })` — replaces the policy in place. Host blocks any navigation to a disallowed origin and emits `WebView.NavigationBlocked` to audit.
- `WebView.destroy`

### Feature gate matrix

WebViews back onto WebKit (macOS), WebView2 (Windows), and WebKitGTK (Linux). Their feature surfaces diverge. The framework exposes capability flags so apps can branch:

| Capability                | macOS WKWebView           | Windows WebView2 | Linux WebKitGTK     |
| ------------------------- | ------------------------- | ---------------- | ------------------- |
| `print` (window.print)    | partial(no header/footer) | ✓                | partial             |
| `popup blocking`          | ✓                         | ✓                | partial             |
| `autofill`                | ✓                         | ✓                | unsupported         |
| `devtools open`           | dev-only                  | ✓                | dev-only            |
| `getUserMedia`            | ✓ (with permission)       | ✓                | partial(distro-dep) |
| `service workers in app:` | partial                   | ✓                | partial             |
| `PDF embedded viewer`     | ✓                         | ✓                | unsupported         |

Apps detect capability at runtime via `WebView.capability(name): boolean`. The §14.6 production checker fails on contracts that require a non-✓ capability without a guard.

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
- `Notification.onAction` — fires when the user clicks a custom action button on a posted notification.
- `Notification.isSupported`
- `Notification.requestPermission()` — returns the resulting `PermissionState`.
- `Notification.getPermissionStatus(): "granted" | "denied" | "default"`.

### Per-platform permission flow

| Platform | Default state                                                     | Required action                                                                                                                                 |
| -------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | `default`                                                         | App must call `requestPermission()` once; result is recorded by the OS. Re-prompting requires the user to clear notification settings manually. |
| Windows  | `granted` for signed apps; `denied` for unsigned/sideloaded       | No prompt. Apps must check status and degrade gracefully if `denied`.                                                                           |
| Linux    | `granted` if a notification daemon is running; `denied` otherwise | Apps must check `isSupported()` per call.                                                                                                       |

`Notification.show` returns `PermissionDenied` when permission is missing rather than silently failing. Notification action callbacks deliver via `targeted(ownerWindowId)` per §8.8.

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

- `Shell.openExternal(url, opts?)` — validates `url` against the configured scheme allowlist (`http`, `https`, `mailto`, `tel`, plus app-declared protocols). Schemes outside the allowlist return `PermissionDenied`. URLs that decode to local paths or to `file:` schemes are always denied.
- `Shell.showItemInFolder(path)` — opens the file manager focused on `path`.
- `Shell.openPath(path)` — opens `path` with the user's default association. Refuses to open executable file types (`.exe`, `.bat`, `.sh`, `.ps1`, `.js`, `.command`, `.app`) without explicit `allowExecutable: true` plus a per-call approval (§14.4).

### Argument-injection rules

`Shell` and any other primitive that spawns a subprocess (see §12.2 `Process`, §12.3 `PTY`) must:

- always use the **exec** form with discrete `argv` arrays, never a single shell-string;
- reject `argv[0]` values that contain shell metacharacters (`;`, `|`, `&`, `>`, `<`, backtick, `$(`, newline) with `InvalidArgument`;
- never pass user input through `cmd.exe /C` or `/bin/sh -c` unless `shell: true` is explicitly set, which itself requires a capability declaration.

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
- `GlobalShortcut.isSupported(): { supported: boolean, reason?: string }` — reports `false` on Wayland session types where no portal-backed global shortcut API is available.

### Wayland note

On Linux Wayland sessions without the `org.freedesktop.portal.GlobalShortcuts` portal, `register` returns `Unsupported { reason: "wayland-no-global-shortcut" }`. Apps must call `isSupported()` first and surface in-app alternatives (e.g., per-window accelerators) when the global shortcut path is unavailable. X11 sessions and macOS/Windows are unaffected. Shortcut callbacks deliver via `targeted(registrarWindowId)` per §8.8.

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

## 11.19 `SystemAppearance`

**Purpose:** Operating-system appearance, accent color, and reduced-motion / contrast preferences.

### Minimum method surface

- `SystemAppearance.getAppearance(): "light" | "dark" | "highContrast"`
- `SystemAppearance.onAppearanceChanged`
- `SystemAppearance.getAccentColor(): { r: number, g: number, b: number, a: number } | null` — returns `null` on Linux where the desktop environment exposes no canonical accent color.
- `SystemAppearance.getReducedMotion(): boolean`
- `SystemAppearance.getReducedTransparency(): boolean`

### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Renderer-side, the WebView automatically receives `prefers-color-scheme`, `prefers-reduced-motion`, and `prefers-contrast` CSS media queries; the runtime mirrors these via the same change events.
- Apps must not render appearance-dependent UI before the first `getAppearance()` resolves.

### Required tests

- success path;
- platform fallback when accent color is unavailable;
- change event delivery on appearance switch;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Per-platform accent-color availability.
- Failure modes.
- Example usage in React and Effect.
- Testing strategy.

## 11.20 `Dock`

**Purpose:** Dock (macOS), taskbar (Windows), and launcher (Linux) integration: badge counts, jump lists, dock menus, taskbar progress.

### Minimum method surface

- `Dock.setBadgeCount(n: number)` — `0` clears.
- `Dock.setBadgeText(text: string | null)` — macOS only; `Unsupported` elsewhere.
- `Dock.setProgress(value: number | null, opts?: { state?: "normal" | "indeterminate" | "error" | "paused" })` — Windows taskbar progress; macOS partial (no state); Linux mostly unsupported.
- `Dock.setMenu(menu: Menu | null)` — macOS dock menu; Windows jump-list-like behavior delivered separately; `Unsupported` elsewhere for true dock menus.
- `Dock.setJumpList(items)` — Windows only; `Unsupported` elsewhere.
- `Dock.requestAttention(opts?: { critical?: boolean })` — macOS bounce; Windows taskbar flash; Linux best-effort.
- `Dock.isSupported(method)`

### Required implementation details

- Public TypeScript API is exposed as an Effect service.
- Each method returns the typed `Unsupported` error on platforms where the feature has no equivalent.
- Badge counts persist across renderer reloads but reset on app restart unless persisted by the app.

### Required tests

- success path on supported platforms;
- `Unsupported` returned on platforms missing the capability;
- badge count clears on `0` and persists across renderer reloads;
- documentation example compiles.

### Documentation requirements

- Purpose and common use cases.
- Per-platform capability matrix.
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

### Path resolution and symlink handling

- Every path argument is resolved to its canonical real path (`realpath` on POSIX, `GetFinalPathNameByHandle` on Windows) **before** the capability check.
- A symlink whose canonical target falls outside the configured `filesystem.write` or `filesystem.read` roots is rejected with `SymlinkEscapesRoot { requestedPath, resolvedPath, capabilityRoots }`.
- File-open paths use `O_NOFOLLOW` semantics where the platform supports it (Linux, macOS); on Windows, `FILE_FLAG_OPEN_REPARSE_POINT` is set when the capability does not explicitly opt in to following links.
- Hard links to files outside the capability root are denied with `SymlinkEscapesRoot` even when the named path is inside the root.
- `Filesystem.realpath(path)` is exposed to apps and is permission-checked against the requested operation's capability.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available;
- write to a path whose underlying volume is full returns `DiskFull { path, freeBytes, requestedBytes? }` rather than panicking;
- partial writes that fail mid-stream return `PartialWrite { bytesWritten }` and leave the destination file in its original state when atomic-write was used.

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

### Process-group ownership and cleanup

- On POSIX, every PTY child runs in its own process group (`setpgid(child_pid, child_pid)`), distinct from the runtime's pgid (§8.2). On Windows, every PTY child is assigned to its own Job Object owned by the runtime.
- Window or scope close issues `SIGTERM` to the PTY pgid (POSIX) or terminates the Job (Windows). After 5 seconds without exit, the runtime issues `SIGKILL` and reaps with `waitpid` so no zombie processes remain. The 5-second grace is configurable per PTY via `gracefulShutdownMs`.
- Killing a PTY also tears down any child processes spawned inside it; the pgid / Job Object semantics ensure transitive cleanup.
- The PTY output stream emits the terminal frame `Closed` once the kill sequence completes; the exit code (or signal) is delivered as the `onExit` event.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available;
- a PTY whose child cannot be killed within the grace window emits `PtyForceKillTimeout` to audit and continues to attempt cleanup in the background.

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

## 12.6 Runtime SQLite

**Purpose:** Provide desktop policy for Effect SQL SQLite clients used by
runtime databases, migrations, transactions, app stores, and workspace stores.

### Required properties

- Exposed through Effect `SqlClient` and the desktop `SqlClientLive` policy
  layer.
- Has typed inputs, outputs, and errors.
- Supports deterministic cleanup where resources are involved.
- Emits trace spans for important operations.
- Emits devtools events for long-running operations.
- Supports cancellation where practical.
- Supports permission checks where dangerous operations are possible.
- Has unit tests and at least one integration test.

### Required failure handling

- invalid layer input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific driver behavior is represented by Effect SQL errors;
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

### Concurrency and migrations

- `Settings.get(key)` and `Settings.set(key, value)` are last-writer-wins on the same key. Multiple concurrent `set`s on the same key serialize at the runtime layer; readers always observe a fully written value (no torn reads).
- `Settings.update(key, fn)` performs an atomic read-modify-write. The provided function receives the current value and returns the next value (or an Effect that does). Concurrent `update`s on the same key serialize; the provider on conflict re-runs the function.
- Schema migrations are versioned (`schemaVersion: number`). On startup the runtime detects a mismatch and runs the registered migration inside a single transaction:
  - readers during the migration see the **old** schema until commit;
  - writers during the migration are queued behind the migration commit;
  - on commit the runtime emits `Settings.onMigrated { from, to, durationMs }`;
  - a failed migration reverts to the prior schema and surfaces `SettingsMigrationFailed { schemaVersion, cause }` as a fatal error.
- The change stream emits `{ key, oldValue, newValue, source }` on every mutation.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available;
- corrupt settings file is recovered by promoting the most recent valid backup (rotation kept by the runtime), and emits `SettingsRecoveredFromBackup` to audit.

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

### Identity and ordering

- Each log entry is assigned a monotonic `EventId: u64`, allocated atomically by the runtime per log instance.
- `append(event)` returns the assigned `EventId`. The function is durable on return: events are flushed (`fsync` per batch on POSIX, `FlushFileBuffers` on Windows) before the result resolves. Batch size and flush interval are configurable; the default is `flushEveryMs: 50` or `flushEveryEvents: 64`, whichever comes first.
- `query({ from?, to?, filter? })` returns events in monotonic `EventId` order; iteration is bounded and chunked.
- `subscribe({ from? })` returns a stream that begins at the requested cursor (or `tail` by default) and follows the live tail with the same backpressure semantics as §10.6.

### Disk-full and rotation

- When the underlying volume is full, `append` returns `EventLogFull { freeBytes }` and the log enters read-only mode. The runtime emits `EventLog.AppendStopped` and continues to serve `query` and `subscribe`.
- The log supports time- or size-bounded rotation; rotated segments are immutable and may be archived externally.

### Required failure handling

- invalid input is rejected before side effects;
- permission denial returns a typed error;
- canceled operations release resources;
- timeouts are explicit and configurable;
- platform-specific unsupported behavior is represented as a typed error;
- errors include operation names and resource IDs where available;
- a corrupted segment is quarantined to `corrupt/` and `EventLogSegmentCorrupt` is emitted to audit; queries skip the segment and continue.

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

## 12.16 `WindowState`

**Purpose:** Opt-in persistence of per-window state across launches and across runtime restarts (window position, size, zoom level, fullscreen state, scroll position, devtools panel selection). Used by the hot-reload preservation contract (§19.4).

### Required properties

- Exposed through an Effect service.
- State is stored under `~/Library/Application Support/<bundle>/window-state.json` (macOS), `%APPDATA%\<bundle>\window-state.json` (Windows), `~/.local/state/<bundle>/window-state.json` (Linux), with the same atomicity guarantees as `Settings`.
- Per window, the framework persists `{ x, y, width, height, isFullScreen, scaleFactor, zoom, devtoolsPanel?, scrollPositions? }`.
- Apps opt in by passing `persistState: true` to `Window.create` or by calling `WindowState.persist(windowId)`.
- Restored coordinates are sanity-checked against the current display layout; off-screen windows snap to the primary display before showing.

### Required failure handling

- A corrupt `window-state.json` is renamed to `window-state.corrupt.<timestamp>.json` and the runtime continues with defaults.
- Restoring to a no-longer-present display falls back to the primary display.

### Required documentation

- public API;
- examples;
- relationship to `Settings` (separate file, separate schema);
- testing strategy (how to assert restored state).

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
import type { Effect, Stream, Sink } from "effect"

type DesktopResourceHandle<Kind extends ResourceKind, State extends string> = {
  readonly kind: Kind
  readonly id: UUIDv7
  readonly generation: number
  readonly ownerScope: ScopeId
  readonly state: State
  dispose(): Effect.Effect<void, DesktopError, never>
}
```

Specialized handles may add methods. All Effect/Stream/Sink types use the v4 three-parameter form `<A, E, R>`:

```ts
type ProcessHandle = DesktopResourceHandle<"process", "running" | "exited"> & {
  stdin: Sink.Sink<unknown, Uint8Array, never, ProcessError, never>
  stdout: Stream.Stream<Uint8Array, ProcessError, never>
  stderr: Stream.Stream<Uint8Array, ProcessError, never>
  kill(signal?: ProcessSignal): Effect.Effect<void, ProcessError, never>
}
```

`UUIDv7` is the canonical identifier — sortable by creation time and globally unique. `generation` is a monotonic per-`(kind, id)` counter; it increments only when an `id` is reused for a new resource (rare; opt-in per kind). Stale-handle behavior is defined in §13.7.

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

A handle has **exactly one owner scope** at a time. Cross-scope use of a handle without explicit `Resource.share(handle, targetScope)`:

- in development: emits a `CrossScopeHandle` warning and the call proceeds (so test harnesses can detect drift);
- in production: returns the typed `CrossScopeHandle` error.

`Resource.share(handle, targetScope)` returns a fresh handle whose `ownerScope` is the new target; the original handle's lifetime is unchanged.

## 13.4 Disposal rules

- Disposal must be idempotent.
- Disposal must emit a devtools event.
- Disposal must remove the resource from the registry.
- Disposal must close streams with a terminal status.
- Disposal must kill process trees where applicable.
- Disposal must not block forever; it must have a timeout.
- Forced disposal must be available after graceful disposal fails.

### Disposal order

When a scope is disposed, its resources are torn down in this order:

1. **Dependents first.** Streams, child processes, child PTYs, and any handle whose owner is the resource being disposed are torn down before their parent.
2. **Terminal frames emitted.** Each affected stream emits its terminal frame (`Closed`) so renderer-side consumers observe a clean end.
3. **Native resource released.** The native side (window, WebView, file watcher, etc.) is released after dependents are gone.
4. **Registry update.** The handle is removed from the resource registry; if the kind opts in to ID reuse, the `generation` counter is bumped so future reuse cannot collide.
5. **Audit emitted.** A `Resource.Disposed` event is recorded with the resource ID, kind, owner scope, and lifetime.

The disposal grace timeout per resource is 5 seconds (configurable per kind via `disposalGraceMs`). On exceedance, the runtime issues a forced abort and emits `Resource.DisposalForcedAbort` to audit; remaining cleanup runs best-effort in the background.

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
yield * Desktop.Test.assertNoOpenResources()
```

Leak checks must fail if windows, WebViews, processes, PTYs, file watchers, workers, database handles, or streams remain open at test end.

The devtools Resources panel surfaces:

- the live handle table with `kind`, `id`, `generation`, `ownerScope`, `createdAt`, `state`;
- handle-age sorting and per-kind filters;
- a "stale references" view showing handles consumed by recently disposed scopes.

CI integrates the same check: a test run that exits with non-app handles still alive in the registry fails the test, with a report listing the leaked handles, the test that created them, and the scope that should have disposed them.

## 13.7 Stale-handle semantics

Every native or runtime method that takes a handle validates `(kind, id, generation)` against the registry. On mismatch the method returns:

```ts
type StaleHandle = {
  tag: "StaleHandle"
  kind: ResourceKind
  id: UUIDv7
  expectedGeneration: number
  actualGeneration: number
}
```

Renderer-side helpers in `@effect-desktop/react` automatically discard handles after observing the resource's `Closed` event so user code never re-presents a stale handle. User code that has cached a handle past its `Closed` event observes `StaleHandle` on the next call and is expected to re-acquire.

`generation` is bumped only when the resource kind opts in to `id` reuse (e.g., for resumable streams declared `idempotent: true`). For most kinds (windows, processes, PTYs) the `id` is consumed permanently on disposal and any future use returns `StaleHandle` with `actualGeneration = -1`.

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

A capability grants concrete authority to a window, resource, or operation. Capabilities must describe what authority is granted, not only which API method can be called.

```ts
const MainWindow = Desktop.window({ id: "main", route: "/" })
  .allow(ProjectRpcs)
  .allow(Desktop.Dialog, ["openFile", "openDirectory"])
  .allow(Desktop.Clipboard, ["readText", "writeText"])
```

Capabilities can be broad in development but must be explicit in production. The production checker must warn about broad privileges and fail on forbidden privileges unless explicitly acknowledged by configuration.

API-oriented permission names such as `Filesystem.writeFile` are insufficient as the durable policy model. API names change. Authority does not. The durable model must name the resource and the permitted action:

```ts
type FilesystemWriteCapability = {
  kind: "filesystem.write"
  roots: string[]
  allowCreate: boolean
  allowOverwrite: boolean
  audit: "always" | "on-deny" | "never"
}

type ProcessSpawnCapability = {
  kind: "process.spawn"
  commands: string[]
  cwd?: string[]
  environment: "none" | "allowlist"
  audit: "always" | "on-deny"
}
```

Runtime APIs consume capabilities. They do not define ambient authority. Audit events must report the concrete authority used, such as `filesystem.write` under a configured root, rather than only reporting that a method was called.

## 14.3 Policy shape

The normalized capability object is authoritative. Convenience declarations from `.allow(...)`, `desktop.config.ts`, approval outcomes, and persisted grants are lowered into `NormalizedCapability` before any permission decision.

```ts
type NormalizedCapability =
  | {
      kind: "filesystem.read" | "filesystem.write" | "filesystem.delete"
      roots: string[]
      ask?: string[]
      deny?: string[]
      audit: "always" | "on-deny" | "never"
      allowCreate?: boolean
      allowOverwrite?: boolean
    }
  | {
      kind: "process.spawn" | "pty.spawn"
      commands: string[]
      cwd?: string[]
      environment: "none" | "allowlist"
      shell: false | "requires-explicit-approval"
      audit: "always" | "on-deny"
    }
  | {
      kind: "network.connect"
      hosts: string[]
      askUnknownHosts: boolean
      audit: "always" | "on-deny" | "never"
    }
  | {
      kind: "secrets.read" | "secrets.write" | "safeStorage.read" | "safeStorage.write"
      namespaces: string[]
      audit: "always" | "on-deny"
    }
  | {
      kind: "native.invoke"
      primitive: string
      methods: string[]
      audit: "always" | "on-deny" | "never"
    }
```

The policy shape below is an authoring convenience. It is not evaluated directly at runtime.

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

Permission resolution order is fixed:

1. explicit deny;
2. revoked, expired, or one-time grant already consumed;
3. approval outcome for the same `(operation, actor, resource)` scope;
4. normalized allow;
5. default deny.

Sources merge in this order, with later sources unable to override explicit deny: framework defaults, `desktop.config.ts`, window `.allow(...)`, worker/process construction capabilities, persisted approval grants, live approval outcomes. Every decision emits an audit event containing the normalized capability, source, actor, resource, and trace ID.

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

### Coalescing

Identical requests collapse into a single prompt:

- two requests are _identical_ when `(operation, actor, resource)` matches;
- while a prompt is open for an identical key, new arrivals attach as additional waiters;
- the user's outcome applies to **all** waiting callers atomically;
- a `denied for scope` outcome prevents future identical requests within the scope without re-prompting.

This prevents UI flooding and prevents racing callers from receiving inconsistent decisions.

### Approval UI surface

Approval prompts must render in the **host process** (Rust), not in the renderer. A renderer must never construct or display a prompt that masquerades as the framework's approval UI. The host UI:

- displays the host application icon and a system-rendered window chrome;
- shows the requesting actor, the operation, and the concrete resource;
- is dismissible only by user action — it cannot be programmatically dismissed;
- is rate-limited per actor to prevent prompt-fatigue attacks (max 1 visible prompt per actor; subsequent identical requests coalesce, subsequent distinct requests queue with a max queue depth of 8 per actor).

Renderers may show their own informational UI alongside, but the authoritative prompt is the host's.

### Revocation propagation

A capability grant may be revoked at any time (manually by the user, or by an expiry). Revocation propagates to every Effect that holds the capability:

- in-flight handlers receive an interrupt signal within 250 ms (target);
- the handler's Effect fails with `PermissionRevoked { capability, revokedAt }`;
- streams owned by the revoked grant terminate with `Error { tag: "PermissionRevoked" }`;
- resource handles tied to the revoked capability are disposed per §13.4.

A revocation that cannot reach an in-flight handler within 5 seconds escalates to forced abort.

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
- disabled or weakened content security policy (per §14.7);
- unsafe external navigation handler;
- unscoped resource creation;
- contracts that require non-✓ §11 capabilities without `isSupported` guards;
- secret-pattern fields not covered by the §14.10 redaction policy.

## 14.7 Content Security Policy defaults

The `app://` protocol handler (§11.13) emits CSP headers on every response. The default policy is strict and ships with v1.0.0:

```
default-src 'self';
script-src 'self' 'nonce-{N}';
style-src 'self' 'nonce-{N}';
style-src-attr 'unsafe-inline';
connect-src 'self' app:;
img-src 'self' app: data: https:;
font-src 'self' app: data:;
media-src 'self' app:;
object-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
worker-src 'self';
```

Rules:

- `{N}` is a per-request nonce, minted by the `app://` protocol handler.
- Nonce attribution is performed by the host at request time. The handler parses every `text/html` response and attaches `nonce="{N}"` to every `<script>`, `<style>`, and `<link rel="stylesheet">` element. Renderer bundles do not inject nonces, and no `__APP_NONCE__` placeholder is required in renderer output.
- `style-src-attr 'unsafe-inline'` admits inline `style="..."` attributes that prerendered HTML uses for layout grids, scroll-area variables, and CSS custom properties. `<style>` and `<link rel="stylesheet">` elements remain governed by `style-src 'self' 'nonce-{N}'`. `unsafe-inline` in `script-src` or `style-src` element directives, and `unsafe-eval` anywhere, are forbidden in production.
- An HTML response that fails the host's rewrite parser produces an HTTP 500 with the trace id, not the un-rewritten body.
- Apps may **tighten** the policy via `desktop.config.ts`'s `security.csp` field. Loosening any directive (e.g., adding `unsafe-inline` to `script-src` or `style-src`) requires `security.csp.acknowledgeWeakening: true` in config plus a justification comment; the production checker fails on weakening without acknowledgement.
- The check at §14.6 enforces these defaults.

## 14.8 Capability lifecycle

Capabilities granted to a window or worker have explicit lifecycle:

- **Inheritance.** Workers and spawned subprocesses do **not** inherit parent capabilities. Each child declares its required capabilities at construction; the runtime grants only what is declared and what the parent itself holds.
- **Tokens.** Every grant carries a `RevocationToken: UUIDv7`. Apps may inspect the token via `Capability.tokenOf(grant)`.
- **Time-bounded grants.** A grant may carry `{ grantedAt, expiresAt?, oneTime?: boolean }`. An `expiresAt` in the past is auto-revoked. A `oneTime: true` grant is revoked immediately after first use.
- **Revocation propagation.** See §14.4 — propagation target is 250 ms, hard ceiling 5 s, then forced abort.
- **Audit.** Every grant, revoke, expire, and use is recorded in §14.5 audit events with the token and trace ID.
- **Persistence.** "Approved for scope" outcomes are persisted in `Settings` under a private key namespace; users can revoke from a host-rendered Permissions panel. Revocation from that panel uses the same propagation path.

## 14.9 IPC origin authentication

This subsection ratifies the protocol contract from §9.3.

- Every WebView is issued a 256-bit `originToken` at construction. The token lives in the host's protocol-handler closure and is never exposed to JavaScript.
- The host injects the token into every renderer-originated envelope; the runtime rejects mismatches with `OriginInvalid`.
- Tokens rotate on top-level navigation and on WebView reload. The previous token is invalidated immediately.
- Devtools connections use a distinct token namespace and a distinct loopback-only socket; devtools cannot impersonate a renderer.
- A renderer may not introspect its own token, may not enumerate other renderers, and may not synthesize protocol envelopes — those are host-injected on the privileged side.

Defends against: hostile pages loaded into a misconfigured WebView; a malicious devtools session; a remote URL opened via `Shell.openExternal` that subsequently attempts to reconnect.

## 14.10 Secret redaction policy

The framework applies a redaction filter at every emission boundary:

```regex
/api[_-]?key|token|password|secret|bearer|authorization|cookie|session[_-]?id|refresh[_-]?token|client[_-]?secret|private[_-]?key/i
```

The filter scans structured field names (and nested keys in `unknown` payloads) and replaces matching values with Effect `Redacted` values while preserving the field's presence. Protocol emission boundaries materialize those redacted values to schema-compatible strings before crossing JSON/host frames. Applied to:

- log records emitted via `Telemetry`;
- devtools display of bridge calls, audit events, and stream frames;
- crash report breadcrumbs and structured fields;
- exported audit events;
- error details surfaced to the renderer.

Apps may extend the pattern via `security.redaction.additionalPatterns` and may opt specific known-safe fields out via `security.redaction.allowlist: string[]`. The §14.6 production checker fails on configurations that disable the default pattern.

\newpage

# 15. CLI Specification

The CLI is a first-class product surface. It should make development and shipping boring.

## 15.1 Required commands

```bash
bun desktop init [path]               # initialize Effect Desktop in an existing directory
bun desktop dev                       # run the app in dev with HMR
bun desktop check [--production]      # typecheck, lint, schema, security, perf
bun desktop typecheck                 # TypeScript strict typecheck only
bun desktop lint                      # lint + format check
bun desktop test                      # run all package and integration tests
bun desktop build                     # build runtime, renderer, native host
bun desktop package                   # produce platform artifacts
bun desktop sign                      # code-sign artifacts per platform
bun desktop notarize                  # macOS notarization + staple
bun desktop publish                   # publish update manifests + artifacts
bun desktop doctor                    # diagnose toolchain and SDKs
bun desktop info                      # print versions, platforms, config snapshot
bun desktop generate-types            # regenerate bridge clients (idempotent)
bun desktop migrate                   # run settings/storage/bridge schema migrations
bun desktop clean                     # clear build, dev, and bridge-codegen caches
bun desktop inspect                   # interactive tracing/devtools attachment
bun desktop replay                    # replay an EventLog or trace bundle
```

### Global flags

The following flags apply to every `bun desktop *` command:

- `--profile <name>` — select a config profile (`dev` | `staging` | `prod` | custom);
- `--debug` — enable verbose tracing and disable cache invalidation;
- `--headless` — run without creating windows (CI / smoke tests);
- `--platform <os-arch>` — target a specific platform (e.g., `macos-arm64`); defaults to host platform;
- `--no-color`, `--json` — output formatting controls.

Each subsection below extends `bun desktop init`, `typecheck`, `lint`, `test`, `info`, `generate-types`, `migrate`, and `clean` with the same Responsibilities / Output shape contract used by §15.2–15.6.

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

The default config file is `desktop.config.ts`. The full schema covers app metadata, runtime, renderer, native host, security, build, signing, update, telemetry, protocols, and environment.

Normative schema fields:

| Field                           | Required | Default             | Notes                                                                         |
| ------------------------------- | -------: | ------------------- | ----------------------------------------------------------------------------- |
| `app.id`                        |      yes | none                | Reverse-DNS ASCII ID; used for bundle ID and storage namespaces.              |
| `app.name`                      |      yes | none                | Human display name.                                                           |
| `app.version`                   |      yes | none                | SemVer.                                                                       |
| `runtime.engine`                |       no | `"bun"`             | Accepts `"bun"` or `"node"`; unsupported engines fail before build steps run. |
| `runtime.entry`                 |      yes | none                | Existing TypeScript entrypoint.                                               |
| `renderer.framework`            |       no | `"react"`           | Templates document React.                                                     |
| `renderer.styling`              |       no | `"tailwind"`        | Templates document Tailwind.                                                  |
| `renderer.entry`                |      yes | none                | Existing renderer entrypoint.                                                 |
| `native.host`                   |       no | `"rust-wry-tao"`    | v1 accepts only this value.                                                   |
| `native.renderer`               |       no | `"system-webview"`  | v1 accepts only this value.                                                   |
| `windows.defaults`              |       no | platform defaults   | Merged into every window declaration.                                         |
| `security.requireTypedBridge`   |       no | `true`              | `false` fails production check.                                               |
| `security.rendererNativeAccess` |       no | `false`             | `true` fails production check.                                                |
| `security.requirePermissions`   |       no | `true`              | `false` fails production check.                                               |
| `security.externalNavigation`   |       no | `"deny"`            | `"ask"` routes through approval broker.                                       |
| `security.devtoolsInProd`       |       no | `false`             | Also requires launch flag.                                                    |
| `protocols`                     |       no | `[]`                | Custom URL schemes.                                                           |
| `build.targets`                 |       no | current host target | `--all-targets` expands to required v1 cells.                                 |
| `signing`                       |       no | `{}`                | Required only for sign/notarize/publish release commands.                     |
| `update`                        |       no | `undefined`         | Required only for updater/publish flows.                                      |
| `telemetry.enabled`             |       no | `true`              | Production cannot disable tracing.                                            |
| `protocol.limits`               |       no | §9.3 limits         | Values above §9.3 caps fail validation.                                       |
| `env`                           |       no | `{}`                | Profile-specific environment map.                                             |
| `workspace.sharedConfigPath`    |       no | `undefined`         | Loaded before app-local config.                                               |

Profile merge order is fixed: framework defaults → shared config → app config → selected `env[profile]` → explicit CLI flags. Arrays replace by default; `protocols`, `build.targets`, and redaction patterns may opt into append semantics by using `merge: "append"` in the shared config helper.

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

  windows: {
    defaults: {
      titleBarStyle: "default", // "default" | "hidden" | "hiddenInset" | "customButtonsOnHover"
      vibrancy: null, // macOS only; null disables
      trafficLights: { x: 12, y: 12 }, // macOS only
      hasShadow: true,
      backgroundColor: "#ffffff"
    }
  },

  security: {
    requireTypedBridge: true,
    rendererNativeAccess: false,
    requirePermissions: true,
    csp: undefined, // optional override of §14.7 defaults
    externalNavigation: "deny", // "deny" | "ask"
    devtoolsInProd: false,
    redaction: {
      additionalPatterns: [],
      allowlist: []
    }
  },

  protocols: [
    {
      scheme: "myapp",
      handler: "open" // "open" | "view" — see native Association and Protocol references
    }
  ],

  build: {
    targets: [
      "macos-arm64",
      "macos-x64",
      "windows-x64",
      "windows-arm64",
      "linux-x64",
      "linux-arm64"
    ]
  },

  signing: {
    macos: {
      identity: "Developer ID Application: Example Inc.",
      teamId: "ABCD1234",
      entitlements: "build/macos-entitlements.plist"
    },
    windows: {
      thumbprint: "a1b2c3d4...", // or pfx: { path, passwordEnv }
      timestampUrl: "http://timestamp.digicert.com"
    },
    linux: {
      gpgKey: "ABCD1234" // optional: AppImage/Snap signing
    }
  },

  update: {
    channel: "stable", // "stable" | "beta" | "canary"
    publicKey: "ed25519:...",
    minVersion: "1.0.0", // optional downgrade floor
    maxVersion: undefined, // optional ceiling
    feedUrl: "https://updates.example.dev/{platform}/{channel}.json",
    keyVersion: 2 // current trust-anchor version
  },

  telemetry: {
    enabled: true,
    redactSensitive: true,
    endpoint: "https://telemetry.example.dev"
  },

  protocol: {
    limits: {
      maxFrameBytes: 4 * 1024 * 1024,
      maxConcurrentRequestsPerWindow: 256,
      maxConcurrentStreamsPerWindow: 64
    }
  },

  env: {
    dev: { LOG_LEVEL: "debug" },
    staging: { LOG_LEVEL: "info" },
    prod: { LOG_LEVEL: "warn" }
  },

  workspace: {
    sharedConfigPath: "../../desktop.shared.ts" // optional monorepo helper
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

### Cross-field rules

The following relationships are checked in addition to per-field shapes; any violation fails `bun desktop check`:

- if `update.channel` is set, `update.publicKey` and `update.feedUrl` are required;
- if `build.targets` includes `macos-*`, `signing.macos` is required for `bun desktop sign`;
- if `build.targets` includes `windows-*`, `signing.windows` (thumbprint or pfx) is required for `bun desktop sign`;
- if `protocols[].scheme` is set, the scheme must be lowercase ASCII and not in the OS reserved list (`http`, `https`, `file`, `about`, `data`, `chrome`, `view-source`);
- if `security.csp` weakens the §14.7 default, `security.csp.acknowledgeWeakening: true` is required;
- if `security.devtoolsInProd: true`, an explicit `--devtools` flag is required at launch;
- if `update.minVersion` is set, it must be ≤ `app.version`.

## 16.3 Environment resolution

Config may read environment variables only through explicit helpers. The config loader must distinguish:

- development environment;
- CI environment;
- packaging environment;
- release environment.

Secrets must not be printed in logs or build reports.

## 16.4 Config output

The resolved config must produce:

- `appManifest`: `{ id, name, version, profile, dataDirs, protocolSchemes }`;
- `hostManifest`: `{ nativeHost, systemWebView, windows, protocols, signingHints }`;
- `runtimeManifest`: `{ engine, entry, executable, args, env, permissions, telemetry, protocolLimits }`;
- `rendererManifest`: `{ framework, entry, assetBaseUrl, csp, navigationPolicy }`;
- `bridgeManifest`: `{ protocolVersion, generatedAt, rpcGroups, errorRegistryHash }`;
- `permissionManifest`: `{ normalizedCapabilities, approvalDefaults, redactionPolicy }`;
- `packageManifest`: `{ targets, artifactLayout, bundleId, resources, signing }`;
- `updateManifestInput`: `{ channel, feedUrl, publicKey, keyVersion, minVersion?, maxVersion? }`.

Every manifest is JSON-serializable, deterministic for the same inputs, and redacted before logging. `bun desktop info --json` prints the same resolved manifests with secrets replaced by Effect redacted string formatting.

\newpage

# 17. Apps and External Examples

## 17.1 Current app surface

The repository keeps `apps/inspector` as the only first-party app. It exists to inspect live and recorded Effect Desktop sessions, not to serve as a starter template.

## 17.2 Templates and examples

Templates, examples, playground apps, and scaffold packages are not current repository surfaces. Do not add them back without a new architecture decision that names their maintenance gate, release responsibility, and API drift policy.

## 17.3 Future example rules

Future examples are validation assets. They must not become product demos with app-specific public APIs. If an example needs a concept that is not generic, implement it inside the example application only.

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
}).allow(ProjectRpcs)
```

Requirements:

- window IDs are typed;
- routes are validated;
- capabilities are derived from `.allow` calls;
- options are mapped to host protocol;
- unsupported options fail clearly by platform;
- state persistence is configurable.

## 18.3 API contract

`Schema` is the in-core `effect` Schema module. Domain types are defined as `Schema.Class<Self>(...)` so they have both an encoded shape and a tagged class identity.

```ts
import { Schema } from "effect"
import { Desktop } from "@effect-desktop/core"

export class Project extends Schema.Class<Project>("Project")({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String
}) {}

import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const ProjectList = Rpc.make("project.list", {
  success: Schema.Array(Project),
  error: Schema.Never
}).pipe(Desktop.RpcEndpoint.query)

export const ProjectOpen = Rpc.make("project.open", {
  payload: Schema.Struct({ path: Schema.String }),
  success: Project,
  error: Schema.Union(Desktop.Errors.PermissionDenied, Desktop.Errors.FileNotFound)
}).pipe(Desktop.RpcEndpoint.mutation, Desktop.RpcCapability({ kind: "project:open" }))

export const ProjectRpcs = RpcGroup.make(ProjectList, ProjectOpen)
```

Requirements:

- `RpcGroup` is the canonical renderer-callable API boundary;
- permissions and native support state are annotations on the RPC value, not duplicated in framework adapters;
- app code imports the contract value and passes it to framework adapters; string API lookup is not a public contract path.

## 18.4 Service implementation

The implementation shape for renderer-callable APIs is `RpcGroup.toLayer`.

```ts
import { Effect, Layer } from "effect"

export const ProjectRpcsLive = ProjectRpcs.toLayer({
  "project.list": () =>
    Effect.gen(function* () {
      const store = yield* ProjectStore
      return yield* store.list()
    }),

  "project.open": ({ path }) =>
    Effect.gen(function* () {
      yield* Desktop.Permissions.require("project:open", { path })
      const store = yield* ProjectStore
      return yield* store.open(path)
    })
}).pipe(Layer.provide(ProjectStore.Live))

export const App = Desktop.make({
  windows: {
    main: { title: "Example App", renderer: "/" }
  },
  rpcs: [Desktop.Rpcs.layer(ProjectRpcs, ProjectRpcsLive)]
})
```

### 18.4.2 Class-based service (`Context.Service`)

For services that are not bound to a public bridge contract — internal stores, caches, indexers — apps use the canonical Effect v4 class-based service:

```ts
import { Context, Effect, Ref } from "effect"

export class ProjectStore extends Context.Service<ProjectStore, ProjectStoreApi>()("ProjectStore", {
  make: Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyArray<Project>>([])
    return {
      list: () => Ref.get(ref),
      open: (path: string) =>
        Effect.gen(function* () {
          const projects = yield* Ref.get(ref)
          const found = projects.find((p) => p.path === path)
          return found ?? (yield* Effect.fail(new ProjectNotFound({ path })))
        })
    }
  })
}) {}

// Provided automatically:
//   ProjectStore.Default : Layer.Layer<ProjectStore, never, never>
```

Requirements:

- implementation returns Effect values;
- dependencies are accessed through services (`yield* Service`);
- errors are typed (`Schema.Class` derivations or `Data.TaggedError`);
- permission checks are explicit or generated according to policy;
- implementations are testable through layers (override with a test layer in tests);
- generators use `Effect.gen(function* () { ... })` without the `$` adapter.

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

Framework adapters derive from the assembled desktop app:

- React exposes hooks from `ReactDesktop.from(Desktop.manifest(App)).useDesktop(ProjectRpcs)`;
- Vue exposes composables and refs from `VueDesktop.from(Desktop.manifest(App)).useDesktop(ProjectRpcs)`;
- Solid exposes resources, accessors, signals, mutations, and owner-scoped cleanup from `SolidDesktop.from(Desktop.manifest(App)).useDesktop(ProjectRpcs)`;
- Next uses the React adapter from a client component boundary;
- Astro uses hydrated React, Vue, or Solid islands; `.astro` files do not expose fake desktop hooks.

Startup windows are opened from the `Desktop.make({ windows })` declaration after runtime/host protocol readiness. Renderer components do not open the initial window as a side effect.

## 18.6 Public method contract matrix

This matrix is normative and supersedes Appendix B sketches. Each method listed in §11 and §12 must add a row here before it can be considered v1.0.0-complete.

Shared schema names:

| Schema                 | Shape                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- | -------- | ---------- |
| `VoidInput`            | `Schema.Void`                                                                 |
| `WindowId`             | stable string ID declared by app config or returned by `Window.create`        |
| `ResourceHandle<Kind>` | `{ kind, id: UUIDv7, generation, ownerScope, state }`                         |
| `LogicalSize`          | `{ width: PositiveInt, height: PositiveInt }`                                 |
| `LogicalPoint`         | `{ x: number, y: number }`                                                    |
| `Bounds`               | `{ x, y, width, height }` in logical pixels                                   |
| `PermissionState`      | `"granted"                                                                    | "denied" | "default"` |
| `MenuTemplate`         | serializable nested menu item data with command IDs only                      |
| `ProcessSpec`          | `{ command, args, cwd?, env?, shell?: false }` unless explicitly permissioned |
| `UpdateManifest`       | §23.4 manifest shape                                                          |

Contract rows use this compact form:

| Method group                                                                                                                                                                          | Required contract rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App`                                                                                                                                                                                 | `getInfo(VoidInput -> AppInfo; errors: Internal; capability: none; resource: none; C.80)`, `getCommandLine(VoidInput -> CommandLine; errors: Internal; capability: none; C.80)`, `quit(QuitInput -> void; errors: Cancelled/Internal; capability: native.invoke:App.quit; C.80)`, `restart(RestartInput -> void; errors: Cancelled/Internal; capability: native.invoke:App.restart; C.80)`, `requestSingleInstanceLock(VoidInput -> SingleInstanceResult; errors: ResourceBusy/Internal; capability: none; C.63)`, event subscriptions return streams scoped to app or window and emit `RendererDisconnected` on owner close. |
| `Window`                                                                                                                                                                              | creation returns `ResourceHandle<"Window">`; mutators accept `{ windowId, ... }`; geometry uses `LogicalSize`, `LogicalPoint`, or `Bounds`; common errors are `InvalidArgument`, `Unsupported`, `StaleHandle`, `CrossScopeHandle`, `Internal`; capability is `native.invoke:Window.<method>`; verification rows are C.23, C.62, C.76, and C.83.                                                                                                                                                                                                                                                                               |
| `WebView`                                                                                                                                                                             | creation returns `ResourceHandle<"WebView">`; navigation inputs include `url` or app route plus `NavigationPolicy`; common errors are `PermissionDenied`, `OriginInvalid`, `Unsupported`, `StaleHandle`, `Internal`; capability is `native.invoke:WebView.<method>`; verification rows are C.34, C.39, C.40, C.50, and C.84.                                                                                                                                                                                                                                                                                                  |
| `Menu`, `ContextMenu`, `Tray`                                                                                                                                                         | inputs are `MenuTemplate`, command IDs, icon asset URLs, or window/resource handles; outputs are void or resource handles; errors include `InvalidArgument`, `MethodNotFound`, `Unsupported`, `StaleHandle`, `Internal`; capability is `native.invoke:<Primitive>.<method>`; verification rows are C.21, C.22, C.85.                                                                                                                                                                                                                                                                                                          |
| `Dialog`, `Clipboard`, `Notification`, `Shell`, `Screen`, `GlobalShortcut`, `Protocol`, `SafeStorage`, `Path`, `Updater`, `CrashReporter`, `PowerMonitor`, `SystemAppearance`, `Dock` | every method must define schema files under `packages/native/src/contracts/<primitive>.ts`; error sets must include every Appendix K `error(...)` tag; capability must be either `native.invoke:<Primitive>.<method>` or a narrower normalized capability from §14.3; verification rows are C.21-C.26 plus the specific C.50-C.79 row where applicable.                                                                                                                                                                                                                                                                       |
| Runtime primitives in §12                                                                                                                                                             | every service method must define schema files under `packages/core/src/contracts/<primitive>.ts`; resource-producing methods return `ResourceHandle`; stream-producing methods declare backpressure; dangerous operations use normalized capabilities; verification rows are C.27-C.33, C.56-C.67, C.74-C.76, and C.86.                                                                                                                                                                                                                                                                                                       |

The implementation must expand these compact rows into concrete TypeScript `Schema.Class` definitions before a method ships. A milestone may introduce only the rows it implements, but it may not expose a method publicly without its row and schemas.

\newpage

# 19. Developer Experience Requirements

## 19.1 First-run experience

The first-run path is documentation-led, not scaffold-led. A basic app must be explainable from public docs and must use public framework packages only.

A basic app must demonstrate:

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

### State preservation contract

| State                             | Preserved across renderer HMR | Preserved across runtime restart       | Preserved across host restart |
| --------------------------------- | ----------------------------- | -------------------------------------- | ----------------------------- |
| window position / size            | ✓ (via `WindowState`, §12.16) | ✓                                      | ✓                             |
| zoom level                        | ✓                             | ✓                                      | ✓                             |
| scroll position                   | ✓ (React Fast Refresh)        | ✗ — renderer reload                    | ✗                             |
| devtools panel selection + scroll | ✓                             | ✓                                      | ✗                             |
| React component state             | ✓ (Fast Refresh)              | ✗                                      | ✗                             |
| in-memory Effect service state    | n/a (renderer-only HMR)       | ✗                                      | ✗                             |
| open streams                      | ✓                             | ✗ — terminated with `RuntimeRestarted` | ✗                             |
| PTY sessions                      | ✓                             | ✗ — terminated                         | ✗                             |
| persistent settings (`Settings`)  | ✓                             | ✓                                      | ✓                             |
| persistent secrets (`Secrets`)    | ✓                             | ✓                                      | ✓                             |
| `EventLog`                        | ✓                             | ✓                                      | ✓                             |

During a runtime restart the renderer shows a "Reconnecting…" overlay (per §9.7) and disables user input until the protocol resumes. Host restarts force a full app restart and surface as a top-level error if not initiated by the user.

## 19.5 Build reports

Build commands must output reports:

- renderer bundle report;
- runtime bundle report;
- bridge generation report;
- native host build report;
- package artifact report;
- security report;
- performance budget report.

## 19.6 First-run environment validation

`bun desktop dev`, `build`, and `package` run a doctor pre-flight before any heavy work. The pre-flight verifies:

- Bun version ≥ the spec's pinned floor;
- Rust toolchain (rustc, cargo, target triples for `build.targets`);
- platform SDK presence (Xcode CLT on macOS, MSVC build tools on Windows, `libwebkit2gtk-4.1-dev` and `libssl-dev` on Linux distributions);
- code-signing tooling presence when signing is configured;
- network reachability of the configured update feed when running `publish`.

A miss prints the **exact** install command for the user's platform, the documentation URL, and a one-line remediation. Doctor errors are typed (`DoctorMissing { component, platform, installHint }`) and surface in `bun desktop doctor --json` for CI consumption.

## 19.7 Error message quality contract

Every typed error returned by a public API must carry the following fields:

```ts
type DesktopError = {
  code: string // stable identifier (e.g., "DESKTOP_E_PERMISSION_DENIED")
  category: "validation" | "permission" | "io" | "network" | "platform" | "internal"
  summary: string // one sentence, no trailing period; suitable for logs
  details: unknown // structured context; redacted per §14.10
  actor: string // who attempted the action
  resource?: string // what was acted on
  remediation: string // one line; what the user/dev should do next
  docsUrl: string // canonical docs page
  cause?: unknown
}
```

`bun desktop check` lints public-facing errors against this shape. An error type defined in a public package that omits any of `code`, `category`, `summary`, `actor`, `remediation`, or `docsUrl` is a check failure.

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
- Runtime SQLite clients close on scope close.
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

## 20.10 Cross-platform verification matrix

Every Appendix C verification row declares the `(platform × arch)` cells on which it must pass.

Required cells (gate the v1.0.0 release):

- `macos-arm64`
- `macos-x64`
- `windows-x64`
- `linux-x64` (one of: Ubuntu 22.04 LTS, Fedora 40)

Optional cells (warn-only for v1.0.0; required for v1.1):

- `windows-arm64`
- `linux-arm64`

A verification row marked `headless: true` runs in CI without a visual session. Rows marked `requiresHardware: true` (e.g., notification, tray, dock badge) require self-hosted runners with a logged-in user session or are gated as documented manual checks tracked in `engineering/manual-gates/<platform>.md`. Manual gates are signed off in the release checklist.

CI green := every required cell green for every gating Appendix C row + every documented manual gate signed off.

## 20.11 Performance budget enforcement

`bun desktop check --perf` runs a deterministic perf harness in CI. The harness:

- runs **cold** (caches cleared), **warm** (one prior run), and **hot** (10 prior runs) startups;
- measures `p50`, `p95`, and `p99` for every bridge call surface;
- captures GPU process memory and renderer process memory;
- compares the result to the baseline stored at `perf/main.baseline.json`;
- fails on any startup metric over budget (§21.2) or any latency metric > 20% over baseline.

The baseline updates only on `main` after a successful release; PRs cannot mutate the baseline.

\newpage

# 21. Performance Requirements

## 21.1 Performance philosophy

The framework should make the fast path the default path. Performance must be measured, reported, and enforced by budgets. The goal is not to make every application fast automatically, but to ensure the framework substrate does not impose avoidable overhead.

## 21.2 Startup budgets

Development targets:

| Operation                 |                      Target |
| ------------------------- | --------------------------: |
| CLI config load           |                     < 100ms |
| native host boot          |                     < 150ms |
| runtime boot              |                     < 250ms |
| renderer dev server ready | project-dependent, reported |
| first window created      | < 500ms after runtime ready |
| bridge ready              | < 100ms after runtime ready |

Production targets:

| Operation             |                      Target |
| --------------------- | --------------------------: |
| native host boot      |                     < 100ms |
| runtime boot          |                     < 200ms |
| first window visible  |                     < 700ms |
| initial bridge ready  | < 100ms after renderer load |
| basic app interactive |                    < 1200ms |

These are framework targets. Example apps must report their own measured values.

## 21.3 Bridge budgets

| Operation                   |                       Target |
| --------------------------- | ---------------------------: |
| small request/response p50  |         < 2ms local overhead |
| small request/response p95  |        < 10ms local overhead |
| stream subscription setup   |                       < 25ms |
| cancellation acknowledgment |                       < 50ms |
| resource handle disposal    | < 100ms for normal resources |

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

## 21.6 Cold / warm / hot definitions and p99 budgets

| Term     | Definition                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **cold** | OS file caches dropped, app data dir freshly created, no prior runtime in the system. Used to measure worst-case first launch. |
| **warm** | One prior successful run completed within the last 60 minutes; OS caches retain app binary; app data dir is initialized.       |
| **hot**  | 10 prior runs completed within the last 60 minutes. Used to capture steady-state startup.                                      |

| Operation                         | Cold p50 | Cold p95 | Hot p50 |  Hot p95 | p99 ceiling |
| --------------------------------- | -------: | -------: | ------: | -------: | ----------: |
| native host boot                  |  < 200ms |  < 400ms | < 100ms |  < 150ms |     < 600ms |
| runtime boot                      |  < 350ms |  < 700ms | < 200ms |  < 300ms |    < 1200ms |
| first window visible              | < 1100ms | < 1800ms | < 700ms | < 1100ms |    < 2500ms |
| bridge p99 small request/response |        — |        — |       — |        — |      < 50ms |
| stream subscription setup p99     |        — |        — |       — |        — |     < 100ms |

CI runs at least cold + hot. Warm is recommended.

### Benchmark harness

`bun desktop check --perf` runs `tests/perf/harness.ts` with:

- 3 warmup launches discarded from measurement;
- 20 measured launches for startup metrics;
- 1,000 bridge calls per measured run for bridge latency;
- p50, p95, and p99 computed from raw samples, not averaged percentiles;
- failure threshold of budget exceedance for two consecutive CI runs, unless the exceedance is greater than 50%, which fails immediately.

The required CI hardware labels are:

- `macos-arm64-baseline`: Apple Silicon runner, 8 CPU cores or better, no battery saver;
- `windows-x64-baseline`: Windows 11 x64 runner, 8 CPU cores or better;
- `linux-x64-baseline`: Ubuntu 22.04 or Fedora 40 x64 runner, 8 CPU cores or better.

Before `perf/main.baseline.json` exists, perf checks are report-only and write `perf/candidate.baseline.json` as an artifact. Only a release manager may promote a candidate baseline on `main` after a green release gate.

\newpage

# 22. Observability and Devtools

## 22.1 Observability requirements

Every framework subsystem must emit structured diagnostics. Observability is not optional because complex desktop applications fail in cross-process, cross-platform, and long-running ways.

Observability must be part of the execution path, not a side channel. Bridge calls, permission checks, resource allocation, resource disposal, process spawn, PTY creation, stream start, stream cancellation, host method calls, runtime crashes, renderer reloads, and update checks must emit events from the code path that performs the operation.

Devtools, logs, audit export, metrics, and tests must read from the same structured event stream where practical. They may project different views, but they must not each invent separate sources of truth for the same operation.

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

Secrets must be redacted before logs are emitted (per §14.10 redaction policy).

## 22.6 Trace propagation

Trace IDs cross every IPC boundary in the system:

- **host ↔ runtime** — every protocol envelope carries `traceId`. Both peers extract incoming trace IDs and inject outgoing trace IDs without rewriting them. A missing `traceId` at this boundary auto-mints a new one and emits a `TraceIdMissing` audit row.
- **runtime ↔ worker** — workers inherit the spawning Effect's trace context. Trace IDs flow through `Worker.spawn` and through `Job` execution.
- **runtime ↔ webview protocol (`app://`)** — protocol responses include the request's `traceId` in response headers; renderer instrumentation propagates it back into bridge calls.
- **runtime → external services** — outgoing HTTP requests carry `Traceparent` per W3C Trace Context if the target is allowlisted in `telemetry.outboundTracing`.

The runtime maintains a ring buffer of trace events (default capacity 10,000, configurable via `telemetry.traceRingSize`). Worker and renderer crashes ship the **last 100 ms of trace context** with the crash report.

The `traceId` field on the host-protocol envelope is the wire-level identifier; on the runtime side it is bound to Effect v4's tracer span via `Effect.withSpan(name, { attributes, parent: { traceId, spanId } })` so that `yield* Effect.currentSpan` inside handlers carries the same identity.

The §14.6 production checker fails on configurations where tracing is disabled in production.

## 22.7 Devtools security

Devtools is a privileged developer-facing surface. The framework treats it as security-sensitive:

- **Default off in production.** Production builds do not start the devtools listener. Enabling devtools in production requires both a `--devtools` CLI flag at launch **and** `security.devtoolsInProd: true` in config; the production checker logs a prominent warning when both are present.
- **Loopback-only socket.** The devtools listener binds exclusively to `127.0.0.1` (or platform equivalent named pipe). It is not exposed over the network.
- **Per-launch token.** The listener requires a 256-bit token presented by the devtools client. The token is generated on launch, written to a chmod-`600` file in the user's `state` directory, and rotated on every launch. Tokens are namespaced separately from renderer origin tokens (§14.9).
- **Redaction on display.** All log records, audit events, and bridge frames pass through the §14.10 redaction filter before display in devtools panels.
- **Kill switch.** Devtools may be disabled at runtime by `Devtools.disable()`; once disabled, re-enabling requires a process restart.

Devtools is the only surface allowed to read the trace ring buffer in real time. The same surface uses redaction, so secrets cannot leak via the trace view.

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

v1.0.0 artifact scope is fixed:

| Artifact                 | v1 status        | Packaging mechanism                            |
| ------------------------ | ---------------- | ---------------------------------------------- |
| macOS `.app`             | required         | first-party bundle staging + `codesign`        |
| macOS `.dmg`             | required         | `hdiutil create` from staged `.app`            |
| macOS `.zip`             | required         | `ditto -c -k --keepParent` from staged `.app`  |
| Windows user installer   | required         | WiX Toolset v5 MSI under per-user install mode |
| Windows system installer | deferred to v1.1 | ADR required before adding                     |
| Linux AppImage           | required         | `appimagetool` with generated AppRun           |
| Linux `.deb`             | required         | `dpkg-deb` from staged filesystem tree         |
| Linux `.rpm`             | required         | `rpmbuild` from generated spec                 |

Artifacts are written under `dist/desktop/<platform>/<artifact-name>` and accompanied by `artifact.json`, `checksums.txt`, and signed SBOM when running release packaging.

## 23.3 Signing requirements

The framework must support:

- macOS Developer ID signing;
- macOS hardened runtime configuration;
- macOS notarization command integration;
- Windows Authenticode signing;
- Linux package signing hooks;
- unsigned local development packages with clear warnings.

### macOS

- Codesign every binary in the bundle (host, runtime helper, native libraries).
- Hardened runtime entitlements:

| Entitlement                                              | Required value                                     | Reason                                 |
| -------------------------------------------------------- | -------------------------------------------------- | -------------------------------------- |
| `com.apple.security.cs.allow-jit`                        | `true`                                             | Bun runtime requires JIT.              |
| `com.apple.security.allow-dylib-injection`               | `false`                                            | Defends against dylib hijacking.       |
| `com.apple.security.cs.allow-unsigned-executable-memory` | `false`                                            | Forbids RWX pages.                     |
| `com.apple.security.cs.disable-library-validation`       | `false` unless an app explicitly opts in           | Forces signed-library-only loading.    |
| `com.apple.security.device.camera`                       | `true` only when policy declares camera capability | Inferred from §14.3 capability policy. |
| `com.apple.security.device.microphone`                   | `true` only when policy declares mic capability    | Inferred.                              |
| `com.apple.security.network.client`                      | `true` for apps with outbound network              | Inferred from `network` policy.        |

- Submit for notarization with `xcrun notarytool submit ... --wait`; staple the ticket onto every artifact (`stapler staple`); CI fails on a missing staple.
- Run Gatekeeper assessment in CI: `spctl --assess --type execute --verbose=4 <artifact>` must pass.

### Windows

- Authenticode-sign every binary in the bundle.
- Pin a public RFC 3161 timestamp server (e.g., `http://timestamp.digicert.com`); no local timestamps.
- Strip Mark-of-the-Web (`Zone.Identifier` alternate stream) from extracted installer payloads using `Unblock-File` semantics during extraction.
- Document the SmartScreen reputation period (typically 30+ days for new certs) in release notes; provide an explicit feedback URL for users who hit warnings.

### Linux

- AppImage signing via the configured `signing.linux.gpgKey`.
- Generate AppStream metadata (`<appid>.metainfo.xml`) and a `.desktop` file under `share/applications/`.
- Snap and Flatpak signing are optional and only attempted when `signing.linux.snapStore` / `signing.linux.flathub` are configured.

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

Update manifest shape:

```ts
type UpdateManifest = {
  schemaVersion: 1
  appId: string
  version: string
  channel: "stable" | "beta" | "canary"
  keyVersion: number
  publishedAt: string
  rollback?: boolean
  minVersion?: string
  maxVersion?: string
  artifacts: Array<{
    platform:
      | "macos-arm64"
      | "macos-x64"
      | "windows-x64"
      | "linux-x64"
      | "windows-arm64"
      | "linux-arm64"
    kind: "app" | "dmg" | "zip" | "msi" | "appimage" | "deb" | "rpm"
    url: string
    sizeBytes: number
    sha256: string
    signature: string
  }>
  signature: string
}
```

The Ed25519 signature covers the canonical JSON encoding of every field except `signature`. `bun desktop publish` rejects a manifest whose canonical encoding is not byte-stable across two serializations.

### Signature, downgrade, and partial-install rules

- Signature algorithm is pinned to **Ed25519**. Manifests are signed with `update.publicKey`. Clients trust up to `keyVersion - N` for `N = 2` to allow rotation; tooling for rotation is part of `bun desktop publish`.
- **Downgrade protection.** Clients refuse manifests where `manifest.version <= installed.version`. Apps may opt in to "rollback packs" by signing them with a `rollback: true` field; rollbacks are applied only when `installed.version > manifest.maxVersion` (set per release).
- **Partial installation.** Updates download to a temp directory with size + signature verified before any move. The atomic move is the commit point; a crash before commit leaves the prior version intact and the temp directory is cleaned on next launch.
- **Notarization staple check.** Before applying a macOS update, the client validates the bundle's stapled ticket. A bundle whose notarization is older than 30 days and unstapled triggers `UpdateStaleNotarization` — the user sees a warning, the update proceeds only with explicit confirmation.
- **Truncation detection.** The download stream tracks `{ downloadedBytes, expectedBytes }`; truncation aborts the install with `UpdateDownloadTruncated`.

### Graceful restart contract

`Updater.installAndRestart()` emits a `preparing-restart` event with a 5-second deadline. Apps must:

1. Flush all `Settings`, `EventLog`, and storage writes;
2. Close all `Process`/`PTY` resources;
3. Emit terminal frames on streams;
4. Acknowledge readiness via `Updater.readyForRestart()`.

If the app fails to acknowledge within 5 seconds, the runtime forces restart and writes a recovery breadcrumb to disk; the next launch surfaces the breadcrumb in the audit log so apps can detect ungraceful restarts.

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

## 23.6 Uninstall hygiene

Uninstallation must remove every artifact the app placed on the system. The framework provides an `Uninstaller` helper invoked from native uninstaller scripts:

- `SafeStorage` keychain / credential-store entries scoped to the bundle ID;
- `Settings` database files under the platform-specific app data directory;
- log files and the trace ring-buffer dump directory;
- `EventLog` segments;
- scheduled tasks (Windows Task Scheduler, macOS `launchd` agents, Linux `systemd` user units) registered by `Autostart`;
- login items (macOS `SMAppService`);
- custom URL scheme registrations (`Association.setDefaultProtocolClient`);
- file association registrations.

The uninstaller leaves user-created project files alone unless the user explicitly opts in to "remove user data" in the uninstaller UI. CI tests at least one uninstall on every required platform to verify hygiene; the uninstall test fails on any leftover that the helper claims to remove.

\newpage

# 24. Implementation Milestones

Milestones must be implemented in order unless a technical lead explicitly reorders them. Each milestone should produce a coherent vertical slice, not a pile of unrelated code.

Every phase below conforms to the shape defined here. A PR that implements a phase and omits any of these elements is not "phase complete":

- **`Depends on:`** explicit list of prior phase numbers required for the phase to begin;
- **Deliverables** — concrete artifacts produced;
- **Non-goals** — what is intentionally deferred;
- **Acceptance criteria** — measurable assertions (numbers, error tags, file paths), not "works";
- **Appendix C verification rows** — every row from Appendix C / H that the phase's deliverables gate;
- **Required validation** — exact CLI commands.

A phase whose deliverable list exceeds 4 items must be split. A phase whose acceptance criteria are not measurable must be tightened before the phase begins. Phase scope is bounded at 2 weeks; longer phases must be decomposed.

## 24.0.1 Phase dependency graph

```
Phase 0  (bootstrap)
   ├─→ Phase 1  (native host spike)
   │       └─→ Phase 2  (runtime supervision)
   │               └─→ Phase 3  (host protocol MVP)
   │                       └─→ Phase 3.5  (resource model + headless harness)
   │                               └─→ Phase 4  (typed bridge MVP)
   │                                       └─→ Phase 5  (window service)
   │                                               └─→ Phase 6  (renderer template)
   │                                                       ├─→ Phase 7  (native services A)
   │                                                       └─→ Phase 8  (native services B)
   │                                                               └─→ Phase 9  (streams + cancellation hardening)
   │                                                                       ├─→ Phase 10 (filesystem)
   │                                                                       ├─→ Phase 11 (process)
   │                                                                       └─→ Phase 12 (PTY)
   │                                                                                ├─→ Phase 13 (storage)
   │                                                                                └─→ Phase 14 (secrets)
   │                                                                                          └─→ Phase 15 (permissions)
   │                                                                                                    └─→ Phase 16 (commands + shortcuts)
   │                                                                                                              └─→ Phase 17 (workers + jobs)
   │                                                                                                                        └─→ Phase 18 (devtools)
   │                                                                                                                                  └─→ Phase 19 (testing harness)
   │                                                                                                                                            └─→ Phase 20 (build + package)
   │                                                                                                                                                      └─→ Phase 21 (signing + update)
   │                                                                                                                                                                └─→ Phase 22 (cross-platform hardening)
   │                                                                                                                                                                          └─→ Phase 23 (release candidate)
```

The historical phase numbering in §24.1–24.24 is preserved. **Phase 3.5** is inserted between current Phase 3 and Phase 4 to land the resource model (handles, registry, leak detection, headless harness) before any native service starts issuing handles. Phases 9 onward are renumbered conceptually here in the graph but keep their existing §24.X anchors below; §24.9 absorbs the prior content for "resources and scopes" that has now moved into Phase 3.5, and §24.9's new role is "Streams + cancellation hardening" (the prior §24.10 content).

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

## 24.3.5 Phase 3.5: Resource model and headless harness

**Goal:** Land the resource registry, generation-stamped handles, scope graph, leak detection, and a headless test harness that can drive the runtime from CI without a window or WebView.

**Depends on:** Phase 3.

### Deliverables

- `Desktop.Resources` registry with `list`, `get`, `dispose`, `observe`, `assertNoLeaks` (per §13.2–§13.6);
- `ResourceHandle` shape with `(kind, id: UUIDv7, generation, ownerScope)` and `StaleHandle` typed error (per §13.7);
- headless test harness in `@effect-desktop/test`: a `runHeadless(layer)` that runs the runtime against a mock host that records protocol calls and replays canned responses.

### Non-goals

- Do not extend public APIs beyond what the harness needs.
- Do not implement leak detection for native-side resources yet — Phase 5+ will populate that.
- Do not skip the harness because Phase 4 will validate the bridge — Phase 4 depends on the harness.

### Acceptance criteria

- A handle's `(id, generation)` is stable across `Resources.observe` snapshots until disposal; on disposal the handle is removed from the registry and `generation` is bumped if the kind opts in to ID reuse.
- A scope close disposes its owned handles in dependency order and emits `Resource.Disposed` audit events with the correct `ownerScope` for each.
- Cross-scope use of a handle in development emits a `CrossScopeHandle` warning; in production it returns the typed error.
- The headless harness runs the smoke test suite without opening a real window in under 5 s on `macos-arm64` baseline hardware.
- `assertNoOpenResources` fails if any test exits with non-app handles in the registry; passes when the test cleans up.

### Appendix C verification rows

C.62 (StaleHandle), C.76 (Resource scope-disposal order), C.75 (Headless harness runs), C.85 (Native method contract matrix where native resources are involved), C.86 (Runtime method contract matrix where runtime resources are involved).

### Required validation

```bash
bun run typecheck
bun test --workspace=@effect-desktop/test
bun test --workspace=@effect-desktop/core --grep="Resource"
cargo check --workspace
cargo test --workspace
```

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

**Goal:** Runtime SQLite, settings, event log, migrations.

### Deliverables

- Effect SQL-backed runtime SQLite policy layer.
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

### Supply-chain and release-artifact gates

- **SBOM generation.** Every released artifact ships with an SPDX-format SBOM listing every TypeScript and Rust dependency (direct and transitive). The SBOM is signed and published alongside the artifact. `bun desktop publish` fails if SBOM generation fails.
- **CVSS scan gate.** All dependencies are scanned for CVSS ≥ 7.0 vulnerabilities. The scan blocks release; an exemption requires a documented justification in `engineering/security/exemptions/` with a re-review date.
- **Reproducible build check.** The build artifact's content hash is reproducible from the same input revision on a clean runner; CI runs the build twice and diffs the artifact bytes.
- **SLSA v1.0 provenance.** Every artifact carries SLSA provenance attestation containing builder ID, source commit, and signed input metadata.
- **Release artifact signing.** All release artifacts are signed by an HSM-backed key, not a CI runner key. Hardware key custody and rotation policy are documented in `engineering/security/key-management.md`.
- **Secret scanning.** Every branch is scanned for committed secrets on every push; a hit blocks merge.
- **Self-hosted runner posture.** Self-hosted runners are ephemeral, rebuilt from a clean image per job; persistent runners are forbidden for release jobs.
- **Branch protection.** `main` requires ≥1 review; release branches require ≥2 reviews including a security reviewer.

## 25.5 Accessibility and localization gates

- Every template passes a WCAG 2.1 AA automated audit (axe-core + Pa11y) plus a manual keyboard-only navigation walkthrough recorded as a screencast in `engineering/audits/<release>/`.
- All template UI strings are externalized; no hardcoded user-visible English in template source.
- At least one example is verified end-to-end in an RTL language (Arabic or Hebrew); the audit is part of the release artifact.
- All templates respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Color contrast on all template UI is ≥ 4.5:1 for body text and 3:1 for large text.

## 25.6 Versioning policy post-v1.0.0

The framework's stability contract after v1.0.0 follows semver with desktop-specific clarifications:

- **Patch (`1.x.Y`).** Bug fixes, performance improvements, dependency updates. No new methods, no new fields, no new error tags.
- **Minor (`1.X.0`).** Additive changes only:
  - new services, new methods, new optional fields, new optional config sections;
  - new error tags appended to the closed unions defined in §9.4 / §10.8 (apps must `_:` exhaustive-match defensively in case);
  - new platform support cells in Appendix K.
- **Major (`X.0.0`).** Breaking changes — removed methods, signature changes, removed error tags, removed platforms. Any change that requires apps to alter source.
- **Deprecation cycle.** A method or field marked deprecated remains in the public API for at least three minor releases (≈ one year) with `@deprecated` JSDoc and a runtime warning before removal.
- **Bridge contract freeze.** Public envelope shapes (§9.3) are frozen between majors; protocol fields may be added (with defaults), never removed or reordered.
- **Versioning compliance test.** A snapshot of every public API and every Appendix C row is committed at release; CI flags any non-additive change to the snapshot as a release-blocking semver violation.

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

## 26.13 IPC origin spoofing

- **Likelihood:** Medium
- **Impact:** Critical
- **Mitigation:** Origin tokens (§9.3, §14.9) bound to WebView creation, rotated on navigation, never exposed to JS; runtime rejects mismatched envelopes with `OriginInvalid`. Verified by C.50.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.14 Update server / CDN compromise

- **Likelihood:** Low
- **Impact:** Critical
- **Mitigation:** Ed25519 manifest signing, downgrade refusal, partial-install atomicity, notarization staple checks (§23.4); HSM-backed release signing key (§25.4). Verified by C.52, C.53, C.54.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.15 Devtools secret leakage

- **Likelihood:** Medium
- **Impact:** High
- **Mitigation:** Devtools off by default in production; redaction filter on every emission boundary (§14.10); loopback-only socket + per-launch token (§22.7). Verified by C.55, C.70.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.16 Capability revocation race

- **Likelihood:** Medium
- **Impact:** High
- **Mitigation:** Revocation tokens with 250 ms propagation target and 5 s forced-abort ceiling (§14.4, §14.8); in-flight Effects interrupted with `PermissionRevoked`. Verified by C.57.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.17 Symlink / TOCTOU privilege escalation

- **Likelihood:** Medium
- **Impact:** High
- **Mitigation:** `Filesystem` resolves to canonical realpath before permission check; symlinks crossing capability roots return `SymlinkEscapesRoot`; opens use `O_NOFOLLOW` semantics where supported (§12.1). Verified by C.58, C.59.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

## 26.18 Effect v3 pattern leakage

- **Likelihood:** Medium
- **Impact:** Medium
- **Mitigation:** §4.4.1 pins Effect v4 as the baseline; `bun desktop check` rejects `@effect/schema` imports, the `$` adapter form, and two-parameter `Effect.Effect<A, E>` in public type signatures. v4 conformance is a phase-completion gate (§28.3, §28.5) and is verified by C.79.
- **Owner:** technical lead assigned by milestone.
- **Review cadence:** every release candidate and after any related incident.

\newpage

# 27. Required Architecture Decision Records

## 27.1 ADR-0001: Use a Rust native host

**Decision:** Use a Rust native host.

**Reason:** Rust provides memory-safe native platform integration and a strong ecosystem for WebView/windowing.

**ADR file:** `engineering/decisions/adr-0001-use-a-rust-native-host.md`

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

**ADR file:** `engineering/decisions/adr-0002-use-a-bun-runtime-process.md`

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

**ADR file:** `engineering/decisions/adr-0003-use-system-webview-by-default.md`

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

**ADR file:** `engineering/decisions/adr-0004-no-compatibility-layer-for-other-desktop-frameworks.md`

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

**ADR file:** `engineering/decisions/adr-0005-generate-bridge-clients-from-effect-contracts.md`

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

**ADR file:** `engineering/decisions/adr-0006-native-host-protocol-before-native-bindings.md`

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

**ADR file:** `engineering/decisions/adr-0007-effect-scopes-for-all-resources.md`

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

**ADR file:** `engineering/decisions/adr-0008-generic-primitives-over-vertical-packages.md`

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

**ADR file:** `engineering/decisions/adr-0009-packaging-is-first-party.md`

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

**ADR file:** `engineering/decisions/adr-0010-renderer-remains-unprivileged.md`

Each ADR must include:

- Context;
- Decision;
- Alternatives considered;
- Consequences;
- Migration notes;
- Validation requirements.

## 27.11 ADR-0022: RpcGroup is the desktop app boundary

**Decision:** `RpcGroup` is the renderer-callable API boundary.

**Reason:** One contract value must drive runtime implementation, app assembly, framework adapters, permissions, support metadata, and examples.

**ADR file:** `engineering/decisions/adr-0022-rpcgroup-desktop-app-boundary.md`

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

### Effect v4 conformance (per §4.4.1)

- Import every Effect-related symbol from `effect` (not `@effect/schema`, not legacy v3-only sub-packages).
- Use `Effect.Effect<A, E, R>` in every public type signature; never elide `R`.
- Define services with `class X extends Context.Service<X, XApi>()("X", { make: Effect.gen(...) }) {}` when the service has a default layer; use `Context.Tag(...)` only for ad-hoc shapes.
- Define schema classes with `class T extends Schema.Class<T>("T")({...}) {}`.
- Use `Effect.gen(function* () { ... yield* effect })` without the `$` adapter.
- Compose layers with `Layer.provide` / `Layer.provideMerge` / `Layer.succeed` / `Layer.effect`.
- Stream contracts compile to `Stream.Stream<A, E, R>`.
- A `bun desktop check` violation on any of the above blocks the phase from completing.

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

## 28.5 Spec-conformance pre-flight

Before starting a phase, the implementation agent must:

1. List every Appendix C verification row that the phase's deliverables gate (per §24's per-phase verification rows field).
2. For each row, identify the test file or harness that will produce evidence (typically `tests/<area>/<row>.test.ts` or `crates/<crate>/tests/<row>.rs`).
3. Identify every section of this spec the deliverables touch (e.g., "implements §11.1, §11.20; satisfies §14.7, §14.9").

Before declaring the phase complete, the agent must attach evidence per row in the §28.4 completion report:

```txt
Verification:
  C.50 IPC origin tokens reject spoofed windowId/originToken
    test: tests/security/origin-token.test.ts
    result: ✓ 7 cases pass on macos-arm64, linux-x64, windows-x64
  C.51 CSP blocks eval and inline script execution
    test: tests/security/csp.test.ts
    result: ✓ 4 cases pass
  ...
```

A phase whose completion report omits any required Appendix C row, or attaches evidence that does not match the row's stated proof shape, is not "phase complete" — the gate at §20.8 / §20.9 will refuse it.

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

These sketches are non-normative implementation notes. The normative public contracts live in §18.6 and Appendix K. A v1.0.0 public method must not ship with `unknown` input or output types, even though this appendix uses `unknown` to keep historical sketches short.

```ts
import { Context, Effect, Schema } from "effect"

export class App extends Context.Service<App, AppApi>()("App", {
  make: Effect.gen(function* () {
    // dependencies acquired here
    return {
      getInfo: (input: AppGetInfoInput) => Effect.succeed(/* ... */)
      // ...
    }
  })
}) {}
```

The `interface XxxService` form below is shorthand for the method surface the v4 class must provide. `Effect.Effect<A, E, R>` follows the v4 type-parameter order (success, error, requirements). All inputs and outputs must be schema-validated at the bridge boundary.

## B.1 `App` sketch

```ts
import type { Effect } from "effect"

export interface AppService {
  getInfo(input: unknown): Effect.Effect<unknown, DesktopError, never>
  quit(input: unknown): Effect.Effect<unknown, DesktopError, never>
  restart(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setSingleInstance(input: unknown): Effect.Effect<unknown, DesktopError, never>
  onOpenFile(input: unknown): Effect.Effect<unknown, DesktopError, never>
  onOpenUrl(input: unknown): Effect.Effect<unknown, DesktopError, never>
  onBeforeQuit(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.2 `Window` sketch

```ts
export interface WindowService {
  create(input: unknown): Effect.Effect<unknown, DesktopError, never>
  show(input: unknown): Effect.Effect<unknown, DesktopError, never>
  hide(input: unknown): Effect.Effect<unknown, DesktopError, never>
  focus(input: unknown): Effect.Effect<unknown, DesktopError, never>
  close(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setTitle(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setSize(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setPosition(input: unknown): Effect.Effect<unknown, DesktopError, never>
  enterFullScreen(input: unknown): Effect.Effect<unknown, DesktopError, never>
  exitFullScreen(input: unknown): Effect.Effect<unknown, DesktopError, never>
  persistState(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.3 `WebView` sketch

```ts
export interface WebViewService {
  create(input: unknown): Effect.Effect<unknown, DesktopError, never>
  loadRoute(input: unknown): Effect.Effect<unknown, DesktopError, never>
  loadUrl(input: unknown): Effect.Effect<unknown, DesktopError, never>
  reload(input: unknown): Effect.Effect<unknown, DesktopError, never>
  goBack(input: unknown): Effect.Effect<unknown, DesktopError, never>
  goForward(input: unknown): Effect.Effect<unknown, DesktopError, never>
  captureScreenshot(input: unknown): Effect.Effect<unknown, DesktopError, never>
  destroy(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.4 `Menu` sketch

```ts
export interface MenuService {
  setApplicationMenu(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setWindowMenu(input: unknown): Effect.Effect<unknown, DesktopError, never>
  clear(input: unknown): Effect.Effect<unknown, DesktopError, never>
  bindCommand(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.5 `ContextMenu` sketch

```ts
export interface ContextMenuService {
  show(input: unknown): Effect.Effect<unknown, DesktopError, never>
  buildFromTemplate(input: unknown): Effect.Effect<unknown, DesktopError, never>
  bindCommand(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.6 `Tray` sketch

```ts
export interface TrayService {
  create(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setIcon(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setTooltip(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setMenu(input: unknown): Effect.Effect<unknown, DesktopError, never>
  destroy(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.7 `Dialog` sketch

```ts
export interface DialogService {
  openFile(input: unknown): Effect.Effect<unknown, DesktopError, never>
  openDirectory(input: unknown): Effect.Effect<unknown, DesktopError, never>
  saveFile(input: unknown): Effect.Effect<unknown, DesktopError, never>
  message(input: unknown): Effect.Effect<unknown, DesktopError, never>
  confirm(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.8 `Clipboard` sketch

```ts
export interface ClipboardService {
  readText(input: unknown): Effect.Effect<unknown, DesktopError, never>
  writeText(input: unknown): Effect.Effect<unknown, DesktopError, never>
  readImage(input: unknown): Effect.Effect<unknown, DesktopError, never>
  writeImage(input: unknown): Effect.Effect<unknown, DesktopError, never>
  clear(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.9 `Notification` sketch

```ts
export interface NotificationService {
  show(input: unknown): Effect.Effect<unknown, DesktopError, never>
  close(input: unknown): Effect.Effect<unknown, DesktopError, never>
  onClick(input: unknown): Effect.Effect<unknown, DesktopError, never>
  isSupported(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.10 `Shell` sketch

```ts
export interface ShellService {
  openExternal(input: unknown): Effect.Effect<unknown, DesktopError, never>
  showItemInFolder(input: unknown): Effect.Effect<unknown, DesktopError, never>
  openPath(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.11 `Screen` sketch

```ts
export interface ScreenService {
  getDisplays(input: unknown): Effect.Effect<unknown, DesktopError, never>
  getPrimaryDisplay(input: unknown): Effect.Effect<unknown, DesktopError, never>
  getPointerPoint(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.12 `GlobalShortcut` sketch

```ts
export interface GlobalShortcutService {
  register(input: unknown): Effect.Effect<unknown, DesktopError, never>
  unregister(input: unknown): Effect.Effect<unknown, DesktopError, never>
  unregisterAll(input: unknown): Effect.Effect<unknown, DesktopError, never>
  isRegistered(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.13 `Protocol` sketch

```ts
export interface ProtocolService {
  registerAppProtocol(input: unknown): Effect.Effect<unknown, DesktopError, never>
  serveAsset(input: unknown): Effect.Effect<unknown, DesktopError, never>
  serveRoute(input: unknown): Effect.Effect<unknown, DesktopError, never>
  deny(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.14 `SafeStorage` sketch

```ts
export interface SafeStorageService {
  set(input: unknown): Effect.Effect<unknown, DesktopError, never>
  get(input: unknown): Effect.Effect<unknown, DesktopError, never>
  delete(input: unknown): Effect.Effect<unknown, DesktopError, never>
  list(input: unknown): Effect.Effect<unknown, DesktopError, never>
  isAvailable(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.15 `Path` sketch

```ts
export interface PathService {
  appData(input: unknown): Effect.Effect<unknown, DesktopError, never>
  cache(input: unknown): Effect.Effect<unknown, DesktopError, never>
  logs(input: unknown): Effect.Effect<unknown, DesktopError, never>
  temp(input: unknown): Effect.Effect<unknown, DesktopError, never>
  home(input: unknown): Effect.Effect<unknown, DesktopError, never>
  downloads(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.16 `Updater` sketch

```ts
export interface UpdaterService {
  check(input: unknown): Effect.Effect<unknown, DesktopError, never>
  download(input: unknown): Effect.Effect<unknown, DesktopError, never>
  install(input: unknown): Effect.Effect<unknown, DesktopError, never>
  installAndRestart(input: unknown): Effect.Effect<unknown, DesktopError, never>
  getStatus(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.17 `CrashReporter` sketch

```ts
export interface CrashReporterService {
  start(input: unknown): Effect.Effect<unknown, DesktopError, never>
  recordBreadcrumb(input: unknown): Effect.Effect<unknown, DesktopError, never>
  flush(input: unknown): Effect.Effect<unknown, DesktopError, never>
  setUploadHandler(input: unknown): Effect.Effect<unknown, DesktopError, never>
}
```

This sketch is intentionally generic. The real service must replace `unknown` with schema-defined input and output types. Every method must include tests for success, invalid input, failure mapping, permissions, and devtools events where relevant.

## B.18 `PowerMonitor` sketch

```ts
export interface PowerMonitorService {
  onSuspend(input: unknown): Effect.Effect<unknown, DesktopError, never>
  onResume(input: unknown): Effect.Effect<unknown, DesktopError, never>
  onShutdown(input: unknown): Effect.Effect<unknown, DesktopError, never>
  onPowerSourceChanged(input: unknown): Effect.Effect<unknown, DesktopError, never>
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

## H.9 Scaffolding acceptance matrix

### Build requirements

No scaffolding module is shipped.

### Functional requirements

None.

### Test requirements

None.

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

## H.37 Runtime SQLite acceptance matrix

### Build requirements

- The module builds in isolation.
- The module participates in the repository-level build.
- The module has no forbidden imports.
- The module exposes only Effect SQL symbols plus intentional desktop policy
  symbols.
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
- Failure tests assert typed policy errors at the desktop boundary and Effect SQL
  errors at the driver boundary.
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

## I.19 Runtime SQLite

The Runtime SQLite documentation page must include:

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

## J.5 Post-v1 compatibility rules

Post-v1 changes require:

- deprecation period for public APIs;
- migration guide;
- test coverage for old and new behavior during deprecation;
- clear removal version.

\newpage

# Appendix K. Cross-Platform Capability Matrix

This matrix is normative. A §11 method whose row is missing from this appendix cannot ship. A change that downgrades support requires an ADR.

Cells use exactly:

- `✓` — fully supported with documented behavior;
- `partial(reason)` — works with a documented reduction;
- `error(tag, reason)` — returns the named typed error on this platform.

Grouped rows are allowed only when every method in the group has identical behavior. Otherwise each method must have its own row.

| Method or exact method group                                                                                                          | macOS (arm64/x64)                                   | Windows (x64/arm64)                              | Linux (x64/arm64)                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `App.getInfo`, `App.getCommandLine`, `App.quit`, `App.restart`, `App.onBeforeQuit`                                                    | ✓                                                   | ✓                                                | ✓                                                                          |
| `App.requestSingleInstanceLock`                                                                                                       | ✓ (flock)                                           | ✓ (named mutex `Global\<bundle>`)                | ✓ (flock)                                                                  |
| `App.onSecondInstance`                                                                                                                | ✓                                                   | ✓                                                | ✓                                                                          |
| `Autostart.isEnabled`, `Autostart.enable`, `Autostart.disable`                                                                        | ✓ (`SMAppService`)                                  | ✓ (HKCU Run key)                                 | ✓ (`~/.config/autostart`)                                                  |
| `Association.setDefaultProtocolClient`                                                                                                | ✓                                                   | ✓                                                | partial(distro-dep, requires `xdg-mime`)                                   |
| `App.onOpenUrl`                                                                                                                       | ✓                                                   | ✓                                                | partial(distro-dep, requires `xdg-mime`)                                   |
| `App.onOpenFile`                                                                                                                      | ✓                                                   | ✓                                                | partial(file-manager-dep)                                                  |
| `Window.create`, `show`, `hide`, `focus`, `close`, `setTitle`, `setSize`, `setPosition`, `setBackgroundColor`, `persistState`         | ✓                                                   | ✓                                                | ✓                                                                          |
| `Window.setVibrancy`                                                                                                                  | ✓                                                   | error(`Unsupported`, "no vibrancy on Windows")   | error(`Unsupported`, "no vibrancy on Linux")                               |
| `Window.setHasShadow`                                                                                                                 | ✓                                                   | ✓                                                | partial(compositor-dep)                                                    |
| `Window.enterFullScreen`, `exitFullScreen`, `onFullScreenChanged`                                                                     | ✓                                                   | ✓                                                | partial(WM-dep)                                                            |
| `Window.getScaleFactor`, `Window.onScaleChanged`                                                                                      | ✓                                                   | ✓                                                | ✓                                                                          |
| `WebView.create`, `loadRoute`, `reload`, `goBack`, `goForward`, `destroy`, `setNavigationPolicy`                                      | ✓                                                   | ✓                                                | ✓                                                                          |
| `WebView.loadUrl`                                                                                                                     | ✓                                                   | ✓                                                | ✓ (subject to navigation policy)                                           |
| `WebView.captureScreenshot`                                                                                                           | ✓                                                   | ✓                                                | partial(WebKitGTK only)                                                    |
| `Menu.setApplicationMenu`                                                                                                             | ✓                                                   | partial(per-window menu only)                    | partial(per-window menu only)                                              |
| `Menu.setWindowMenu`, `Menu.clear`, `Menu.bindCommand`                                                                                | ✓                                                   | ✓                                                | ✓                                                                          |
| `ContextMenu.show`, `buildFromTemplate`, `bindCommand`                                                                                | ✓                                                   | ✓                                                | ✓                                                                          |
| `Tray.create`, `setIcon`, `setTooltip`, `setMenu`, `destroy`                                                                          | ✓                                                   | ✓                                                | partial(distro-dep, AppIndicator/StatusNotifier)                           |
| `Dialog.openFile`, `openDirectory`, `saveFile`, `message`, `confirm`                                                                  | ✓                                                   | ✓                                                | ✓                                                                          |
| `Clipboard.readText`, `writeText`, `readImage`, `writeImage`, `clear`                                                                 | ✓                                                   | ✓                                                | partial(X11/Wayland diff)                                                  |
| `Notification.show`, `close`, `onClick`, `onAction`, `isSupported`, `getPermissionStatus`                                             | ✓ (after `requestPermission`)                       | ✓                                                | partial(distro-dep)                                                        |
| `Notification.requestPermission`                                                                                                      | ✓ (must be called once)                             | ✓ (no-op, returns `granted`)                     | ✓ (no-op for daemons)                                                      |
| `Shell.openExternal`, `openPath`, `showItemInFolder`                                                                                  | ✓                                                   | ✓                                                | ✓                                                                          |
| `Screen.getDisplays`, `getPrimaryDisplay`, `Screen.isSupported`                                                                       | ✓                                                   | ✓                                                | ✓                                                                          |
| `Screen.getPointerPoint`                                                                                                              | ✓                                                   | ✓                                                | partial(Wayland may deny)                                                  |
| `GlobalShortcut.register`, `unregister`, `unregisterAll`, `isRegistered`, `isSupported`                                               | ✓                                                   | ✓                                                | partial(X11 ✓; Wayland error(`Unsupported`, "wayland-no-global-shortcut")) |
| `Protocol.registerAppProtocol`, `serveAsset`, `serveRoute`, `deny`                                                                    | ✓                                                   | ✓                                                | ✓                                                                          |
| `SafeStorage.set`, `get`, `delete`, `list`, `isAvailable`                                                                             | ✓ (Keychain)                                        | ✓ (DPAPI)                                        | partial(Secret Service / GNOME Keyring)                                    |
| `Path.appData`, `cache`, `logs`, `temp`, `home`, `downloads`                                                                          | ✓                                                   | ✓                                                | ✓                                                                          |
| `Updater.check`, `download`, `install`, `installAndRestart`, `getStatus`                                                              | ✓                                                   | ✓                                                | ✓                                                                          |
| `CrashReporter.start`, `recordBreadcrumb`, `flush`, `setUploadHandler`                                                                | ✓                                                   | ✓                                                | ✓                                                                          |
| `PowerMonitor.onSuspend`, `onResume`, `onShutdown`, `PowerMonitor.isSupported`                                                        | ✓                                                   | ✓                                                | ✓                                                                          |
| `PowerMonitor.onPowerSourceChanged`                                                                                                   | ✓                                                   | ✓                                                | partial(distro-dep)                                                        |
| `SystemAppearance.getAppearance`, `onAppearanceChanged`, `SystemAppearance.isSupported`, `getReducedMotion`, `getReducedTransparency` | ✓                                                   | ✓                                                | partial(distro-dep)                                                        |
| `SystemAppearance.getAccentColor`                                                                                                     | ✓                                                   | ✓                                                | error(`Unsupported`, "no canonical accent on Linux")                       |
| `Dock.setBadgeCount`                                                                                                                  | ✓                                                   | ✓ (taskbar overlay)                              | partial(launcher-dep)                                                      |
| `Dock.setBadgeText`                                                                                                                   | ✓                                                   | error(`Unsupported`, "no badge text on Windows") | error(`Unsupported`, "no portable badge text on Linux")                    |
| `Dock.setProgress`                                                                                                                    | partial(no state)                                   | ✓                                                | partial(launcher-dep)                                                      |
| `Dock.setMenu`                                                                                                                        | ✓                                                   | error(`Unsupported`, "use jump list")            | error(`Unsupported`, "no portable dock menu on Linux")                     |
| `Dock.setJumpList`                                                                                                                    | error(`Unsupported`, "jump lists are Windows-only") | ✓                                                | error(`Unsupported`, "jump lists are Windows-only")                        |
| `Dock.requestAttention`                                                                                                               | ✓ (bounce)                                          | ✓ (flash)                                        | partial(WM-dep)                                                            |

Apps must call `<Primitive>.isSupported(method)` before any non-`✓` method. The generated client exposes `isSupported(method: string): boolean` from this table. The production checker fails on renderer or runtime contracts that call non-`✓` methods without a dominating guard in the same control-flow path.

\newpage

# Appendix L. Rust Error Mapping and Panic Safety

This appendix is the single authoritative source for `HostProtocolError` tags and the platform-error mapping. `crates/host-protocol` exports the enum; every other crate consumes it.

## L.1 Canonical `HostProtocolError` enum

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tag")]
pub enum HostProtocolError {
    FileNotFound { path: String },
    PermissionDenied { capability: String, resource: Option<String> },
    Timeout { timeout_ms: u64 },
    Cancelled { source: CancelSource },
    Unsupported { reason: String },
    InvalidArgument { field: String, reason: String },
    ResourceBusy { resource: String },
    DiskFull { path: String, free_bytes: u64 },
    RateLimited { retry_after_ms: u64 },
    FrameTooLarge { size_bytes: u64, limit_bytes: u64 },
    OriginInvalid,
    StaleHandle { kind: String, id: String, expected_generation: u32, actual_generation: u32 },
    CrossScopeHandle { kind: String, id: String, owner_scope: String, attempted_scope: String },
    BackpressureOverflow { policy: String, lost_frames: u64 },
    RendererDisconnected { duration_ms: u64 },
    RuntimeRestarted,
    RuntimeUnavailable { retry_after_ms: u64 },
    HostUnavailable,
    MethodNotFound { method: String },
    InvalidOutput { method: String, reason: String },
    PermissionRevoked { capability: String, revoked_at: u64 },
    StreamClosed { stream_id: String },
    BinaryDecodeError { reason: String },
    ReconnectBackfillExhausted { stream_id: String },
    PanicInNativeCode { message: String, backtrace: Option<String>, location: Option<String> },
    NetworkError { kind: NetworkErrorKind, message: String },
    NotFound { resource: String },
    AlreadyExists { resource: String },
    InvalidState { current: String, attempted: String },
    SymlinkEscapesRoot { requested: String, resolved: String, capability_roots: Vec<String> },
    EventLogFull { free_bytes: u64 },
    UpdateDowngradeRefused { installed_version: String, manifest_version: String },
    UpdateDownloadTruncated { downloaded_bytes: u64, expected_bytes: u64 },
    UpdateStaleNotarization { notarized_at: String },
    SettingsMigrationFailed { schema_version: u32, cause: String },
    SettingsRecoveredFromBackup { backup_path: String },
    EventLogSegmentCorrupt { segment_path: String },
    PtyForceKillTimeout { pty_id: String },
    Internal { message: String },
}
```

Each variant carries a documented `recoverable: bool` default and (where applicable) a `retry_after_ms`. The TypeScript-facing service maps these to the corresponding `Desktop.Errors.*` types.

## L.2 Platform-error mapping

| Source error                               | Mapped tag                  | Notes                         |
| ------------------------------------------ | --------------------------- | ----------------------------- |
| `io::ErrorKind::NotFound`                  | `FileNotFound` / `NotFound` | Path included when available  |
| `io::ErrorKind::PermissionDenied`          | `PermissionDenied`          | OS error preserved in `cause` |
| `io::ErrorKind::TimedOut`                  | `Timeout`                   |                               |
| `io::ErrorKind::WouldBlock`                | `ResourceBusy`              |                               |
| `io::ErrorKind::AlreadyExists`             | `AlreadyExists`             |                               |
| `io::ErrorKind::Other` with `errno=ENOSPC` | `DiskFull`                  | Linux/macOS                   |
| Windows `ERROR_FILE_NOT_FOUND` (2)         | `FileNotFound`              |                               |
| Windows `ERROR_ACCESS_DENIED` (5)          | `PermissionDenied`          |                               |
| Windows `ERROR_DISK_FULL` (112)            | `DiskFull`                  |                               |
| Windows `ERROR_SHARING_VIOLATION` (32)     | `ResourceBusy`              |                               |
| Windows `ERROR_FILENAME_EXCED_RANGE` (206) | `InvalidArgument`           |                               |
| WebView2 `HRESULT 0x80370102`              | `Unsupported`               |                               |
| `serde_json::Error::syntax`                | `InvalidArgument`           |                               |
| `tokio::time::error::Elapsed`              | `Timeout`                   |                               |
| `Box<dyn Any + Send>` from `catch_unwind`  | `PanicInNativeCode`         | message/location extracted    |

## L.3 Panic boundary contract

Every FFI entry point and every protocol-handler entry point wraps its body in `std::panic::catch_unwind` (typically through a thin `host_call!` macro). The macro:

```rust
macro_rules! host_call {
    ($body:block) => {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<_, HostProtocolError> {
            $body
        }))
        .unwrap_or_else(|payload| {
            Err(HostProtocolError::PanicInNativeCode {
                message: extract_panic_message(&payload),
                backtrace: capture_backtrace_if_enabled(),
                location: capture_panic_location(),
            })
        })
    };
}
```

Forbidden idioms on FFI / protocol-handler paths (enforced by Clippy lints scoped to those modules):

- `unwrap()`, `expect()`, `panic!()`, `unreachable!()`, `todo!()` outside of compile-time constants;
- direct slice indexing without prior bounds check;
- `Mutex::lock().unwrap()` — must use `try_lock` or recover from poisoning;
- `RefCell::borrow_mut()` without a documented invariant.

A `tests/panic_safety.rs` integration test asserts that a panicking handler returns `PanicInNativeCode` rather than aborting the process.

\newpage

# Appendix M. Security and Supply-Chain Checklist

This checklist is enforced by `bun desktop check --production` and the §25.4 release criteria. Each row maps to a §x.y section and an Appendix C verification row.

## M.1 Renderer threat model

The renderer is treated as untrusted. The framework defends against:

- compromised remote pages loaded into a misconfigured WebView;
- malicious devtools sessions;
- exfiltration via crash reports or telemetry;
- prompt-fatigue attacks against the approval broker;
- DoS via oversized frames or stream flooding.

Mitigations are in §14.1 (default posture), §14.4 (approval coalescing + host-rendered prompt), §14.7 (CSP), §14.9 (origin auth), §14.10 (redaction), §22.7 (devtools security), §9.3 (framing limits).

## M.2 Content Security Policy

- Default policy as defined in §14.7 is non-negotiable in production.
- Per-request nonces minted by the protocol handler.
- Loosening any directive requires `security.csp.acknowledgeWeakening: true` and a justification comment.

## M.3 IPC origin authentication

- Per-WebView 256-bit `originToken`; never exposed to JS.
- Token rotates on top-level navigation and on reload.
- Devtools tokens are namespaced separately.

## M.4 Update security

- Algorithm: Ed25519, pinned.
- Key rotation: client trusts up to `keyVersion - 2`.
- Downgrade refusal on `manifest.version <= installed.version`.
- Partial-install: download-to-temp + signature verify + atomic move.
- macOS: notarization staple checked; > 30 days unstapled triggers warning.
- Windows: Authenticode with RFC 3161 timestamp; MOTW removal in installer.
- Truncation detection via `expectedBytes` comparison.

## M.5 macOS hardened-runtime entitlements

Mirror of §23.3 macOS subsection. Required entitlements are enumerated; deviations require an ADR and a security review.

## M.6 Windows packaging

- Authenticode signing on every binary.
- RFC 3161 timestamp server pinned.
- MOTW removal during installer extraction.
- SmartScreen reputation period documented in release notes.

## M.7 Subprocess argument injection

- Spawn helpers always use exec form with discrete `argv`.
- Shell metacharacters in `argv[0]` rejected with `InvalidArgument`.
- `cmd.exe /C` and `/bin/sh -c` require explicit `shell: true` plus a capability declaration.

## M.8 Symlink and TOCTOU rules

- Path arguments resolved to canonical realpath before permission check.
- Symlinks crossing capability roots → `SymlinkEscapesRoot`.
- File opens use `O_NOFOLLOW` semantics where supported.
- Hard links to files outside capability root denied.

## M.9 Secret redaction

- Default pattern (see §14.10) applied to logs, devtools displays, crash breadcrumbs, audit events, error details.
- Apps may extend the pattern; disabling the default fails the production checker.

## M.10 SBOM, SLSA, signing

- SBOM generated per release in SPDX format and signed.
- All deps scanned for CVSS ≥ 7.0; exemptions require documented justification with re-review date.
- Reproducible-build hash check on every release.
- SLSA v1.0 provenance attestation.
- Release artifacts signed with HSM-backed key.

## M.11 Disclosure policy

- `security.txt` at `/.well-known/security.txt` and in repo.
- Vulnerability response SLA: 24h critical, 7d high, 30d medium.
- 90-day embargo for pre-release fixes.
- `[Security]` heading in changelog when applicable.

## M.12 CI posture

- Self-hosted runners: ephemeral, rebuilt from clean image per job.
- Branch protection: `main` requires ≥1 review; release branches ≥2.
- Secret scanning enabled on every branch.
- Release jobs use HSM-backed keys, not runner-local keys.

\newpage

# Appendix N. Resource Handle and Lifecycle Semantics

This appendix consolidates the lifecycle contracts referenced from §10, §13, §9.7, §8.5, §14.4, and §14.8 into a single normative reference.

## N.1 Handle shape

```ts
import type { Effect } from "effect"

type DesktopResourceHandle<Kind extends ResourceKind, State extends string> = {
  readonly kind: Kind
  readonly id: UUIDv7 // sortable, globally unique
  readonly generation: number // monotonic; bumped only on opt-in id reuse
  readonly ownerScope: ScopeId
  readonly state: State
  dispose(): Effect.Effect<void, DesktopError, never>
}
```

## N.2 Allocation, disposal, ID-reuse

- `id` is allocated by the runtime registry as a UUIDv7. Sorting by `id` orders by creation time.
- `generation` starts at `0`. For most kinds (windows, processes, PTYs) the `id` is consumed permanently on disposal; subsequent use returns `StaleHandle` with `actualGeneration = -1`.
- Kinds that opt in to ID reuse (e.g., resumable streams declared `idempotent: true`) bump `generation` on each reuse.
- Disposal is idempotent. Calling `dispose` on an already-disposed handle is a no-op that returns success.

## N.3 Cross-scope policy

- A handle has exactly one owner scope.
- `Resource.share(handle, targetScope)` returns a fresh handle whose `ownerScope` is the new target.
- Direct cross-scope use without `share`: dev → `CrossScopeHandle` warning + proceed; prod → typed error.

## N.4 Stream lifecycle state machine

```
Pending ─────► Running ───► Closing ──┐
                  │                    ├──► Terminal { Complete | Error | Closed }
                  └─► Cancelling ──────┘
```

- A stream emits zero or more data frames followed by exactly one terminal frame.
- Terminal frame is the last frame on the wire for the `streamId`.
- Cleanup occurs after both endpoints observe the terminal frame, or after the 30 s cleanup-grace timeout.
- Backpressure overflow per §10.6 transitions Running → Terminal{Error: BackpressureOverflow} unless overflow policy is `dropOldest`/`dropNewest`/`block`.

## N.5 Reconnect rules

| Event               | Window                        | Behavior                                                                                                                     |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Renderer disconnect | 30 s default reconnect window | Token-bound resume; idempotent calls auto-replay; streams resume from cursor if buffered.                                    |
| Runtime restart     | n/a                           | All streams terminate with `Error{RuntimeRestarted}`; bridge calls fail; renderer shows "Reconnecting…" overlay until ready. |
| Host crash          | n/a                           | Supervisor relaunches host; orphaned runtime killed via process group / Job Object; full cold start.                         |

## N.6 Multi-window event routing

(Mirror of §8.8.) Routing modes: `firstResponder` | `broadcast` | `targeted(windowId)`. Per-event defaults documented in §8.8 table. Apps may override per-window via `App.subscribe(event, { route })`.

## N.7 Capability revocation propagation

- Revocation target: 250 ms; ceiling: 5 s; then forced abort.
- In-flight Effects holding the revoked capability are interrupted with `PermissionRevoked`.
- Streams owned by the revoked grant terminate with `Error{PermissionRevoked}`.
- Resource handles tied to the revoked capability are disposed per §13.4.

## N.8 Approval coalescing

- Identical `(operation, actor, resource)` requests collapse into one prompt.
- Outcome applies to all waiters atomically.
- Rate limit per actor: max 1 visible prompt; max queue depth 8.
- Approval UI renders in the host process (Rust); never in renderer.

\newpage

# Appendix O. Verification Matrix Additions

These rows extend Appendix C and are required for v1.0.0 release. They are named `C.50+`; `O.*` is not a valid verification ID.

## C.50 IPC origin authentication

A renderer-originated request with a missing, mismatched, or revoked `(windowId, originToken)` pair is rejected with `OriginInvalid`. Test: `tests/security/origin-token.test.ts`.

## C.51 CSP blocks eval and inline scripts

Loading a renderer page that attempts `eval("...")` or contains an inline `<script>` without a valid nonce results in a CSP violation captured by the WebView and a redacted entry in the audit log. Test: `tests/security/csp.test.ts`.

## C.52 Update downgrade refusal

A signed update manifest whose `version` is ≤ the installed version is rejected with `UpdateDowngradeRefused`. Test: `tests/updater/downgrade.test.ts`.

## C.53 Update truncation recovery

A download stream that terminates before `expectedBytes` are received aborts the install with `UpdateDownloadTruncated` and leaves the prior version intact. Test: `tests/updater/truncation.test.ts`.

## C.54 Notarization staple expiry

A bundle whose notarization staple is missing and whose notarization timestamp is > 30 days old triggers `UpdateStaleNotarization` warning before install. Test: `tests/updater/notarization-expiry.test.ts` (manual gate on macOS CI).

## C.55 Secret redaction

Log records, devtools display, crash breadcrumbs, and audit events scrub fields matching the §14.10 pattern to Effect `Redacted` values or their JSON materialized strings at protocol boundaries. Test: `tests/security/redaction.test.ts`.

## C.56 Worker capability inheritance

A worker spawned without an explicit capability declaration cannot use that capability; `PermissionDenied` is returned. Test: `tests/security/worker-capability.test.ts`.

## C.57 Capability revocation propagation

Revoking an in-use capability causes the in-flight Effect to fail with `PermissionRevoked` within 250 ms (target) and 5 s (ceiling). Test: `tests/security/revocation-race.test.ts`.

## C.58 Symlink crossing capability root

A `Filesystem.write` to a path whose canonical realpath falls outside the capability roots returns `SymlinkEscapesRoot`. Test: `tests/filesystem/symlink-escape.test.ts`.

## C.59 Hard link to protected file

A `Filesystem` operation against a hard link whose target is outside capability roots is denied with `SymlinkEscapesRoot`. Test: `tests/filesystem/hardlink-escape.test.ts`.

## C.60 Renderer reconnect within window

A renderer that disconnects and reconnects within `reconnectWindowMs` resumes idempotent calls; non-idempotent calls fail with `RendererDisconnected`. Test: `tests/protocol/reconnect-window.test.ts`.

## C.61 Stream terminal-frame ordering

The terminal frame for any `streamId` is the last frame on the wire; subsequent frames are dropped with an audit row. Test: `tests/bridge/stream-terminal-ordering.test.ts`.

## C.62 Stale handle returns typed error

Calling a method with a handle whose generation does not match the registry returns `StaleHandle` with `expectedGeneration`/`actualGeneration` set. Test: `tests/resources/stale-handle.test.ts`.

## C.63 Multi-window onSecondInstance routing

Launching a duplicate instance broadcasts `onSecondInstance` to every window in the primary instance, in creation order; the duplicate exits without opening a window. Test: `tests/app/single-instance.test.ts`.

## C.64 PTY pgid cleanup

Closing a PTY's owning scope sends `SIGTERM` to the PTY's pgid, then `SIGKILL` after 5 s; no zombie processes remain. Test: `tests/process/pty-cleanup.test.ts`.

## C.65 Settings concurrent update atomicity

Concurrent `Settings.update` on the same key serializes; readers never observe a torn value. Test: `tests/settings/concurrent-update.test.ts`.

## C.66 EventLog ordering

`EventLog.query` returns events in monotonic `EventId` order. Test: `tests/eventlog/ordering.test.ts`.

## C.67 EventLog durability

`EventLog.append` is durable on return: a process kill immediately after `append` resolves leaves the event readable on the next launch. Test: `tests/eventlog/durability.test.ts`.

## C.68 Cross-platform matrix gate

Every primitive in §11 declares its support row in Appendix K; CI fails on a missing row. Test: `tests/spec/appendix-k-completeness.test.ts`.

## C.69 Performance budget regression

`bun desktop check --perf` fails when a startup metric exceeds §21.6 budgets or when bridge latency p99 regresses > 20 % from `perf/main.baseline.json`. Test: `tests/perf/regression.test.ts`.

## C.70 Devtools redaction

Bridge frames, audit events, and stream frames displayed in devtools pass through the §14.10 redaction filter. Test: `tests/devtools/redaction.test.ts`.

## C.71 macOS hardened-runtime entitlements

The packaged macOS bundle has the entitlements listed in §23.3 macOS table; `codesign -d --entitlements -` verifies presence. Test: `tests/packaging/macos-entitlements.test.ts` (manual gate on macOS CI).

## C.72 Windows Authenticode timestamp

Windows release artifacts are Authenticode-signed with an RFC 3161 timestamp; `signtool verify /v /pa <artifact>` succeeds. Test: `tests/packaging/windows-timestamp.test.ts` (manual gate on Windows CI).

## C.73 SBOM signing

Every release artifact has an accompanying signed SPDX SBOM; signature validates with the published trust anchor. Test: `tests/release/sbom.test.ts`.

## C.74 Bridge call cancellation interrupt

A cancelled bridge call interrupts the handler Effect within 50 ms (signal) and reaches a terminal state within 5 s (grace) or emits `BridgeCallAborted`. Test: `tests/bridge/cancellation-grace.test.ts`.

## C.75 Headless harness runs

The headless test harness in `@effect-desktop/test` runs the smoke suite without opening a real window in under 5 s on `macos-arm64` baseline hardware. Test: `tests/test-harness/headless-smoke.test.ts`.

## C.76 Resource scope-disposal order

When a scope closes, dependents are disposed before the scope's own resources; terminal stream frames are emitted before native resources are released. Test: `tests/resources/disposal-order.test.ts`.

## C.77 Frame size limit

A frame larger than `maxFrameBytes` (default 4 MiB) is rejected with `FrameTooLarge`. Test: `tests/protocol/frame-too-large.test.ts`.

## C.78 Heartbeat-driven reconnect

Three consecutive missed pings (≥3 s silence) trigger a reconnect attempt; six consecutive missed pings (≥6 s) trigger a forced restart of the silent peer. Test: `tests/system/heartbeat.test.ts`.

## C.79 Effect v4 conformance

`bun desktop check` rejects every v3-only pattern: imports from `@effect/schema`, the `Effect.gen(function* ($) { ... yield* $(...) })` adapter form, two-parameter `Effect.Effect<A, E>` in public type signatures, and any other v3-only API the migration policy enumerates. Test: `tests/spec/effect-v4-conformance.test.ts` (lints every `packages/*` source file).

## C.80 App lifecycle contracts

`App.getInfo`, `getCommandLine`, `quit`, `restart`, and lifecycle events validate schemas, emit trace events, and return only declared errors. Test: `tests/app/lifecycle-contracts.test.ts`.

## C.81 Open-at-login contract

`Autostart.enable` and `Autostart.disable` register and unregister the platform login item, `Autostart.isEnabled` reports state and mechanism, and the uninstaller removes the artifact. Test: `tests/app/open-at-login.test.ts` (manual gate where the OS requires a logged-in session).

## C.82 Protocol registration contract

`Association.setDefaultProtocolClient` validates schemes, rejects reserved schemes, and `App.onOpenUrl` delivers URL-open events to the primary instance. Test: `tests/app/protocol-registration.test.ts`.

## C.83 Window contract matrix

Every `Window` method has schema validation, Appendix K support metadata, declared errors, and resource-scope disposal tests. Test: `tests/native/window-contract-matrix.test.ts`.

## C.84 WebView contract matrix

Every `WebView` method enforces navigation policy, origin-token handling, schema validation, and declared errors. Test: `tests/native/webview-contract-matrix.test.ts`.

## C.85 Native method contract matrix

Every §11 native method has a public contract row, Appendix K support row, declared error set, and devtools event. Test: `tests/spec/native-contract-matrix.test.ts`.

## C.86 Runtime method contract matrix

Every §12 runtime method has schema contracts, resource/stream lifecycle behavior where applicable, normalized capability behavior, and declared errors. Test: `tests/spec/runtime-contract-matrix.test.ts`.
