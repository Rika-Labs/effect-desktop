import { expect, test } from "bun:test"
import {
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Stream
} from "effect"
import { TestClock } from "effect/testing"

import {
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  HostProtocolUnsupportedError,
  HostProtocolRequestEnvelope,
  HostProtocolInvalidOutputError,
  HostProtocolNotFoundError,
  makeHostHandshakeClient,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  Rpc,
  RpcGroup,
  bridgeContractFromRpcGroup
} from "@effect-desktop/bridge"
import {
  Filesystem,
  PermissionActor,
  PermissionContext,
  PermissionRegistry,
  Process,
  PTY,
  ResourceOwner,
  ResourceRegistryLive,
  SidecarCommand,
  Telemetry,
  makeSecretBytesFromUtf8,
  makeSecrets,
  makeResourceRegistry,
  makeResourceId,
  makeSidecar,
  ResourceHandleSchema,
  type ResourceOwnerApi,
  unsafeSecretBytes,
  wipeSecretBytes
} from "@effect-desktop/core"
import {
  Clipboard,
  ClipboardClient,
  ClipboardLive,
  ClipboardSurface,
  Dialog,
  DialogSurface,
  DialogLive,
  Screen,
  ScreenSurface,
  ScreenLive,
  Window,
  type DialogClientApi,
  makeClipboardClientLayer,
  makeClipboardServiceLayer,
  makeDialogServiceLayer,
  makeScreenClientLayer,
  type ClipboardClientApi,
  type DialogError,
  type ScreenClientApi,
  type ScreenError
} from "@effect-desktop/native"
import {
  ClipboardImage,
  ClipboardSupportedResult,
  DialogConfirmResult,
  DialogOpenResult,
  DialogSaveResult,
  ScreenDisplay,
  ScreenDisplaysResult,
  ScreenPoint,
  ScreenSupportedResult
} from "@effect-desktop/native/contracts"

import {
  assertNoOpenResourcesIn,
  formatLeakedHandleReport,
  HeadlessRuntime,
  leakedHandles,
  makeMemorySecretsSafeStorage,
  makeMemoryFilesystem,
  makeMockBridge,
  makeMockHost,
  makeMockProcess,
  makeMockPty,
  MemoryFilesystemLive,
  MockProcessLive,
  MockPtyLayer,
  MockHost,
  MockHostLive,
  MockBridge,
  registerLeakMatchers,
  runHeadless,
  ResourceLeakError,
  CapabilityLaws,
  ClipboardTest,
  DialogTest,
  FailureAssertions,
  LayerMatrix,
  makeClipboardScenarioLayer,
  TestNativeSurfaces,
  ScreenTest
} from "./index.js"
import {
  makeMockBridge as makeSubpathMockBridge,
  MockHost as SubpathMockHost,
  MockHostLive as SubpathMockHostLive
} from "@effect-desktop/test/bridge"
import { MemoryFilesystemLive as SubpathMemoryFilesystemLive } from "@effect-desktop/test/core"
import {
  ClipboardTest as SubpathClipboardTest,
  TestDesktop as SubpathTestDesktop
} from "@effect-desktop/test/native"
import { CapabilityLaws as SubpathCapabilityLaws } from "@effect-desktop/test/renderer"

const id = makeResourceId
const TEST_OWNER: ResourceOwnerApi = Object.freeze({
  kind: "test",
  scopeId: "scope-main",
  actor: new PermissionActor({ kind: "resource", id: "scope-main" }),
  attributes: Object.freeze({ scopeId: "scope-main" })
})
const waitForRegistryEntries = (
  registry: {
    readonly list: () => Effect.Effect<{ readonly entries: readonly unknown[] }, never, never>
  },
  count: number
): Effect.Effect<void, never, never> =>
  Effect.suspend(() =>
    registry
      .list()
      .pipe(
        Effect.flatMap((snapshot) =>
          snapshot.entries.length >= count
            ? Effect.void
            : Effect.fail(new Error(`waiting for ${count} registry entries`))
        )
      )
  ).pipe(
    Effect.retry(Schedule.spaced("1 millis").pipe(Schedule.both(Schedule.recurs(100)))),
    Effect.orDie
  )

registerLeakMatchers()

const TEST_CLIPBOARD_IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
const TEST_CLIPBOARD_IMAGE_BYTES_JSON = "iVBORw0KGgoA"

const ClipboardContractLaws = CapabilityLaws.make("Clipboard", Clipboard, {
  "write/read round trips text": (clipboard) =>
    Effect.gen(function* () {
      yield* clipboard.writeText("shared text")
      const text = yield* clipboard.readText()
      expect(text).toBe("shared text")
    }),
  "write/read round trips html": (clipboard) =>
    Effect.gen(function* () {
      yield* clipboard.writeHtml("<strong>shared html</strong>")
      const html = yield* clipboard.readHtml()
      expect(html).toBe("<strong>shared html</strong>")
    }),
  "write/read round trips image": (clipboard) =>
    Effect.gen(function* () {
      yield* clipboard.writeImage({ mime: "image/png", bytes: TEST_CLIPBOARD_IMAGE_BYTES })
      const image = yield* clipboard.readImage()
      expect(image).toEqual(
        new ClipboardImage({ mime: "image/png", bytes: TEST_CLIPBOARD_IMAGE_BYTES })
      )
    }),
  "clear removes text and html": (clipboard) =>
    Effect.gen(function* () {
      yield* clipboard.writeText("temporary")
      yield* clipboard.writeHtml("<p>temporary</p>")
      yield* clipboard.clear()
      const text = yield* clipboard.readText()
      const html = yield* clipboard.readHtml()
      expect(text).toBe("")
      expect(html).toBe("")
    }),
  "support queries return booleans": (clipboard) =>
    Effect.gen(function* () {
      const textSupported = yield* clipboard.isSupported("text")
      const htmlSupported = yield* clipboard.isSupported("html")
      const imageSupported = yield* clipboard.isSupported("image")
      const clearSupported = yield* clipboard.isSupported("clear")
      const selectionSupported = yield* clipboard.isSupported("selection")
      expect(typeof textSupported).toBe("boolean")
      expect(typeof htmlSupported).toBe("boolean")
      expect(typeof imageSupported).toBe("boolean")
      expect(typeof clearSupported).toBe("boolean")
      expect(typeof selectionSupported).toBe("boolean")
    })
})

CapabilityLaws.run(ClipboardContractLaws, [
  {
    name: "test layer",
    layer: ClipboardTest()
  },
  {
    name: "bridge client layer",
    layer: (law) => makeClipboardBridgeLawLayer(law.name)
  }
])

test("ClipboardTest clear removes image state", async () => {
  const image = await Effect.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeImage({ mime: "image/png", bytes: TEST_CLIPBOARD_IMAGE_BYTES })
      yield* clipboard.clear()
      return yield* clipboard.readImage()
    }).pipe(Effect.provide(ClipboardTest()))
  )

  expect(image).toEqual(new ClipboardImage({ mime: "image/png", bytes: new Uint8Array(0) }))
})

const makeClipboardBridgeLawLayer = (lawName: string): Layer.Layer<Clipboard> => {
  const bridge = makeMockBridge()
  switch (lawName) {
    case "write/read round trips text":
      Effect.runSync(
        Effect.all([
          bridge.succeed("Clipboard.writeText", undefined),
          bridge.succeed("Clipboard.readText", { text: "shared text" })
        ])
      )
      break
    case "write/read round trips html":
      Effect.runSync(
        Effect.all([
          bridge.succeed("Clipboard.writeHtml", undefined),
          bridge.succeed("Clipboard.readHtml", { html: "<strong>shared html</strong>" })
        ])
      )
      break
    case "write/read round trips image":
      Effect.runSync(
        Effect.all([
          bridge.succeed("Clipboard.writeImage", undefined),
          bridge.succeed("Clipboard.readImage", {
            mime: "image/png",
            bytes: TEST_CLIPBOARD_IMAGE_BYTES_JSON
          })
        ])
      )
      break
    case "clear removes text and html":
      Effect.runSync(
        Effect.all([
          bridge.succeed("Clipboard.writeText", undefined),
          bridge.succeed("Clipboard.writeHtml", undefined),
          bridge.succeed("Clipboard.clear", undefined),
          bridge.succeed("Clipboard.readText", { text: "" }),
          bridge.succeed("Clipboard.readHtml", { html: "" })
        ])
      )
      break
    case "support queries return booleans":
      Effect.runSync(
        Effect.all([
          bridge.succeed("Clipboard.isSupported", { supported: true }),
          bridge.succeed("Clipboard.isSupported", { supported: true }),
          bridge.succeed("Clipboard.isSupported", { supported: true }),
          bridge.succeed("Clipboard.isSupported", { supported: true }),
          bridge.succeed("Clipboard.isSupported", { supported: true })
        ])
      )
      break
    default:
      throw new Error(`unhandled Clipboard law fixture: ${lawName}`)
  }

  return Layer.provide(ClipboardLive, ClipboardSurface.bridgeClientLayer(bridge.exchange))
}

