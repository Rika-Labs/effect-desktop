import { expect, test } from "bun:test"
import type { RpcCapabilityMetadata, RpcSupportMetadata } from "@orika/bridge"
import { type DesktopNativeLayer, type DesktopRpcSchemaDoc } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect"

import {
  NativeCapabilities,
  NativeCapabilitiesLive,
  NativeCapabilityLookupError,
  NativeCapabilityManifestError,
  UnsupportedCapability,
  makeNativeCapabilitiesLayer
} from "./capabilities.js"
import { Native } from "./native.js"

const UnsupportedDockCapabilitySupport = {
  status: "unsupported",
  reason: "host adapter does not implement this Dock method on any platform",
  platforms: [
    {
      platform: "macos",
      status: "unsupported",
      reason: "host adapter does not implement this Dock method on any platform"
    },
    {
      platform: "linux",
      status: "unsupported",
      reason: "host adapter does not implement this Dock method on any platform"
    },
    {
      platform: "windows",
      status: "unsupported",
      reason: "host adapter does not implement this Dock method on any platform"
    }
  ]
} as const

const UnsupportedDownloadSupport = {
  status: "unsupported",
  reason: "host-download-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-download-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-download-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-download-unavailable" }
  ]
} as const

const NativeNetworkUnavailableSupport = {
  status: "unsupported",
  reason: "host-native-network-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-native-network-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-native-network-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-native-network-unavailable" }
  ]
} as const

const NetworkAuthUnavailableSupport = {
  status: "unsupported",
  reason: "host-network-auth-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-network-auth-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-network-auth-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-network-auth-unavailable" }
  ]
} as const

const NetworkAuthProxySupport = {
  status: "partial",
  reason: "host-network-auth-proxy-future-webviews-only",
  platforms: [
    {
      platform: "macos",
      status: "unsupported",
      reason: "host-network-auth-proxy-platform-unavailable"
    },
    {
      platform: "windows",
      status: "partial",
      reason: "host-network-auth-proxy-future-webviews-only"
    },
    { platform: "linux", status: "partial", reason: "host-network-auth-proxy-future-webviews-only" }
  ]
} as const

const WebRequestUnavailableSupport = {
  status: "unsupported",
  reason: "host-web-request-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-web-request-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-web-request-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-web-request-unavailable" }
  ]
} as const

const WebViewDebuggerUnavailableSupport = {
  status: "unsupported",
  reason: "host-debugger-protocol-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-debugger-protocol-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-debugger-protocol-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-debugger-protocol-unavailable" }
  ]
} as const

const WebViewDocumentOutputUnavailableSupport = {
  status: "unsupported",
  reason: "host-document-output-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-document-output-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-document-output-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-document-output-unavailable" }
  ]
} as const

const WebViewFindInPageUnavailableSupport = {
  status: "unsupported",
  reason: "host-find-in-page-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-find-in-page-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-find-in-page-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-find-in-page-unavailable" }
  ]
} as const

const WebViewRuntimeUserAgentUnavailableSupport = {
  status: "unsupported",
  reason: "host-user-agent-runtime-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-user-agent-runtime-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-user-agent-runtime-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-user-agent-runtime-unavailable" }
  ]
} as const

const WebViewFrameRoutingUnavailableSupport = {
  status: "unsupported",
  reason: "host-frame-routing-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-frame-routing-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-frame-routing-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-frame-routing-unavailable" }
  ]
} as const

const WebViewRuntimeMediaControlUnavailableSupport = {
  status: "unsupported",
  reason: "host-runtime-media-control-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-runtime-media-control-unavailable" },
    {
      platform: "windows",
      status: "unsupported",
      reason: "host-runtime-media-control-unavailable"
    },
    { platform: "linux", status: "unsupported", reason: "host-runtime-media-control-unavailable" }
  ]
} as const

const WebViewRuntimePermissionUnavailableSupport = {
  status: "unsupported",
  reason: "host-permission-request-routing-unavailable",
  platforms: [
    {
      platform: "macos",
      status: "unsupported",
      reason: "host-permission-request-routing-unavailable"
    },
    {
      platform: "windows",
      status: "unsupported",
      reason: "host-permission-request-routing-unavailable"
    },
    {
      platform: "linux",
      status: "unsupported",
      reason: "host-permission-request-routing-unavailable"
    }
  ]
} as const

