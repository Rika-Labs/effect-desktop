import { expect, test } from "bun:test"
import {
  HostProtocolResponseEnvelope,
  HostProtocolRequestEnvelope,
  makeDesktopClientProtocol,
  makeDesktopServerProtocol,
  RpcCapability,
  RpcEndpoint,
  RpcSupport,
  type HostProtocolEnvelope
} from "@effect-desktop/bridge"
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import { BunServices } from "@effect/platform-bun"
import { NodeServices } from "@effect/platform-node"
import { Cause, Context, Effect, Exit, FileSystem, Layer, Path, Queue, Schema } from "effect"
import type { Scope } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import type { Socket } from "effect/unstable/socket"
import { Reactivity } from "effect/unstable/reactivity"
import { WorkflowEngine } from "effect/unstable/workflow"
import type * as RuntimeTransport from "@effect-desktop/core/runtime/transport"
import type {
  DesktopNativeLayer,
  DesktopPermissionsLayer,
  DesktopProvidersLayer,
  DesktopProviderRegistry,
  DesktopRpcsLayer,
  DesktopRuntimeProviderServices,
  DesktopWindowsLayer,
  DesktopWorkflowEngineLayer,
  DesktopWorkflowLayer,
  DesktopWorkflowsLayer
} from "./runtime/desktop-app.js"
import type { DesktopNativeRegistry } from "./runtime/desktop-native-registry.js"
import type { DesktopPermissionRegistry } from "./runtime/desktop-permission-registry.js"
import type { DesktopRpcRegistry } from "./runtime/desktop-rpc-registry.js"
import type { DesktopWindowRegistry } from "./runtime/desktop-window-registry.js"
import type { DesktopWorkflowRegistry } from "./runtime/desktop-workflow-registry.js"
import type { DesktopRpcClient, SupportedDesktopRpcClient } from "./runtime/desktop-rpc-surface.js"

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
type TransportConnectContract = Assert<
  IsEqual<
    ReturnType<RuntimeTransport.TransportApi["connect"]>,
    Effect.Effect<
      RuntimeTransport.TransportConnection,
      RuntimeTransport.TransportError,
      Socket.Socket | Scope.Scope
    >
  >
>
const transportConnectContract: TransportConnectContract = true
type BunProviderServicesContract = Assert<
  IsEqual<Layer.Success<typeof BunServices.layer>, DesktopRuntimeProviderServices>
>
type NodeProviderServicesContract = Assert<
  IsEqual<Layer.Success<typeof NodeServices.layer>, DesktopRuntimeProviderServices>
>
type DurableWorkflowEngineContract = Assert<
  IsEqual<
    typeof import("./index.js").WorkflowEngineDurable,
    DesktopWorkflowEngineLayer<SqlClient, SqlError>
  >
>
interface WindowDependency {
  readonly _tag: "WindowDependency"
}
interface RpcDependency {
  readonly _tag: "RpcDependency"
}
interface WorkflowDependency {
  readonly _tag: "WorkflowDependency"
}
type PermissionDeclarationServicesContract = Assert<
  IsEqual<Layer.Services<DesktopPermissionsLayer>, DesktopPermissionRegistry>
>
type ProviderDeclarationServicesContract = Assert<
  IsEqual<Layer.Services<DesktopProvidersLayer>, DesktopProviderRegistry>
>
type NativeDeclarationServicesContract = Assert<
  IsEqual<Layer.Services<DesktopNativeLayer>, DesktopNativeRegistry>
>
type WindowDeclarationServicesContract = Assert<
  IsEqual<Layer.Services<DesktopWindowsLayer<WindowDependency>>, DesktopWindowRegistry>
>
type RpcDeclarationServicesContract = Assert<
  IsEqual<Layer.Services<DesktopRpcsLayer<Error, RpcDependency>>, DesktopRpcRegistry>
>
type WorkflowDeclarationServicesContract = Assert<
  IsEqual<
    Layer.Services<DesktopWorkflowLayer<WorkflowDependency, Error>>,
    WorkflowDependency | WorkflowEngine.WorkflowEngine
  >
>
type WorkflowRegistrationServicesContract = Assert<
  IsEqual<Layer.Services<DesktopWorkflowsLayer<WorkflowDependency, Error>>, DesktopWorkflowRegistry>
>
const bunProviderServicesContract: BunProviderServicesContract = true
const nodeProviderServicesContract: NodeProviderServicesContract = true
const durableWorkflowEngineContract: DurableWorkflowEngineContract = true
const permissionDeclarationServicesContract: PermissionDeclarationServicesContract = true
const providerDeclarationServicesContract: ProviderDeclarationServicesContract = true
const nativeDeclarationServicesContract: NativeDeclarationServicesContract = true
const windowDeclarationServicesContract: WindowDeclarationServicesContract = true
const rpcDeclarationServicesContract: RpcDeclarationServicesContract = true
const workflowDeclarationServicesContract: WorkflowDeclarationServicesContract = true
const workflowRegistrationServicesContract: WorkflowRegistrationServicesContract = true
const runtimeProviderServicesContracts = [
  bunProviderServicesContract,
  nodeProviderServicesContract
] as const
const declarationLayerContracts = [
  permissionDeclarationServicesContract,
  providerDeclarationServicesContract,
  nativeDeclarationServicesContract,
  windowDeclarationServicesContract,
  rpcDeclarationServicesContract,
  workflowDeclarationServicesContract,
  workflowRegistrationServicesContract
] as const
// @ts-expect-error FramedTransport was removed from the public runtime transport subpath.
type _RemovedFramedTransport = RuntimeTransport.FramedTransport
// @ts-expect-error FramedTransportOptions was replaced by the narrower FrameCodecOptions name.
type _RemovedFramedTransportOptions = RuntimeTransport.FramedTransportOptions