test("public bridge subpath exposes host and bridge fixtures", async () => {
  const bridge = makeSubpathMockBridge({ now: () => 1710000000050 })
  await Effect.runPromise(bridge.succeed("Test.Subpath.open", { id: "project-1" }))

  const response = await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* SubpathMockHost
      return yield* host.request(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-1",
          timestamp: 1710000000051,
          traceId: "trace-1",
          method: HOST_VERSION_METHOD,
          payload: undefined
        })
      )
    }).pipe(Effect.provide(SubpathMockHostLive({ now: () => 1710000000052 })))
  )

  expect(bridge.calls()).toEqual([])
  expect(response.payload).toEqual({ protocolVersion: HOST_PROTOCOL_VERSION })
})

test("public core subpath exposes composable core fixture layers", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const filesystem = yield* Filesystem
      yield* filesystem.write("/workspace/subpath.txt", bytes("core"))
      const file = yield* filesystem.read("/workspace/subpath.txt")

      return text(file)
    }).pipe(
      Effect.provide(
        SubpathMemoryFilesystemLive({
          directories: ["/workspace"],
          permissions: {
            readRoots: ["/workspace"],
            writeRoots: ["/workspace"]
          }
        }).pipe(
          Layer.provide(ResourceRegistryLive),
          Layer.provide(ResourceOwner.test("scope-main"))
        )
      )
    )
  )

  expect(result).toBe("core")
})

test("public native subpath exposes deterministic native service layers", async () => {
  const textValue = await Effect.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeText("native")
      return yield* clipboard.readText()
    }).pipe(Effect.provide(SubpathClipboardTest()))
  )

  expect(textValue).toBe("native")
})

test("public native subpath exposes a composed desktop test layer with inspectable windows", async () => {
  const windows = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const window = yield* Window
        const permissions = yield* PermissionRegistry
        yield* window.create({ title: "Notes", width: 800, height: 600 })
        yield* permissions.check(
          {
            kind: "native.invoke",
            primitive: "Window",
            methods: ["create"],
            audit: "always"
          },
          new PermissionContext({
            actor: new PermissionActor({ kind: "window", id: "main" }),
            traceId: "trace-allowed"
          })
        )
        yield* TestClock.adjust("1 minute")

        const opened = yield* SubpathTestDesktop.windows
        const first = opened[0]
        if (first === undefined) {
          return yield* Effect.die(new Error("expected a test window"))
        }
        yield* window.close(first.window)
        yield* SubpathTestDesktop.expectNoLeakedResources

        return opened
      }).pipe(Effect.provide(Layer.mergeAll(SubpathTestDesktop.layer(), TestClock.layer())))
    )
  )

  expect(windows).toMatchObject([
    {
      input: { title: "Notes", width: 800, height: 600 },
      window: { kind: "window", state: "open" }
    }
  ])
})

test("public native subpath desktop test layer reports leaked windows", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.create({ title: "Leaked" })
      return yield* SubpathTestDesktop.expectNoLeakedResources
    }).pipe(Effect.provide(SubpathTestDesktop.layer()))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(JSON.stringify(exit.cause.toJSON())).toContain("ResourceLeakError")
  }
})

test("public native subpath desktop test layer can simulate denied permissions", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const permissions = yield* PermissionRegistry
      return yield* permissions.check(
        {
          kind: "native.invoke",
          primitive: "Window",
          methods: ["create"],
          audit: "always"
        },
        new PermissionContext({
          actor: new PermissionActor({ kind: "window", id: "main" }),
          traceId: "trace-denied"
        })
      )
    }).pipe(Effect.provide(SubpathTestDesktop.layer({ permissions: "deny-all" })))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(JSON.stringify(exit.cause.toJSON())).toContain("PermissionDenied")
  }
})

test("public renderer subpath exposes shared capability law helpers", () => {
  expect(typeof SubpathCapabilityLaws.make).toBe("function")
  expect(typeof SubpathCapabilityLaws.run).toBe("function")
})

test("assertNoOpenResourcesIn fails with a leaked-handle report", async () => {
  let error: unknown

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeResourceRegistry({
          now: () => 1710000000000,
          nextId: () => id("018e2f36-5800-7000-8000-000000000101")
        })
        yield* registry.register({
          kind: "watcher",
          ownerScope: "test-scope",
          state: "open"
        })

        yield* assertNoOpenResourcesIn(registry, {
          testName: "leaky watcher test"
        })
      })
    )
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ResourceLeakError)
  if (error instanceof ResourceLeakError) {
    expect(error.message).toBe(
      [
        "Leaked resource handles (1) in leaky watcher test",
        "- kind: watcher",
        "  id: 018e2f36-5800-7000-8000-000000000101",
        "  generation: 0",
        "  ownerScope: test-scope",
        "  createdAt: 1710000000000"
      ].join("\n")
    )
  }
})

test("leakedHandles ignores app handles by default without exempting app-owned resources", async () => {
  const ids = [
    id("018e2f36-5800-7000-8000-000000000102"),
    id("018e2f36-5800-7000-8000-000000000104")
  ]
  let nextIdIndex = 0
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => ids[nextIdIndex++] ?? id("018e2f36-5800-7000-8000-000000000105")
      })
      yield* registry.register({
        kind: "app",
        ownerScope: "app",
        state: "open"
      })
      const window = yield* registry.register({
        kind: "window",
        ownerScope: "window-1",
        state: "open"
      })

      return {
        snapshot: yield* registry.list(),
        window
      }
    })
  )

  expect(leakedHandles(snapshot.snapshot).map((entry) => entry.handle.id)).toEqual([
    snapshot.window.id
  ])
})

test("registered matcher renders the leaked-handle report", () => {
  const snapshot = {
    entries: [
      {
        handle: {
          kind: "stream",
          id: id("018e2f36-5800-7000-8000-000000000103"),
          generation: 3,
          ownerScope: "stream-scope",
          state: "open",
          dispose: () => Effect.void
        },
        createdAt: 1710000000001
      }
    ]
  }
  const report = formatLeakedHandleReport(snapshot.entries, "stream leak test")

  expect(() => expect(snapshot).toHaveNoLeakedHandles({ testName: "stream leak test" })).toThrow(
    report
  )
})

test("runHeadless records host calls and exits without leaked windows", async () => {
  const result = await Effect.runPromise(
    runHeadless(
      (runtime) =>
        Effect.gen(function* () {
          yield* runtime.handshake.ping()
          const version = yield* runtime.handshake.version()
          const window = yield* runtime.window.create({ title: "Headless" })
          yield* runtime.window.destroy(window.windowId)

          return {
            calls: runtime.calls().map((call) => call.method),
            protocolVersion: version.protocolVersion
          }
        }),
      {
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace"),
        now: () => 1710000000100
      }
    )
  )

  expect(result.calls).toEqual([
    "host.ping",
    "host.version",
    WINDOW_CREATE_METHOD,
    WINDOW_DESTROY_METHOD
  ])
  expect(result.protocolVersion).toBe(HOST_PROTOCOL_VERSION)
})