const WebViewNavigationTrackedSupport = {
  status: "partial",
  reason: "host-navigation-state-tracked",
  platforms: [
    { platform: "macos", status: "partial", reason: "host-navigation-state-tracked" },
    { platform: "windows", status: "partial", reason: "host-navigation-state-tracked" },
    { platform: "linux", status: "partial", reason: "host-navigation-state-tracked" }
  ]
} as const

const WebViewNavigationPolicySupport = {
  status: "partial",
  reason: "host-navigation-policy-open-external-unavailable",
  platforms: [
    {
      platform: "macos",
      status: "partial",
      reason: "host-navigation-policy-open-external-unavailable"
    },
    {
      platform: "windows",
      status: "partial",
      reason: "host-navigation-policy-open-external-unavailable"
    },
    {
      platform: "linux",
      status: "partial",
      reason: "host-navigation-policy-open-external-unavailable"
    }
  ]
} as const

const WebViewOpenDevToolsSupport = {
  status: "partial",
  reason: "host-devtools-build-gated",
  platforms: [
    { platform: "macos", status: "partial", reason: "host-devtools-build-gated" },
    { platform: "windows", status: "partial", reason: "host-devtools-build-gated" },
    { platform: "linux", status: "partial", reason: "host-devtools-build-gated" }
  ]
} as const

const WebViewCloseDevToolsSupport = {
  status: "partial",
  reason: "host-devtools-build-gated",
  platforms: [
    { platform: "macos", status: "partial", reason: "host-devtools-build-gated" },
    {
      platform: "windows",
      status: "unsupported",
      reason: "windows-devtools-close-unavailable"
    },
    { platform: "linux", status: "partial", reason: "host-devtools-build-gated" }
  ]
} as const

const NotificationUnavailableSupport = {
  status: "partial",
  reason: "host-notification-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-notification-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-notification-unavailable" },
    { platform: "linux", status: "supported" }
  ]
} as const

const RealtimeMediaSessionMacOsSupport = {
  status: "partial",
  reason: "host-media-startup-unverified",
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: "host-media-startup-unverified" },
    { platform: "linux", status: "unsupported", reason: "host-media-startup-unverified" }
  ]
} as const

const RuntimeProbedEgressPolicySupport = {
  status: "partial",
  reason: "host-decision-log-runtime-probed",
  platforms: [
    { platform: "macos", status: "partial", reason: "host-decision-log-runtime-probed" },
    { platform: "windows", status: "partial", reason: "host-decision-log-runtime-probed" },
    { platform: "linux", status: "partial", reason: "host-decision-log-runtime-probed" }
  ]
} as const

