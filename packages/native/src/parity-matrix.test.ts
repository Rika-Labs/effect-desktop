import { expect, test } from "bun:test"
import type { RpcCapabilityMetadata, RpcSupportMetadata } from "@effect-desktop/bridge"
import { type DesktopNativeLayer, type DesktopRpcSchemaDoc } from "@effect-desktop/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect"

import {
  formatNativeParityMatrixMarkdown,
  routedHostMethodsFromSource
} from "./parity-matrix-source.js"
import {
  makeNativeHostMethodInventoryLayer,
  makeNativeParityMatrixLayer,
  makeNativeParityMatrixResult,
  NativeHostMethodInventory,
  NativeHostMethodInventorySnapshot,
  NativeParityMatrix,
  NativeParityMatrixError,
  NativeParityMatrixResult,
  type NativeParityMatrixResultType
} from "./parity-matrix.js"
import { Native } from "./native.js"

const repoRoot = `${import.meta.dir}/../../..`
const hostProtocolPath = `${repoRoot}/crates/host-protocol/src/lib.rs`
const hostRouterPath = `${repoRoot}/crates/host/src/methods/mod.rs`

const readRoutedHostMethods = (): Effect.Effect<ReadonlySet<string>, never, never> =>
  Effect.gen(function* () {
    const protocolSource = yield* Effect.promise(() => Bun.file(hostProtocolPath).text())
    const routerSource = yield* Effect.promise(() => Bun.file(hostRouterPath).text())
    return routedHostMethodsFromSource(protocolSource, routerSource)
  })

const buildNativeParityMatrix = (): Effect.Effect<
  NativeParityMatrixResultType,
  NativeParityMatrixError,
  never
> =>
  Effect.gen(function* () {
    const hostMethods = yield* readRoutedHostMethods()
    return yield* makeNativeParityMatrixResult(Native.all.surfaces, hostMethods)
  })