test("MockHost layer speaks host protocol in-process and preserves trace IDs", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* MockHost
      const options = {
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace"),
        now: () => 1710000000150
      }
      const handshake = makeHostHandshakeClient(host, options)
      const window = makeHostWindowClient(host, options)

      yield* handshake.ping()
      const version = yield* handshake.version()
      const created = yield* window.create({ title: "Mock Host" })
      yield* window.destroy(created.windowId)

      return {
        calls: host.calls().map((call) => ({
          method: call.method,
          traceId: call.request.traceId
        })),
        protocolVersion: version.protocolVersion,
        windows: host.windows().size
      }
    }).pipe(Effect.provide(MockHostLive()))
  )

  expect(result).toEqual({
    calls: [
      { method: HOST_PING_METHOD, traceId: "trace-0" },
      { method: "host.version", traceId: "trace-1" },
      { method: WINDOW_CREATE_METHOD, traceId: "trace-2" },
      { method: WINDOW_DESTROY_METHOD, traceId: "trace-3" }
    ],
    protocolVersion: HOST_PROTOCOL_VERSION,
    windows: 0
  })
})

test("MockHost reports unknown window destroy as a typed host error", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* MockHost
      const window = makeHostWindowClient(host, {
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace")
      })

      return yield* Effect.exit(window.destroy("missing-window"))
    }).pipe(Effect.provide(MockHostLive()))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail?.error).toBeInstanceOf(HostProtocolNotFoundError)
  }
})

const expectFrozenPathPayload = (payload: unknown): void => {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("expected object payload")
  }

  expect(Reflect.set(payload, "path", "after")).toBe(false)
  expect(Reflect.get(payload, "path")).toBe("before")
}

test("MockHost calls returns immutable request snapshots", async () => {
  const timestamp = 1_710_000_002_000
  const host = makeMockHost()
  const request = new HostProtocolRequestEnvelope({
    kind: "request",
    id: "request-immutable-host",
    timestamp: 1710000000200,
    traceId: "trace-immutable-host",
    method: HOST_PING_METHOD,
    payload: { path: "before" }
  })

  const response = await Effect.runPromise(
    host.request(request).pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))
  )
  const first = host.calls()
  const firstCall = first[0]
  if (firstCall === undefined) {
    throw new Error("expected MockHost call")
  }
  expectFrozenPathPayload(firstCall.request.payload)
  const storedCall = host.calls()[0]
  if (storedCall === undefined) {
    throw new Error("expected stored MockHost call")
  }
  expect(response.timestamp).toBe(timestamp)
  expectFrozenPathPayload(storedCall.request.payload)
})

test("MockHost rejects non-JSON fixture payloads", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* MockHost
      const window = makeHostWindowClient(host, {
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace")
      })

      return yield* Effect.exit(window.create({ title: "Mock Host" }))
    }).pipe(
      Effect.provide(
        MockHostLive({
          fixtures: {
            [WINDOW_CREATE_METHOD]: () => Symbol("not-json")
          }
        })
      )
    )
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail?.error).toBeInstanceOf(HostProtocolInvalidOutputError)
  }
})

test("MockBridge records typed client calls and returns pinned successes", async () => {
  const ProjectRpcs = bridgeContractFromRpcGroup(
    "Test.MockBridge.Success",
    RpcGroup.make(
      Rpc.make("Test.MockBridge.Success.open", {
        payload: Schema.Struct({ path: Schema.String }),
        success: Schema.Struct({ id: Schema.String }),
        error: Schema.Never
      })
    )
  )
  const bridge = makeMockBridge({ now: () => 1710000000400 })
  await Effect.runPromise(bridge.succeed("Test.MockBridge.Success.open", { id: "project-1" }))
  const client = bridge.client(
    { project: ProjectRpcs },
    {
      nextRequestId: nextSequence("request"),
      nextTraceId: nextSequence("trace"),
      now: () => 1710000000400
    }
  )

  const output = await Effect.runPromise(client.project.open({ path: "/tmp/project" }))

  expect(output).toEqual({ id: "project-1" })
  expect(bridge.calls()).toEqual([
    {
      method: "Test.MockBridge.Success.open",
      payload: { path: "/tmp/project" },
      traceId: "trace-0",
      timestamp: 1710000000400
    }
  ])
})

test("MockBridge calls returns immutable payload snapshots", async () => {
  const bridge = makeMockBridge({ now: () => 1710000000401 })
  await Effect.runPromise(bridge.succeed("Test.method", { ok: true }))
  await Effect.runPromise(
    bridge.exchange.request(
      new HostProtocolRequestEnvelope({
        kind: "request",
        id: "request-immutable-bridge",
        timestamp: 1710000000401,
        traceId: "trace-immutable-bridge",
        method: "Test.method",
        payload: { path: "before" }
      })
    )
  )
  const first = bridge.calls()
  const firstCall = first[0]
  if (firstCall === undefined) {
    throw new Error("expected MockBridge call")
  }
  expectFrozenPathPayload(firstCall.payload)
  const storedCall = bridge.calls()[0]
  if (storedCall === undefined) {
    throw new Error("expected stored MockBridge call")
  }
  expectFrozenPathPayload(storedCall.payload)
})

test("MockBridge rejects pinned success payloads that are not JSON-serializable", async () => {
  const bridge = makeMockBridge()
  const pin = await Effect.runPromiseExit(
    bridge.succeed("Test.MockBridge.Symbol.open", Symbol("not-json"))
  )

  expect(Exit.isFailure(pin)).toBe(true)
  if (Exit.isFailure(pin)) {
    const fail = pin.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail?.error).toBeInstanceOf(HostProtocolInvalidOutputError)
  }
})

test("MockBridge rejects pinned stream chunks that are not JSON-serializable", async () => {
  const ProjectRpcs = bridgeContractFromRpcGroup(
    "Test.MockBridge.Stream",
    RpcGroup.make(
      Rpc.make("Test.MockBridge.Stream.watch", {
        payload: Schema.Void,
        success: Schema.String,
        error: Schema.Never,
        stream: true
      })
    )
  )
  const bridge = makeMockBridge()
  const pin = await Effect.runPromiseExit(
    bridge.streamChunks("Test.MockBridge.Stream.watch", [Symbol("not-json")])
  )

  expect(Exit.isFailure(pin)).toBe(true)
  if (Exit.isFailure(pin)) {
    const fail = pin.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail?.error).toBeInstanceOf(HostProtocolInvalidOutputError)
  }

  const client = bridge.client(
    { project: ProjectRpcs },
    {
      nextRequestId: nextSequence("request"),
      nextTraceId: nextSequence("trace")
    }
  )
  const chunks = await Effect.runPromiseExit(client.project.watch().pipe(Stream.runCollect))
  expect(Exit.isFailure(chunks)).toBe(true)
})

test("MockBridge returns pinned contract errors through the typed error channel", async () => {
  const Failure = Schema.Struct({ tag: Schema.Literal("Denied"), reason: Schema.String })
  const ProjectRpcs = bridgeContractFromRpcGroup(
    "Test.MockBridge.Failure",
    RpcGroup.make(
      Rpc.make("Test.MockBridge.Failure.open", {
        payload: Schema.Struct({ path: Schema.String }),
        success: Schema.Struct({ id: Schema.String }),
        error: Failure
      })
    )
  )
  const bridge = makeMockBridge()
  await Effect.runPromise(
    bridge.fail("Test.MockBridge.Failure.open", { tag: "Denied", reason: "not allowed" })
  )
  const client = bridge.client(
    { project: ProjectRpcs },
    {
      nextRequestId: nextSequence("request"),
      nextTraceId: nextSequence("trace")
    }
  )

  const exit = await Effect.runPromiseExit(client.project.open({ path: "/tmp/project" }))

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail?.error).toEqual({ tag: "Denied", reason: "not allowed" })
  }
})

