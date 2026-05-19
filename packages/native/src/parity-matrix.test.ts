import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { expect, test } from "bun:test"
import type { RpcCapabilityMetadata, RpcSupportMetadata } from "@effect-desktop/bridge"
import { type DesktopNativeLayer, type DesktopRpcSchemaDoc } from "@effect-desktop/core"
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect"

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

const repoRoot = join(import.meta.dir, "../../..")
const hostProtocolPath = join(repoRoot, "crates/host-protocol/src/lib.rs")
const hostRouterPath = join(repoRoot, "crates/host/src/methods/mod.rs")

const readRoutedHostMethods = async (): Promise<ReadonlySet<string>> => {
  const [protocolSource, routerSource] = await Promise.all([
    readFile(hostProtocolPath, "utf8"),
    readFile(hostRouterPath, "utf8")
  ])
  return routedHostMethodsFromSource(protocolSource, routerSource)
}

const buildNativeParityMatrix = async (): Promise<NativeParityMatrixResultType> => {
  const hostMethods = await readRoutedHostMethods()
  return Effect.runPromise(makeNativeParityMatrixResult(Native.all.surfaces, hostMethods))
}

test("NativeParityMatrix reports declared TypeScript methods against the Rust host registry", async () => {
  const hostMethods = await readRoutedHostMethods()
  const result = await Effect.runPromise(
    makeNativeParityMatrixResult(Native.all.surfaces, hostMethods)
  )

  expect(Schema.decodeUnknownSync(NativeParityMatrixResult)(result)).toEqual(result)
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
  expect(result.rows.find((row) => row.tag === "App.quit")).toMatchObject({
    hostStatus: "routed",
    support: { status: "supported" }
  })
  for (const tag of ["App.requestSingleInstanceLock", "App.restart"]) {
    expect(result.rows.find((row) => row.tag === tag)).toMatchObject({
      hostStatus: "routed",
      support: { status: "unsupported", reason: "host-adapter-unimplemented" }
    })
  }
  expect(result.rows.find((row) => row.tag === "Clipboard.readText")).toMatchObject({
    hostStatus: "routed",
    support: { status: "unsupported", reason: "host-adapter-unimplemented" }
  })
  expect(result.rows.find((row) => row.tag === "WebView.create")).toMatchObject({
    hostStatus: "routed",
    support: { status: "unsupported", reason: "host-adapter-unimplemented" }
  })
  expect(result.rows.find((row) => row.tag === "Menu.setApplicationMenu")).toMatchObject({
    hostStatus: "routed",
    support: { status: "supported" }
  })
  expect(result.rows.find((row) => row.tag === "Menu.clear")).toMatchObject({
    hostStatus: "routed",
    support: { status: "unsupported", reason: "host-adapter-unimplemented" }
  })
  expect(result.rows.find((row) => row.tag === "ContextMenu.show")).toMatchObject({
    hostStatus: "routed",
    support: { status: "unsupported", reason: "host-adapter-unimplemented" }
  })
  expect(result.rows.find((row) => row.tag === "SafeStorage.isAvailable")).toMatchObject({
    hostStatus: "routed",
    support: { status: "supported" }
  })
  expect(result.rows.find((row) => row.tag === "SafeStorage.set")).toMatchObject({
    hostStatus: "routed",
    support: { status: "unsupported", reason: "host-adapter-unimplemented" }
  })
  expect(result.rows.find((row) => row.tag === "Updater.check")).toMatchObject({
    hostStatus: "routed",
    support: { status: "unsupported", reason: "host-adapter-unimplemented" }
  })
  expect(result.rows.find((row) => row.tag === "CrashReporter.start")).toMatchObject({
    hostStatus: "routed",
    support: { status: "unsupported", reason: "host-adapter-unimplemented" }
  })
  expect(result.rows.find((row) => row.tag === "PowerMonitor.isSupported")).toMatchObject({
    hostStatus: "routed",
    support: { status: "unsupported", reason: "host-adapter-unimplemented" }
  })
  expect(result.rows.find((row) => row.tag === "SystemAppearance.getAppearance")).toMatchObject({
    hostStatus: "routed",
    support: { status: "partial", reason: "macos-system-appearance-snapshot" }
  })
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
  expect(result.rows.find((row) => row.tag === "EgressPolicy.record")).toMatchObject({
    hostStatus: "routed"
  })
})

test("NativeParityMatrix does not mark missing host methods as supported", async () => {
  const result = await buildNativeParityMatrix()
  const falseSupportedRows = result.rows.filter(
    (row) =>
      row.hostStatus === "missing" &&
      (row.support.status === "supported" || row.support.status === "partial")
  )

  expect(falseSupportedRows).toEqual([])
})