test("public barrel exports the ResourceRegistry factory", async () => {
  const core = await import("./index.js")

  expect(runtimeProviderServicesContracts).toEqual([true, true])
  expect(declarationLayerContracts).toEqual([true, true, true, true, true, true, true])
  expect(core.makeResourceRegistry).toBeFunction()
  expect(core.makeProcess).toBeFunction()
  expect(core.ProcessLive).toBeDefined()
  expect(core.makeApprovalBroker).toBeFunction()
  expect(core.makeAuditEvents).toBeFunction()
  expect(core.makeCommandRegistry).toBeFunction()
  expect(Layer.isLayer(core.WorkflowEngineMemory)).toBe(true)
  expect(Layer.isLayer(core.WorkflowEngineDurable)).toBe(true)
  expect(durableWorkflowEngineContract).toBe(true)
})

test("workflow engine layers separate memory and durable storage requirements", async () => {
  const core = await import("./index.js")
  const memoryRuntime = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* WorkflowEngine.WorkflowEngine
      }).pipe(Effect.provide(core.WorkflowEngineMemory))
    )
  )

  expect(memoryRuntime).toBeDefined()
  expect(Layer.isLayer(core.Desktop.WorkflowEngineMemory)).toBe(true)
  expect(Layer.isLayer(core.Desktop.WorkflowEngineDurable)).toBe(true)

  const durableRuntime = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* WorkflowEngine.WorkflowEngine
      }).pipe(
        Effect.provide(core.WorkflowEngineDurable),
        Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
        Effect.provide(Reactivity.layer)
      )
    )
  )

  expect(durableRuntime).toBeDefined()
})

test("public barrel keeps low-level runtime plumbing behind subpaths", async () => {
  const core = await import("./index.js")

  expect("FrameDecoder" in core).toBe(false)
  expect("encodeFrame" in core).toBe(false)
  expect("layerStdioSocket" in core).toBe(false)
  expect("makeDesktopRendererRpcRuntime" in core).toBe(false)
  expect("describeRpcs" in core).toBe(false)
  expect("EventJournalMemoryLive" in core).toBe(false)
  expect("EventJournalSqlLive" in core).toBe(false)
  expect("ReactivityLayer" in core).toBe(false)
  expect("mutation" in core).toBe(false)
  expect("WorkflowEngineLive" in core).toBe(false)
  expect("WorkflowLayer" in core).toBe(false)
  expect("Activity" in core).toBe(false)
  expect("DurableClock" in core).toBe(false)
  expect("DurableDeferred" in core).toBe(false)
  expect("Workflow" in core).toBe(false)
})

test("public barrel keeps optional runtime provider layers behind provider subpaths", async () => {
  const core = await import("./index.js")
  const bunProvider = await import("@effect-desktop/core/providers/bun")
  const nodeProvider = await import("@effect-desktop/core/providers/node")
  const testProvider = await import("@effect-desktop/core/providers/test")

  expect("BunRuntimeProviderLayer" in core).toBe(false)
  expect("NodeRuntimeProviderLayer" in core).toBe(false)
  expect("TestRuntimeProviderLayer" in core).toBe(false)
  expect(Layer.isLayer(core.providerLayerFor({ runtime: "test" }))).toBe(true)
  expect(Layer.isLayer(bunProvider.BunRuntimeProviderLayer)).toBe(true)
  expect(Layer.isLayer(nodeProvider.NodeRuntimeProviderLayer)).toBe(true)
  expect(Layer.isLayer(testProvider.TestRuntimeProviderLayer)).toBe(true)
})

test("runtime transport subpath exposes framed transport helpers", async () => {
  const transport = await import("@effect-desktop/core/runtime/transport")

  expect(transport.FrameDecoder).toBeFunction()
  expect(transport.encodeFrame).toBeFunction()
  expect(transport.makeFramedSocketConnection).toBeFunction()
  expect(transportConnectContract).toBe(true)
  expect("createFramedTransport" in transport).toBe(false)
  expect("createBunStdioTransport" in transport).toBe(false)
  expect("makeConnection" in transport).toBe(false)
})

test("deleted zero-policy runtime wrapper subpaths are not exported", async () => {
  for (const module of ["reactivity", "workflow"]) {
    const specifier = "@effect-desktop/core/runtime/" + module
    const rejected = await import(specifier).then(
      () => false,
      () => true
    )
    expect(rejected).toBe(true)
  }
})

test("runtime event-log subpath exposes desktop policy without raw journal shortcuts", async () => {
  const eventLog = await import("@effect-desktop/core/runtime/event-log")

  expect(eventLog.DesktopEventLog).toBeDefined()
  expect(eventLog.DesktopEventSchema).toBeDefined()
  expect(eventLog.DesktopEventLogLive).toBeFunction()
  expect("EventJournal" in eventLog).toBe(false)
  expect("SqlEventJournal" in eventLog).toBe(false)
  expect("EventLog" in eventLog).toBe(false)
})

test("public Desktop facade exposes Rpc metadata helpers", async () => {
  const core = await import("./index.js")

  expect(core.Desktop.RpcEndpoint.query).toBeFunction()
  expect(core.Desktop.RpcCapability).toBeFunction()
  expect(core.Desktop.RpcSupport.unsupported).toBeFunction()
  expect(core.Desktop.Rpc.supportedGroup).toBeFunction()
  expect(core.Desktop.RedactionFilter.redact({ token: "abc" }) as unknown).toEqual({
    token: core.Desktop.RedactionFilter.redactedValue
  })
})

