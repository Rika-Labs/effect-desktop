# Feature Shape Before/After Ledger

This ledger is the concrete audit target for making Effect Desktop features use one
consistent shape.

Scope: public feature boundaries and repeated internal abstractions that teach future
authors how to add a feature. This intentionally excludes pure schema-only data classes
unless the schema is the boundary for a feature.

Canonical after-shape:

```ts
// Effectful capability
export class Thing extends Context.Service<Thing, ThingApi>()("@orika/<area>/Thing") {}
export const ThingLive = Layer.effect(Thing)(makeThing())
export const ThingTest = Layer.succeed(Thing)(makeTestThing())

// Boundary capability
export const ThingSurface = Desktop.Rpc.surface("Thing", ThingRpcs, {
  service: ThingClient,
  handlers: ThingHandlersLive,
  client: thingClientFromRpcClient
})

// App composition
Desktop.make({
  windows: Desktop.window("main", { title: "App" }),
  native: Desktop.native(Native.Thing),
  permissions: Desktop.permissions(Desktop.permission(Native.Permissions.thing.doThing))
})
```

## Desktop Declarations

### Desktop.make

```ts
// Before
const App = Desktop.make({
  id: "com.acme.app",
  windows: Desktop.window("main", { title: "Acme" }),
  native: Desktop.native(Native.Clipboard.readText)
})

// After
const App = Desktop.make({
  id: "com.acme.app",
  windows: Desktop.window("main", { title: "Acme" }),
  native: Desktop.native(Native.Clipboard),
  permissions: Desktop.permissions(Desktop.permission(Native.Permissions.clipboard.readText))
})
```

### Desktop.window / Desktop.windows

```ts
// Before
windows: Desktop.windows(
  Desktop.window("main", { title: "Main" }),
  Desktop.window("preferences", { title: "Preferences" })
)

// After
windows: Desktop.windows(
  Desktop.window("main", { title: "Main" }),
  Desktop.window("preferences", { title: "Preferences" })
)
// Same public API. Internally this should compile to declaration data,
// not a feature-specific append/snapshot registry.
```

### Desktop.rpc / Desktop.rpcs

```ts
// Before
rpcs: Desktop.rpcs(
  Desktop.rpc(NotesRpcs, NotesHandlersLive),
  Desktop.rpc(TasksRpcs, TasksHandlersLive)
)

// After
rpcs: Desktop.rpcs(
  Desktop.rpc(NotesRpcs, NotesHandlersLive),
  Desktop.rpc(TasksRpcs, TasksHandlersLive)
)
// Same public API. Runtime compiler owns duplicate checks and permission checks.
```

### Desktop.native

```ts
// Before
native: Desktop.native(Native.Clipboard.readText, Native.Dialog.openFile)

// After
native: Desktop.native(Native.Clipboard, Native.Dialog)
```

### Desktop.permission / Desktop.permissions

```ts
// Before
permissions: Desktop.permissions(Desktop.permission(P.filesystemRead({ roots: ["/tmp/app"] })))

// After
permissions: Desktop.permissions(
  Desktop.permission(P.filesystemRead({ roots: ["/tmp/app"] })),
  Desktop.permission(Native.Permissions.clipboard.readText)
)
```

### Desktop.provider / Desktop.providers

```ts
// Before
providers: Desktop.providers(
  Desktop.provider(Desktop.Provider.Runtime.node),
  Desktop.provider(Desktop.Provider.WebView.chrome)
)

// After
providers: Desktop.providers(
  Desktop.provider(Desktop.Provider.Runtime.node),
  Desktop.provider(Desktop.Provider.WebView.chrome)
)
// Same public API. Provider descriptors remain data selected by declaration.
```

### Desktop.workflow / Desktop.workflows