test("NativeParityMatrix reports declared TypeScript methods against the Rust host registry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const hostMethods = yield* readRoutedHostMethods()
      const result = yield* makeNativeParityMatrixResult(Native.all.surfaces, hostMethods)

      const decoded = yield* Schema.decodeUnknownEffect(NativeParityMatrixResult)(result)
      expect(decoded).toEqual(result)
      expect(result.summary.total).toBeGreaterThan(0)
      expect(result.summary.routed).toBeGreaterThan(0)
      expect(result.summary.missing).toBe(0)

      expect(result.rows.find((row) => row.tag === "Window.create")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "App.focus")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "App.activate")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "App.quit")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "App.exit")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "App.requestSingleInstanceLock")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "App.releaseSingleInstanceLock")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "App.restart")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "App.relaunch")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "Clipboard.readText")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "WebView.create")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "host-navigation-state-tracked" }
      })
      expect(result.rows.find((row) => row.tag === "Menu.setApplicationMenu")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "Menu.clear")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "macos-menu-clear-only",
          platforms: [
            { platform: "macos", status: "supported" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "Menu.bindCommand")).toBeUndefined()
      expect(result.rows.find((row) => row.tag === "NativeNetwork.fetch")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-native-network-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "NativeNetwork.upload")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-native-network-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "NativeNetwork.localhostUrl")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-native-network-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "NativeNetwork.connectWebSocket")).toMatchObject(
        {
          hostStatus: "capability-fact",
          support: {
            status: "unsupported",
            reason: "host-native-network-unavailable",
            platforms: [
              {
                platform: "macos",
                status: "unsupported",
                reason: "host-native-network-unavailable"
              },
              {
                platform: "windows",
                status: "unsupported",
                reason: "host-native-network-unavailable"
              },
              {
                platform: "linux",
                status: "unsupported",
                reason: "host-native-network-unavailable"
              }
            ]
          }
        }
      )
      expect(result.rows.find((row) => row.tag === "NativeNetwork.closeWebSocket")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-native-network-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-native-network-unavailable"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "NetworkAuth.handleAuth")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-network-auth-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-network-auth-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-network-auth-unavailable"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-network-auth-unavailable"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "NetworkAuth.handleCertificate")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-network-auth-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-network-auth-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-network-auth-unavailable"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-network-auth-unavailable"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "NetworkAuth.setProxy")).toMatchObject({
        hostStatus: "routed",
        support: {
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
            {
              platform: "linux",
              status: "partial",
              reason: "host-network-auth-proxy-future-webviews-only"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "ContextMenu.show")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "Notification.close")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-notification-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-notification-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-notification-unavailable"
            },
            { platform: "linux", status: "supported" }
          ]
        }
      })
      expect(
        result.rows.find((row) => row.tag === "Notification.getPermissionStatus")
      ).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-notification-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-notification-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-notification-unavailable"
            },
            { platform: "linux", status: "supported" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "Notification.requestPermission")).toMatchObject(
        {
          hostStatus: "routed",
          support: {
            status: "partial",
            reason: "host-notification-unavailable",
            platforms: [
              {
                platform: "macos",
                status: "unsupported",
                reason: "host-notification-unavailable"
              },
              {
                platform: "windows",
                status: "unsupported",
                reason: "host-notification-unavailable"
              },
              { platform: "linux", status: "supported" }
            ]
          }
        }
      )
      expect(result.rows.find((row) => row.tag === "Notification.show")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-notification-unavailable",
          platforms: [
            {
              platform: "macos",
              status: "unsupported",
              reason: "host-notification-unavailable"
            },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-notification-unavailable"
            },
            { platform: "linux", status: "supported" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "Dialog.openDirectory")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "linux-zenity-multi-selection-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "Dialog.openFile")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "linux-zenity-multi-selection-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "DisplayCapture.captureDisplay")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "macos-screencapture-adapter" }
      })
      expect(result.rows.find((row) => row.tag === "DisplayCapture.captureRegion")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "macos-screencapture-adapter" }
      })
      expect(result.rows.find((row) => row.tag === "DisplayCapture.captureWindow")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "macos-screencapture-adapter" }
      })
      expect(result.rows.find((row) => row.tag === "Dock.setBadgeCount")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "dock behavior is platform-specific" }
      })
      expect(result.rows.find((row) => row.tag === "Dock.setBadgeText")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "dock behavior is platform-specific" }
      })
      expect(result.rows.find((row) => row.tag === "Dock.setJumpList")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host adapter does not implement this Dock method on any platform"
        }
      })
      expect(result.rows.find((row) => row.tag === "Dock.setMenu")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host adapter does not implement this Dock method on any platform"
        }
      })
      expect(result.rows.find((row) => row.tag === "Download.cancel")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-download-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "Download.list")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-download-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "Download.pause")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-download-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "Download.resume")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-download-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "Download.start")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-download-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "SafeStorage.isAvailable")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "SafeStorage.set")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "Updater.check")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "signed-manifest-check-only" }
      })
      expect(result.rows.find((row) => row.tag === "Updater.download")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "signed-manifest-file-artifact-only" }
      })
      expect(result.rows.find((row) => row.tag === "CrashReporter.start")).toMatchObject({
        hostStatus: "routed",
        support: { status: "partial", reason: "native-crash-capture-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "CrashReporter.flush")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "CrashReporter.getReports")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "CrashReporter.recordBreadcrumb")).toMatchObject(
        {
          hostStatus: "routed",
          support: { status: "supported" }
        }
      )
      expect(result.rows.find((row) => row.tag === "PowerMonitor.isSupported")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "platform-power-monitor-unavailable",
          platforms: [
            { platform: "macos", status: "supported" },
            {
              platform: "windows",
              status: "unsupported",
              reason: "platform-power-monitor-unavailable"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "platform-power-monitor-unavailable"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "RealtimeMediaSession.open")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-media-startup-unverified",
          platforms: [
            { platform: "macos", status: "supported" },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-media-startup-unverified"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-media-startup-unverified"
            }
          ]
        }
      })
      expect(
        result.rows.find((row) => row.tag === "RealtimeMediaSession.selectDevice")
      ).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-media-startup-unverified",
          platforms: [
            { platform: "macos", status: "supported" },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-media-startup-unverified"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-media-startup-unverified"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "RealtimeMediaSession.close")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-media-startup-unverified",
          platforms: [
            { platform: "macos", status: "supported" },
            {
              platform: "windows",
              status: "unsupported",
              reason: "host-media-startup-unverified"
            },
            {
              platform: "linux",
              status: "unsupported",
              reason: "host-media-startup-unverified"
            }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "RealtimeMediaSession.interrupt")).toMatchObject(
        {
          hostStatus: "routed",
          support: {
            status: "partial",
            reason: "host-media-startup-unverified",
            platforms: [
              { platform: "macos", status: "supported" },
              {
                platform: "windows",
                status: "unsupported",
                reason: "host-media-startup-unverified"
              },
              {
                platform: "linux",
                status: "unsupported",
                reason: "host-media-startup-unverified"
              }
            ]
          }
        }
      )
      expect(result.rows.find((row) => row.tag === "RecentDocuments.add")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "RecentDocuments.clear")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "RecentDocuments.list")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "ScopedAccessGrant.grant")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-adapter-unimplemented" }
      })
      expect(result.rows.find((row) => row.tag === "ScopedAccessGrant.resolve")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-adapter-unimplemented" }
      })
      expect(result.rows.find((row) => row.tag === "ScopedAccessGrant.revoke")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-adapter-unimplemented" }
      })
      expect(result.rows.find((row) => row.tag === "ScopedAccessGrant.isSupported")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(
        result.rows.find((row) => row.tag === "SelectionContext.readDocumentContext")
      ).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-adapter-unimplemented" }
      })
      expect(result.rows.find((row) => row.tag === "SelectionContext.readSelection")).toMatchObject(
        {
          hostStatus: "capability-fact",
          support: { status: "unsupported", reason: "host-adapter-unimplemented" }
        }
      )
      expect(result.rows.find((row) => row.tag === "SelectionContext.stopWatching")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-adapter-unimplemented" }
      })
      expect(result.rows.find((row) => row.tag === "SelectionContext.watchFocus")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-adapter-unimplemented" }
      })
      expect(result.rows.find((row) => row.tag === "SessionPermission.decide")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-session-permission-unavailable" }
      })
      expect(
        result.rows.find((row) => row.tag === "SessionPermission.listDecisions")
      ).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-session-permission-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "SessionPermission.request")).toMatchObject({
        hostStatus: "capability-fact",
        support: { status: "unsupported", reason: "host-session-permission-unavailable" }
      })
      expect(result.rows.find((row) => row.tag === "SessionProfile.destroy")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "SessionProfile.fromPartition")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "SessionProfile.list")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "Shell.trashItem")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(
        result.rows.find((row) => row.tag === "SystemAppearance.getAccentColor")
      ).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "SystemAppearance.getAppearance")).toMatchObject(
        {
          hostStatus: "routed",
          support: { status: "partial", reason: "host-system-appearance-snapshot" }
        }
      )
      expect(result.rows.find((row) => row.tag === "SystemAppearance.isSupported")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(result.rows.find((row) => row.tag === "Window.close")).toMatchObject({
        hostMethod: "Window.destroy",
        hostStatus: "routed"
      })
      expect(result.rows.find((row) => row.tag === "Window.destroy")).toMatchObject({
        hostStatus: "routed"
      })
      expect(result.rows.find((row) => row.tag === "Window.centerOnDisplay")).toMatchObject({
        hostStatus: "routed"
      })
      expect(result.rows.find((row) => row.tag === "EgressPolicy.decide")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-decision-log-runtime-probed",
          platforms: [
            { platform: "macos", status: "partial", reason: "host-decision-log-runtime-probed" },
            { platform: "windows", status: "partial", reason: "host-decision-log-runtime-probed" },
            { platform: "linux", status: "partial", reason: "host-decision-log-runtime-probed" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "EgressPolicy.isSupported")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-decision-log-runtime-probed",
          platforms: [
            { platform: "macos", status: "partial", reason: "host-decision-log-runtime-probed" },
            { platform: "windows", status: "partial", reason: "host-decision-log-runtime-probed" },
            { platform: "linux", status: "partial", reason: "host-decision-log-runtime-probed" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "EgressPolicy.record")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "host-decision-log-runtime-probed",
          platforms: [
            { platform: "macos", status: "partial", reason: "host-decision-log-runtime-probed" },
            { platform: "windows", status: "partial", reason: "host-decision-log-runtime-probed" },
            { platform: "linux", status: "partial", reason: "host-decision-log-runtime-probed" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "ExecutionSandbox.create")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "ExecutionSandbox.destroy")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "ExecutionSandbox.run")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(
        result.rows.find((row) => row.tag === "FocusedApplicationContext.snapshot")
      ).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "macos-frontmost-application-only",
          platforms: [
            { platform: "macos", status: "partial", reason: "macos-frontmost-application-only" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(
        result.rows.find((row) => row.tag === "FocusedApplicationContext.stopWatching")
      ).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(
        result.rows.find((row) => row.tag === "FocusedApplicationContext.watch")
      ).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "GlobalShortcut.register")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "GlobalShortcut.unregister")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "GlobalShortcut.unregisterAll")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "TransientWindowRole.open")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "TransientWindowRole.reposition")).toMatchObject(
        {
          hostStatus: "capability-fact",
          support: {
            status: "unsupported",
            reason: "host-adapter-unimplemented",
            platforms: [
              { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
              { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
              { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
            ]
          }
        }
      )
      expect(result.rows.find((row) => row.tag === "TransientWindowRole.dismiss")).toMatchObject({
        hostStatus: "capability-fact",
        support: {
          status: "unsupported",
          reason: "host-adapter-unimplemented",
          platforms: [
            { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
            { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "Tray.create")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "linux-tray-unavailable",
          platforms: [
            { platform: "macos", status: "supported" },
            { platform: "windows", status: "supported" },
            { platform: "linux", status: "unsupported", reason: "host-tray-unavailable" }
          ]
        }
      })
      expect(result.rows.find((row) => row.tag === "Tray.destroy")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "linux-tray-unavailable",
          platforms: [
            { platform: "macos", status: "supported" },
            { platform: "windows", status: "supported" },
            { platform: "linux", status: "unsupported", reason: "host-tray-unavailable" }
          ]
        }
      })
    })
  ))