test("framework boundary errors carry public diagnostic fields", async () => {
  const core = await import("./index.js")
  const error = core.makeMissingDesktopContextError(
    "react",
    "ReactDesktopRoot is required before useDesktop(group)"
  )

  expect(error).toBeInstanceOf(core.MissingDesktopContextError)
  expect(error).toMatchObject({
    code: "EDESKTOP_MISSING_CONTEXT",
    category: "usage",
    summary: "Desktop framework context is missing.",
    actor: "renderer",
    details: { framework: "react" }
  })
  expect(error.remediation).toContain("react")
  expect(error.docsUrl).toContain("docs/typed-apis.md")
})

test("Desktop.make returns metadata descriptor and Desktop.app returns the runtime Layer", async () => {
  const core = await import("./index.js")
  const app = core.Desktop.make({
    id: "notes",
    providers: core.Desktop.provider(core.Desktop.Provider.Runtime.test),
    windows: core.Desktop.window("main", { title: "Notes", renderer: "/" })
  })

  expect(app._tag).toBe("DesktopAppDescriptor")
  expect(app.id).toBe("notes")
  expect(core.Desktop.manifest(app).windows["main"]?.title).toBe("Notes")
  expect(core.Desktop.manifest(app).windows["main"]?.renderer).toBe("/")
  expect(Layer.isLayer(app.providers)).toBe(true)
  expect("pipe" in app).toBe(false)
  expect("layers" in app).toBe(false)
  expect(Layer.isLayer(core.Desktop.app(app))).toBe(true)

  const runtime = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* core.DesktopRuntime
      }).pipe(
        Effect.provide(
          core.Desktop.app(app) as unknown as Layer.Layer<
            InstanceType<typeof core.DesktopRuntime>,
            InstanceType<typeof core.DesktopSpineConfigError>,
            never
          >
        )
      )
    )
  )
  expect(runtime.providers).toEqual({ runtime: "test", webview: "system" })
})

test("Desktop.runtimeGraph exposes selected providers and composition nodes without launching", async () => {
  const core = await import("./index.js")
  const Ping = Rpc.make("Notes.Graph.Ping", { success: Schema.String })
  const NotesRpcs = RpcGroup.make(Ping)
  const graph = await Effect.runPromise(
    core.Desktop.runtimeGraph({
      id: "notes",
      windows: core.Desktop.window("main", { title: "Notes" }),
      providers: core.Desktop.provider(core.Desktop.Provider.Runtime.test),
      rpcs: core.Desktop.rpc(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Graph.Ping": () => Effect.succeed("pong")
        })
      ),
      workflows: core.Desktop.workflow(Layer.empty as DesktopWorkflowLayer)
    })
  )

  expect(graph).toMatchObject({
    _tag: "DesktopRuntimeGraph",
    appId: "notes",
    providers: { runtime: "test", webview: "system" },
    providerBudgets: [
      {
        id: "test",
        kind: "runtime",
        package: "@effect-desktop/core",
        importPath: "@effect-desktop/core/providers/test",
        startupBudgetMs: 25,
        bundleBudgetKb: 64
      }
    ]
  })
  expect(graph.nodes.map((node) => [node.id, node.kind])).toEqual([
    ["provider:runtime:test", "provider"],
    ["provider:webview:system", "provider"],
    ["core:resources", "core-service"],
    ["core:telemetry", "core-service"],
    ["core:permissions", "core-service"],
    ["core:reactivity", "core-service"],
    ["core:logger", "core-service"],
    ["core:workflow", "core-service"],
    ["rpc-layer:0", "rpc-layer"],
    ["workflow:0", "workflow"],
    ["service:DesktopApp", "app-service"],
    ["service:DesktopRuntime", "runtime-service"]
  ])
  expect(graph.nodes.find((node) => node.id === "rpc-layer:0")?.provides).toEqual([
    "Notes.Graph.Ping"
  ])
  expect(graph.nodes.find((node) => node.id === "workflow:0")).toMatchObject({
    provides: [],
    requires: ["WorkflowEngine"]
  })
  expect(graph.providerFacts.find((provider) => provider.id === "test")).toMatchObject({
    kind: "runtime",
    capabilities: ["FileSystem", "Path", "Terminal", "Stdio", "ChildProcessSpawner"]
  })
  expect(graph.providerFacts.find((provider) => provider.id === "system")).toMatchObject({
    kind: "webview",
    capabilities: ["WindowWebView", "AppProtocol"]
  })
  expect(
    core.layerGraphSnapshotFromGraph(graph).nodes.find((node) => node.id === "rpc-layer:0")
  ).toMatchObject({
    provides: ["Notes.Graph.Ping"],
    requires: ["RpcServer.Protocol"]
  })
})

test("Desktop.runtimeGraph exposes node runtime provider selection", async () => {
  const core = await import("./index.js")
  const graph = await Effect.runPromise(
    core.Desktop.runtimeGraph({
      id: "notes",
      windows: core.Desktop.window("main", { title: "Notes" }),
      providers: Layer.mergeAll(
        core.Desktop.provider(core.Desktop.Provider.Runtime.node),
        core.Desktop.provider(core.Desktop.Provider.WebView.chrome)
      )
    })
  )

  expect(graph.providers).toEqual({ runtime: "node", webview: "chrome" })
  expect(graph.providerBudgets).toEqual([
    {
      id: "node",
      kind: "runtime",
      package: "@effect/platform-node",
      importPath: "@effect-desktop/core/providers/node",
      startupBudgetMs: 25,
      bundleBudgetKb: 64
    }
  ])
  expect(graph.nodes[0]).toMatchObject({
    id: "provider:runtime:node",
    kind: "provider",
    label: "Node runtime provider"
  })
  expect(graph.nodes[1]).toMatchObject({
    id: "provider:webview:chrome",
    kind: "provider",
    label: "Bundled Chrome WebView provider"
  })
})

