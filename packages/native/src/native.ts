import { Desktop, type DesktopNativeLayer, type AnyDesktopNativeRegistration } from "@orika/core"

import { ActivationRegistrySurface } from "./activation-registry.js"
import { AppMetadataSurface } from "./app-metadata.js"
import { AppSurface } from "./app.js"
import { AssociationSurface } from "./association.js"
import { AutostartSurface } from "./autostart.js"
import { BrowsingDataSurface } from "./browsing-data.js"
import { AttachmentIntakeSurface } from "./attachment-intake.js"
import { ClipboardSurface } from "./clipboard.js"
import { ContextMenuSurface } from "./context-menu.js"
import { CookieStoreSurface } from "./cookie-store.js"
import { CrashReporterSurface } from "./crash-reporter.js"
import { DiagnosticsBundleSurface } from "./diagnostics-bundle.js"
import { DistributionParitySurface } from "./distribution-parity.js"
import { DisplayCaptureSurface } from "./display-capture.js"
import { DownloadSurface } from "./download.js"
import { DialogSurface } from "./dialog.js"
import { EgressPolicySurface } from "./egress-policy.js"
import { ExecutionSandboxSurface } from "./execution-sandbox.js"
import { ExtensionConfigSurface } from "./extension-config.js"
import { ExtensionPackageSurface } from "./extension-package.js"
import { FocusedApplicationContextSurface } from "./focused-application-context.js"
import { JobSurface } from "./job.js"
import { LocalToolRuntimeSurface } from "./local-tool-runtime.js"
import { NativeFileSystemSurface } from "./native-file-system.js"
import { NativeNetworkSurface } from "./native-network.js"
import { TransientWindowRoleSurface } from "./transient-window-role.js"
import { TransactionalFileMutationSurface } from "./transactional-file-mutation.js"
import { WorkspaceIndexSurface } from "./workspace-index.js"
import { DockSurface } from "./dock.js"
import { GlobalShortcutSurface } from "./global-shortcut.js"
import { MenuSurface } from "./menu.js"
import { NetworkAuthSurface } from "./network-auth.js"
import { NotificationSurface } from "./notification.js"
import { PathSurface } from "./path.js"
import { PowerMonitorSurface } from "./power-monitor.js"
import { ProtocolSurface } from "./protocol.js"
import { RealtimeMediaSessionSurface } from "./realtime-media-session.js"
import { RecentDocumentsSurface } from "./recent-documents.js"
import { ResidentLifecycleSurface } from "./resident-lifecycle.js"
import { SafeStorageSurface } from "./safe-storage.js"
import { ScopedAccessGrantSurface } from "./scoped-access-grant.js"
import { SelectionContextSurface } from "./selection-context.js"
import { SessionPermissionSurface } from "./session-permission.js"
import { SessionProfileSurface } from "./session-profile.js"
import { ScreenSurface } from "./screen.js"
import { ShellSurface } from "./shell.js"
import { SystemAppearanceSurface } from "./system-appearance.js"
import { TraySurface } from "./tray.js"
import { UpdaterSurface } from "./updater.js"
import { WebRequestSurface } from "./web-request.js"
import { WebViewSurface } from "./webview.js"
import { WindowSurface } from "./window.js"
import type { NativeSurfaceSelection } from "./native-surface.js"

const BuiltInSurfaces = Object.freeze([
  ActivationRegistrySurface,
  AppMetadataSurface,
  AppSurface,
  AssociationSurface,
  AutostartSurface,
  BrowsingDataSurface,
  AttachmentIntakeSurface,
  ClipboardSurface,
  ContextMenuSurface,
  CookieStoreSurface,
  CrashReporterSurface,
  DiagnosticsBundleSurface,
  DistributionParitySurface,
  DisplayCaptureSurface,
  DownloadSurface,
  DialogSurface,
  EgressPolicySurface,
  ExecutionSandboxSurface,
  ExtensionConfigSurface,
  ExtensionPackageSurface,
  FocusedApplicationContextSurface,
  JobSurface,
  LocalToolRuntimeSurface,
  NativeFileSystemSurface,
  NativeNetworkSurface,
  TransientWindowRoleSurface,
  TransactionalFileMutationSurface,
  WorkspaceIndexSurface,
  DockSurface,
  GlobalShortcutSurface,
  MenuSurface,
  NetworkAuthSurface,
  NotificationSurface,
  PathSurface,
  PowerMonitorSurface,
  ProtocolSurface,
  RealtimeMediaSessionSurface,
  RecentDocumentsSurface,
  ResidentLifecycleSurface,
  SafeStorageSurface,
  ScopedAccessGrantSurface,
  SelectionContextSurface,
  SessionPermissionSurface,
  SessionProfileSurface,
  ScreenSurface,
  ShellSurface,
  SystemAppearanceSurface,
  TraySurface,
  UpdaterSurface,
  WebRequestSurface,
  WebViewSurface,
  WindowSurface
])