test("NativeParityMatrix keeps CrashReporter.start partial until native crash capture exists", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* buildNativeParityMatrix()
      const crashReporterRows = result.rows.filter((row) => row.surface === "CrashReporter")

      expect(crashReporterRows.find((row) => row.tag === "CrashReporter.start")).toMatchObject({
        hostStatus: "routed",
        support: {
          status: "partial",
          reason: "native-crash-capture-unavailable",
          platforms: [
            { platform: "macos", status: "partial", reason: "native-crash-capture-unavailable" },
            { platform: "windows", status: "partial", reason: "native-crash-capture-unavailable" },
            { platform: "linux", status: "partial", reason: "native-crash-capture-unavailable" }
          ]
        }
      })
      expect(
        crashReporterRows.find((row) => row.tag === "CrashReporter.recordBreadcrumb")
      ).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(crashReporterRows.find((row) => row.tag === "CrashReporter.flush")).toMatchObject({
        hostStatus: "routed",
        support: { status: "supported" }
      })
      expect(crashReporterRows.find((row) => row.tag === "CrashReporter.getReports")).toMatchObject(
        {
          hostStatus: "routed",
          support: { status: "supported" }
        }
      )
    })
  ))

test("NativeParityMatrix does not mark missing host methods as supported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* buildNativeParityMatrix()
      const falseSupportedRows = result.rows.filter(
        (row) =>
          row.hostStatus === "missing" &&
          (row.support.status === "supported" || row.support.status === "partial")
      )

      expect(falseSupportedRows).toEqual([])
    })
  ))