test("Desktop.provider accepts custom provider descriptors through layer composition", async () => {
  const core = await import("./index.js")
  const { TestRuntimeProviderLayer } = await import("@effect-desktop/core/providers/test")
  const customRuntime = core.Desktop.Provider.runtime({
    id: "custom-runtime",
    layer: TestRuntimeProviderLayer,
    budget: {
      id: "custom-runtime",
      kind: "runtime",
      package: "@effect-desktop/core",
      importPath: "@effect-desktop/core/providers/custom-runtime",
      startupBudgetMs: 25,
      bundleBudgetKb: 64
    }
  })
  const customWebView = core.Desktop.Provider.webview({
    id: "custom-webview",
    hostEngine: "chrome",
    capabilities: ["WindowWebView", "AppProtocol"]
  })

  const graph = await Effect.runPromise(
    core.Desktop.runtimeGraph({
      id: "notes",
      windows: core.Desktop.window("main", { title: "Notes" }),
      providers: Layer.mergeAll(
        core.Desktop.provider(customRuntime),
        core.Desktop.provider(customWebView)
      )
    })
  )

  expect(graph.providers).toEqual({ runtime: "custom-runtime", webview: "custom-webview" })
  expect(graph.providerBudgets[0]?.id).toBe("custom-runtime")
  expect(graph.providerFacts.find((provider) => provider.id === "custom-webview")).toMatchObject({
    kind: "webview",
    capabilities: ["WindowWebView", "AppProtocol"]
  })
})

test("Desktop.runtime runs the same provider-backed app program under bun, node, and test graphs", async () => {
  const core = await import("./index.js")
  const config = {
    id: "notes",
    windows: core.Desktop.window("main", { title: "Notes" })
  }
  const program = Effect.gen(function* () {
    const app = yield* core.DesktopApp
    const runtime = yield* core.DesktopRuntime
    const owner = yield* core.ResourceOwner
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const cwd = path.resolve(".")
    return {
      appId: app.appId,
      ownerKind: owner.kind,
      ownerScope: owner.scopeId,
      runtimeProvider: runtime.providers.runtime,
      graphAppId: runtime.graph.appId,
      cwdExists: yield* fs.exists(cwd)
    }
  })

  const bun = await Effect.runPromise(
    Effect.scoped(program.pipe(Effect.provide(core.Desktop.runtime(config))))
  )
  const node = await Effect.runPromise(
    Effect.scoped(
      program.pipe(
        Effect.provide(
          core.Desktop.runtime({
            ...config,
            providers: core.Desktop.provider(core.Desktop.Provider.Runtime.node)
          })
        )
      )
    )
  )
  const test = await Effect.runPromise(
    Effect.scoped(
      program.pipe(
        Effect.provide(
          core.Desktop.runtime({
            ...config,
            providers: core.Desktop.provider(core.Desktop.Provider.Runtime.test)
          })
        )
      )
    )
  )

  expect(bun).toEqual({
    appId: "notes",
    ownerKind: "app",
    ownerScope: "notes",
    runtimeProvider: "bun",
    graphAppId: "notes",
    cwdExists: true
  })
  expect(node).toEqual({
    appId: "notes",
    ownerKind: "app",
    ownerScope: "notes",
    runtimeProvider: "node",
    graphAppId: "notes",
    cwdExists: true
  })
  expect(test).toMatchObject({
    appId: "notes",
    ownerKind: "app",
    ownerScope: "notes",
    runtimeProvider: "test",
    graphAppId: "notes"
  })
  expect(typeof test.cwdExists).toBe("boolean")
})

test("Desktop runtime accepts handler services provided around Desktop.app(App)", async () => {
  const core = await import("./index.js")
  class Greeting extends Context.Service<Greeting, { readonly value: string }>()("Greeting") {}
  const GreetingLayer = Layer.succeed(Greeting)({ value: "hello" })
  const Ping = Rpc.make("Notes.Layer.Ping", { success: Schema.String })
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesLive = NotesRpcs.toLayer({
    "Notes.Layer.Ping": () =>
      Effect.gen(function* () {
        const greeting = yield* Greeting
        return greeting.value
      })
  })
  const app = core.Desktop.make({
    id: "notes",
    windows: core.Desktop.window("main", { title: "Notes" }),
    providers: core.Desktop.provider(core.Desktop.Provider.Runtime.test),
    rpcs: core.Desktop.rpc(NotesRpcs, NotesLive)
  })

  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.runtime(app).pipe(Layer.provide(GreetingLayer))))
  )

  expect(Exit.isSuccess(exit)).toBe(true)
})

test("Desktop.runtime rejects duplicate runtime providers as typed startup errors", async () => {
  const core = await import("./index.js")
  const duplicateProviders = Layer.mergeAll(
    core.Desktop.provider(core.Desktop.Provider.Runtime.bun),
    core.Desktop.provider(core.Desktop.Provider.Runtime.node)
  )
  const badConfig = {
    id: "notes",
    windows: core.Desktop.window("main", { title: "Notes" }),
    providers: duplicateProviders
  }
  const graphExit = await Effect.runPromiseExit(core.Desktop.runtimeGraph(badConfig))
  const diagnostics = await Effect.runPromise(core.Desktop.runtimeGraphSnapshot(badConfig))
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* core.DesktopApp
      }).pipe(Effect.provide(core.Desktop.runtime(badConfig)))
    )
  )

  expect(Exit.isFailure(graphExit)).toBe(true)
  if (Exit.isFailure(graphExit)) {
    const failure = graphExit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(core.DesktopSpineConfigError)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "invalid-config",
      provider: "node"
    })
  }
  expect(diagnostics.failures[0]).toMatchObject({
    reason: "missing-requirement",
    requirement: "DesktopRuntime",
    providerPath: ["provider:runtime:node"],
    message: "Desktop.provider(...) selected more than one runtime provider (bun, node)"
  })

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(core.DesktopSpineConfigError)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "invalid-config",
      provider: "node"
    })
  }
})

