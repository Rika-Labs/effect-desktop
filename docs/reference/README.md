---
title: Reference
description: Every public API surface, looked up.
kind: reference
audience: app-developers
effect_version: 4
---

# Reference

Information-oriented documentation. Each page lists the contract, layers, errors, and a minimal example. Reference pages do not teach; they answer "what does this API do?"

If you're trying to learn the framework, start with [Tutorials](../tutorials/). If you have a specific task, look at [How-to guides](../how-to/). If you want to understand the design, read [Explanation](../explanation/).

## Top-level

- [`Desktop` API](desktop-api.md) — `make`, `manifest`, `app`, `Rpc.surface`, runtime graph
- [`Desktop.Rpc`](rpc-surface.md) — surfaces, supported groups, contract law
- [Configuration](config.md) — `defineDesktopConfig`, schema, production checks
- [CLI commands](cli.md) — every subcommand
- [Errors](errors.md) — typed error catalog
- [Devtools](devtools.md) — inspector shell and panels
- [Platform browser](platform-browser.md) — IndexedDB, SQLite WASM, PGlite renderer layers

## Runtime services — `@orika/core`

- [`PermissionRegistry`](services/permission-registry.md)
- [`ApprovalBroker`](services/approval-broker.md)
- [`AuditEvents`](services/audit-events.md)
- [`ResourceRegistry`](services/resource-registry.md)
- [`Filesystem`](services/filesystem.md)
- [`Process`](services/process.md)
- [`PTY`](services/pty.md)
- [`Worker`](services/worker.md)
- [`Sidecar`](services/sidecar.md)
- [`Command`](services/command.md)
- [`SqlClient`](services/sqlite.md)
- [`Settings`](services/settings.md)
- [`Secrets`](services/secrets.md)
- [`Telemetry`](services/telemetry.md)
- [`Transport`](services/transport.md)
- [`WindowState`](services/window-state.md)
- [`ProviderRegistry`](services/provider-registry.md)

## Native RPC groups — `@orika/native`

- [Native parity matrix](native/parity-matrix.md) — generated TypeScript surface to Rust host router parity
- [App](native/app.md) · [AttachmentIntake](native/attachment-intake.md) · [Clipboard](native/clipboard.md) · [ContextMenu](native/context-menu.md) · [CrashReporter](native/crash-reporter.md) · [DiagnosticsBundle](native/diagnostics-bundle.md) · [DisplayCapture](native/display-capture.md) · [Dialog](native/dialog.md)
- [DistributionParity](native/distribution-parity.md) · [Dock](native/dock.md) · [EgressPolicy](native/egress-policy.md) · [ExecutionSandbox](native/execution-sandbox.md) · [ExtensionConfig](native/extension-config.md) · [ExtensionPackage](native/extension-package.md) · [FocusedApplicationContext](native/focused-application-context.md) · [Job](native/job.md) · [LocalToolRuntime](native/local-tool-runtime.md) · [NativeFileSystem](native/native-file-system.md) · [TransactionalFileMutation](native/transactional-file-mutation.md) · [WorkspaceIndex](native/workspace-index.md) · [GlobalShortcut](native/global-shortcut.md) · [Menu](native/menu.md) · [Notification](native/notification.md) · [Path](native/path.md)
- [PowerMonitor](native/power-monitor.md) · [Protocol](native/protocol.md) · [RealtimeMediaSession](native/realtime-media-session.md) · [ResidentLifecycle](native/resident-lifecycle.md) · [SafeStorage](native/safe-storage.md) · [ScopedAccessGrant](native/scoped-access-grant.md) · [Screen](native/screen.md) · [SelectionContext](native/selection-context.md) · [Shell](native/shell.md)
- [SystemAppearance](native/system-appearance.md) · [Tray](native/tray.md) · [Updater](native/updater.md) · [WebView](native/webview.md) · [Window](native/window.md)

## React hooks — `@orika/react`

- [Provider and context](react/provider-and-context.md)
- [Mutations](react/mutations.md)
- [Queries](react/queries.md)
- [Streams](react/streams.md)
- [Windows](react/windows.md)
- [Permissions](react/permissions.md)
- [Atoms](react/atoms.md)
- [Native hooks](react/native-hooks.md)

## Bridge — `@orika/bridge`

- [Host protocol](bridge/host-protocol.md)
- [Envelopes and framing](bridge/envelopes-and-framing.md)
- [Streams and cancellation](bridge/streams-and-cancellation.md)
- [Redaction](bridge/redaction.md)

## Test — `@orika/test`

- [Headless runtime](test/headless-runtime.md)
- [Mock host and bridge](test/mock-host-and-bridge.md)
- [Memory filesystem](test/memory-filesystem.md)
- [Mock process and PTY](test/mock-process-and-pty.md)
- [Native test layers](test/native-test-layers.md)

## Page conventions

Every reference page follows the same shape:

1. **Import** — package and named imports.
2. **Service tag or contract** — the `Context.Service` or `RpcGroup` that owns the API.
3. **API table** — methods with payload, success, errors.
4. **Errors** — closed union of typed failures.
5. **Layers** — live, client, test, handler.
6. **Example** — minimum runnable shape.
7. **Related** — cross-links.

If a page diverges from this shape, the reason is called out at the top.