test("NativeParityMatrix service exposes generated and missing rows from an injected inventory", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const matrix = yield* NativeParityMatrix
      const generated = yield* matrix.generate
      const missing = yield* matrix.missing
      return { generated, missing }
    }).pipe(
      Effect.provide(
        Layer.provide(
          makeNativeParityMatrixLayer(testNativeLayer(testSurface("Example.supported"))),
          makeNativeHostMethodInventoryLayer(["Example.supported"])
        )
      )
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

test("NativeHostMethodInventory exposes a schema-typed snapshot", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const inventory = yield* NativeHostMethodInventory
      return yield* inventory.snapshot
    }).pipe(Effect.provide(makeNativeHostMethodInventoryLayer(["Example.method"])))
  )

  expect(Schema.decodeUnknownSync(NativeHostMethodInventorySnapshot)(snapshot)).toEqual(snapshot)
})

test("NativeParityMatrix keeps unsupported declarations visible", async () => {
  const result = await Effect.runPromise(
    makeNativeParityMatrixResult(
      testNativeLayer(
        testSurface("Example.unsupported", {
          status: "unsupported",
          reason: "host adapter unavailable"
        })
      ),
      new Set()
    )
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

test("NativeParityMatrix maps invalid surface manifests to tagged errors", async () => {
  const exit = await Effect.runPromiseExit(
    makeNativeParityMatrixResult(testNativeLayer(testSurfaceWithoutCapability()), new Set())
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(NativeParityMatrixError)
    expect(failure?.error).toMatchObject({
      _tag: "NativeParityMatrixError",
      reason: "invalid-manifest",
      tag: "Example.missing"
    })
  }
})

test("NativeParityMatrix surfaces host inventory failures as typed errors", async () => {
  const hostFailure = new NativeParityMatrixError({
    reason: "invalid-host-inventory",
    message: "router source unavailable"
  })
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const matrix = yield* NativeParityMatrix
      return yield* matrix.generate
    }).pipe(
      Effect.provide(
        Layer.provide(
          makeNativeParityMatrixLayer(testNativeLayer(testSurface("Example.supported"))),
          Layer.succeed(NativeHostMethodInventory)({
            snapshot: Effect.fail(hostFailure)
          })
        )
      )
    )
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBe(hostFailure)
  }
})

test("Rust host inventory parser reads only the host dispatch registry", () => {
  const hostMethods = routedHostMethodsFromSource(
    'pub const WINDOW_CREATE_METHOD: &str = "Window.create";\npub const WINDOW_FOCUS_METHOD: &str =\n    "Window.focus";\npub const EGRESS_POLICY_RECORD_METHOD: &str = "EgressPolicy.record";\npub const WINDOW_DESTROY_METHOD: &str = "Window.destroy";\n',
    "const HOST_DISPATCH_ROUTES: &[HostMethodRoute] = &[\n  route(host_protocol::EGRESS_POLICY_RECORD_METHOD, HostMethodDispatcher::EgressRecord),\n  route(host_protocol::WINDOW_CREATE_METHOD, HostMethodDispatcher::Window(window::create)),\n  route(host_protocol::WINDOW_FOCUS_METHOD, HostMethodDispatcher::Window(window::focus)),\n];\nconst fn route(method: &'static str, dispatcher: HostMethodDispatcher) -> HostMethodRoute { HostMethodRoute { method, dispatcher } }\n#[test] fn unrelated() { host_protocol::WINDOW_DESTROY_METHOD; }"
  )

  expect([...hostMethods]).toEqual(["EgressPolicy.record", "Window.create", "Window.focus"])
})

test("native parity docs and CLI artifact are generated from current source", async () => {
  const [matrix, committedJson, committedCliJson, committedMarkdown] = await Promise.all([
    buildNativeParityMatrix(),
    readFile(join(repoRoot, "docs/reference/native/parity-matrix.json"), "utf8"),
    readFile(join(repoRoot, "packages/cli/src/native-parity-matrix.json"), "utf8"),
    readFile(join(repoRoot, "docs/reference/native/parity-matrix.md"), "utf8")
  ])

  expect(JSON.parse(committedJson)).toEqual(JSON.parse(JSON.stringify(matrix)))
  expect(JSON.parse(committedCliJson)).toEqual(JSON.parse(JSON.stringify(matrix)))
  expect(committedMarkdown).toBe(formatNativeParityMatrixMarkdown(matrix))
})

const testSurface = (
  tag: string,
  support: RpcSupportMetadata = { status: "supported" },
  capability: RpcCapabilityMetadata | undefined = { kind: "none" }
) =>
  Object.freeze({
    schemaDocs: Object.freeze([
      Object.freeze({
        name: tag.slice(tag.lastIndexOf(".") + 1),
        tag,
        kind: "mutation",
        payload: Schema.Void,
        success: Schema.Void,
        error: Schema.Void,
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
        payload: Schema.Void,
        success: Schema.Void,
        error: Schema.Void,
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