test("Desktop.runtime rejects app ids that cannot become ResourceOwner ids", async () => {
  const core = await import("./index.js")
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* core.DesktopRuntime
      }).pipe(
        Effect.provide(
          core.Desktop.runtime({
            id: "bad\napp",
            windows: core.Desktop.window("main", { title: "Notes" })
          })
        )
      )
    )
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(core.DesktopSpineConfigError)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "invalid-config",
      appId: "bad\napp"
    })
  }
})

test("Desktop.runtimeGraphSnapshot preserves provider failure evidence", async () => {
  const core = await import("./index.js")
  const duplicateProviders = Layer.mergeAll(
    core.Desktop.provider(core.Desktop.Provider.Runtime.bun),
    core.Desktop.provider(core.Desktop.Provider.Runtime.node)
  )
  const snapshot = await Effect.runPromise(
    core.Desktop.runtimeGraphSnapshot({
      id: "notes",
      windows: core.Desktop.window("main", { title: "Notes" }),
      providers: duplicateProviders
    })
  )

  expect(snapshot).toMatchObject({
    appId: "notes",
    providers: { runtime: "node", webview: "system" },
    nodes: [],
    providerFacts: [],
    failures: [
      {
        appId: "notes",
        reason: "missing-requirement",
        requirement: "DesktopRuntime",
        providerPath: ["provider:runtime:node"],
        provider: "node"
      }
    ]
  })
})

test("Desktop.rpc pairs an RpcGroup with its implementation for app adapters", async () => {
  const core = await import("./index.js")
  const Ping = Rpc.make("Notes.Ping", { success: Schema.String })
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesLive = NotesRpcs.toLayer({
    "Notes.Ping": () => Effect.succeed("pong")
  })
  const rpcLayer = core.Desktop.rpc(NotesRpcs, NotesLive)
  const config = core.Desktop.make({
    id: "notes",
    windows: core.Desktop.window("main", { title: "Notes", renderer: "/" }),
    rpcs: rpcLayer
  })

  const manifest = core.Desktop.manifest(config)
  expect(manifest.rpcGroups).toHaveLength(1)
  expect(manifest.rpcGroups[0]?.group.requests.has("Notes.Ping")).toBe(true)
  expect(core.Desktop.manifest(config)).toEqual({
    _tag: "DesktopAppManifest",
    id: "notes",
    windows: { main: { title: "Notes", renderer: "/" } },
    rpcGroups: [
      {
        _tag: "DesktopRpcGroup",
        group: NotesRpcs
      }
    ]
  })
})

test("Desktop.native composes an empty native layer without adding runtime surfaces", async () => {
  const core = await import("./index.js")
  const app = core.Desktop.make({
    id: "native-empty",
    windows: core.Desktop.window("main", { title: "Native" }),
    providers: core.Desktop.provider(core.Desktop.Provider.Runtime.test),
    native: core.Desktop.native()
  })
  const graph = await Effect.runPromise(core.Desktop.runtimeGraph(app))

  expect(Layer.isLayer(app.native)).toBe(true)
  expect(core.Desktop.manifest(app).rpcGroups).toEqual([])
  expect(graph.nodes.some((node) => node.kind === "native-surface")).toBe(false)
})