test("NativeParityMatrix service exposes generated and missing rows from an injected inventory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const matrix = yield* NativeParityMatrix
          const generated = yield* matrix.generate
          const missing = yield* matrix.missing
          return { generated, missing }
        }),
        Layer.provide(
          makeNativeParityMatrixLayer(testNativeLayer(testSurface("Example.supported"))),
          makeNativeHostMethodInventoryLayer(["Example.supported"])
        )
      )

      expect(result.generated.summary).toMatchObject({
        total: 1,
        routed: 1,
        missing: 0,
        supported: 1
      })
      expect(result.missing).toEqual([])
    })
  ))

test("NativeHostMethodInventory exposes a schema-typed snapshot", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* runScoped(
        Effect.gen(function* () {
          const inventory = yield* NativeHostMethodInventory
          return yield* inventory.snapshot
        }),
        makeNativeHostMethodInventoryLayer(["Example.method"])
      )

      const decoded = yield* Schema.decodeUnknownEffect(NativeHostMethodInventorySnapshot)(snapshot)
      expect(decoded).toEqual(snapshot)
    })
  ))

test("NativeParityMatrix keeps unsupported declarations visible", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* makeNativeParityMatrixResult(
        testNativeLayer(
          testSurface("Example.unsupported", {
            status: "unsupported",
            reason: "host adapter unavailable"
          })
        ),
        new Set()
      )

      expect(result.rows).toEqual([
        expect.objectContaining({
          tag: "Example.unsupported",
          hostStatus: "missing",
          support: {
            status: "unsupported",
            reason: "host adapter unavailable"
          }
        })
      ])
      expect(result.summary).toMatchObject({ total: 1, missing: 1, unsupported: 1 })
    })
  ))

