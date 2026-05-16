# Effect Desktop — feature inventory for human review

**Date:** 2026-05-14
**Author:** Claude (with Dallen)
**Purpose:** A scannable map of every feature surface so we can pick what's worth a fresh human pass before v1.0.0. Bolded items are flagged as worth a closer look (inconsistent with neighbors, recently changed, or where a recent refactor pattern hasn't propagated).

---

## Application shell

- `Desktop.make` — descriptor builder
- `Desktop.app` / `Desktop.runtime` / `Desktop.launch` — runtime spine
- `Desktop.manifest` — JSON-shaped renderer handoff
- **`windows`** — just refactored to `Layer<DesktopWindowRegistry>` (PR #1307)
- **`rpcs`** — refactored to `Layer<DesktopRpcRegistry>` (PR #1306)
- **`permissions: NormalizedCapability[]`** and **`workflows: DesktopWorkflowLayer[]`** — still array-shaped, not Layer-composed. Should they follow the registry pattern?
- `providers` — runtime provider selection (bun / node / test)
- Runtime graph + `LayerGraphSnapshot` (`runtimeGraph`, `runtimeGraphSnapshot`)

## RPC infrastructure

- `Desktop.rpc(group, handlers)` — registration constructor
- `Desktop.Rpc.surface(name, group, options)` — packages server / client / test client / docs / contract laws together
- `Desktop.Rpc.supportedGroup` — feature-flag at the RPC level
- `RpcCapability`, `RpcEndpoint.query` / `.mutation`, `RpcSupport.supported` / `.unsupported`
- `describeRpcs` — contract introspection for tooling
- **`PermissionInterceptor`** — every RPC is wrapped in it; worth understanding once

## Permissions & security

- `PermissionRegistry` — declared capabilities
- `PermissionInterceptor` — runtime enforcement middleware
- `ApprovalBroker` / `permission-approval-workflow` — async user prompts (unknown-host etc.)
- `AuditEvents` — every permission decision is an event
- `RedactionFilter` — bridge-level secret scrubbing
- `PermissionContracts` — capability normalization

## Storage & state

- **`Settings`** — typed key/value, sqlite-backed, with `ownerScope: "window-main"` string handshake — **now redundant after Phase 2 of the windows refactor; worth cleaning up**
- `SqlClient` — direct SQLite access
- `Secrets` — OS keychain
- `SafeStorage` — Electron-style encrypted blob
- `Filesystem` — scoped FS access via permissions
- `Resources` / `ResourceRegistry` — handle lifecycle
- `WindowState` — per-window geometry persistence (still global-service shape; could become a Phase-2 services-Layer per window)
- `AutoSave` — debounced write coordinator

## Process & worker

- `Process` — child process spawn with capabilities
- `Worker` — Bun worker, scoped, with audit
- `Sidecar` — long-running detachable process
- `PTY` — full pseudo-terminal
- `Commands` / `CommandRegistry` — declared command surface
- `CommandBindingLog` — replay of executed commands

## Native OS surfaces

Each is its own `RpcGroup`, registered via `Desktop.rpc`:

- `Window`, `WindowState`, `WindowSupervisor`
- `Clipboard`, `Dialog`, `ContextMenu`, `Menu`, `Tray`, `Dock`
- `Notification`, `GlobalShortcut`, `Shell`, `Screen`
- `PowerMonitor`, `SystemAppearance`, `Path`, `AppEvents`
- `CrashReporter` + `crash-report-workflow`
- `Updater` + `updater-workflow`
- `Webview` — embedded webview RPC

**Worth a human pass:** Are these all consistent in API shape, capability declaration, audit emission, and renderer-adapter exposure? They were probably hand-written one at a time.

## Bridge & transport

- `HostProtocol` (envelopes, errors, capabilities)
- `Transport` (framing, connection lifecycle)
- `StdioSocket`, `PostMessageSocket` — concrete sockets
- `Reconnect` — backoff + replay
- `HostClient` — typed protocol exchange
- `HostHandshakeClient`, `HostWindowClient` — typed sub-clients
- Bun runtime + Rust host wire format (`STARTUP_WINDOWS_ENV`, app-module env, etc.)

## Renderer adapters

- `@effect-desktop/react` — `ReactDesktop.from`, `useDesktop`, `useQuery`, `useMutation`, `useStream`, native hooks, atoms
- `@effect-desktop/solid` — same shape
- `@effect-desktop/vue` — same shape
- `@effect-desktop/next` — Next.js client-boundary wrapper
- `@effect-desktop/astro` — Astro island wrapper
- `@effect-desktop/vite` — dev plugin
- `@effect-desktop/platform-browser` — shared browser layer

**Worth a human pass:** Cross-framework consistency. Solid / Vue / React all expose `useDesktop` — does the test surface (`@effect-desktop/test` + `RpcTest`) work uniformly across them?

## Workflows & background

- `WorkflowEngineMemory` (default)
- `WorkflowEngineDurable` — cluster + `SqlClient` backed
- `desktop-schedules` — scheduled jobs API
- `EventLog` — append-only event store
- **`cluster-prototype/`** — cluster integration WIP (worth deciding ship vs. cut for v1.0.0)

## Observability & devtools

- `Telemetry` + `EffectTelemetryRuntimeLive` — Effect-native tracing
- `telemetry-otel` — OpenTelemetry bridge
- `DesktopObservability` — composed layer
- `Devtools` package — `LayerGraphPanel`, `CommandsDevtools`, etc.
- `InspectorEvents`, `InspectorTransport`, `InspectorSafetyPolicy`
- `FrameworkMetrics`, `ExecutionBudgets` — startup and bundle budgets per provider
- `Logger` — `DesktopLoggerLayer`

## Build & ship (CLI)

- `desktop build` — Bun bundler + Rust host
- `desktop sign` — macOS notarization, Windows Authenticode, Linux
- `desktop package` — DMG, MSI, AppImage, deb
- `desktop update` — release publish + manifest
- `desktop doctor` — environment diagnostics
- `desktop check --api` / `--docs` / `--release` / `--repro` / `--a11y` / `--semver` — release gates
- `desktop dev` — dev loop
- Config: `@effect-desktop/config` — layered TOML / JSON resolution

## Testing

- `@effect-desktop/test` — test layer helpers
- `RpcTest.makeClient` — deterministic client against a handler layer
- `inject-mock-host-and-bridge` how-to
- Provider-conformance tests — per-runtime budget assertions

## Documentation system

- Diátaxis structure (start, tutorials, how-to, reference, explanation)
- `llms.txt`
- `docs-manifest.json` — release-gate snapshot of executable doc snippets
- `desktop check --docs` — verifies doc TS blocks compile + run

---

## Short list of "look here first"

1. **`permissions` and `workflows` fields** — still arrays, not Layer-composed. Same staleness as `windows` was.
2. **`Settings.open({ ownerScope: "window-main" })`** — string handshake is redundant after Phase 2 of windows; deprecate in favor of per-window services Layer.
3. **`WindowState`** — works fine but doesn't own the per-window scope binding the framework now gives it for free.
4. **Native services (~20 of them)** — quickly written, may have drift in capability declarations / audit emission / RPC shape.
5. **`cluster-prototype/`** — name implies WIP; worth deciding ship / cut for v1.0.0.
6. **Renderer adapter symmetry** — does React / Solid / Vue all feel like one framework, or three with the same name?
7. **CLI command organization** — `desktop check --api / --docs / --release / ...` is one command with seven flag-modes; might be cleaner as subcommands.