test("Desktop.Rpc.surface derives server, client, test, docs, and laws from one RpcGroup", async () => {
  const core = await import("./index.js")
  const Ping = Rpc.make("Notes.Ping", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Ping)
  class NotesClient extends Context.Service<
    NotesClient,
    RpcClient.RpcClient<RpcGroup.Rpcs<typeof NotesRpcs>>
  >()("NotesClient") {}
  const NotesLive = NotesRpcs.toLayer({
    "Notes.Ping": () => Effect.succeed("pong")
  })
  class NotesFacade extends Context.Service<
    NotesFacade,
    { readonly ping: () => Effect.Effect<string> }
  >()("NotesFacade") {}
  const assertSurfaceRequiresMappedCustomServices = (
    makeSurface: typeof core.Desktop.Rpc.surface
  ): void => {
    // @ts-expect-error custom service shapes must explicitly map from the generated RPC client
    makeSurface("Notes", NotesRpcs, {
      service: NotesFacade,
      handlers: NotesLive
    })
  }
  void assertSurfaceRequiresMappedCustomServices
  const surface = core.Desktop.Rpc.surface("Notes", NotesRpcs, {
    service: NotesClient,
    handlers: NotesLive
  })
  const app = core.Desktop.make({
    id: "notes",
    windows: core.Desktop.window("main", { title: "Notes" }),
    rpcs: surface.serverLayer
  })

  for (const law of surface.contractLaws) {
    await Effect.runPromise(law.check)
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* NotesClient
      return yield* client["Notes.Ping"](undefined)
    }).pipe(Effect.provide(surface.testClientLayer))
  )
  const queue = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const requests: HostProtocolEnvelope[] = []
  const protocolLayer = Layer.effect(RpcClient.Protocol)(
    makeDesktopClientProtocol(
      {
        send: (envelope) => {
          requests.push(envelope)
          if (envelope.kind !== "request") {
            return Effect.void
          }
          return Queue.offer(
            queue,
            new HostProtocolResponseEnvelope({
              kind: "response",
              id: envelope.id,
              timestamp: 0,
              traceId: envelope.traceId,
              payload: "pong-live"
            })
          ).pipe(Effect.asVoid)
        },
        run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
      },
      { nextTraceId: () => "trace-surface-client" }
    )
  )
  const liveClientResult = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* NotesClient
        return yield* client["Notes.Ping"](undefined)
      }).pipe(Effect.provide(Layer.provide(surface.clientLayer, protocolLayer)))
    )
  )

  expect(result).toBe("pong")
  expect(liveClientResult).toBe("pong-live")
  expect(requests).toMatchObject([
    {
      kind: "request",
      method: "Notes.Ping"
    }
  ])
  expect(surface.group).toBe(NotesRpcs)
  expect(Layer.isLayer(surface.serverLayer)).toBe(true)
  expect(Layer.isLayer(surface.clientLayer)).toBe(true)
  expect(Layer.isLayer(surface.testClientLayer)).toBe(true)
  // Identity assertion: build serverLayer against the registry, snapshot, and
  // confirm the (group, handlers) pair was threaded through unchanged. Catches
  // regressions where surface() loses the reference (the prior identity check
  // used surface.serverLayer.group/.layer before the registry refactor).
  const surfaceRegistrations = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(
          Layer.provideMerge(surface.serverLayer, core.DesktopRpcRegistryLive)
        )
        return yield* Context.get(ctx, core.DesktopRpcRegistry).snapshot
      })
    )
  )
  expect(surfaceRegistrations).toHaveLength(1)
  expect(surfaceRegistrations[0]?.group).toBe(NotesRpcs)
  expect(Object.is(surfaceRegistrations[0]?.handlers, NotesLive)).toBe(true)
  expect(surface.schemaDocs.map((doc) => [doc.name, doc.tag, doc.kind])).toEqual([
    ["ping", "Notes.Ping", "query"]
  ])
  expect(core.Desktop.manifest(app).rpcGroups[0]?.group).toBe(NotesRpcs)
  expect(core.Desktop.describeRpcs(app, NotesRpcs).map((descriptor) => descriptor.tag)).toEqual([
    "Notes.Ping"
  ])
})

test("Desktop.Rpc.supportedGroup filters unsupported RPCs from generated clients", async () => {
  const core = await import("./index.js")
  const List = Rpc.make("Notes.List", {
    success: Schema.Array(Schema.String)
  }).pipe(RpcSupport.supported)
  const Delete = Rpc.make("Notes.Delete", {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Void
  }).pipe(RpcSupport.unsupported("host adapter does not implement delete yet"))
  const NotesRpcs = RpcGroup.make(List, Delete)
  const SupportedNotesRpcs = core.Desktop.Rpc.supportedGroup(NotesRpcs)
  type SupportedNotesRpcContract = Assert<
    IsEqual<RpcGroup.Rpcs<typeof SupportedNotesRpcs>, typeof List>
  >
  const supportedNotesRpcContract: SupportedNotesRpcContract = true
  class NotesClient extends Context.Service<
    NotesClient,
    DesktopRpcClient<RpcGroup.Rpcs<typeof NotesRpcs>>
  >()("NotesClient") {}
  const assertSupportedClient = (
    client: SupportedDesktopRpcClient<RpcGroup.Rpcs<typeof NotesRpcs>>
  ): void => {
    void client["Notes.List"]
    // @ts-expect-error unsupported RPCs are absent from supported generated clients
    void client["Notes.Delete"]
  }
  void assertSupportedClient
  void supportedNotesRpcContract

  expect(Array.from(SupportedNotesRpcs.requests.keys())).toEqual(["Notes.List"])
  expect(
    core.Desktop.Rpc.surface("Notes", NotesRpcs, {
      service: NotesClient,
      handlers: NotesRpcs.toLayer({
        "Notes.List": () => Effect.succeed(["one"]),
        "Notes.Delete": () => Effect.void
      })
    }).schemaDocs.map((doc) => [doc.tag, doc.support])
  ).toEqual([
    ["Notes.List", { status: "supported" }],
    [
      "Notes.Delete",
      { status: "unsupported", reason: "host adapter does not implement delete yet" }
    ]
  ])
})

test("Desktop.Rpc.surface laws reject groups that cannot lower to bridge metadata", async () => {
  const core = await import("./index.js")
  const Valid = Rpc.make("Notes.Ping", { success: Schema.String })
  const InvalidNamespace = RpcGroup.make(Rpc.make("Other.Ping", { success: Schema.String }))
  const DuplicateNames = RpcGroup.make(Valid, Rpc.make("Tasks.Ping", { success: Schema.String }))
  const Broken = { _tag: "Notes.Broken", annotations: Context.empty() }
  const BrokenGroup = Object.freeze({
    ...RpcGroup.make(Valid),
    requests: new Map([["Notes.Broken", Broken]])
  }) as unknown as RpcGroup.Any & {
    readonly requests: ReadonlyMap<string, Rpc.Any>
  }

  const invalidNamespace = core.Desktop.Rpc.surface("Notes", InvalidNamespace, {
    service: Context.Service<{ readonly client: unknown }>("InvalidNamespaceClient"),
    handlers: InvalidNamespace.toLayer({
      "Other.Ping": () => Effect.succeed("pong")
    }),
    client: (client) => ({ client })
  })
  const duplicateNames = core.Desktop.Rpc.surface("Notes", DuplicateNames, {
    service: Context.Service<{ readonly client: unknown }>("DuplicateNamesClient"),
    handlers: DuplicateNames.toLayer({
      "Notes.Ping": () => Effect.succeed("pong"),
      "Tasks.Ping": () => Effect.succeed("pong")
    }),
    client: (client) => ({ client })
  })
  const brokenSchema = core.Desktop.Rpc.surface("Notes", BrokenGroup, {
    service: Context.Service<{ readonly client: unknown }>("BrokenSchemaClient"),
    handlers: Layer.empty as Layer.Layer<unknown>,
    client: (client: unknown) => ({ client })
  })

  const expectLawFailure = async (
    law: (typeof invalidNamespace.contractLaws)[number],
    expected: Record<string, unknown>
  ) => {
    const exit = await Effect.runPromiseExit(law.check)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject(expected)
    }
  }

  await expectLawFailure(invalidNamespace.contractLaws[0]!, {
    reason: "invalid-tag",
    tag: "Other.Ping"
  })
  await expectLawFailure(duplicateNames.contractLaws[1]!, {
    reason: "duplicate-endpoint",
    tag: "Tasks.Ping"
  })
  await expectLawFailure(brokenSchema.contractLaws[2]!, {
    reason: "missing-schema",
    tag: "Notes.Broken"
  })
})