```ts
// Before
workflows: Desktop.workflows(
  Desktop.workflow(BackupWorkflowLayer),
  Desktop.workflow(RestoreWorkflowLayer)
)

// After
workflows: Desktop.workflows(
  Desktop.workflow(BackupWorkflowLayer),
  Desktop.workflow(RestoreWorkflowLayer)
)
// Same public API. Each workflow must expose typed config and deterministic tests.
```

### Desktop.app

```ts
// Before
Desktop.app()
Desktop.app({ permissions, workflows })
Desktop.app(App)

// After
Desktop.WorkflowEngine.layer()
Desktop.WorkflowEngine.layer({ permissions, workflows })
Desktop.runtime(App)
```

### Desktop.runtime / DesktopRuntimeLive

```ts
// Before
const layer = Desktop.runtime(App)
const alias = DesktopRuntimeLive(App)

// After
const layer = Desktop.runtime(App)
// Keep one public name. If alias remains, document it as compatibility only.
```

### Desktop.runtimeGraph / Desktop.runtimeGraphSnapshot

```ts
// Before
const graph = yield * Desktop.runtimeGraph(App)
const snapshot = yield * Desktop.runtimeGraphSnapshot(App)

// After
const graph = yield * Desktop.runtimeGraph(App)
const snapshot = yield * Desktop.runtimeGraphSnapshot(App)
// Same API. This becomes the contract compiler proof for every declaration.
```

## Native Surfaces

Pattern for every native surface:

```ts
// Before
native: Desktop.native(Native.Surface.method)

// After
native: Desktop.native(Native.Surface),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.surface.method)
)
```

### Native.all

```ts
// Before
native: Desktop.native(Native.all)

// After
native: Desktop.native(Native.all),
permissions: Desktop.permissions(...Native.Permissions.all.map(Desktop.permission))
```

### App

```ts
// Before
native: Desktop.native(Native.App.quit)

// After
native: Desktop.native(Native.App),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.app.quit)
)
```

### Clipboard

```ts
// Before
native: Desktop.native(Native.Clipboard.readText)

// After
native: Desktop.native(Native.Clipboard),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.clipboard.readText)
)
```

### ContextMenu

```ts
// Before
native: Desktop.native(Native.ContextMenu.show)

// After
native: Desktop.native(Native.ContextMenu),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.contextMenu.show)
)
```

### CrashReporter

```ts
// Before
native: Desktop.native(Native.CrashReporter.start)

// After
native: Desktop.native(Native.CrashReporter),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.crashReporter.start)
)
```

### Dialog

```ts
// Before
native: Desktop.native(Native.Dialog.openFile)

// After
native: Desktop.native(Native.Dialog),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.dialog.openFile)
)
```

### Dock

```ts
// Before
native: Desktop.native(Native.Dock.setBadgeCount)

// After
native: Desktop.native(Native.Dock),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.dock.setBadgeCount)
)
```

### GlobalShortcut

```ts
// Before
native: Desktop.native(Native.GlobalShortcut.register)

// After
native: Desktop.native(Native.GlobalShortcut),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.globalShortcut.register)
)
```

### Menu

```ts
// Before
native: Desktop.native(Native.Menu.setApplicationMenu)

// After
native: Desktop.native(Native.Menu),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.menu.setApplicationMenu)
)
```

### Notification

```ts
// Before
native: Desktop.native(Native.Notification.show)

// After
native: Desktop.native(Native.Notification),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.notification.show)
)
```

### Path

```ts
// Before
native: Desktop.native(Native.Path.all)

// After
native: Desktop.native(Native.Path)
// Path methods are availability/support data unless a method declares authority.
```

### PowerMonitor

```ts
// Before
native: Desktop.native(Native.PowerMonitor.all)

// After
native: Desktop.native(Native.PowerMonitor)
// PowerMonitor.isSupported is support metadata, not authority.
```

### Protocol

```ts
// Before
native: Desktop.native(Native.Protocol.registerAppProtocol)

// After
native: Desktop.native(Native.Protocol),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.protocol.registerAppProtocol)
)
```