test("NativeParityMatrix maps invalid surface manifests to tagged errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        makeNativeParityMatrixResult(testNativeLayer(testSurfaceWithoutCapability()), new Set())
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(NativeParityMatrixError)(failure?.error)).toBe(true)
        expect(failure?.error).toMatchObject({
          _tag: "NativeParityMatrixError",
          reason: "invalid-manifest",
          tag: "Example.missing"
        })
      }
    })
  ))

test("NativeParityMatrix surfaces host inventory failures as typed errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const hostFailure = new NativeParityMatrixError({
        reason: "invalid-host-inventory",
        message: "router source unavailable"
      })
      const exit = yield* runScopedExit(
        Effect.gen(function* () {
          const matrix = yield* NativeParityMatrix
          return yield* matrix.generate
        }),
        Layer.provide(
          makeNativeParityMatrixLayer(testNativeLayer(testSurface("Example.supported"))),
          Layer.succeed(NativeHostMethodInventory)({
            snapshot: Effect.fail(hostFailure)
          })
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toBe(hostFailure)
      }
    })
  ))

test("Rust host inventory parser reads only the host dispatch registry", () => {
  const hostMethods = routedHostMethodsFromSource(
    'pub const WINDOW_CREATE_METHOD: &str = "Window.create";\npub const WINDOW_FOCUS_METHOD: &str =\n    "Window.focus";\npub const EGRESS_POLICY_RECORD_METHOD: &str = "EgressPolicy.record";\npub const WINDOW_DESTROY_METHOD: &str = "Window.destroy";\n',
    "const HOST_DISPATCH_ROUTES: &[HostMethodRoute] = &[\n  route(host_protocol::EGRESS_POLICY_RECORD_METHOD, HostMethodDispatcher::EgressRecord),\n  route(host_protocol::WINDOW_CREATE_METHOD, HostMethodDispatcher::Window(window::create)),\n  route(host_protocol::WINDOW_FOCUS_METHOD, HostMethodDispatcher::Window(window::focus)),\n];\nconst fn route(method: &'static str, dispatcher: HostMethodDispatcher) -> HostMethodRoute { HostMethodRoute { method, dispatcher } }\n#[test] fn unrelated() { host_protocol::WINDOW_DESTROY_METHOD; }"
  )

  expect([...hostMethods]).toEqual(["EgressPolicy.record", "Window.create", "Window.focus"])
})

test("native parity docs and CLI artifact are generated from current source", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const matrix = yield* buildNativeParityMatrix()
      const committedJson = yield* Effect.promise(() =>
        Bun.file(`${repoRoot}/docs/reference/native/parity-matrix.json`).text()
      )
      const committedCliJson = yield* Effect.promise(() =>
        Bun.file(`${repoRoot}/packages/cli/src/native-parity-matrix.json`).text()
      )
      const committedMarkdown = yield* Effect.promise(() =>
        Bun.file(`${repoRoot}/docs/reference/native/parity-matrix.md`).text()
      )

      const JsonString = Schema.fromJsonString(Schema.Unknown)
      const serializedJson = yield* Schema.encodeEffect(JsonString)(matrix)
      const serializedMatrix = yield* Schema.decodeEffect(JsonString)(serializedJson)
      const committedJsonValue = yield* Schema.decodeEffect(JsonString)(committedJson)
      const committedCliJsonValue = yield* Schema.decodeEffect(JsonString)(committedCliJson)
      expect(committedJsonValue).toEqual(serializedMatrix)
      expect(committedCliJsonValue).toEqual(serializedMatrix)
      expect(committedMarkdown).toBe(formatNativeParityMatrixMarkdown(matrix))
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

const runScoped = <A, E, ELayer, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, ELayer, never>
): Effect.Effect<A, E | ELayer, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

const runScopedExit = <A, E, ELayer, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, ELayer, never>
): Effect.Effect<Exit.Exit<A, E | ELayer>, never, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })
