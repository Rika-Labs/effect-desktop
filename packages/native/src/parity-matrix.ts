import {
  type DesktopNativeLayer,
  NativeHostMethodInventorySnapshot,
  type NativeHostMethodInventorySnapshotType,
  NativeParityMatrixError,
  NativeParityMatrixResult,
  NativeParityMatrixRow,
  NativeParityMatrixSummary,
  type NativeParityCapabilityKind,
  type NativeParityMatrixResultType,
  type NativeParityMatrixRowType,
  type NativeParityReleaseDispositionType
} from "@orika/core"
import { Context, Effect, Layer } from "effect"
import {
  makeNativeCapabilityManifest,
  NativeCapabilityManifestError,
  type NativeCapabilityFact,
  type NativeCapabilitySurface
} from "./capabilities.js"
import { all as NativeAll, available as nativeAvailable } from "./native.js"

export {
  NativeHostMethodInventorySnapshot,
  NativeParityHostStatus,
  NativeParityMatrixError,
  NativeParityMatrixErrorReason,
  NativeParityMatrixResult,
  NativeParityMatrixRow,
  NativeParityMatrixSummary,
  NativeParityPlatform,
  NativeParityPlatformSupport,
  NativeParitySupport,
  NativeParitySupportStatus
} from "@orika/core"
export type {
  NativeHostMethodInventorySnapshotType,
  NativeParityMatrixResultType,
  NativeParityMatrixRowType,
  NativeParityMatrixSummaryType
} from "@orika/core"

export interface NativeHostMethodInventoryApi {
  readonly snapshot: Effect.Effect<
    NativeHostMethodInventorySnapshotType,
    NativeParityMatrixError,
    never
  >
}

export class NativeHostMethodInventory extends Context.Service<
  NativeHostMethodInventory,
  NativeHostMethodInventoryApi
>()("@orika/native/parity-matrix/NativeHostMethodInventory") {}

export interface NativeParityMatrixApi {
  readonly generate: Effect.Effect<NativeParityMatrixResultType, NativeParityMatrixError, never>
  readonly missing: Effect.Effect<
    readonly NativeParityMatrixRowType[],
    NativeParityMatrixError,
    never
  >
}

export class NativeParityMatrix extends Context.Service<
  NativeParityMatrix,
  NativeParityMatrixApi
>()("@orika/native/parity-matrix/NativeParityMatrix") {}

export const makeNativeHostMethodInventoryLayer = (
  methods: Iterable<string>
): Layer.Layer<NativeHostMethodInventory, never, never> =>
  Layer.succeed(
    NativeHostMethodInventory,
    Object.freeze({
      snapshot: Effect.succeed(
        new NativeHostMethodInventorySnapshot({
          methods: Object.freeze([...methods].toSorted())
        })
      )
    })
  )

export const makeNativeParityMatrix = (
  surfaces: Iterable<NativeCapabilitySurface>,
  hostMethods: ReadonlySet<string>
): Effect.Effect<NativeParityMatrixApi, NativeParityMatrixError, never> =>
  makeNativeParityMatrixResult(surfaces, hostMethods).pipe(
    Effect.map((result) =>
      Object.freeze({
        generate: Effect.succeed(result),
        missing: Effect.succeed(
          Object.freeze(result.rows.filter((row) => row.hostStatus === "missing"))
        )
      })
    )
  )

export const makeNativeParityMatrixLayer = (
  nativeLayer: DesktopNativeLayer = nativeAvailable(NativeAll)
): Layer.Layer<NativeParityMatrix, NativeParityMatrixError, NativeHostMethodInventory> =>
  Layer.effect(
    NativeParityMatrix,
    Effect.gen(function* () {
      const inventory = yield* NativeHostMethodInventory
      const snapshot = yield* inventory.snapshot
      return yield* makeNativeParityMatrix(
        snapshotNativeCapabilitySurfacesSync(nativeLayer),
        new Set(snapshot.methods)
      )
    })
  )

export const makeNativeParityMatrixResult = (
  surfaces: Iterable<NativeCapabilitySurface>,
  hostMethods: ReadonlySet<string>
): Effect.Effect<NativeParityMatrixResultType, NativeParityMatrixError, never> =>
  makeNativeCapabilityManifest(surfaces).pipe(
    Effect.mapError(parityMatrixManifestError),
    Effect.map((manifest) => matrixFromManifest(manifest, hostMethods))
  )

const matrixFromManifest = (
  manifest: readonly NativeCapabilityFact[],
  hostMethods: ReadonlySet<string>
): NativeParityMatrixResultType => {
  const rows = manifest
    .map((fact) => rowFromFact(fact, hostMethods))
    .toSorted((left, right) => left.tag.localeCompare(right.tag))
  const summary = rows.reduce(
    (current, row) => ({
      total: current.total + 1,
      routed: current.routed + (row.hostStatus === "routed" ? 1 : 0),
      missing: current.missing + (row.hostStatus === "missing" ? 1 : 0),
      supported: current.supported + (row.support.status === "supported" ? 1 : 0),
      partial: current.partial + (row.support.status === "partial" ? 1 : 0),
      unsupported: current.unsupported + (row.support.status === "unsupported" ? 1 : 0),
      releaseComplete: current.releaseComplete + (row.release.status === "complete" ? 1 : 0),
      releaseTracked: current.releaseTracked + (row.release.status === "tracked" ? 1 : 0),
      releaseUntracked: current.releaseUntracked + (row.release.status === "untracked" ? 1 : 0)
    }),
    {
      total: 0,
      routed: 0,
      missing: 0,
      supported: 0,
      partial: 0,
      unsupported: 0,
      releaseComplete: 0,
      releaseTracked: 0,
      releaseUntracked: 0
    }
  )

  return new NativeParityMatrixResult({
    rows: Object.freeze(rows),
    summary: new NativeParityMatrixSummary(summary)
  })
}

const rowFromFact = (
  fact: NativeCapabilityFact,
  hostMethods: ReadonlySet<string>
): NativeParityMatrixRowType => {
  const separator = fact.tag.indexOf(".")
  const surface = separator === -1 ? fact.tag : fact.tag.slice(0, separator)
  const method = separator === -1 ? fact.tag : fact.tag.slice(separator + 1)
  const hostMethod = hostMethodForNativeTag(fact.tag)
  const hostStatus = !fact.callable
    ? "capability-fact"
    : hostMethods.has(hostMethod)
      ? "routed"
      : "missing"

  return new NativeParityMatrixRow({
    tag: fact.tag,
    surface,
    method,
    capability: nativeParityCapabilityKind(fact.capability.kind),
    support: fact.support,
    hostStatus,
    release: releaseDispositionFor(surface, fact.support.status),
    ...(hostMethod === fact.tag ? {} : { hostMethod })
  })
}

const releaseIssueBySurface = new Map<string, { readonly issue: number; readonly url: string }>(
  [
    "BrowsingData",
    "CookieStore",
    "SessionPermission",
    "SessionProfile",
    "WebRequest",
    "WebView"
  ].map((surface) => [
    surface,
    { issue: 1439, url: "https://github.com/Rika-Labs/effect-desktop/issues/1439" }
  ])
)

for (const surface of ["Download", "NativeNetwork", "NetworkAuth"]) {
  releaseIssueBySurface.set(surface, {
    issue: 1440,
    url: "https://github.com/Rika-Labs/effect-desktop/issues/1440"
  })
}

for (const surface of ["ContextMenu", "Dock", "GlobalShortcut", "Menu"]) {
  releaseIssueBySurface.set(surface, {
    issue: 1441,
    url: "https://github.com/Rika-Labs/effect-desktop/issues/1441"
  })
}

for (const surface of ["Dialog", "Notification", "Shell", "Tray", "Window"]) {
  releaseIssueBySurface.set(surface, {
    issue: 1442,
    url: "https://github.com/Rika-Labs/effect-desktop/issues/1442"
  })
}

for (const surface of [
  "Association",
  "FocusedApplicationContext",
  "RecentDocuments",
  "ScopedAccessGrant",
  "SelectionContext",
  "TransientWindowRole"
]) {
  releaseIssueBySurface.set(surface, {
    issue: 1443,
    url: "https://github.com/Rika-Labs/effect-desktop/issues/1443"
  })
}

for (const surface of ["EgressPolicy", "ExecutionSandbox"]) {
  releaseIssueBySurface.set(surface, {
    issue: 1444,
    url: "https://github.com/Rika-Labs/effect-desktop/issues/1444"
  })
}

for (const surface of [
  "CrashReporter",
  "DisplayCapture",
  "PowerMonitor",
  "RealtimeMediaSession",
  "SystemAppearance",
  "Updater"
]) {
  releaseIssueBySurface.set(surface, {
    issue: 1445,
    url: "https://github.com/Rika-Labs/effect-desktop/issues/1445"
  })
}

const releaseDispositionFor = (
  surface: string,
  supportStatus: NativeCapabilityFact["support"]["status"]
): NativeParityReleaseDispositionType => {
  if (supportStatus === "supported") {
    return { status: "complete" }
  }
  const issue = releaseIssueBySurface.get(surface)
  if (issue !== undefined) {
    return { status: "tracked", ...issue }
  }
  return {
    status: "untracked",
    reason: `partial or unsupported native surface ${surface} has no release issue`
  }
}

const hostMethodForNativeTag = (tag: string): string => {
  switch (tag) {
    case "Window.close":
      return "Window.destroy"
    case "Window.subscribeEvents":
      return "Window.Event"
    default:
      return tag
  }
}

const nativeParityCapabilityKind = (kind: string): NativeParityCapabilityKind =>
  kind === "none" ? "none" : "native"

const parityMatrixManifestError = (error: NativeCapabilityManifestError): NativeParityMatrixError =>
  new NativeParityMatrixError({
    reason: "invalid-manifest",
    tag: error.tag,
    message: error.message
  })

function snapshotNativeCapabilitySurfacesSync(
  nativeLayer: DesktopNativeLayer
): readonly NativeCapabilitySurface[] {
  return nativeLayer.map((registration) => Object.freeze({ schemaDocs: registration.schemaDocs }))
}