test("MockBridge replays pinned stream chunks in order", async () => {
  const timestamp = 1_710_000_005_000
  const ProjectRpcs = bridgeContractFromRpcGroup(
    "Test.MockBridge.Stream",
    RpcGroup.make(
      Rpc.make("Test.MockBridge.Stream.watch", {
        payload: Schema.Struct({ path: Schema.String }),
        success: Schema.String,
        error: Schema.Never,
        stream: true
      })
    )
  )
  const bridge = makeMockBridge()
  await Effect.runPromise(bridge.streamChunks("Test.MockBridge.Stream.watch", ["a", "b"]))
  const client = bridge.client(
    { project: ProjectRpcs },
    {
      nextRequestId: nextSequence("request"),
      nextTraceId: nextSequence("trace")
    }
  )

  const chunks = await Effect.runPromise(
    client.project
      .watch({ path: "/tmp/project" })
      .pipe(Stream.runCollect, Effect.provideService(Clock.Clock, fixedClock(timestamp)))
  )
  const stream = bridge.exchange.stream
  if (stream === undefined) {
    throw new Error("expected MockBridge stream")
  }
  const envelopes = await Effect.runPromise(
    stream(
      new HostProtocolRequestEnvelope({
        kind: "request",
        id: "request-stream-clock",
        timestamp,
        traceId: "trace-stream-clock",
        method: "Test.MockBridge.Stream.watch",
        payload: { path: "/tmp/project" }
      })
    ).pipe(Stream.runCollect, Effect.provideService(Clock.Clock, fixedClock(timestamp)))
  )

  expect(Array.from(chunks)).toEqual(["a", "b"])
  expect(Array.from(envelopes).map((envelope) => envelope.timestamp)).toEqual([
    timestamp,
    timestamp,
    timestamp
  ])
  expect(bridge.calls().map((call) => call.method)).toEqual([
    "Test.MockBridge.Stream.watch",
    "Test.MockBridge.Stream.watch"
  ])
})

test("MockBridge returns resource handles through the method schema", async () => {
  const ProcessApi = bridgeContractFromRpcGroup(
    "Test.MockBridge.Resource",
    RpcGroup.make(
      Rpc.make("Test.MockBridge.Resource.spawn", {
        payload: Schema.Void,
        success: ResourceHandleSchema("process", "running"),
        error: Schema.Never
      })
    )
  )
  const bridge = makeMockBridge()
  await Effect.runPromise(
    bridge.succeed("Test.MockBridge.Resource.spawn", {
      kind: "process",
      id: "process-1",
      generation: 0,
      ownerScope: "window-1",
      state: "running"
    })
  )
  const client = bridge.client(
    { process: ProcessApi },
    {
      nextRequestId: nextSequence("request"),
      nextTraceId: nextSequence("trace")
    }
  )

  const handle = await Effect.runPromise(client.process.spawn())

  expect(handle).toEqual({
    kind: "process",
    id: id("process-1"),
    generation: 0,
    ownerScope: "window-1",
    state: "running"
  })
})

test("MemoryFilesystem layer reads, writes, stats, and atomically replaces files", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const filesystem = yield* Filesystem
      yield* filesystem.mkdir("/workspace/data", { recursive: true })
      yield* filesystem.write("/workspace/data/file.txt", bytes("first"))
      const first = yield* filesystem.read("/workspace/data/file.txt")
      const before = yield* filesystem.stat("/workspace/data/file.txt")
      yield* filesystem.writeAtomic("/workspace/data/file.txt", bytes("second"))
      const second = yield* filesystem.read("/workspace/data/file.txt")
      const realpath = yield* filesystem.realpath("/workspace/data/file.txt")

      return {
        first: text(first),
        second: text(second),
        kind: before.kind,
        sizeBytes: before.sizeBytes,
        realpath: realpath.replaceAll("\\", "/")
      }
    }).pipe(
      Effect.provide(
        MemoryFilesystemLive({
          directories: ["/workspace"],
          permissions: {
            readRoots: ["/workspace"],
            writeRoots: ["/workspace"],
            deleteRoots: ["/workspace"],
            allowRecursiveRemove: true
          },
          now: () => 1710000000600
        }).pipe(
          Layer.provide(ResourceRegistryLive),
          Layer.provide(ResourceOwner.test("scope-main"))
        )
      )
    )
  )

  expect(result).toEqual({
    first: "first",
    second: "second",
    kind: "file",
    sizeBytes: 5,
    realpath: "/workspace/data/file.txt"
  })
})

test("MemoryFilesystem default timestamps come from the Effect Clock", async () => {
  const timestamp = 1_710_000_601_000
  const stat = await Effect.runPromise(
    Effect.gen(function* () {
      const filesystem = yield* Filesystem
      yield* filesystem.write("/workspace/file.txt", bytes("clocked"))
      return yield* filesystem.stat("/workspace/file.txt")
    }).pipe(
      Effect.provide(
        MemoryFilesystemLive({
          directories: ["/workspace"],
          permissions: {
            readRoots: ["/workspace"],
            writeRoots: ["/workspace"]
          }
        }).pipe(
          Layer.provide(ResourceRegistryLive),
          Layer.provide(ResourceOwner.test("scope-main"))
        )
      ),
      Effect.provideService(Clock.Clock, fixedClock(timestamp))
    )
  )

  expect(stat.modifiedAtMs).toBe(timestamp)
})

test("MemoryFilesystem watcher emits contract events and closes its registry resource", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({ nextId: () => id("watch-1") })
      const filesystem = yield* makeMemoryFilesystem(registry, TEST_OWNER, {
        directories: ["/workspace"],
        permissions: {
          readRoots: ["/workspace"],
          writeRoots: ["/workspace"]
        }
      })
      const fiber = yield* filesystem
        .watch("/workspace", { bufferSize: 8 })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* waitForRegistryEntries(registry, 1)
      const events = yield* Effect.gen(function* () {
        const attemptRef = yield* Ref.make(0)
        return yield* Effect.gen(function* () {
          const attempt = yield* Ref.getAndUpdate(attemptRef, (current) => current + 1)
          yield* filesystem.write("/workspace/file.txt", bytes(`one-${attempt}`))
          yield* filesystem.write("/workspace/file.txt", bytes(`two-${attempt}`))
          const collected = yield* Fiber.join(fiber).pipe(Effect.timeoutOption("1 millis"))
          if (Option.isSome(collected)) {
            return collected.value
          }
          return yield* Effect.fail(new Error("watch events not collected"))
        }).pipe(
          Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(50)))),
          Effect.catch(() => Fiber.join(fiber))
        )
      })
      const registryAfterWatch = yield* registry.list()

      return {
        events: Array.from(events).map((event) => ({
          kind: event.kind,
          path: event.path.replaceAll("\\", "/"),
          directory: event.directory.replaceAll("\\", "/"),
          filename: event.filename
        })),
        leaks: registryAfterWatch.entries
      }
    })
  )

  expect(result.events).toHaveLength(2)
  expect(result.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "/workspace/file.txt",
        directory: "/workspace",
        filename: "file.txt"
      })
    ])
  )
  expect(
    result.events.every((event) => event.kind === "created" || event.kind === "modified")
  ).toBe(true)
  expect(result.leaks).toEqual([])
})

test("MemoryFilesystem preserves symlink escape failures through the real service policy", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, TEST_OWNER, {
      directories: ["/allowed", "/outside"],
      files: [{ path: "/outside/secret.txt", bytes: bytes("secret") }],
      symlinks: [{ path: "/allowed/link.txt", target: "/outside/secret.txt" }],
      permissions: {
        readRoots: ["/allowed"]
      }
    })
  )

  const exit = await Effect.runPromiseExit(filesystem.read("/allowed/link.txt"))

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(JSON.stringify(exit.cause.toJSON())).toContain("SymlinkEscapesRoot")
  }
})

test("MemoryFilesystem follows symlinks in intermediate path segments", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, TEST_OWNER, {
      directories: ["/allowed", "/target"],
      files: [{ path: "/target/file.txt", bytes: bytes("resolved") }],
      symlinks: [{ path: "/allowed/linkdir", target: "/target" }],
      permissions: {
        readRoots: ["/target"]
      }
    })
  )

  const output = await Effect.runPromise(filesystem.read("/allowed/linkdir/file.txt"))

  expect(text(output)).toBe("resolved")
})