const HostAdapterUnimplementedSupport = {
  status: "unsupported",
  reason: "host-adapter-unimplemented",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
    { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
    { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
  ]
} as const

const MacOsFocusedApplicationSnapshotSupport = {
  status: "partial",
  reason: "macos-frontmost-application-only",
  platforms: [
    { platform: "macos", status: "partial", reason: "macos-frontmost-application-only" },
    { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
    { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
  ]
} as const

test("NativeCapabilities exposes support metadata from native surfaces", () => {
  const runtime = ManagedRuntime.make(NativeCapabilitiesLive)
  return runtime.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const create = yield* capabilities.support("Window.create")
      const dockBadge = yield* capabilities.support("Dock.setBadgeCount")
      const dockBadgeText = yield* capabilities.support("Dock.setBadgeText")
      const dockJumpList = yield* capabilities.support("Dock.setJumpList")
      const dockMenu = yield* capabilities.support("Dock.setMenu")
      const dockProgress = yield* capabilities.support("Dock.setProgress")
      const updaterCheck = yield* capabilities.support("Updater.check")
      const updaterDownload = yield* capabilities.support("Updater.download")
      const updaterGetStatus = yield* capabilities.support("Updater.getStatus")
      const updaterInstall = yield* capabilities.support("Updater.install")
      const updaterReadyForRestart = yield* capabilities.support("Updater.readyForRestart")
      const dialogOpenFile = yield* capabilities.support("Dialog.openFile")
      const dialogOpenDirectory = yield* capabilities.support("Dialog.openDirectory")
      const displayCaptureCaptureDisplay = yield* capabilities.support(
        "DisplayCapture.captureDisplay"
      )
      const displayCaptureCaptureRegion = yield* capabilities.support(
        "DisplayCapture.captureRegion"
      )
      const displayCaptureCaptureWindow = yield* capabilities.support(
        "DisplayCapture.captureWindow"
      )
      const downloadCancel = yield* capabilities.support("Download.cancel")
      const downloadList = yield* capabilities.support("Download.list")
      const downloadPause = yield* capabilities.support("Download.pause")
      const downloadResume = yield* capabilities.support("Download.resume")
      const downloadStart = yield* capabilities.support("Download.start")
      const egressPolicyDecide = yield* capabilities.support("EgressPolicy.decide")
      const egressPolicyIsSupported = yield* capabilities.support("EgressPolicy.isSupported")
      const egressPolicyRecord = yield* capabilities.support("EgressPolicy.record")
      const executionSandboxCreate = yield* capabilities.support("ExecutionSandbox.create")
      const executionSandboxDestroy = yield* capabilities.support("ExecutionSandbox.destroy")
      const executionSandboxRun = yield* capabilities.support("ExecutionSandbox.run")
      const focusedApplicationSnapshot = yield* capabilities.support(
        "FocusedApplicationContext.snapshot"
      )
      const focusedApplicationStopWatching = yield* capabilities.support(
        "FocusedApplicationContext.stopWatching"
      )
      const focusedApplicationWatch = yield* capabilities.support("FocusedApplicationContext.watch")
      const crashReporterStart = yield* capabilities.support("CrashReporter.start")
      const crashReporterRecordBreadcrumb = yield* capabilities.support(
        "CrashReporter.recordBreadcrumb"
      )
      const crashReporterFlush = yield* capabilities.support("CrashReporter.flush")
      const crashReporterGetReports = yield* capabilities.support("CrashReporter.getReports")
      const powerMonitorIsSupported = yield* capabilities.support("PowerMonitor.isSupported")
      const recentDocumentsAdd = yield* capabilities.support("RecentDocuments.add")
      const recentDocumentsClear = yield* capabilities.support("RecentDocuments.clear")
      const recentDocumentsList = yield* capabilities.support("RecentDocuments.list")
      const systemAppearance = yield* capabilities.support("SystemAppearance.getAppearance")
      const appQuit = yield* capabilities.support("App.quit")
      const globalShortcutRegister = yield* capabilities.support("GlobalShortcut.register")
      const globalShortcutUnregister = yield* capabilities.support("GlobalShortcut.unregister")
      const globalShortcutUnregisterAll = yield* capabilities.support(
        "GlobalShortcut.unregisterAll"
      )
      const nativeNetworkFetch = yield* capabilities.support("NativeNetwork.fetch")
      const nativeNetworkUpload = yield* capabilities.support("NativeNetwork.upload")
      const nativeNetworkLocalhostUrl = yield* capabilities.support("NativeNetwork.localhostUrl")
      const nativeNetworkConnectWebSocket = yield* capabilities.support(
        "NativeNetwork.connectWebSocket"
      )
      const nativeNetworkCloseWebSocket = yield* capabilities.support(
        "NativeNetwork.closeWebSocket"
      )
      const networkAuthHandleAuth = yield* capabilities.support("NetworkAuth.handleAuth")
      const networkAuthHandleCertificate = yield* capabilities.support(
        "NetworkAuth.handleCertificate"
      )
      const networkAuthSetProxy = yield* capabilities.support("NetworkAuth.setProxy")
      const webRequestOnBeforeRequest = yield* capabilities.support("WebRequest.onBeforeRequest")
      const webRequestOnHeadersReceived = yield* capabilities.support(
        "WebRequest.onHeadersReceived"
      )
      const webRequestRemoveListener = yield* capabilities.support("WebRequest.removeListener")
      const notificationClose = yield* capabilities.support("Notification.close")
      const notificationGetPermissionStatus = yield* capabilities.support(
        "Notification.getPermissionStatus"
      )
      const notificationRequestPermission = yield* capabilities.support(
        "Notification.requestPermission"
      )
      const notificationShow = yield* capabilities.support("Notification.show")
      const realtimeMediaSessionOpen = yield* capabilities.support("RealtimeMediaSession.open")
      const realtimeMediaSessionClose = yield* capabilities.support("RealtimeMediaSession.close")
      const realtimeMediaSessionSelectDevice = yield* capabilities.support(
        "RealtimeMediaSession.selectDevice"
      )
      const realtimeMediaSessionInterrupt = yield* capabilities.support(
        "RealtimeMediaSession.interrupt"
      )
      const webViewCreate = yield* capabilities.support("WebView.create")
      const webViewDestroy = yield* capabilities.support("WebView.destroy")
      const webViewLoadRoute = yield* capabilities.support("WebView.loadRoute")
      const webViewLoadUrl = yield* capabilities.support("WebView.loadUrl")
      const webViewReload = yield* capabilities.support("WebView.reload")
      const webViewStop = yield* capabilities.support("WebView.stop")
      const webViewPrint = yield* capabilities.support("WebView.print")
      const webViewSetZoom = yield* capabilities.support("WebView.setZoom")
      const webViewGoBack = yield* capabilities.support("WebView.goBack")
      const webViewGoForward = yield* capabilities.support("WebView.goForward")
      const webViewGetNavigationState = yield* capabilities.support("WebView.getNavigationState")
      const webViewSetNavigationPolicy = yield* capabilities.support("WebView.setNavigationPolicy")
      const webViewOpenDevTools = yield* capabilities.support("WebView.openDevTools")
      const webViewCloseDevTools = yield* capabilities.support("WebView.closeDevTools")
      const webViewAttachDebugger = yield* capabilities.support("WebView.attachDebugger")
      const webViewCaptureScreenshot = yield* capabilities.support("WebView.captureScreenshot")
      const webViewPrintToPdf = yield* capabilities.support("WebView.printToPdf")
      const webViewFindInPage = yield* capabilities.support("WebView.findInPage")
      const webViewSetUserAgent = yield* capabilities.support("WebView.setUserAgent")
      const webViewSetAudioMuted = yield* capabilities.support("WebView.setAudioMuted")
      const webViewRespondToPermission = yield* capabilities.support("WebView.respondToPermission")
      const webViewListFrames = yield* capabilities.support("WebView.listFrames")
      const webViewPostToFrame = yield* capabilities.support("WebView.postToFrame")
      const menuClear = yield* capabilities.support("Menu.clear")
      const contextMenuShow = yield* capabilities.support("ContextMenu.show")
      const safeStorageSet = yield* capabilities.support("SafeStorage.set")
      const safeStorageIsAvailable = yield* capabilities.support("SafeStorage.isAvailable")
      const hasWindowShow = capabilities.manifest.some((fact) => fact.tag === "Window.show")
      const hasMenuBindCommand = capabilities.manifest.some(
        (fact) => fact.tag === "Menu.bindCommand"
      )
      const hasWebViewCapability = capabilities.manifest.some(
        (fact) => fact.tag === "WebView.capability"
      )

      expect(create).toEqual({ status: "supported" })
      expect(appQuit).toEqual({ status: "supported" })
      expect(dockBadge).toEqual({
        status: "partial",
        reason: "dock behavior is platform-specific",
        platforms: [
          { platform: "macos", status: "supported" },
          {
            platform: "linux",
            status: "unsupported",
            reason: "Linux launcher badge labels are not wired in the host adapter"
          },
          {
            platform: "windows",
            status: "unsupported",
            reason: "Windows taskbar badges require jump-list/taskbar integration"
          }
        ]
      })
      expect(dockBadgeText).toEqual({
        status: "partial",
        reason: "dock behavior is platform-specific",
        platforms: [
          { platform: "macos", status: "supported" },
          {
            platform: "linux",
            status: "unsupported",
            reason: "Linux host only exposes numeric launcher badge labels"
          },
          {
            platform: "windows",
            status: "unsupported",
            reason: "Windows taskbar badges require jump-list/taskbar integration"
          }
        ]
      })
      expect(dockJumpList).toEqual(UnsupportedDockCapabilitySupport)
      expect(dockMenu).toEqual(UnsupportedDockCapabilitySupport)
      expect(dockProgress).toEqual({ status: "supported" })
      expect(globalShortcutRegister).toEqual(HostAdapterUnimplementedSupport)
      expect(globalShortcutUnregister).toEqual(HostAdapterUnimplementedSupport)
      expect(globalShortcutUnregisterAll).toEqual(HostAdapterUnimplementedSupport)
      expect(nativeNetworkFetch).toEqual(NativeNetworkUnavailableSupport)
      expect(nativeNetworkUpload).toEqual(NativeNetworkUnavailableSupport)
      expect(nativeNetworkLocalhostUrl).toEqual(NativeNetworkUnavailableSupport)
      expect(nativeNetworkConnectWebSocket).toEqual(NativeNetworkUnavailableSupport)
      expect(nativeNetworkCloseWebSocket).toEqual(NativeNetworkUnavailableSupport)
      expect(networkAuthHandleAuth).toEqual(NetworkAuthUnavailableSupport)
      expect(networkAuthHandleCertificate).toEqual(NetworkAuthUnavailableSupport)
      expect(networkAuthSetProxy).toEqual(NetworkAuthProxySupport)
      expect(webRequestOnBeforeRequest).toEqual(WebRequestUnavailableSupport)
      expect(webRequestOnHeadersReceived).toEqual(WebRequestUnavailableSupport)
      expect(webRequestRemoveListener).toEqual(WebRequestUnavailableSupport)
      expect(notificationClose).toEqual(NotificationUnavailableSupport)
      expect(notificationGetPermissionStatus).toEqual(NotificationUnavailableSupport)
      expect(notificationRequestPermission).toEqual(NotificationUnavailableSupport)
      expect(notificationShow).toEqual(NotificationUnavailableSupport)
      expect(realtimeMediaSessionOpen).toEqual(RealtimeMediaSessionMacOsSupport)
      expect(realtimeMediaSessionClose).toEqual(RealtimeMediaSessionMacOsSupport)
      expect(realtimeMediaSessionSelectDevice).toEqual(RealtimeMediaSessionMacOsSupport)
      expect(realtimeMediaSessionInterrupt).toEqual(RealtimeMediaSessionMacOsSupport)
      expect(webViewOpenDevTools).toEqual(WebViewOpenDevToolsSupport)
      expect(webViewCloseDevTools).toEqual(WebViewCloseDevToolsSupport)
      expect(webViewAttachDebugger).toEqual(WebViewDebuggerUnavailableSupport)
      expect(webViewCaptureScreenshot).toEqual(WebViewDocumentOutputUnavailableSupport)
      expect(webViewPrintToPdf).toEqual(WebViewDocumentOutputUnavailableSupport)
      expect(webViewFindInPage).toEqual(WebViewFindInPageUnavailableSupport)
      expect(webViewSetUserAgent).toEqual(WebViewRuntimeUserAgentUnavailableSupport)
      expect(webViewSetAudioMuted).toEqual(WebViewRuntimeMediaControlUnavailableSupport)
      expect(webViewRespondToPermission).toEqual(WebViewRuntimePermissionUnavailableSupport)
      expect(webViewListFrames).toEqual(WebViewFrameRoutingUnavailableSupport)
      expect(webViewPostToFrame).toEqual(WebViewFrameRoutingUnavailableSupport)
      expect(webViewCreate).toEqual({ status: "supported" })
      expect(webViewDestroy).toEqual({ status: "supported" })
      expect(webViewLoadRoute).toEqual({ status: "supported" })
      expect(webViewLoadUrl).toEqual({ status: "supported" })
      expect(webViewReload).toEqual({ status: "supported" })
      expect(webViewStop).toEqual({ status: "supported" })
      expect(webViewPrint).toEqual({ status: "supported" })
      expect(webViewSetZoom).toEqual({ status: "supported" })
      expect(webViewGoBack).toEqual(WebViewNavigationTrackedSupport)
      expect(webViewGoForward).toEqual(WebViewNavigationTrackedSupport)
      expect(webViewGetNavigationState).toEqual(WebViewNavigationTrackedSupport)
      expect(webViewSetNavigationPolicy).toEqual(WebViewNavigationPolicySupport)
      expect(menuClear).toEqual({
        status: "partial",
        reason: "macos-menu-clear-only",
        platforms: [
          { platform: "macos", status: "supported" },
          { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
          { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
        ]
      })
      expect(contextMenuShow).toEqual({ status: "supported" })
      expect(hasMenuBindCommand).toBe(false)
      expect(hasWebViewCapability).toBe(false)
      expect(safeStorageSet).toEqual({ status: "supported" })
      expect(safeStorageIsAvailable).toEqual({ status: "supported" })
      expect(updaterCheck).toEqual({ status: "supported" })
      expect(updaterDownload).toEqual({
        status: "partial",
        reason: "signed-manifest-file-artifact-only",
        platforms: [
          { platform: "macos", status: "partial", reason: "signed-manifest-file-artifact-only" },
          { platform: "windows", status: "partial", reason: "signed-manifest-file-artifact-only" },
          { platform: "linux", status: "partial", reason: "signed-manifest-file-artifact-only" }
        ]
      })
      expect(updaterGetStatus).toEqual({ status: "supported" })
      expect(updaterInstall).toEqual({
        status: "partial",
        reason: "signed-manifest-staged-install-only",
        platforms: [
          { platform: "macos", status: "partial", reason: "signed-manifest-staged-install-only" },
          { platform: "windows", status: "partial", reason: "signed-manifest-staged-install-only" },
          { platform: "linux", status: "partial", reason: "signed-manifest-staged-install-only" }
        ]
      })
      expect(updaterReadyForRestart).toEqual({ status: "supported" })
      expect(dialogOpenDirectory).toEqual({
        status: "partial",
        reason: "linux-zenity-multi-selection-unavailable",
        platforms: [
          { platform: "macos", status: "supported" },
          { platform: "windows", status: "supported" },
          {
            platform: "linux",
            status: "partial",
            reason: "linux-zenity-multi-selection-unavailable"
          }
        ]
      })
      expect(dialogOpenFile).toEqual(dialogOpenDirectory)
      expect(downloadCancel).toEqual(UnsupportedDownloadSupport)
      expect(downloadList).toEqual(UnsupportedDownloadSupport)
      expect(downloadPause).toEqual(UnsupportedDownloadSupport)
      expect(downloadResume).toEqual(UnsupportedDownloadSupport)
      expect(downloadStart).toEqual(UnsupportedDownloadSupport)
      expect(egressPolicyDecide).toEqual(RuntimeProbedEgressPolicySupport)
      expect(egressPolicyIsSupported).toEqual(RuntimeProbedEgressPolicySupport)
      expect(egressPolicyRecord).toEqual(RuntimeProbedEgressPolicySupport)
      expect(executionSandboxCreate).toEqual(HostAdapterUnimplementedSupport)
      expect(executionSandboxDestroy).toEqual(HostAdapterUnimplementedSupport)
      expect(executionSandboxRun).toEqual(HostAdapterUnimplementedSupport)
      expect(focusedApplicationSnapshot).toEqual(MacOsFocusedApplicationSnapshotSupport)
      expect(focusedApplicationStopWatching).toEqual(HostAdapterUnimplementedSupport)
      expect(focusedApplicationWatch).toEqual(HostAdapterUnimplementedSupport)
      expect(displayCaptureCaptureDisplay).toEqual({
        status: "partial",
        reason: "macos-screencapture-adapter",
        platforms: [
          { platform: "macos", status: "supported" },
          { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
          { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
        ]
      })
      expect(displayCaptureCaptureRegion).toEqual(displayCaptureCaptureDisplay)
      expect(displayCaptureCaptureWindow).toEqual(displayCaptureCaptureDisplay)
      expect(crashReporterStart).toEqual({
        status: "partial",
        reason: "native-crash-capture-unavailable",
        platforms: [
          { platform: "macos", status: "partial", reason: "native-crash-capture-unavailable" },
          { platform: "windows", status: "partial", reason: "native-crash-capture-unavailable" },
          { platform: "linux", status: "partial", reason: "native-crash-capture-unavailable" }
        ]
      })
      expect(crashReporterRecordBreadcrumb).toEqual({ status: "supported" })
      expect(crashReporterFlush).toEqual({ status: "supported" })
      expect(crashReporterGetReports).toEqual({ status: "supported" })
      expect(powerMonitorIsSupported).toEqual({
        status: "partial",
        reason: "platform-power-monitor-unavailable",
        platforms: [
          { platform: "macos", status: "supported" },
          {
            platform: "windows",
            status: "unsupported",
            reason: "platform-power-monitor-unavailable"
          },
          { platform: "linux", status: "unsupported", reason: "platform-power-monitor-unavailable" }
        ]
      })
      expect(recentDocumentsAdd).toEqual({ status: "supported" })
      expect(recentDocumentsClear).toEqual({ status: "supported" })
      expect(recentDocumentsList).toEqual({ status: "supported" })
      expect(systemAppearance).toEqual({
        status: "partial",
        reason: "host-system-appearance-snapshot",
        platforms: [
          { platform: "macos", status: "supported" },
          { platform: "windows", status: "supported" },
          { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
        ]
      })
      expect(hasWindowShow).toBe(true)
    })
  )
})

test("NativeCapabilities derives support metadata from selected native layers only", () => {
  const runtime = ManagedRuntime.make(
    makeNativeCapabilitiesLayer(Native.available(Native.Clipboard))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const readText = yield* capabilities.support("Clipboard.readText")
      const missingWindow = yield* Effect.exit(capabilities.support("Window.create"))
      const tags = capabilities.manifest.map((fact) => fact.tag)

      expect(readText).toEqual({ status: "supported" })
      expect(tags).toContain("Clipboard.readText")
      expect(tags).not.toContain("Window.create")
      expect(Exit.isFailure(missingWindow)).toBe(true)
      if (Exit.isFailure(missingWindow)) {
        const failure = missingWindow.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(NativeCapabilityLookupError)(failure?.error)).toBe(true)
      }
    })
  )
})

test("NativeCapabilities require fails unsupported methods from explicit metadata", () => {
  const unsupported = testSurface("Example.unsupported", {
    status: "unsupported",
    reason: "example unavailable"
  })
  const runtime = ManagedRuntime.make(makeNativeCapabilitiesLayer(testNativeLayer(unsupported)))
  return runtime.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const capabilities = yield* NativeCapabilities
          yield* capabilities.support("Example.unsupported")
          return yield* capabilities.require("Example.unsupported")
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(UnsupportedCapability)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          _tag: "UnsupportedCapability",
          tag: "Example.unsupported",
          reason: "example unavailable"
        })
      }
    })
  )
})