### SafeStorage

```ts
// Before
native: Desktop.native(Native.SafeStorage.get)

// After
native: Desktop.native(Native.SafeStorage),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.safeStorage.get)
)
```

### Screen

```ts
// Before
native: Desktop.native(Native.Screen.getDisplays)

// After
native: Desktop.native(Native.Screen),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.screen.getDisplays)
)
```

### Shell

```ts
// Before
native: Desktop.native(Native.Shell.openExternal)

// After
native: Desktop.native(Native.Shell),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.shell.openExternal)
)
```

### SystemAppearance

```ts
// Before
native: Desktop.native(Native.SystemAppearance.getAppearance)

// After
native: Desktop.native(Native.SystemAppearance),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.systemAppearance.getAppearance)
)
```

### Tray

```ts
// Before
native: Desktop.native(Native.Tray.create)

// After
native: Desktop.native(Native.Tray),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.tray.create)
)
```

### Updater

```ts
// Before
native: Desktop.native(Native.Updater.install)

// After
native: Desktop.native(Native.Updater),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.updater.install)
)
```

### WebView

```ts
// Before
native: Desktop.native(Native.WebView.create)

// After
native: Desktop.native(Native.WebView),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.webView.create)
)
```

### Window

```ts
// Before
native: Desktop.native(Native.Window.create)

// After
native: Desktop.native(Native.Window),
permissions: Desktop.permissions(
  Desktop.permission(Native.Permissions.window.create)
)
```

## Native Module Authoring

### NativeSurface.rpc

```ts
// Before
export const ClipboardReadText = NativeSurface.rpc("Clipboard", "readText", {
  payload: Schema.Void,
  success: ClipboardText,
  endpoint: "query",
  authority: NativeSurface.authority.native(),
  support: NativeSurface.support.supported
})

// After
export const ClipboardReadText = NativeSurface.rpc("Clipboard", "readText", {
  payload: Schema.Void,
  success: ClipboardText,
  endpoint: "query",
  authority: NativeSurface.authority.native(),
  support: NativeSurface.support.supported
})
// Same authoring point. Native.Permissions is derived from this metadata.
```

### NativeSurface.make

```ts
// Before
export const ClipboardSurface = NativeSurface.make("Clipboard", ClipboardRpcGroup, {
  service: ClipboardClient,
  capabilities: ClipboardCapabilityMethods,
  handlers: ClipboardHandlersLive,
  client: clipboardClientFromRpcClient
})

// After
export const ClipboardSurface = NativeSurface.make("Clipboard", ClipboardRpcGroup, {
  service: ClipboardClient,
  handlers: ClipboardHandlersLive,
  client: clipboardClientFromRpcClient
})

export const ClipboardPermissions = ClipboardSurface.permissions
```

### NativeCapabilities

```ts
// Before
const layer = makeNativeCapabilitiesLayer(Native.capabilities(Native.Clipboard.readText))

// After
const layer = makeNativeCapabilitiesLayer(Desktop.native(Native.Clipboard))
const required = Native.Permissions.clipboard.readText
```

## Core Capabilities

### ResourceRegistry

```ts
// Before
const layer = ResourceRegistryLive

// After
const layer = ResourceRegistryLive
// Keep. It owns scoped desktop resource lifecycle.
```

### ResourceOwner

```ts
// Before
const layer = ResourceOwner.test("test")

// After
const layer = ResourceOwner.test("test")
// Keep. Every resource-owning test and runtime layer must state ownership.
```

### Filesystem

```ts
// Before
const layer = FilesystemLive({ root: "/tmp/app" })

// After
const layer = FilesystemLive({ root: "/tmp/app" })
const test = FilesystemTest({ root: "/" })
// Add/alias deterministic test layer name; keep same Filesystem service.
```

### Sqlite

```ts
// Before
const layer = SqlClientLive({ filename: "app.db" })

// After
const layer = SqlClientLive({ filename: "app.db" })
// Keep. App code depends on Effect SqlClient, not a local database wrapper.
```