test("MemoryFilesystem resolves relative symlink fixtures from the link directory", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, TEST_OWNER, {
      directories: ["/workspace/sub"],
      files: [{ path: "/workspace/sub/file.txt", bytes: bytes("relative") }],
      symlinks: [{ path: "/workspace/link.txt", target: "sub/file.txt" }],
      permissions: {
        readRoots: ["/workspace"]
      }
    })
  )

  const output = await Effect.runPromise(filesystem.read("/workspace/link.txt"))

  expect(text(output)).toBe("relative")
})

test("MemoryFilesystem preserves symlink stat identity", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, TEST_OWNER, {
      directories: ["/workspace"],
      files: [{ path: "/workspace/target.txt", bytes: bytes("target content") }],
      symlinks: [{ path: "/workspace/link.txt", target: "target.txt" }],
      permissions: {
        readRoots: ["/workspace"]
      }
    })
  )

  const stat = await Effect.runPromise(filesystem.stat("/workspace/link.txt"))
  const output = await Effect.runPromise(filesystem.read("/workspace/link.txt"))

  expect(stat.kind).toBe("symlink")
  expect(stat.path.replaceAll("\\", "/")).toBe("/workspace/link.txt")
  expect(text(output)).toBe("target content")
})

test("MemoryFilesystem writeAtomic replaces symlink without changing target", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, TEST_OWNER, {
      directories: ["/workspace"],
      files: [{ path: "/workspace/target.txt", bytes: bytes("target") }],
      symlinks: [{ path: "/workspace/link.txt", target: "target.txt" }],
      permissions: {
        readRoots: ["/workspace"],
        writeRoots: ["/workspace"]
      }
    })
  )

  await Effect.runPromise(filesystem.writeAtomic("/workspace/link.txt", bytes("replacement")))
  const target = await Effect.runPromise(filesystem.read("/workspace/target.txt"))
  const link = await Effect.runPromise(filesystem.read("/workspace/link.txt"))
  const linkStat = await Effect.runPromise(filesystem.stat("/workspace/link.txt"))

  expect(text(target)).toBe("target")
  expect(text(link)).toBe("replacement")
  expect(linkStat.kind).toBe("file")
})

test("MemoryFilesystem rejects directory targets for writes and atomic renames", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, TEST_OWNER, {
      directories: ["/workspace/target"],
      permissions: {
        readRoots: ["/workspace"],
        writeRoots: ["/workspace"]
      }
    })
  )

  const writeExit = await Effect.runPromiseExit(filesystem.write("/workspace/target", bytes("x")))
  const atomicExit = await Effect.runPromiseExit(
    filesystem.writeAtomic("/workspace/target", bytes("x"))
  )
  const stat = await Effect.runPromise(filesystem.stat("/workspace/target"))

  expect(Exit.isFailure(writeExit)).toBe(true)
  expect(Exit.isFailure(atomicExit)).toBe(true)
  expect(stat.kind).toBe("directory")
  if (Exit.isFailure(writeExit)) {
    expect(JSON.stringify(writeExit.cause.toJSON())).toContain("InvalidArgument")
  }
  if (Exit.isFailure(atomicExit)) {
    expect(JSON.stringify(atomicExit.cause.toJSON())).toContain("InvalidArgument")
  }
})

test("MemoryFilesystem mkdir preserves existing nodes instead of clobbering them", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, TEST_OWNER, {
      directories: ["/workspace"],
      files: [{ path: "/workspace/file.txt", bytes: bytes("file") }],
      permissions: {
        readRoots: ["/workspace"],
        writeRoots: ["/workspace"]
      }
    })
  )

  const existingDirectoryExit = await Effect.runPromiseExit(filesystem.mkdir("/workspace"))
  const recursiveThroughFileExit = await Effect.runPromiseExit(
    filesystem.mkdir("/workspace/file.txt/child", { recursive: true })
  )
  const file = await Effect.runPromise(filesystem.read("/workspace/file.txt"))

  expect(Exit.isFailure(existingDirectoryExit)).toBe(true)
  expect(Exit.isFailure(recursiveThroughFileExit)).toBe(true)
  expect(text(file)).toBe("file")
  if (Exit.isFailure(existingDirectoryExit)) {
    expect(JSON.stringify(existingDirectoryExit.cause.toJSON())).toContain("InvalidArgument")
  }
  if (Exit.isFailure(recursiveThroughFileExit)) {
    expect(JSON.stringify(recursiveThroughFileExit.cause.toJSON())).toContain("InvalidArgument")
  }
})

test("MockProcess layer emits stdout, stderr, exit, and records stdin", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const process = yield* Process
      const handle = yield* process.spawn("git", ["status"])
      yield* Stream.make(bytes("input")).pipe(Stream.run(handle.stdin))
      const stdout = yield* Stream.runCollect(handle.stdout)
      const stderr = yield* Stream.runCollect(handle.stderr)
      const exit = yield* handle.exit
      const list = yield* process.list()

      return {
        pid: handle.pid,
        stdout: Array.from(stdout).map(text),
        stderr: Array.from(stderr).map(text),
        exit,
        list
      }
    }).pipe(
      Effect.provide(
        MockProcessLive({
          processes: [
            {
              command: "git",
              args: ["status"],
              pid: 1234,
              stdout: [bytes("ok\n")],
              stderr: [bytes("warn\n")],
              exit: { code: 7 }
            }
          ],
          permissions: {
            spawn: ["git"]
          },
          now: () => 1710000000700
        }).pipe(
          Layer.provide(ResourceRegistryLive),
          Layer.provide(ResourceOwner.test("scope-main"))
        )
      )
    )
  )

  expect(result.pid).toBe(1234)
  expect(result.stdout).toEqual(["ok\n"])
  expect(result.stderr).toEqual(["warn\n"])
  expect(result.exit.code).toBe(7)
  expect(result.list).toMatchObject([
    {
      pid: 1234,
      command: "git",
      args: ["status"],
      state: "exited"
    }
  ])
})

test("makeMockProcess records kill and scope cleanup through the real registry", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({ nextId: () => id("process-1") })
      const process = yield* makeMockProcess(registry, TEST_OWNER, {
        processes: [{ command: "sleep", pid: 4321, exit: false }],
        permissions: { spawn: ["sleep"] },
        gracefulShutdownMs: 1
      })
      const handle = yield* process.spawn("sleep", ["10"])
      yield* handle.kill("SIGTERM")
      const exit = yield* handle.exit
      const afterExit = yield* registry.list()

      const cleanup = yield* makeMockProcess(registry, TEST_OWNER, {
        processes: [{ command: "tail", pid: 4322, exit: false }],
        permissions: { spawn: ["tail"] },
        gracefulShutdownMs: 1
      })
      yield* cleanup.spawn("tail", ["-f"])
      yield* registry.closeScope("scope-main")

      return {
        exit,
        afterExit: afterExit.entries,
        killed: process.calls()[0]?.killedWith,
        cleanup: cleanup.calls()[0]
      }
    })
  )

  expect(result.exit).toMatchObject({ code: 0, signal: "SIGTERM" })
  expect(result.afterExit).toEqual([])
  expect(result.killed).toBe("SIGTERM")
  expect(result.cleanup?.terminateTreeCalls).toBe(1)
})

test("Sidecar starts a scoped process and derives readiness from stdout", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      let resourceIndex = 0
      const registry = yield* makeResourceRegistry({
        nextId: () => id(`sidecar-resource-${(resourceIndex += 1)}`)
      })
      const process = yield* makeMockProcess(registry, TEST_OWNER, {
        processes: [
          {
            command: "server",
            args: ["serve"],
            pid: 9876,
            stdout: [bytes("booting\nREADY http://127.0.0.1:4317\n")],
            exit: false
          }
        ],
        permissions: { spawn: ["server"] }
      })
      const sidecar = yield* makeSidecar(process, registry)
      const handle = yield* sidecar.start(
        new SidecarCommand({
          args: ["serve"],
          command: "server",
          ownerScope: "scope-main"
        }),
        { readiness: { _tag: "Line", match: "READY", stream: "stdout" } }
      )
      const ready = yield* handle.ready
      const status = yield* handle.status
      const resourcesBeforeClose = yield* registry.list()
      yield* handle.close()
      const resourcesAfterClose = yield* registry.list()

      return { ready, resourcesAfterClose, resourcesBeforeClose, status }
    })
  )

  expect(result.ready).toMatchObject({
    line: "READY http://127.0.0.1:4317",
    pid: 9876,
    stream: "stdout"
  })
  expect(result.status._tag).toBe("Ready")
  expect(result.resourcesBeforeClose.entries.map((entry) => entry.handle.kind).sort()).toEqual([
    "process",
    "sidecar"
  ])
  expect(result.resourcesAfterClose.entries).toEqual([])
})