const BuiltInRegistrations = Object.freeze([
  ...BuiltInSurfaces
]) satisfies readonly AnyDesktopNativeRegistration[]

export const available = (...selections: readonly NativeSurfaceSelection[]): DesktopNativeLayer =>
  Desktop.native(...selections)

const App = AppSurface.selection
const AppMetadata = AppMetadataSurface.selection
const Association = AssociationSurface.selection
const ActivationRegistry = ActivationRegistrySurface.selection
const Autostart = AutostartSurface.selection
const BrowsingData = BrowsingDataSurface.selection
const AttachmentIntake = AttachmentIntakeSurface.selection
const Clipboard = ClipboardSurface.selection
const ContextMenu = ContextMenuSurface.selection
const CookieStore = CookieStoreSurface.selection
const CrashReporter = CrashReporterSurface.selection
const DiagnosticsBundle = DiagnosticsBundleSurface.selection
const DistributionParity = DistributionParitySurface.selection
const DisplayCapture = DisplayCaptureSurface.selection
const Download = DownloadSurface.selection
const Dialog = DialogSurface.selection
const EgressPolicy = EgressPolicySurface.selection
const ExecutionSandbox = ExecutionSandboxSurface.selection
const ExtensionConfig = ExtensionConfigSurface.selection
const ExtensionPackage = ExtensionPackageSurface.selection
const FocusedApplicationContext = FocusedApplicationContextSurface.selection
const Job = JobSurface.selection
const LocalToolRuntime = LocalToolRuntimeSurface.selection
const NativeFileSystem = NativeFileSystemSurface.selection
const NativeNetwork = NativeNetworkSurface.selection
const TransientWindowRole = TransientWindowRoleSurface.selection
const TransactionalFileMutation = TransactionalFileMutationSurface.selection
const WorkspaceIndex = WorkspaceIndexSurface.selection
const Dock = DockSurface.selection
const GlobalShortcut = GlobalShortcutSurface.selection
const Menu = MenuSurface.selection
const NetworkAuth = NetworkAuthSurface.selection
const Notification = NotificationSurface.selection
const Path = PathSurface.selection
const PowerMonitor = PowerMonitorSurface.selection
const Protocol = ProtocolSurface.selection
const RealtimeMediaSession = RealtimeMediaSessionSurface.selection
const RecentDocuments = RecentDocumentsSurface.selection
const ResidentLifecycle = ResidentLifecycleSurface.selection
const SafeStorage = SafeStorageSurface.selection
const ScopedAccessGrant = ScopedAccessGrantSurface.selection
const SelectionContext = SelectionContextSurface.selection
const SessionPermission = SessionPermissionSurface.selection
const SessionProfile = SessionProfileSurface.selection
const Screen = ScreenSurface.selection
const Shell = ShellSurface.selection
const SystemAppearance = SystemAppearanceSurface.selection
const Tray = TraySurface.selection
const Updater = UpdaterSurface.selection
const WebRequest = WebRequestSurface.selection
const WebView = WebViewSurface.selection
const Window = WindowSurface.selection

export const all: NativeSurfaceSelection = Object.freeze({
  _tag: "NativeSurfaceSelection" as const,
  surfaces: BuiltInRegistrations
})

const permissionAll = Object.freeze(BuiltInSurfaces.flatMap((surface) => surface.permissions.all))

