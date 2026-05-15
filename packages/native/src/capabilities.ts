import { rpcSupport, type RpcSupportMetadata } from "@effect-desktop/bridge"
import { Context, Data, Effect, Layer } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import { AppRpcs } from "./app.js"
import { ClipboardRpcs } from "./clipboard.js"
import { ContextMenuRpcs } from "./context-menu.js"
import { CrashReporterRpcs } from "./crash-reporter.js"
import { DialogRpcs } from "./dialog.js"
import { DockRpcs } from "./dock.js"
import { GlobalShortcutRpcs } from "./global-shortcut.js"
import { MenuRpcs } from "./menu.js"
import { NotificationRpcs } from "./notification.js"
import { PathRpcs } from "./path.js"
import { PowerMonitorRpcs } from "./power-monitor.js"
import { ProtocolRpcs } from "./protocol.js"
import { SafeStorageRpcs } from "./safe-storage.js"
import { ScreenRpcs } from "./screen.js"
import { ShellRpcs } from "./shell.js"
import { SystemAppearanceRpcs } from "./system-appearance.js"
import { TrayRpcs } from "./tray.js"
import { UpdaterRpcs } from "./updater.js"
import { WebViewRpcs } from "./webview.js"
import { WindowRpcs } from "./window.js"

export type NativeCapabilitySupport = RpcSupportMetadata

export interface NativeCapabilityFact {
  readonly tag: string
  readonly support: NativeCapabilitySupport
}

type NativeCapabilityGroup = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.Any>
}

export class NativeCapabilityLookupError extends Data.TaggedError("NativeCapabilityLookupError")<{
  readonly tag: string
  readonly message: string
}> {}

export class NativeCapabilityManifestError extends Data.TaggedError(
  "NativeCapabilityManifestError"
)<{
  readonly tag: string
  readonly message: string
}> {}

export class UnsupportedCapability extends Data.TaggedError("UnsupportedCapability")<{
  readonly tag: string
  readonly reason: string
  readonly message: string
}> {}

export interface NativeCapabilitiesApi {
  readonly manifest: readonly NativeCapabilityFact[]
  readonly support: (
    tag: string
  ) => Effect.Effect<NativeCapabilitySupport, NativeCapabilityLookupError, never>
  readonly require: (
    tag: string
  ) => Effect.Effect<void, NativeCapabilityLookupError | UnsupportedCapability, never>
}

export class NativeCapabilities extends Context.Service<
  NativeCapabilities,
  NativeCapabilitiesApi
>()("@effect-desktop/native/NativeCapabilities") {}

const NativeCapabilityGroups: readonly NativeCapabilityGroup[] = Object.freeze([
  AppRpcs,
  ClipboardRpcs,
  ContextMenuRpcs,
  CrashReporterRpcs,
  DialogRpcs,
  DockRpcs,
  GlobalShortcutRpcs,
  MenuRpcs,
  NotificationRpcs,
  PathRpcs,
  PowerMonitorRpcs,
  ProtocolRpcs,
  SafeStorageRpcs,
  ScreenRpcs,
  ShellRpcs,
  SystemAppearanceRpcs,
  TrayRpcs,
  UpdaterRpcs,
  WebViewRpcs,
  WindowRpcs
])

export const makeNativeCapabilityManifest = (
  groups: Iterable<NativeCapabilityGroup>
): Effect.Effect<readonly NativeCapabilityFact[], NativeCapabilityManifestError, never> =>
  Effect.suspend(() => {
    const seen = new Set<string>()
    const facts: NativeCapabilityFact[] = []

    for (const group of groups) {
      for (const rpc of group.requests.values()) {
        if (seen.has(rpc._tag)) {
          return Effect.fail(
            new NativeCapabilityManifestError({
              tag: rpc._tag,
              message: `duplicate native capability tag: ${rpc._tag}`
            })
          )
        }
        seen.add(rpc._tag)
        facts.push(
          Object.freeze({
            tag: rpc._tag,
            support: freezeSupport(rpcSupport(rpc))
          })
        )
      }
    }

    return Effect.succeed(Object.freeze(facts))
  })

export const makeNativeCapabilities = (
  groups: Iterable<NativeCapabilityGroup>
): Effect.Effect<NativeCapabilitiesApi, NativeCapabilityManifestError, never> =>
  makeNativeCapabilityManifest(groups).pipe(Effect.map(capabilitiesFromManifest))

export const makeNativeCapabilitiesLayer = (
  groups: Iterable<NativeCapabilityGroup> = NativeCapabilityGroups
): Layer.Layer<NativeCapabilities, NativeCapabilityManifestError, never> =>
  Layer.effect(NativeCapabilities, makeNativeCapabilities(groups))

export const NativeCapabilitiesLive: Layer.Layer<
  NativeCapabilities,
  NativeCapabilityManifestError,
  never
> = makeNativeCapabilitiesLayer()

function capabilitiesFromManifest(
  manifest: readonly NativeCapabilityFact[]
): NativeCapabilitiesApi {
  const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

  const support = (
    tag: string
  ): Effect.Effect<NativeCapabilitySupport, NativeCapabilityLookupError, never> =>
    Effect.suspend(() => {
      const fact = byTag.get(tag)
      if (fact === undefined) {
        return Effect.fail(
          new NativeCapabilityLookupError({
            tag,
            message: `unknown native capability tag: ${tag}`
          })
        )
      }
      return Effect.succeed(fact.support)
    })

  return Object.freeze({
    manifest,
    support,
    require: (tag: string) =>
      support(tag).pipe(
        Effect.flatMap((metadata) =>
          metadata.status === "supported"
            ? Effect.void
            : Effect.fail(unsupportedCapability(tag, metadata))
        )
      )
  })
}

const freezeSupport = (support: RpcSupportMetadata): NativeCapabilitySupport =>
  support.status === "supported"
    ? Object.freeze({ status: "supported" })
    : Object.freeze({ status: "unsupported", reason: support.reason })

const unsupportedCapability = (
  tag: string,
  support: Extract<RpcSupportMetadata, { readonly status: "unsupported" }>
): UnsupportedCapability =>
  new UnsupportedCapability({
    tag,
    reason: support.reason,
    message: `unsupported native capability: ${tag}`
  })