test("NativeCapabilities exposes partial support with platform-specific reasons", () => {
  const partial = testSurface("Example.partial", {
    status: "partial",
    reason: "platform implementations differ",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "linux", status: "unsupported", reason: "host adapter missing" },
      { platform: "windows", status: "partial", reason: "requires shell integration" }
    ]
  })
  const runtime = ManagedRuntime.make(makeNativeCapabilitiesLayer(testNativeLayer(partial)))
  return runtime.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const support = yield* capabilities.support("Example.partial")
      yield* capabilities.require("Example.partial")
      yield* capabilities.requirePlatform("Example.partial", "macos")

      expect(support).toEqual({
        status: "partial",
        reason: "platform implementations differ",
        platforms: [
          { platform: "macos", status: "supported" },
          { platform: "linux", status: "unsupported", reason: "host adapter missing" },
          { platform: "windows", status: "partial", reason: "requires shell integration" }
        ]
      })
      expect(Object.isFrozen(support)).toBe(true)
      expect(Object.isFrozen(support.platforms)).toBe(true)
    })
  )
})

test("NativeCapabilities fails platform-specific unsupported entries as typed errors", () => {
  const partial = testSurface("Example.partial", {
    status: "partial",
    reason: "platform implementations differ",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "linux", status: "unsupported", reason: "host adapter missing" },
      { platform: "windows", status: "partial", reason: "requires shell integration" }
    ]
  })
  const runtime = ManagedRuntime.make(makeNativeCapabilitiesLayer(testNativeLayer(partial)))
  return runtime.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const capabilities = yield* NativeCapabilities
          return yield* capabilities.requirePlatform("Example.partial", "linux")
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(UnsupportedCapability)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          _tag: "UnsupportedCapability",
          tag: "Example.partial",
          platform: "linux",
          reason: "host adapter missing"
        })
      }
    })
  )
})