### Settings

```ts
// Before
const layer = Settings.layer({ filename: "settings.db", namespace: "app" })
const windowLayer = Settings.window({ namespace: "window" })

// After
const layer = SettingsLive({ filename: "settings.db", namespace: "app" })
const windowLayer = Settings.window({ namespace: "window" })
const test = SettingsTest.memory()
```

### WindowState

```ts
// Before
const services = WindowState.window()
windows: Desktop.window("main", { title: "App" }, services)

// After
const services = WindowState.window()
windows: Desktop.window("main", { title: "App" }, services)
// Keep. It is a window-scoped capability.
```

### Secrets and SecretsSafeStorage

```ts
// Before
const storageLayer = customSecretsSafeStorageLayer(safeStorage)

// After
const storageLayer = Layer.succeed(SecretsSafeStorage)(safeStorage)
const layer = SecretsLayer(options).pipe(Layer.provide(storageLayer))
const test = SecretsTest.memory()
```

### PermissionRegistry

```ts
// Before
yield * registry.declare(capability, { source: "Desktop.app", effect: "allow" })

// After
yield * registry.declare(capability, { source: "Desktop.app", effect: "allow" })
// Keep. All authority declarations flow through this service.
```

### PermissionInterceptor

```ts
// Before
const middleware = makePermissionInterceptorLayer()

// After
const middleware = PermissionInterceptorLive
// Rename as a normal Live layer or keep package-internal.
```

### ApprovalBroker

```ts
// Before
const layer = ApprovalBrokerLive(options)

// After
const layer = ApprovalBrokerLive(options)
const test = ApprovalBrokerTest({ decisions })
```

### AuditEvents

```ts
// Before
yield * AuditEvents.emit(event)

// After
yield * AuditEvents.emit(event)
// Keep. Audit schema remains the source of truth for permission-relevant events.
```

### DesktopEventLog

```ts
// Before
const layer = DesktopEventLogLive(options)

// After
const layer = DesktopEventLogLive(options)
const test = DesktopEventLogTest.memory()
```

### CommandRegistry / DesktopCommands

```ts
// Before
yield* CommandRegistry.register(command)
const commands = DesktopCommands.make(...)

// After
yield* CommandRegistry.register(command)
const command = Command.define(...)
// Registry is service. Command definitions are plain data.
```

### Process

```ts
// Before
const layer = ProcessLive
const test = MockProcessLive()

// After
const layer = ProcessLive
const test = ProcessTest()
```

### PTY

```ts
// Before
const layer = PtyLive
const test = MockPtyLive()

// After
const layer = PtyLive
const test = PtyTest()
```

### Worker

```ts
// Before
const layer = WorkerLive

// After
const layer = WorkerLive
const test = WorkerTest({ adapter })
```

### Sidecar

```ts
// Before
const layer = SidecarLive

// After
const layer = SidecarLive
const test = SidecarTest({ adapter })
```

### Transport

```ts
// Before
const layer = TransportLive(options)

// After
const layer = TransportLive(options)
const test = TransportTest.memory()
```

### Telemetry

```ts
// Before
const layer = TelemetryLive(options)

// After
const layer = TelemetryLive(options)
const test = TelemetryTest.memory()
```

### EffectTelemetryCollector

```ts
// Before
const layer = EffectTelemetryCollectorLive

// After
const layer = EffectTelemetryCollectorLive
// Keep as adapter from Effect telemetry into Telemetry.
```

### InspectorTransport

```ts
// Before
const layer = InspectorTransportLive(options)

// After
const layer = InspectorTransportLive(options)
const test = InspectorTransportTest.memory()
```

### InspectorCollectors

```ts
// Before
const layer = InspectorCollectorsLive
const disabled = disabledRendererInspectorCollector

// After
const layer = InspectorCollectorsLive
const test = InspectorCollectorsTest.disabled()
```