test("Desktop.app binds RpcGroups into the runtime RpcServer protocol", async () => {
  const core = await import("./index.js")
  let acquired = 0
  const Ping = Rpc.make("Notes.Ping", { success: Schema.String })
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesLive = Layer.merge(
    NotesRpcs.toLayer({
      "Notes.Ping": () => Effect.succeed("pong")
    }),
    Layer.effectDiscard(
      Effect.sync(() => {
        acquired += 1
      })
    )
  )
  const definition = core.Desktop.make({
    id: "notes",
    windows: core.Desktop.window("main", { title: "Notes" }),
    rpcs: core.Desktop.rpc(NotesRpcs, NotesLive)
  })
  const transport = {
    send: () => Effect.void,
    run: () => Effect.never
  }
  const protocolLayer = Layer.effect(RpcServer.Protocol)(makeDesktopServerProtocol(transport))
  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.app(definition).pipe(Layer.provide(protocolLayer))))
  )

  expect(Exit.isSuccess(exit)).toBe(true)
  expect(acquired).toBe(1)
})

test("Desktop.app rejects RpcGroup methods that declare known capability kinds without scoped fields", async () => {
  const core = await import("./index.js")
  const Connect = Rpc.make("Network.Connect").pipe(
    RpcCapability({
      kind: "network.connect"
    })
  )
  const NetworkRpcs = RpcGroup.make(Connect)
  const definition = core.Desktop.make({
    id: "network-app",
    windows: core.Desktop.window("main", { title: "Network" }),
    rpcs: core.Desktop.rpc(
      NetworkRpcs,
      NetworkRpcs.toLayer({
        "Network.Connect": () => Effect.succeed(undefined)
      })
    )
  })

  const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(core.Desktop.app(definition))))

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "invalid-config",
      method: "Network.Connect",
      permission: "network.connect"
    })
  }
})

test("Desktop.app rejects RpcGroup methods that require undeclared capabilities", async () => {
  const core = await import("./index.js")
  const Connect = Rpc.make("Network.Connect").pipe(
    RpcCapability({
      kind: "network.connect",
      hosts: ["api.example.com"],
      askUnknownHosts: false,
      audit: "on-deny"
    })
  )
  const NetworkRpcs = RpcGroup.make(Connect)
  const definition = core.Desktop.make({
    id: "network-app",
    windows: core.Desktop.window("main", { title: "Network" }),
    rpcs: core.Desktop.rpc(
      NetworkRpcs,
      NetworkRpcs.toLayer({
        "Network.Connect": () => Effect.succeed(undefined)
      })
    )
  })

  const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(core.Desktop.app(definition))))

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "missing-permission",
      method: "Network.Connect",
      permission: "network.connect"
    })
  }
})

test("Desktop.app validates RpcGroup capability scope coverage", async () => {
  const core = await import("./index.js")
  const requiredCapability = {
    kind: "network.connect",
    hosts: ["api.example.com"],
    askUnknownHosts: false,
    audit: "on-deny"
  } as const
  const Connect = Rpc.make("Network.Connect").pipe(RpcCapability(requiredCapability))
  const NetworkRpcs = RpcGroup.make(Connect)
  const layer = core.Desktop.rpc(
    NetworkRpcs,
    NetworkRpcs.toLayer({
      "Network.Connect": () => Effect.succeed(undefined)
    })
  )
  const transport = {
    send: () => Effect.void,
    run: () => Effect.never
  }
  const protocolLayer = Layer.effect(RpcServer.Protocol)(makeDesktopServerProtocol(transport))
  const wrongScope = core.Desktop.make({
    id: "network-app",
    windows: core.Desktop.window("main", { title: "Network" }),
    permissions: core.Desktop.permission({
      ...requiredCapability,
      hosts: ["other.example.com"]
    }),
    rpcs: layer
  })
  const coveredScope = core.Desktop.make({
    id: "network-app",
    windows: core.Desktop.window("main", { title: "Network" }),
    permissions: core.Desktop.permission(requiredCapability),
    rpcs: layer
  })

  const rejected = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.app(wrongScope)))
  )
  const accepted = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.app(coveredScope).pipe(Layer.provide(protocolLayer))))
  )

  expect(Exit.isFailure(rejected)).toBe(true)
  if (Exit.isFailure(rejected)) {
    const failure = rejected.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "missing-permission",
      method: "Network.Connect",
      permission: "network.connect"
    })
  }
  expect(Exit.isSuccess(accepted)).toBe(true)
})