test("NativeCapabilities require succeeds for supported methods", () => {
  const runtime = ManagedRuntime.make(NativeCapabilitiesLive)
  return runtime.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const result = yield* capabilities.require("Window.create")
      expect(result).toBeUndefined()
    })
  )
})

test("NativeCapabilities reports unknown method tags as typed lookup errors", () => {
  const runtime = ManagedRuntime.make(NativeCapabilitiesLive)
  return runtime.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const capabilities = yield* NativeCapabilities
          return yield* capabilities.support("Window.missing")
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(NativeCapabilityLookupError)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          tag: "Window.missing",
          message: "unknown native capability tag: Window.missing"
        })
      }
    })
  )
})

test("NativeCapabilities rejects duplicate method tags in manifests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const first = testSurface("Duplicate.method")
      const second = testSurface("Duplicate.method", {
        status: "unsupported",
        reason: "second declaration"
      })

      const exit = yield* Effect.exit(
        Effect.scoped(Layer.build(makeNativeCapabilitiesLayer(testNativeLayer(first, second))))
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(NativeCapabilityManifestError)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          tag: "Duplicate.method",
          message: "duplicate native capability tag: Duplicate.method"
        })
      }
    })
  ))

test("NativeCapabilities rejects missing capability metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Layer.build(makeNativeCapabilitiesLayer(testNativeLayer(testSurfaceWithoutCapability())))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(NativeCapabilityManifestError)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          tag: "Example.missing",
          message: "missing native capability metadata: Example.missing"
        })
      }
    })
  ))