### InspectorSafetyPolicy

```ts
// Before
const layer = InspectorSafetyPolicyLive(options)

// After
const layer = InspectorSafetyPolicyLive(options)
const test = InspectorSafetyPolicyTest.strict()
```

### DesktopObservability

```ts
// Before
const layer = DesktopObservabilityLive

// After
const layer = DesktopObservabilityLive
const test = DesktopObservabilityTest.memory()
```

### DesktopDevtools

```ts
// Before
const layer = DesktopDevtoolsLive(options)

// After
const layer = DesktopDevtoolsLive(options)
// Keep as adapter over runtime graph, telemetry, inspector, and event log.
```

### AutoSaveService

```ts
// Before
const layer = makeAutoSaveLayer(options)

// After
const layer = AutoSaveLive(options)
// Or remove if it only forwards Schedule/Effect without desktop lifecycle policy.
```

## Workflows

### PermissionApprovalWorkflow

```ts
// Before
const layer = makePermissionApprovalWorkflowLayer(options)

// After
const layer = PermissionApprovalWorkflowLive(options)
workflows: Desktop.workflow(layer)
```

### BackupWorkflow

```ts
// Before
workflows: Desktop.workflow(makeBackupLayer(options))

// After
workflows: Desktop.workflow(BackupWorkflowLive(options))
```

### RestoreWorkflow

```ts
// Before
workflows: Desktop.workflow(makeRestoreLayer(options))

// After
workflows: Desktop.workflow(RestoreWorkflowLive(options))
```

### UpdateWorkflow

```ts
// Before
workflows: Desktop.workflow(UpdateWorkflowLayer)

// After
workflows: Desktop.workflow(UpdateWorkflowLive(options))
```

### CrashSubmissionWorkflow

```ts
// Before
const layer = makeCrashSubmissionWorkflowLayer(endpointUrl)

// After
const layer = CrashSubmissionWorkflowLive({ endpointUrl })
```

### ReleaseWorkflow

```ts
// Before
const layer = ReleaseWorkflow.layer(options)

// After
const layer = ReleaseWorkflowLive(options)
```

## Bridge Features

### Client / Codec / Protocol

```ts
// Before
const protocol = makeDesktopClientProtocol(transport, options)

// After
const protocol = makeDesktopClientProtocol(transport, options)
// Keep. This is real native/web protocol translation.
```

### Contracts

```ts
// Before
const contract = bridgeContractFromRpcGroup("Notes", NotesRpcs)

// After
const contract = Desktop.Rpc.describe(NotesSurface)
// Keep bridge contract code only where Effect RPC cannot yet express wire policy.
```

### Events / Streams / Resources

```ts
// Before
const streams = makeBridgeStreamRegistry()
const calls = makeBridgeCallRegistry()

// After
const streams = BridgeRuntime.streams()
const calls = BridgeRuntime.calls()
// Keep internal protocol bookkeeping; do not expose as app feature APIs.
```

### RpcEndpoint / RpcCapability / RpcSupport

```ts
// Before
Rpc.make("Notes.list", { success }).pipe(
  RpcEndpoint.query,
  RpcCapability(P.networkConnect({ hosts: ["api.example.com"] })),
  RpcSupport.supported
)

// After
Desktop.Rpc.make("Notes.list", {
  success,
  endpoint: "query",
  capability: P.networkConnect({ hosts: ["api.example.com"] }),
  support: "supported"
})
// Target: one RPC authoring point, no separate annotation DSL.
```

### RedactionFilter

```ts
// Before
const safe = RedactionFilter.redact(value)

// After
const safe = RedactionFilter.redact(value)
// Keep. It owns desktop security policy.
```

## Renderer and Platform Adapters

### ReactDesktop

```tsx
// Before
<DesktopProvider app={ReactDesktop.from(Manifest, options)}>{children}</DesktopProvider>

// After
<ReactDesktop.Provider manifest={Manifest} transport={transport}>{children}</ReactDesktop.Provider>
```