test("Desktop.app treats explicit none capability as permission-free metadata", async () => {
  const core = await import("./index.js")
  const IsSupported = Rpc.make("Screen.isSupported", {
    payload: Schema.Void,
    success: Schema.Boolean
  }).pipe(RpcCapability({ kind: "none" }))
  const ScreenRpcs = RpcGroup.make(IsSupported)
  const definition = core.Desktop.make({
    id: "screen-app",
    windows: core.Desktop.window("main", { title: "Screen" }),
    rpcs: core.Desktop.rpc(
      ScreenRpcs,
      ScreenRpcs.toLayer({
        "Screen.isSupported": () => Effect.succeed(true)
      })
    )
  })
  const transport = {
    send: () => Effect.void,
    run: () => Effect.never
  }
  const protocolLayer = Layer.effect(RpcServer.Protocol)(makeDesktopServerProtocol(transport))

  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(core.Desktop.app(definition).pipe(Layer.provide(protocolLayer))))
  )

  expect(Exit.isSuccess(exit)).toBe(true)
})

test("Desktop.app permission middleware declares app permissions for protected RPCs", async () => {
  const core = await import("./index.js")
  const requiredCapability = {
    kind: "network.connect",
    hosts: ["api.example.com"],
    askUnknownHosts: false,
    audit: "on-deny"
  } as const
  let handlerCalls = 0
  const Connect = Rpc.make("Network.Connect", {
    payload: { host: Schema.String },
    success: Schema.String
  }).pipe(RpcCapability(requiredCapability))
  const NetworkRpcs = RpcGroup.make(Connect)
  const definition = core.Desktop.make({
    id: "network-app",
    windows: core.Desktop.window("main", { title: "Network" }),
    permissions: core.Desktop.permission(requiredCapability),
    rpcs: core.Desktop.rpc(
      NetworkRpcs,
      NetworkRpcs.toLayer({
        "Network.Connect": ({ host }) =>
          Effect.sync(() => {
            handlerCalls += 1
            return `connected:${host}`
          })
      })
    )
  })
  const inbound = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const response = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const transport = {
    send: (envelope: HostProtocolEnvelope) => Queue.offer(response, envelope).pipe(Effect.asVoid),
    run: (onEnvelope: (envelope: HostProtocolEnvelope) => Effect.Effect<void>) =>
      Effect.forever(Queue.take(inbound).pipe(Effect.flatMap(onEnvelope)))
  }
  const protocolLayer = Layer.effect(RpcServer.Protocol)(
    makeDesktopServerProtocol(transport, {
      nextTraceId: () => "trace-permission-test",
      now: () => 1710000000000
    })
  )

  const envelope = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(core.Desktop.app(definition).pipe(Layer.provide(protocolLayer)))
        yield* Queue.offer(
          inbound,
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "req-permission",
            method: "Network.Connect",
            timestamp: 1710000000000,
            traceId: "trace-renderer",
            windowId: "main",
            payload: { host: "api.example.com" }
          })
        )
        return yield* Queue.take(response)
      })
    )
  )

  expect(handlerCalls).toBe(1)
  expect(envelope.kind).toBe("response")
  if (envelope.kind === "response") {
    expect(envelope.payload).toBe("connected:api.example.com")
    expect(envelope.error).toBeUndefined()
  }
})

test("describeRpcs derives endpoint descriptors from provided RpcGroups", async () => {
  const core = await import("./index.js")
  const List = Rpc.make("Notes.List", { success: Schema.Array(Schema.String) }).pipe(
    RpcEndpoint.query
  )
  const Tail = Rpc.make("Notes.Tail", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  }).pipe(RpcSupport.unsupported("host stream is unavailable"))
  const NotesRpcs = RpcGroup.make(List, Tail)
  const definition = core.Desktop.make({
    windows: core.Desktop.window("main", { title: "Notes" }),
    rpcs: core.Desktop.rpc(
      NotesRpcs,
      NotesRpcs.toLayer({
        "Notes.List": () => Effect.succeed(["inbox"]),
        "Notes.Tail": () => Effect.never
      })
    )
  })

  expect(
    core.Desktop.describeRpcs(definition, NotesRpcs).map((descriptor) => descriptor.name)
  ).toEqual(["list", "tail"])
  expect(
    core.Desktop.describeRpcs(definition, NotesRpcs).map((descriptor) => descriptor.kind)
  ).toEqual(["query", "stream"])
  expect(core.Desktop.describeRpcs(definition, NotesRpcs)[1]?.support).toEqual({
    status: "unsupported",
    reason: "host stream is unavailable"
  })
})

test("describeRpcs rejects duplicate endpoint names before adapters build maps", async () => {
  const core = await import("./index.js")
  const ProjectList = Rpc.make("Projects.List", { success: Schema.Array(Schema.String) })
  const TaskList = Rpc.make("Tasks.List", { success: Schema.Array(Schema.String) })
  const CollidingRpcs = RpcGroup.make(ProjectList, TaskList)
  const definition = core.Desktop.make({
    windows: core.Desktop.window("main", { title: "Lists" }),
    rpcs: core.Desktop.rpc(
      CollidingRpcs,
      CollidingRpcs.toLayer({
        "Projects.List": () => Effect.succeed(["project"]),
        "Tasks.List": () => Effect.succeed(["task"])
      })
    )
  })

  expect(() => core.Desktop.describeRpcs(definition, CollidingRpcs)).toThrow(
    core.DuplicateDesktopRpcNameError
  )
})

test("describeRpcs fails loudly when a group is not provided to the app", async () => {
  const core = await import("./index.js")
  const Missing = RpcGroup.make(Rpc.make("Notes.Missing"))
  const definition = core.Desktop.make({
    windows: core.Desktop.window("main", { title: "Notes" })
  })

  expect(() => core.Desktop.describeRpcs(definition, Missing)).toThrow(core.MissingDesktopRpcsError)
})