test("NativeCapabilities rejects malformed support metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const malformed = testSurface("Example.malformed", {
        status: "partial",
        reason: " ",
        platforms: [{ platform: "linux", status: "unsupported", reason: " " }]
      })

      const exit = yield* Effect.exit(
        Effect.scoped(Layer.build(makeNativeCapabilitiesLayer(testNativeLayer(malformed))))
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(NativeCapabilityManifestError)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          tag: "Example.malformed",
          message: "partial and unsupported native capabilities must include a reason"
        })
      }
    })
  ))

test("NativeCapabilities rejects partial support without complete platform coverage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const incomplete = testSurface("Example.incomplete", {
        status: "partial",
        reason: "platform implementations differ",
        platforms: [
          { platform: "macos", status: "supported" },
          { platform: "linux", status: "unsupported", reason: "host adapter missing" }
        ]
      })

      const exit = yield* Effect.exit(
        Effect.scoped(Layer.build(makeNativeCapabilitiesLayer(testNativeLayer(incomplete))))
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(NativeCapabilityManifestError)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          tag: "Example.incomplete",
          message: "native capability platform support must include macos, windows, and linux"
        })
      }
    })
  ))

test("NativeCapabilities rejects contradictory top-level and platform support", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const contradictory = testSurface("Example.contradictory", {
        status: "supported",
        platforms: [
          { platform: "macos", status: "supported" },
          { platform: "linux", status: "unsupported", reason: "host adapter missing" },
          { platform: "windows", status: "supported" }
        ]
      })

      const exit = yield* Effect.exit(
        Effect.scoped(Layer.build(makeNativeCapabilitiesLayer(testNativeLayer(contradictory))))
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(NativeCapabilityManifestError)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          tag: "Example.contradictory",
          message:
            "supported native capabilities cannot include partial or unsupported platform entries"
        })
      }
    })
  ))