test("Sidecar reports typed readiness failure instead of polling a port", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const process = yield* makeMockProcess(registry, TEST_OWNER, {
        processes: [{ command: "server", stdout: [bytes("listening somewhere else\n")] }],
        permissions: { spawn: ["server"] }
      })
      const sidecar = yield* makeSidecar(process, registry)
      const handle = yield* sidecar.start(
        new SidecarCommand({
          args: [],
          command: "server",
          ownerScope: "scope-main"
        }),
        { readiness: { _tag: "Line", match: "READY", stream: "stdout" } }
      )
      return yield* handle.ready
    })
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(JSON.stringify(exit.cause.toJSON())).toContain("SidecarError")
    expect(JSON.stringify(exit.cause.toJSON())).toContain("readiness")
  }
})

test("MockProcess fails loudly when a command has no fixture", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const process = await Effect.runPromise(
    makeMockProcess(registry, TEST_OWNER, {
      permissions: { spawn: ["missing"] }
    })
  )

  const exit = await Effect.runPromiseExit(process.spawn("missing", []))

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(JSON.stringify(exit.cause.toJSON())).toContain("InvalidArgument")
  }
})

test("MockProcess rejects stdin writes after process exit", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const process = await Effect.runPromise(
    makeMockProcess(registry, TEST_OWNER, {
      processes: [{ command: "cat", exit: { code: 0 } }],
      permissions: { spawn: ["cat"] }
    })
  )
  const handle = await Effect.runPromise(process.spawn("cat", []))
  await Effect.runPromise(handle.exit)

  const exit = await Effect.runPromiseExit(
    Stream.make(bytes("late")).pipe(Stream.run(handle.stdin))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  expect(process.calls()[0]?.stdin.map(text)).toEqual([])
})

test("MockPTY layer emits output, records writes and resizes, and exits", async () => {
  const layerResult = await Effect.runPromise(
    Effect.gen(function* () {
      const pty = yield* PTY
      const handle = yield* pty.open({
        argv: ["bash", "-l"],
        rows: 24,
        cols: 80
      })
      const output = yield* Stream.runCollect(handle.output)
      const exit = yield* handle.onExit

      return {
        output: Array.from(output).map(text),
        exit
      }
    }).pipe(
      Effect.provide(
        MockPtyLayer({
          ptys: [{ command: "bash", args: ["-l"], output: [bytes("layer")], exit: { code: 0 } }],
          permissions: { spawn: ["bash"] },
          budgets: { outputCoalesceBytes: 1024, outputCoalesceMs: 1 }
        }).pipe(
          Layer.provide(ResourceRegistryLive),
          Layer.provide(ResourceOwner.test("scope-main"))
        )
      )
    )
  )

  expect(layerResult.output).toEqual(["layer"])
  expect(layerResult.exit.code).toBe(0)

  const registry = await Effect.runPromise(makeResourceRegistry())
  const pty = await Effect.runPromise(
    makeMockPty(registry, TEST_OWNER, {
      ptys: [
        {
          command: "bash",
          args: ["-l"],
          pid: null,
          output: [bytes("prompt")],
          exit: false
        }
      ],
      permissions: { spawn: ["bash"] },
      budgets: {
        outputCoalesceBytes: 1024,
        outputCoalesceMs: 1
      }
    })
  )

  const handle = await Effect.runPromise(pty.open({ argv: ["bash", "-l"], rows: 24, cols: 80 }))
  await Effect.runPromise(handle.write(bytes("echo hi\n")))
  await Effect.runPromise(handle.resize({ rows: 40, cols: 120 }))
  const output = await Effect.runPromise(Stream.runCollect(handle.output))
  await Effect.runPromise(handle.kill("SIGTERM"))
  const exit = await Effect.runPromise(handle.onExit)
  const calls = pty.calls()
  const afterExit = await Effect.runPromise(registry.list())

  expect(handle.pid._tag).toBe("None")
  expect(Array.from(output).map(text)).toEqual(["prompt"])
  expect(exit.code).toBe(0)
  expect(exit.signal).toBe("SIGTERM")
  expect(calls[0]?.pid).toBeUndefined()
  expect(calls[0]?.writes.map(text)).toEqual(["echo hi\n"])
  expect(calls[0]?.resizes).toEqual([{ rows: 40, cols: 120 }])
  expect(afterExit.entries).toEqual([])
})

test("MockPTY closes through scope cleanup with the real PTY disposer", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry({ nextId: () => id("pty-1") }))
  const pty = await Effect.runPromise(
    makeMockPty(registry, TEST_OWNER, {
      ptys: [{ command: "bash", exit: false }],
      permissions: { spawn: ["bash"] },
      gracefulShutdownMs: 1
    })
  )

  await Effect.runPromise(pty.open({ argv: ["bash"], rows: 24, cols: 80 }))
  await Effect.runPromise(registry.closeScope("scope-main"))

  expect(pty.calls()[0]?.terminateTreeCalls).toBe(1)
})

test("MockPTY fails loudly when a command has no fixture", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const pty = await Effect.runPromise(
    makeMockPty(registry, TEST_OWNER, {
      permissions: { spawn: ["missing"] }
    })
  )

  const exit = await Effect.runPromiseExit(pty.open({ argv: ["missing"], rows: 24, cols: 80 }))

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(JSON.stringify(exit.cause.toJSON())).toContain("InvalidArgument")
  }
})

test("MockPTY rejects writes and resizes after exit", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const pty = await Effect.runPromise(
    makeMockPty(registry, TEST_OWNER, {
      ptys: [{ command: "bash", exit: { code: 0 } }],
      permissions: { spawn: ["bash"] },
      budgets: { outputCoalesceBytes: 1024, outputCoalesceMs: 1 }
    })
  )
  const handle = await Effect.runPromise(pty.open({ argv: ["bash"], rows: 24, cols: 80 }))
  await Effect.runPromise(handle.onExit)

  const writeExit = await Effect.runPromiseExit(handle.write(bytes("late")))
  const resizeExit = await Effect.runPromiseExit(handle.resize({ rows: 40, cols: 120 }))

  expect(Exit.isFailure(writeExit)).toBe(true)
  expect(Exit.isFailure(resizeExit)).toBe(true)
  expect(pty.calls()[0]?.writes.map(text)).toEqual([])
  expect(pty.calls()[0]?.resizes).toEqual([])
})