### React hooks

```ts
// Before
const clipboard = useNative(Clipboard)
const windows = useWindows()

// After
const clipboard = ReactDesktop.useService(Clipboard)
const windows = ReactDesktop.useService(Window)
```

### React permissions

```ts
// Before
const state = usePermission(Native.Clipboard.readText)

// After
const state = usePermission(Native.Permissions.clipboard.readText)
```

### SolidDesktop

```ts
// Before
const app = SolidDesktop.from(Manifest, options)

// After
const app = SolidDesktop.fromManifest(Manifest, { transport })
```

### VueDesktop

```ts
// Before
const app = VueDesktop.from(Manifest, options)

// After
const app = VueDesktop.fromManifest(Manifest, { transport })
```

### NextDesktop

```ts
// Before
const app = NextDesktop.from(Manifest)

// After
const app = NextDesktop.fromManifest(Manifest)
```

### Platform Browser SQLite / PGlite / IDB / KV

```ts
// Before
const sqlite = orikaSqliteWasmAlias(options)
const pglite = RendererPgliteLive(options)

// After
const sqlite = SqliteWasmClient.layer(options)
const pglite = RendererPgliteLive(options)
// SQLite WASM comes directly from @effect/sql-sqlite-wasm.
// PGlite stays behind the ORIKA boundary only for optional dependency errors.
```

## Devtools Features

### DesktopInspector

```ts
// Before
const layer = DesktopInspectorLive(options)

// After
const layer = DesktopInspectorLive(options)
// Keep as adapter over runtime graph and inspector transport.
```

### DevtoolsSnapshotClient

```ts
// Before
const layer = DevtoolsSnapshotClientLive(options)

// After
const layer = DevtoolsSnapshotClientLive(options)
const test = DevtoolsSnapshotClientTest(snapshot)
```

### LayerGraphPanel

```ts
// Before
const layer = LayerGraphPanelLive(options)

// After
const layer = LayerGraphPanelLive(options)
// Panel projects Desktop.runtimeGraphSnapshot; no panel-side graph policy.
```

### EventLogPanel

```ts
// Before
const layer = EventLogPanelLive(options)

// After
const layer = EventLogPanelLive(options)
// Panel projects DesktopEventLog; no separate event store.
```

### ReactivityPanel / ReactivityTracker

```ts
// Before
const tracker = ReactivityTrackerLive
const panel = ReactivityPanelLive(options)

// After
const tracker = ReactivityTrackerLive
const panel = ReactivityPanelLive(options)
// Tracker is capability. Panel is projection.
```

### WorkflowsPanel / WorkflowExecutionRegistry

```ts
// Before
const registry = WorkflowExecutionRegistryLive
const panel = WorkflowsPanelLive(options)

// After
const registry = WorkflowExecutionRegistryLive
const panel = WorkflowsPanelLive(options)
// Registry mirrors WorkflowEngine state; it must not become a workflow source of truth.
```

### PersistencePanel

```ts
// Before
const layer = PersistencePanelLive(options)

// After
const layer = PersistencePanelLive(options)
// Projection over Settings, Sqlite, Secrets, ResourceRegistry.
```

### LogsPanel

```ts
// Before
const layer = LogsPanelLive(options)

// After
const layer = LogsPanelLive(options)
// Projection over Telemetry logs.
```

### ClusterPanel

```ts
// Before
const layer = ClusterPanelLive

// After
const layer = ClusterPanelLive
// Projection over Effect cluster services.
```

### DiagnosticsPanels

```ts
// Before
const layer = DiagnosticsPanelsLive(options)

// After
const layer = DiagnosticsPanelsLive(options)
// Composition of panel projections, not a diagnostics source of truth.
```

### PerformanceOverlay

```ts
// Before
const layer = PerformanceOverlayLive(options)

// After
const layer = PerformanceOverlayLive(options)
// Projection over Telemetry metrics.
```