const testSurface = (
  tag: string,
  support: RpcSupportMetadata = { status: "supported" },
  capability: RpcCapabilityMetadata | undefined = { kind: "none" },
  callable = true
) =>
  Object.freeze({
    schemaDocs: Object.freeze([
      Object.freeze({
        name: tag.slice(tag.lastIndexOf(".") + 1),
        tag,
        kind: "mutation",
        callable,
        payload: callable ? Option.some(Schema.Void) : Option.none(),
        success: callable ? Option.some(Schema.Void) : Option.none(),
        error: callable ? Option.some(Schema.Void) : Option.none(),
        stream: Option.none(),
        capability: capability === undefined ? Option.none() : Option.some(capability),
        support
      } satisfies DesktopRpcSchemaDoc)
    ])
  })

const testSurfaceWithoutCapability = () =>
  Object.freeze({
    schemaDocs: Object.freeze([
      Object.freeze({
        name: "missing",
        tag: "Example.missing",
        kind: "mutation",
        callable: true,
        payload: Option.some(Schema.Void),
        success: Option.some(Schema.Void),
        error: Option.some(Schema.Void),
        stream: Option.none(),
        capability: Option.none(),
        support: { status: "supported" }
      } satisfies DesktopRpcSchemaDoc)
    ])
  })

const testNativeLayer = (
  ...surfaces: readonly { readonly schemaDocs: readonly DesktopRpcSchemaDoc[] }[]
): DesktopNativeLayer =>
  Object.freeze(
    surfaces.map((capabilitySurface, index) =>
      Object.freeze({
        tag: `TestSurface${index}`,
        serverLayer: Object.freeze([]),
        schemaDocs: capabilitySurface.schemaDocs,
        contractLaws: Object.freeze([])
      })
    )
  )