test("HeadlessRuntime layer composes mocks with real registry telemetry and permissions", async () => {
  const ProjectRpcs = bridgeContractFromRpcGroup(
    "Test.HeadlessRuntime.Project",
    RpcGroup.make(
      Rpc.make("Test.HeadlessRuntime.Project.open", {
        payload: Schema.Struct({ path: Schema.String }),
        success: Schema.Struct({ id: Schema.String }),
        error: Schema.Never
      })
    )
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const filesystem = yield* Filesystem
      const process = yield* Process
      const pty = yield* PTY
      const telemetry = yield* Telemetry
      const permissions = yield* PermissionRegistry
      const host = yield* MockHost
      const bridge = yield* MockBridge
      const owner = yield* ResourceOwner

      yield* bridge.succeed("Test.HeadlessRuntime.Project.open", { id: "project-1" })
      const client = bridge.client({ project: ProjectRpcs })
      const opened = yield* client.project.open({ path: "/workspace/project" })

      yield* filesystem.write("/workspace/out.txt", bytes("file"))
      const file = yield* filesystem.read("/workspace/out.txt")

      const child = yield* process.spawn("echo", ["ok"])
      const stdout = yield* Stream.runCollect(child.stdout)
      const processExit = yield* child.exit

      const terminal = yield* pty.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* terminal.write(bytes("pwd\n"))
      const terminalOutput = yield* Stream.runCollect(terminal.output)
      const ptyExit = yield* terminal.onExit

      yield* telemetry.log({
        level: "info",
        subsystem: "test",
        operation: "HeadlessRuntime",
        traceId: "trace-headless",
        message: "ran"
      })
      const logs = yield* telemetry.listLogs()
      const decisions = yield* permissions.listDecisions()

      return {
        opened,
        file: text(file),
        stdout: Array.from(stdout).map(text),
        processExit,
        terminalOutput: Array.from(terminalOutput).map(text),
        ptyExit,
        hostCalls: host.calls().map((call) => call.method),
        bridgeCalls: bridge.calls().map((call) => call.method),
        logs: logs.map((log) => log.message),
        decisions,
        ownerKind: owner.kind,
        ownerScope: owner.scopeId
      }
    }).pipe(
      Effect.provide(
        HeadlessRuntime.layer({
          filesystem: {
            directories: ["/workspace"],
            permissions: {
              readRoots: ["/workspace"],
              writeRoots: ["/workspace"]
            }
          },
          process: {
            processes: [{ command: "echo", args: ["ok"], stdout: [bytes("ok\n")] }],
            permissions: { spawn: ["echo"] }
          },
          pty: {
            ptys: [{ command: "bash", output: [bytes("prompt")] }],
            permissions: { spawn: ["bash"] },
            budgets: { outputCoalesceBytes: 1024, outputCoalesceMs: 1 }
          },
          telemetry: { now: () => 1710000000800 },
          permissions: { traceId: () => "trace-permission" }
        })
      )
    )
  )

  expect(result).toEqual({
    opened: { id: "project-1" },
    file: "file",
    stdout: ["ok\n"],
    processExit: { code: 0 },
    terminalOutput: ["prompt"],
    ptyExit: { code: 0 },
    hostCalls: [],
    bridgeCalls: ["Test.HeadlessRuntime.Project.open"],
    logs: ["ran"],
    decisions: [],
    ownerKind: "test",
    ownerScope: "headless"
  })
})

test("HeadlessRuntime run fails when scoped resources leak", async () => {
  const exit = await Effect.runPromiseExit(
    HeadlessRuntime.run(
      Effect.gen(function* () {
        const process = yield* Process
        yield* process.spawn("sleep", ["10"])
      }),
      {
        process: {
          processes: [{ command: "sleep", args: ["10"], exit: false }],
          permissions: { spawn: ["sleep"] },
          gracefulShutdownMs: 1
        }
      }
    )
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(JSON.stringify(exit.cause.toJSON())).toContain("ResourceLeakError")
  }
})

test("runHeadless fails when a headless window is left open", async () => {
  let error: unknown

  try {
    await Effect.runPromise(
      runHeadless(
        (runtime) =>
          Effect.gen(function* () {
            yield* runtime.window.create({ title: "Leaked" })
          }),
        {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace"),
          now: () => 1710000000200
        }
      )
    )
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ResourceLeakError)
  if (error instanceof ResourceLeakError) {
    expect(error.message).toContain("kind: window")
    expect(error.message).toContain("ownerScope: headless")
  }
})

test("runHeadless preserves typed destroy errors from the mock host", async () => {
  const result = await Effect.runPromise(
    runHeadless(
      (runtime) =>
        Effect.gen(function* () {
          const window = yield* runtime.window.create({ title: "Destroy failure" })
          const destroyExit = yield* Effect.exit(runtime.window.destroy(window.windowId))
          yield* runtime.registry.closeScope("headless")

          return destroyExit
        }),
      {
        fixtures: {
          [WINDOW_DESTROY_METHOD]: () =>
            Effect.fail(makeHostProtocolNotFoundError("headless-window", WINDOW_DESTROY_METHOD))
        },
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace"),
        now: () => 1710000000300
      }
    )
  )

  expect(result._tag).toBe("Failure")
  if (result._tag === "Failure") {
    expect(JSON.stringify(result.cause.toJSON())).toContain("NotFound")
  }
})

test("makeMemorySecretsSafeStorage backs Secrets with copied in-memory values", async () => {
  const storage = makeMemorySecretsSafeStorage()
  const secrets = await Effect.runPromise(
    makeSecrets(storage, {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] }
    })
  )
  const original = makeSecretBytesFromUtf8("refresh-token")

  await Effect.runPromise(secrets.set("auth", "token", original))
  await Effect.runPromise(wipeSecretBytes(original))
  const stored = await Effect.runPromise(secrets.get("auth", "token"))
  const snapshot = await Effect.runPromise(storage.snapshot())
  await Effect.runPromise(secrets.delete("auth", "token"))
  const missing = await Effect.runPromiseExit(secrets.get("auth", "token"))

  expect(new TextDecoder().decode(unsafeSecretBytes(stored))).toBe("refresh-token")
  expect([...snapshot.keys()]).toEqual(["com.rika.test/auth/token"])
  expect(Exit.isFailure(missing)).toBe(true)
  if (Exit.isFailure(missing)) {
    expect(JSON.stringify(missing.cause.toJSON())).toContain("SecretNotFound")
  }
})

test("makeMemorySecretsSafeStorage models unavailable platform storage as typed values", async () => {
  const secrets = await Effect.runPromise(
    makeSecrets(makeMemorySecretsSafeStorage({ available: false }), {
      appId: "com.rika.test",
      permissions: { read: ["auth"], write: ["auth"] }
    })
  )

  const unavailable = await Effect.runPromiseExit(
    secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
  )

  expect(Exit.isFailure(unavailable)).toBe(true)
  if (Exit.isFailure(unavailable)) {
    expect(JSON.stringify(unavailable.cause.toJSON())).toContain("SafeStorageUnavailable")
  }
})

test("FailureAssertions matches tagged failures through Exit", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeText("blocked")
    }).pipe(Effect.provide(makeClipboardServiceLayer(makeUnavailableClipboardClient())))
  )

  FailureAssertions.expectFailureTag(exit, "Unsupported")
})

test("Clipboard unavailable platform layer reports unsupported selection capability", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* ClipboardClient
      return yield* client.isSupported("selection")
    }).pipe(Effect.provide(makeClipboardClientLayer(makeUnavailableClipboardClient())))
  )

  expect(result).toEqual(
    new ClipboardSupportedResult({
      supported: false,
      reason: "test clipboard client is unavailable"
    })
  )
})

test("Clipboard bridge layer propagates host failures through the service", async () => {
  const bridge = makeMockBridge()
  await Effect.runPromise(
    bridge.fail("Clipboard.readText", {
      tag: "Unsupported",
      reason: "host failure",
      message: "clipboard host failed",
      operation: "Clipboard.readText",
      recoverable: false
    })
  )

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      return yield* clipboard.readText()
    }).pipe(
      Effect.provide(
        Layer.provide(ClipboardLive, ClipboardSurface.bridgeClientLayer(bridge.exchange))
      )
    )
  )

  FailureAssertions.expectFailureTag(exit, "Unsupported")
})

const makeUnavailableClipboardClient = (): ClipboardClientApi => {
  const unsupported = (method: string) =>
    new HostProtocolUnsupportedError({
      tag: "Unsupported",
      reason: "test clipboard client is unavailable",
      message: `unsupported Clipboard method: ${method}`,
      operation: method,
      recoverable: false
    })

  const fail = <A>(method: string): Effect.Effect<A, HostProtocolUnsupportedError, never> =>
    Effect.fail(unsupported(method))

  return {
    readText: () => fail("Clipboard.readText"),
    writeText: () => fail("Clipboard.writeText"),
    readHtml: () => fail("Clipboard.readHtml"),
    writeHtml: () => fail("Clipboard.writeHtml"),
    readImage: () => fail("Clipboard.readImage"),
    writeImage: () => fail("Clipboard.writeImage"),
    clear: () => fail("Clipboard.clear"),
    isSupported: () =>
      Effect.succeed(
        new ClipboardSupportedResult({
          supported: false,
          reason: "test clipboard client is unavailable"
        })
      )
  }
}