### Lifecycle Collectors

```ts
// Before
const layer = Layer.mergeAll(
  ResourceInspectorCollectorLive,
  ScopeInspectorCollectorLive,
  FiberInspectorCollectorLive,
  StreamInspectorCollectorLive
)

// After
const layer = LifecycleCollectorsLive
const test = LifecycleCollectorsTest.disabled()
```

### InspectorTest / ReplayTransport

```ts
// Before
const layer = Layer.merge(InspectorTestLive, ReplayTransportLive)

// After
const layer = InspectorDevtoolsTest({ replay })
```

## Test Features

### MockHost

```ts
// Before
const layer = MockHostLive({ latencyMs: 10 })

// After
const layer = HostTest({ latencyMs: 10 })
```

### MockBridge

```ts
// Before
const layer = MockBridgeLive({ pins })

// After
const layer = BridgeTest({ pins })
```

### MemoryFilesystem

```ts
// Before
const layer = MemoryFilesystem.layer(options)

// After
const layer = FilesystemTest.memory(options)
```

### MockProcess

```ts
// Before
const layer = MockProcessLive(options)

// After
const layer = ProcessTest(options)
```

### MockPTY

```ts
// Before
const layer = MockPtyLive(options)

// After
const layer = PtyTest(options)
```

### HeadlessRuntime

```ts
// Before
await HeadlessRuntime.run(program, { testName: "notes" })

// After
await TestRuntime.run(program, { testName: "notes" })
// Or keep HeadlessRuntime as the named test composition if documented as such.
```

### Native Scenario Layers

```ts
// Before
const layer = makeClipboardScenarioLayer(options)

// After
const layer = ClipboardTest(options)
```

### CapabilityLaws / LayerMatrix / FailureAssertions

```ts
// Before
CapabilityLaws.make("Clipboard", Clipboard, cases)

// After
FeatureContract.laws.capability("Clipboard", {
  service: Clipboard,
  live: ClipboardLive,
  test: ClipboardTest
})
```

## CLI Features

### DoctorEnvironment

```ts
// Before
const layer = DoctorEnvironmentLive(options)

// After
const layer = DoctorEnvironmentLive(options)
const test = DoctorEnvironmentTest(options)
```

### ReleaseFileSystem

```ts
// Before
const layer = ReleaseFileSystemLive

// After
const layer = ReleaseFileSystemLive
// CLI-local port over Effect FileSystem.
```

### ReleaseToolRunner

```ts
// Before
const layer = ReleaseToolRunnerLive

// After
const layer = ReleaseToolRunnerLive
const test = ReleaseToolRunnerTest({ results })
```

### ReleaseWorkflowServices

```ts
// Before
const layer = ReleaseWorkflowServicesLive(options)

// After
const layer = ReleaseWorkflowServicesLive(options)
// CLI workflow dependency service; keep scoped to CLI package.
```

## Inspector App

### InspectorApp

```ts
// Before
const layer = InspectorAppLive(options)

// After
const layer = InspectorAppLive(options)
// App-local composition over devtools/core services.
```

## Enforcement

### Feature inventory test

```ts
// Before
// New exported feature can appear without being classified.

// After
const inventory = FeatureInventory.fromPublicExports()

expect(inventory.unclassified).toEqual([])
expect(inventory.features).toContainEqual({
  name: "Clipboard",
  kind: "native-surface",
  service: "Clipboard",
  live: "ClipboardLive",
  surface: "ClipboardSurface",
  permissions: "Native.Permissions.clipboard"
})
```

### Feature shape laws

```ts
// Before
expect(Layer.isLayer(Native.capabilities(Native.Clipboard.readText))).toBe(true)

// After
FeatureContract.laws.nativeSurface("Clipboard", {
  availability: Native.Clipboard,
  permissions: Native.Permissions.clipboard,
  surface: ClipboardSurface
})
```