export const Permissions = Object.freeze({
  activationRegistry: ActivationRegistrySurface.permissions,
  appMetadata: AppMetadataSurface.permissions,
  app: AppSurface.permissions,
  association: AssociationSurface.permissions,
  autostart: AutostartSurface.permissions,
  browsingData: BrowsingDataSurface.permissions,
  attachmentIntake: AttachmentIntakeSurface.permissions,
  clipboard: ClipboardSurface.permissions,
  contextMenu: ContextMenuSurface.permissions,
  cookieStore: CookieStoreSurface.permissions,
  crashReporter: CrashReporterSurface.permissions,
  diagnosticsBundle: DiagnosticsBundleSurface.permissions,
  distributionParity: DistributionParitySurface.permissions,
  displayCapture: DisplayCaptureSurface.permissions,
  download: DownloadSurface.permissions,
  dialog: DialogSurface.permissions,
  egressPolicy: EgressPolicySurface.permissions,
  executionSandbox: ExecutionSandboxSurface.permissions,
  extensionConfig: ExtensionConfigSurface.permissions,
  extensionPackage: ExtensionPackageSurface.permissions,
  focusedApplicationContext: FocusedApplicationContextSurface.permissions,
  job: JobSurface.permissions,
  localToolRuntime: LocalToolRuntimeSurface.permissions,
  nativeFileSystem: NativeFileSystemSurface.permissions,
  nativeNetwork: NativeNetworkSurface.permissions,
  transientWindowRole: TransientWindowRoleSurface.permissions,
  transactionalFileMutation: TransactionalFileMutationSurface.permissions,
  workspaceIndex: WorkspaceIndexSurface.permissions,
  dock: DockSurface.permissions,
  globalShortcut: GlobalShortcutSurface.permissions,
  menu: MenuSurface.permissions,
  networkAuth: NetworkAuthSurface.permissions,
  notification: NotificationSurface.permissions,
  path: PathSurface.permissions,
  powerMonitor: PowerMonitorSurface.permissions,
  protocol: ProtocolSurface.permissions,
  realtimeMediaSession: RealtimeMediaSessionSurface.permissions,
  recentDocuments: RecentDocumentsSurface.permissions,
  residentLifecycle: ResidentLifecycleSurface.permissions,
  safeStorage: SafeStorageSurface.permissions,
  scopedAccessGrant: ScopedAccessGrantSurface.permissions,
  selectionContext: SelectionContextSurface.permissions,
  sessionPermission: SessionPermissionSurface.permissions,
  sessionProfile: SessionProfileSurface.permissions,
  screen: ScreenSurface.permissions,
  shell: ShellSurface.permissions,
  systemAppearance: SystemAppearanceSurface.permissions,
  tray: TraySurface.permissions,
  updater: UpdaterSurface.permissions,
  webRequest: WebRequestSurface.permissions,
  webView: WebViewSurface.permissions,
  window: WindowSurface.permissions,
  all: permissionAll
})

export const Native = Object.freeze({
  ActivationRegistry,
  AppMetadata,
  App,
  Association,
  Autostart,
  BrowsingData,
  AttachmentIntake,
  Clipboard,
  ContextMenu,
  CookieStore,
  CrashReporter,
  DiagnosticsBundle,
  DistributionParity,
  DisplayCapture,
  Download,
  Dialog,
  EgressPolicy,
  ExecutionSandbox,
  ExtensionConfig,
  ExtensionPackage,
  FocusedApplicationContext,
  Job,
  LocalToolRuntime,
  NativeFileSystem,
  NativeNetwork,
  TransientWindowRole,
  TransactionalFileMutation,
  WorkspaceIndex,
  Dock,
  GlobalShortcut,
  Menu,
  NetworkAuth,
  Notification,
  Path,
  PowerMonitor,
  Protocol,
  RealtimeMediaSession,
  RecentDocuments,
  ResidentLifecycle,
  SafeStorage,
  ScopedAccessGrant,
  SelectionContext,
  SessionPermission,
  SessionProfile,
  Screen,
  Shell,
  SystemAppearance,
  Tray,
  Updater,
  WebRequest,
  WebView,
  Window,
  Permissions,
  all,
  available
})

export type NativeApi = typeof Native
export type { NativePermissionsApi, NativeSurfaceSelection } from "./native-surface.js"