test("LayerMatrix interruption closes scoped capability layers", async () => {
  class InterruptibleService extends Context.Service<
    InterruptibleService,
    { readonly wait: Effect.Effect<never, never, never> }
  >()("@effect-desktop/test/InterruptibleService") {}

  let acquired = 0
  let released = 0
  const layer = Layer.effectContext(
    Effect.acquireRelease(
      Effect.sync(() => {
        acquired += 1
        return Context.make(InterruptibleService, { wait: Effect.never })
      }),
      () =>
        Effect.sync(() => {
          released += 1
        })
    )
  )

  const exit = await Effect.runPromise(
    LayerMatrix.interrupt(
      layer,
      Effect.gen(function* () {
        const service = yield* InterruptibleService
        return yield* service.wait
      })
    )
  )

  FailureAssertions.expectInterrupted(exit)
  expect(acquired).toBe(1)
  expect(released).toBe(1)
})

test("native capability programs run unchanged through Live, Client, and Test layers", async () => {
  const screenProgram: Effect.Effect<string, ScreenError, Screen> = Effect.gen(function* () {
    const screen = yield* Screen
    const display = yield* screen.getPrimaryDisplay()
    return display.id
  })
  const screenDisplayPayload = {
    id: "primary",
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 24, width: 1440, height: 876 },
    scaleFactor: 2,
    primary: true
  } as const
  const screenDisplay = new ScreenDisplay(screenDisplayPayload)
  const screenLiveClient: ScreenClientApi = Object.freeze({
    getDisplays: () => Effect.succeed(new ScreenDisplaysResult({ displays: [screenDisplay] })),
    getPrimaryDisplay: () => Effect.succeed(screenDisplay),
    getPointerPoint: () => Effect.succeed(new ScreenPoint({ x: 10, y: 20 })),
    isSupported: () => Effect.succeed(new ScreenSupportedResult({ supported: true }))
  })
  const screenBridge = makeMockBridge()
  await Effect.runPromise(screenBridge.succeed("Screen.getPrimaryDisplay", screenDisplayPayload))

  const dialogProgram: Effect.Effect<string, DialogError, Dialog> = Effect.gen(function* () {
    const dialog = yield* Dialog
    const openPaths = yield* dialog.openFile({ defaultPath: "/tmp/input.txt" })
    const savePath = yield* dialog.saveFile({ defaultPath: "/tmp/output.txt" })
    yield* dialog.message({ level: "info", message: "Saved", detail: "details" })
    const confirmed = yield* dialog.confirm({ message: "Proceed?", confirmLabel: "Yes" })
    return `${openPaths.join(",")}:${savePath}:${confirmed ? "confirmed" : "cancelled"}`
  })
  const dialogOptions = {
    openFilePaths: ["/tmp/input.txt"],
    saveFilePath: "/tmp/output.txt",
    confirmResult: true
  } as const
  const dialogLiveClient: DialogClientApi = Object.freeze({
    openFile: () =>
      Effect.succeed(new DialogOpenResult({ paths: [...dialogOptions.openFilePaths] })),
    openDirectory: () => Effect.succeed(new DialogOpenResult({ paths: [] })),
    saveFile: () => Effect.succeed(new DialogSaveResult({ path: dialogOptions.saveFilePath })),
    message: () => Effect.void,
    confirm: () =>
      Effect.succeed(new DialogConfirmResult({ confirmed: dialogOptions.confirmResult }))
  })
  const dialogBridge = makeMockBridge()
  await Effect.runPromise(
    Effect.all([
      dialogBridge.succeed("Dialog.openFile", { paths: ["/tmp/input.txt"] }),
      dialogBridge.succeed("Dialog.saveFile", { path: "/tmp/output.txt" }),
      dialogBridge.succeed("Dialog.message", undefined),
      dialogBridge.succeed("Dialog.confirm", { confirmed: true })
    ])
  )

  const cases = [
    {
      name: "Screen",
      expected: "primary",
      calls: () => screenBridge.calls().map((call) => call.method),
      expectedCalls: ["Screen.getPrimaryDisplay"],
      runLive: () =>
        Effect.runPromise(
          screenProgram.pipe(
            Effect.provide(Layer.provide(ScreenLive, makeScreenClientLayer(screenLiveClient)))
          )
        ),
      runClient: () =>
        Effect.runPromise(
          screenProgram.pipe(
            Effect.provide(
              Layer.provide(ScreenLive, ScreenSurface.bridgeClientLayer(screenBridge.exchange))
            )
          )
        ),
      runTest: () =>
        Effect.runPromise(
          screenProgram.pipe(
            Effect.provide(
              ScreenTest({
                displays: [
                  {
                    id: "primary",
                    bounds: { width: 1440, height: 900 },
                    workArea: { y: 24, width: 1440, height: 876 },
                    scaleFactor: 2,
                    primary: true
                  }
                ]
              })
            )
          )
        )
    },
    {
      name: "Dialog",
      expected: "/tmp/input.txt:/tmp/output.txt:confirmed",
      calls: () => dialogBridge.calls().map((call) => call.method),
      expectedCalls: ["Dialog.openFile", "Dialog.saveFile", "Dialog.message", "Dialog.confirm"],
      runLive: () =>
        Effect.runPromise(
          dialogProgram.pipe(Effect.provide(makeDialogServiceLayer(dialogLiveClient)))
        ),
      runClient: () =>
        Effect.runPromise(
          dialogProgram.pipe(
            Effect.provide(
              Layer.provide(DialogLive, DialogSurface.bridgeClientLayer(dialogBridge.exchange))
            )
          )
        ),
      runTest: () =>
        Effect.runPromise(dialogProgram.pipe(Effect.provide(DialogTest(dialogOptions))))
    }
  ] as const

  for (const capability of cases) {
    const [live, client, test] = await Promise.all([
      capability.runLive(),
      capability.runClient(),
      capability.runTest()
    ])

    expect({ name: capability.name, live, client, test }).toEqual({
      name: capability.name,
      live: capability.expected,
      client: capability.expected,
      test: capability.expected
    })
    expect(capability.calls()).toEqual(Array.from(capability.expectedCalls))
  }
})

test("native test layers are derived from DesktopRpc surfaces", async () => {
  expect(TestNativeSurfaces.map((surface) => surface.tag)).toEqual([
    "ActivationRegistry",
    "App",
    "AttachmentIntake",
    "Clipboard",
    "ContextMenu",
    "CrashReporter",
    "DiagnosticsBundle",
    "DistributionParity",
    "DisplayCapture",
    "Dialog",
    "EgressPolicy",
    "ExecutionSandbox",
    "ExtensionConfig",
    "ExtensionPackage",
    "FocusedApplicationContext",
    "Job",
    "LocalToolRuntime",
    "TransientWindowRole",
    "TransactionalFileMutation",
    "WorkspaceIndex",
    "Dock",
    "GlobalShortcut",
    "Menu",
    "Notification",
    "Path",
    "PowerMonitor",
    "Protocol",
    "RealtimeMediaSession",
    "ResidentLifecycle",
    "SafeStorage",
    "ScopedAccessGrant",
    "SelectionContext",
    "Screen",
    "Shell",
    "SystemAppearance",
    "Tray",
    "Updater",
    "WebView",
    "Window"
  ])

  for (const surface of TestNativeSurfaces) {
    for (const law of surface.contractLaws) {
      await Effect.runPromise(law.check)
    }
  }

  const malformedWrite = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const clipboard = yield* ClipboardClient
      // @ts-expect-error Runtime schema rejection is the contract under test.
      yield* clipboard.writeText(123)
    }).pipe(
      Effect.provide(ClipboardSurface.testClientLayer),
      Effect.provide(makeClipboardScenarioLayer({}))
    )
  )

  expect(Exit.isFailure(malformedWrite)).toBe(true)
})

const nextSequence = (prefix: string): (() => string) => {
  let next = 0

  return () => `${prefix}-${next++}`
}

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

const text = (value: Uint8Array): string => new TextDecoder().decode(value)

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
