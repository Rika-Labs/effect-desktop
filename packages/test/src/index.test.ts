import { expect, test } from "bun:test"
import {
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Ref,
  Schedule,
  Schema,
  Stream
} from "effect"
import { TestClock } from "effect/testing"

const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

class WaitForEntriesTimeout extends Schema.TaggedErrorClass<WaitForEntriesTimeout>()(
  "WaitForEntriesTimeout",
  { count: Schema.Number }
) {}

class WatchEventsMissing extends Schema.TaggedErrorClass<WatchEventsMissing>()(
  "WatchEventsMissing",
  {}
) {}

class MockHostCallMissing extends Schema.TaggedErrorClass<MockHostCallMissing>()(
  "MockHostCallMissing",
  {}
) {}

class MockBridgeCallMissing extends Schema.TaggedErrorClass<MockBridgeCallMissing>()(
  "MockBridgeCallMissing",
  {}
) {}

class TestWindowMissing extends Schema.TaggedErrorClass<TestWindowMissing>()(
  "TestWindowMissing",
  {}
) {}

import {
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  WINDOW_FOCUS_METHOD,
  WINDOW_GET_CURRENT_METHOD,
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
} from "@orika/bridge"
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
} from "@orika/core"
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
  Window,
  type DialogClientApi,
  type ClipboardClientApi,
  type DialogError,
  type ScreenClientApi,
  type ScreenError,
  DialogClient
} from "@orika/native"
import {
  ClipboardImage,
  ClipboardSupportedResult,
  DialogConfirmResult,
  DialogOpenResult,
  DialogSaveResult,
  ScreenDisplay,
  ScreenPoint
} from "@orika/native/contracts"

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
} from "@orika/test/bridge"
import { MemoryFilesystemLive as SubpathMemoryFilesystemLive } from "@orika/test/core"
import {
  ClipboardTest as SubpathClipboardTest,
  TestDesktop as SubpathTestDesktop
} from "@orika/test/native"
import { CapabilityLaws as SubpathCapabilityLaws } from "@orika/test/renderer"

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
            : Effect.fail(new WaitForEntriesTimeout({ count }))
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
  "support queries return structured results": (clipboard) =>
    Effect.gen(function* () {
      const textSupported = yield* clipboard.isSupported("text")
      const htmlSupported = yield* clipboard.isSupported("html")
      const imageSupported = yield* clipboard.isSupported("image")
      const clearSupported = yield* clipboard.isSupported("clear")
      const selectionSupported = yield* clipboard.isSupported("selection")
      expect(textSupported).toEqual(new ClipboardSupportedResult({ supported: true }))
      expect(htmlSupported).toEqual(new ClipboardSupportedResult({ supported: true }))
      expect(imageSupported).toEqual(new ClipboardSupportedResult({ supported: true }))
      expect(clearSupported).toEqual(new ClipboardSupportedResult({ supported: true }))
      expect(selectionSupported).toEqual(new ClipboardSupportedResult({ supported: true }))
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

test("ClipboardTest clear removes image state", () => {
  const runtime = ManagedRuntime.make(ClipboardTest())
  return runtime.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeImage({ mime: "image/png", bytes: TEST_CLIPBOARD_IMAGE_BYTES })
      yield* clipboard.clear()
      const image = yield* clipboard.readImage()
      expect(image).toEqual(new ClipboardImage({ mime: "image/png", bytes: new Uint8Array(0) }))
    })
  )
})

test("ClipboardTest unsupported capabilities return support reasons", () => {
  const runtime = ManagedRuntime.make(ClipboardTest({ supported: { selection: false } }))
  return runtime.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      const result = yield* clipboard.isSupported("selection")

      expect(result).toEqual(
        new ClipboardSupportedResult({
          supported: false,
          reason: "test clipboard capability unsupported"
        })
      )
    })
  )
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
    case "support queries return structured results":
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

test("public bridge subpath exposes host and bridge fixtures", () => {
  const bridge = makeSubpathMockBridge({ now: () => 1710000000050 })
  const runtime = ManagedRuntime.make(SubpathMockHostLive({ now: () => 1710000000052 }))
  return runtime.runPromise(
    Effect.gen(function* () {
      yield* bridge.succeed("Test.Subpath.open", { id: "project-1" })
      const host = yield* SubpathMockHost
      const response = yield* host.request(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-1",
          timestamp: 1710000000051,
          traceId: "trace-1",
          method: HOST_VERSION_METHOD,
          payload: undefined
        })
      )
      expect(bridge.calls()).toEqual([])
      expect(response.payload).toEqual({ protocolVersion: HOST_PROTOCOL_VERSION })
    })
  )
})

test("public core subpath exposes composable core fixture layers", () => {
  const runtime = ManagedRuntime.make(
    SubpathMemoryFilesystemLive({
      directories: ["/workspace"],
      permissions: {
        readRoots: ["/workspace"],
        writeRoots: ["/workspace"]
      }
    }).pipe(Layer.provide(ResourceRegistryLive), Layer.provide(ResourceOwner.test("scope-main")))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const filesystem = yield* Filesystem
      yield* filesystem.write("/workspace/subpath.txt", bytes("core"))
      const file = yield* filesystem.read("/workspace/subpath.txt")
      expect(text(file)).toBe("core")
    })
  )
})

test("public native subpath exposes deterministic native service layers", () => {
  const runtime = ManagedRuntime.make(SubpathClipboardTest())
  return runtime.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeText("native")
      const textValue = yield* clipboard.readText()
      expect(textValue).toBe("native")
    })
  )
})

test("public native subpath exposes a composed desktop test layer with inspectable windows", () => {
  const runtime = ManagedRuntime.make(Layer.mergeAll(SubpathTestDesktop.layer(), TestClock.layer()))
  return runtime.runPromise(
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
          return yield* new TestWindowMissing()
        }
        yield* window.close(first.window)
        yield* SubpathTestDesktop.expectNoLeakedResources

        expect(opened).toMatchObject([
          {
            input: { title: "Notes", width: 800, height: 600 },
            window: { kind: "window", state: "open" }
          }
        ])
      })
    )
  )
})

test("public native subpath desktop test layer reports leaked windows", () => {
  const runtime = ManagedRuntime.make(SubpathTestDesktop.layer())
  return runtime.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const window = yield* Window
          yield* window.create({ title: "Leaked" })
          return yield* SubpathTestDesktop.expectNoLeakedResources
        })
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(encodeJsonString(exit.cause.toJSON())).toContain("ResourceLeakError")
      }
    })
  )
})

test("public native subpath desktop test layer can simulate denied permissions", () => {
  const runtime = ManagedRuntime.make(SubpathTestDesktop.layer({ permissions: "deny-all" }))
  return runtime.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
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
        })
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(encodeJsonString(exit.cause.toJSON())).toContain("PermissionDenied")
      }
    })
  )
})

test("public renderer subpath exposes shared capability law helpers", () => {
  expect(typeof SubpathCapabilityLaws.make).toBe("function")
  expect(typeof SubpathCapabilityLaws.run).toBe("function")
})

test("assertNoOpenResourcesIn fails with a leaked-handle report", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
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

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
        const error = fail?.error
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
      }
    })
  ))

test("leakedHandles ignores app handles by default without exempting app-owned resources", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ids = [
        id("018e2f36-5800-7000-8000-000000000102"),
        id("018e2f36-5800-7000-8000-000000000104")
      ]
      let nextIdIndex = 0
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
      const snapshot = yield* registry.list()

      expect(leakedHandles(snapshot).map((entry) => entry.handle.id)).toEqual([window.id])
    })
  ))

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

test("runHeadless records host calls and exits without leaked windows", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runHeadless(
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

      expect(result.calls).toEqual([
        "host.ping",
        "host.version",
        WINDOW_CREATE_METHOD,
        WINDOW_DESTROY_METHOD
      ])
      expect(result.protocolVersion).toBe(HOST_PROTOCOL_VERSION)
    })
  ))

test("runHeadless tracks the focused host window for getCurrent", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runHeadless(
        (runtime) =>
          Effect.gen(function* () {
            const first = yield* runtime.window.create({ title: "First" })
            const second = yield* runtime.window.create({ title: "Second" })
            const currentBeforeFocus = yield* runtime.window.getCurrent()
            yield* runtime.window.focus(second.windowId)
            const currentAfterFocus = yield* runtime.window.getCurrent()
            yield* runtime.window.destroy(second.windowId)
            yield* runtime.window.destroy(first.windowId)

            return {
              calls: runtime.calls().map((call) => call.method),
              currentAfterFocus: currentAfterFocus.windowId,
              currentBeforeFocus: currentBeforeFocus.windowId,
              first: first.windowId,
              second: second.windowId
            }
          }),
        {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace"),
          now: () => 1710000000100
        }
      )

      expect(result.currentBeforeFocus).toBe(result.first)
      expect(result.currentAfterFocus).toBe(result.second)
      expect(result.calls).toEqual([
        WINDOW_CREATE_METHOD,
        WINDOW_CREATE_METHOD,
        WINDOW_GET_CURRENT_METHOD,
        WINDOW_FOCUS_METHOD,
        WINDOW_GET_CURRENT_METHOD,
        WINDOW_DESTROY_METHOD,
        WINDOW_DESTROY_METHOD
      ])
    })
  ))

test("MockHost layer speaks host protocol in-process and preserves trace IDs", () => {
  const runtime = ManagedRuntime.make(MockHostLive())
  return runtime.runPromise(
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

      expect({
        calls: host.calls().map((call) => ({
          method: call.method,
          traceId: call.request.traceId
        })),
        protocolVersion: version.protocolVersion,
        windows: host.windows().size
      }).toEqual({
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
  )
})

test("MockHost reports unknown window destroy as a typed host error", () => {
  const runtime = ManagedRuntime.make(MockHostLive())
  return runtime.runPromise(
    Effect.gen(function* () {
      const host = yield* MockHost
      const window = makeHostWindowClient(host, {
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace")
      })

      const exit = yield* Effect.exit(window.destroy("missing-window"))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
        expect(fail?.error).toBeInstanceOf(HostProtocolNotFoundError)
      }
    })
  )
})

const expectFrozenPathPayload = (payload: unknown): void => {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("expected object payload")
  }

  expect(Reflect.set(payload, "path", "after")).toBe(false)
  expect(Reflect.get(payload, "path")).toBe("before")
}

test("MockHost calls returns immutable request snapshots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const response = yield* host
        .request(request)
        .pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))
      const first = host.calls()
      const firstCall = first[0]
      if (firstCall === undefined) {
        return yield* new MockHostCallMissing()
      }
      expectFrozenPathPayload(firstCall.request.payload)
      const storedCall = host.calls()[0]
      if (storedCall === undefined) {
        return yield* new MockHostCallMissing()
      }
      expect(response.timestamp).toBe(timestamp)
      expectFrozenPathPayload(storedCall.request.payload)
    })
  ))

test("MockHost rejects non-JSON fixture payloads", () => {
  const runtime = ManagedRuntime.make(
    MockHostLive({
      fixtures: {
        [WINDOW_CREATE_METHOD]: () => Symbol("not-json")
      }
    })
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const host = yield* MockHost
      const window = makeHostWindowClient(host, {
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace")
      })

      const exit = yield* Effect.exit(window.create({ title: "Mock Host" }))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
        expect(fail?.error).toBeInstanceOf(HostProtocolInvalidOutputError)
      }
    })
  )
})

test("MockBridge records typed client calls and returns pinned successes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
      yield* bridge.succeed("Test.MockBridge.Success.open", { id: "project-1" })
      const client = bridge.client(
        { project: ProjectRpcs },
        {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace"),
          now: () => 1710000000400
        }
      )

      const output = yield* client.project.open({ path: "/tmp/project" })

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
  ))

test("MockBridge calls returns immutable payload snapshots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const bridge = makeMockBridge({ now: () => 1710000000401 })
      yield* bridge.succeed("Test.method", { ok: true })
      yield* bridge.exchange.request(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-immutable-bridge",
          timestamp: 1710000000401,
          traceId: "trace-immutable-bridge",
          method: "Test.method",
          payload: { path: "before" }
        })
      )
      const first = bridge.calls()
      const firstCall = first[0]
      if (firstCall === undefined) {
        return yield* new MockBridgeCallMissing()
      }
      expectFrozenPathPayload(firstCall.payload)
      const storedCall = bridge.calls()[0]
      if (storedCall === undefined) {
        return yield* new MockBridgeCallMissing()
      }
      expectFrozenPathPayload(storedCall.payload)
    })
  ))

test("MockBridge rejects pinned success payloads that are not JSON-serializable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const bridge = makeMockBridge()
      const pin = yield* Effect.exit(
        bridge.succeed("Test.MockBridge.Symbol.open", Symbol("not-json"))
      )

      expect(Exit.isFailure(pin)).toBe(true)
      if (Exit.isFailure(pin)) {
        const fail = pin.cause.reasons.find((reason) => reason._tag === "Fail")
        expect(fail?.error).toBeInstanceOf(HostProtocolInvalidOutputError)
      }
    })
  ))

test("MockBridge rejects pinned stream chunks that are not JSON-serializable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
      const pin = yield* Effect.exit(
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
      const chunks = yield* Effect.exit(client.project.watch().pipe(Stream.runCollect))
      expect(Exit.isFailure(chunks)).toBe(true)
    })
  ))

test("MockBridge returns pinned contract errors through the typed error channel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
      yield* bridge.fail("Test.MockBridge.Failure.open", { tag: "Denied", reason: "not allowed" })
      const client = bridge.client(
        { project: ProjectRpcs },
        {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace")
        }
      )

      const exit = yield* Effect.exit(client.project.open({ path: "/tmp/project" }))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
        expect(fail?.error).toEqual({ tag: "Denied", reason: "not allowed" })
      }
    })
  ))

test("MockBridge replays pinned stream chunks in order", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
      yield* bridge.streamChunks("Test.MockBridge.Stream.watch", ["a", "b"])
      const client = bridge.client(
        { project: ProjectRpcs },
        {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace")
        }
      )

      const chunks = yield* client.project
        .watch({ path: "/tmp/project" })
        .pipe(Stream.runCollect, Effect.provideService(Clock.Clock, fixedClock(timestamp)))
      const stream = bridge.exchange.stream
      if (stream === undefined) {
        return yield* Effect.die(new Error("expected MockBridge stream"))
      }
      const envelopes = yield* stream(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "request-stream-clock",
          timestamp,
          traceId: "trace-stream-clock",
          method: "Test.MockBridge.Stream.watch",
          payload: { path: "/tmp/project" }
        })
      ).pipe(Stream.runCollect, Effect.provideService(Clock.Clock, fixedClock(timestamp)))

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
  ))

test("MockBridge returns resource handles through the method schema", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
      yield* bridge.succeed("Test.MockBridge.Resource.spawn", {
        kind: "process",
        id: "process-1",
        generation: 0,
        ownerScope: "window-1",
        state: "running"
      })
      const client = bridge.client(
        { process: ProcessApi },
        {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace")
        }
      )

      const handle = yield* client.process.spawn()

      expect(handle).toEqual({
        kind: "process",
        id: id("process-1"),
        generation: 0,
        ownerScope: "window-1",
        state: "running"
      })
    })
  ))

test("MemoryFilesystem layer reads, writes, stats, and atomically replaces files", () => {
  const runtime = ManagedRuntime.make(
    MemoryFilesystemLive({
      directories: ["/workspace"],
      permissions: {
        readRoots: ["/workspace"],
        writeRoots: ["/workspace"],
        deleteRoots: ["/workspace"],
        allowRecursiveRemove: true
      },
      now: () => 1710000000600
    }).pipe(Layer.provide(ResourceRegistryLive), Layer.provide(ResourceOwner.test("scope-main")))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const filesystem = yield* Filesystem
      yield* filesystem.mkdir("/workspace/data", { recursive: true })
      yield* filesystem.write("/workspace/data/file.txt", bytes("first"))
      const first = yield* filesystem.read("/workspace/data/file.txt")
      const before = yield* filesystem.stat("/workspace/data/file.txt")
      yield* filesystem.writeAtomic("/workspace/data/file.txt", bytes("second"))
      const second = yield* filesystem.read("/workspace/data/file.txt")
      const realpath = yield* filesystem.realpath("/workspace/data/file.txt")

      expect({
        first: text(first),
        second: text(second),
        kind: before.kind,
        sizeBytes: before.sizeBytes,
        realpath: realpath.replaceAll("\\", "/")
      }).toEqual({
        first: "first",
        second: "second",
        kind: "file",
        sizeBytes: 5,
        realpath: "/workspace/data/file.txt"
      })
    })
  )
})

test("MemoryFilesystem default timestamps come from the Effect Clock", () => {
  const timestamp = 1_710_000_601_000
  const runtime = ManagedRuntime.make(
    MemoryFilesystemLive({
      directories: ["/workspace"],
      permissions: {
        readRoots: ["/workspace"],
        writeRoots: ["/workspace"]
      }
    }).pipe(
      Layer.provide(ResourceRegistryLive),
      Layer.provide(ResourceOwner.test("scope-main")),
      Layer.provide(Layer.succeed(Clock.Clock)(fixedClock(timestamp)))
    )
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const filesystem = yield* Filesystem
      yield* filesystem.write("/workspace/file.txt", bytes("clocked"))
      const stat = yield* filesystem.stat("/workspace/file.txt")
      expect(stat.modifiedAtMs).toBe(timestamp)
    })
  )
})

test("MemoryFilesystem watcher emits contract events and closes its registry resource", () =>
  Effect.runPromise(
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
      const attemptRef = yield* Ref.make(0)
      const events = yield* Effect.gen(function* () {
        const attempt = yield* Ref.getAndUpdate(attemptRef, (current) => current + 1)
        yield* filesystem.write("/workspace/file.txt", bytes(`one-${attempt}`))
        yield* filesystem.write("/workspace/file.txt", bytes(`two-${attempt}`))
        const collected = yield* Fiber.join(fiber).pipe(Effect.timeoutOption("1 millis"))
        if (Option.isSome(collected)) {
          return collected.value
        }
        return yield* new WatchEventsMissing()
      }).pipe(
        Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(50)))),
        Effect.catch(() => Fiber.join(fiber))
      )
      const registryAfterWatch = yield* registry.list()

      const mapped = Array.from(events).map((event) => ({
        kind: event.kind,
        path: event.path.replaceAll("\\", "/"),
        directory: event.directory.replaceAll("\\", "/"),
        filename: event.filename
      }))

      expect(mapped).toHaveLength(2)
      expect(mapped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "/workspace/file.txt",
            directory: "/workspace",
            filename: "file.txt"
          })
        ])
      )
      expect(mapped.every((event) => event.kind === "created" || event.kind === "modified")).toBe(
        true
      )
      expect(registryAfterWatch.entries).toEqual([])
    })
  ))

test("MemoryFilesystem preserves symlink escape failures through the real service policy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const filesystem = yield* makeMemoryFilesystem(registry, TEST_OWNER, {
        directories: ["/allowed", "/outside"],
        files: [{ path: "/outside/secret.txt", bytes: bytes("secret") }],
        symlinks: [{ path: "/allowed/link.txt", target: "/outside/secret.txt" }],
        permissions: {
          readRoots: ["/allowed"]
        }
      })

      const exit = yield* Effect.exit(filesystem.read("/allowed/link.txt"))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(encodeJsonString(exit.cause.toJSON())).toContain("SymlinkEscapesRoot")
      }
    })
  ))

test("MemoryFilesystem follows symlinks in intermediate path segments", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const filesystem = yield* makeMemoryFilesystem(registry, TEST_OWNER, {
        directories: ["/allowed", "/target"],
        files: [{ path: "/target/file.txt", bytes: bytes("resolved") }],
        symlinks: [{ path: "/allowed/linkdir", target: "/target" }],
        permissions: {
          readRoots: ["/target"]
        }
      })

      const output = yield* filesystem.read("/allowed/linkdir/file.txt")

      expect(text(output)).toBe("resolved")
    })
  ))

test("MemoryFilesystem resolves relative symlink fixtures from the link directory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const filesystem = yield* makeMemoryFilesystem(registry, TEST_OWNER, {
        directories: ["/workspace/sub"],
        files: [{ path: "/workspace/sub/file.txt", bytes: bytes("relative") }],
        symlinks: [{ path: "/workspace/link.txt", target: "sub/file.txt" }],
        permissions: {
          readRoots: ["/workspace"]
        }
      })

      const output = yield* filesystem.read("/workspace/link.txt")

      expect(text(output)).toBe("relative")
    })
  ))

test("MemoryFilesystem preserves symlink stat identity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const filesystem = yield* makeMemoryFilesystem(registry, TEST_OWNER, {
        directories: ["/workspace"],
        files: [{ path: "/workspace/target.txt", bytes: bytes("target content") }],
        symlinks: [{ path: "/workspace/link.txt", target: "target.txt" }],
        permissions: {
          readRoots: ["/workspace"]
        }
      })

      const stat = yield* filesystem.stat("/workspace/link.txt")
      const output = yield* filesystem.read("/workspace/link.txt")

      expect(stat.kind).toBe("symlink")
      expect(stat.path.replaceAll("\\", "/")).toBe("/workspace/link.txt")
      expect(text(output)).toBe("target content")
    })
  ))

test("MemoryFilesystem writeAtomic replaces symlink without changing target", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const filesystem = yield* makeMemoryFilesystem(registry, TEST_OWNER, {
        directories: ["/workspace"],
        files: [{ path: "/workspace/target.txt", bytes: bytes("target") }],
        symlinks: [{ path: "/workspace/link.txt", target: "target.txt" }],
        permissions: {
          readRoots: ["/workspace"],
          writeRoots: ["/workspace"]
        }
      })

      yield* filesystem.writeAtomic("/workspace/link.txt", bytes("replacement"))
      const target = yield* filesystem.read("/workspace/target.txt")
      const link = yield* filesystem.read("/workspace/link.txt")
      const linkStat = yield* filesystem.stat("/workspace/link.txt")

      expect(text(target)).toBe("target")
      expect(text(link)).toBe("replacement")
      expect(linkStat.kind).toBe("file")
    })
  ))

test("MemoryFilesystem rejects directory targets for writes and atomic renames", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const filesystem = yield* makeMemoryFilesystem(registry, TEST_OWNER, {
        directories: ["/workspace/target"],
        permissions: {
          readRoots: ["/workspace"],
          writeRoots: ["/workspace"]
        }
      })

      const writeExit = yield* Effect.exit(filesystem.write("/workspace/target", bytes("x")))
      const atomicExit = yield* Effect.exit(filesystem.writeAtomic("/workspace/target", bytes("x")))
      const stat = yield* filesystem.stat("/workspace/target")

      expect(Exit.isFailure(writeExit)).toBe(true)
      expect(Exit.isFailure(atomicExit)).toBe(true)
      expect(stat.kind).toBe("directory")
      if (Exit.isFailure(writeExit)) {
        expect(encodeJsonString(writeExit.cause.toJSON())).toContain("InvalidArgument")
      }
      if (Exit.isFailure(atomicExit)) {
        expect(encodeJsonString(atomicExit.cause.toJSON())).toContain("InvalidArgument")
      }
    })
  ))

test("MemoryFilesystem mkdir preserves existing nodes instead of clobbering them", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const filesystem = yield* makeMemoryFilesystem(registry, TEST_OWNER, {
        directories: ["/workspace"],
        files: [{ path: "/workspace/file.txt", bytes: bytes("file") }],
        permissions: {
          readRoots: ["/workspace"],
          writeRoots: ["/workspace"]
        }
      })

      const existingDirectoryExit = yield* Effect.exit(filesystem.mkdir("/workspace"))
      const recursiveThroughFileExit = yield* Effect.exit(
        filesystem.mkdir("/workspace/file.txt/child", { recursive: true })
      )
      const file = yield* filesystem.read("/workspace/file.txt")

      expect(Exit.isFailure(existingDirectoryExit)).toBe(true)
      expect(Exit.isFailure(recursiveThroughFileExit)).toBe(true)
      expect(text(file)).toBe("file")
      if (Exit.isFailure(existingDirectoryExit)) {
        expect(encodeJsonString(existingDirectoryExit.cause.toJSON())).toContain("InvalidArgument")
      }
      if (Exit.isFailure(recursiveThroughFileExit)) {
        expect(encodeJsonString(recursiveThroughFileExit.cause.toJSON())).toContain(
          "InvalidArgument"
        )
      }
    })
  ))

test("MockProcess layer emits stdout, stderr, exit, and records stdin", () => {
  const runtime = ManagedRuntime.make(
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
    }).pipe(Layer.provide(ResourceRegistryLive), Layer.provide(ResourceOwner.test("scope-main")))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const process = yield* Process
      const handle = yield* process.spawn("git", ["status"])
      yield* Stream.make(bytes("input")).pipe(Stream.run(handle.stdin))
      const stdout = yield* Stream.runCollect(handle.stdout)
      const stderr = yield* Stream.runCollect(handle.stderr)
      const all = yield* Stream.runCollect(handle.all)
      const exit = yield* handle.exit
      const list = yield* process.list()

      expect(handle.pid).toBe(1234)
      expect(Array.from(stdout).map(text)).toEqual(["ok\n"])
      expect(Array.from(stderr).map(text)).toEqual(["warn\n"])
      expect(Array.from(all).map(text)).toEqual(["ok\n", "warn\n"])
      expect(exit.code).toBe(7)
      expect(list).toMatchObject([
        {
          pid: 1234,
          command: "git",
          args: ["status"],
          state: "exited"
        }
      ])
    })
  )
})

test("makeMockProcess records kill and scope cleanup through the real registry", () =>
  Effect.runPromise(
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

      expect(exit).toMatchObject({ code: 0, signal: "SIGTERM" })
      expect(afterExit.entries).toEqual([])
      expect(process.calls()[0]?.killedWith).toBe("SIGTERM")
      expect(cleanup.calls()[0]?.terminateTreeCalls).toBe(1)
    })
  ))

test("Sidecar starts a scoped process and derives readiness from stdout", () =>
  Effect.runPromise(
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

      expect(ready).toMatchObject({
        line: "READY http://127.0.0.1:4317",
        pid: 9876,
        stream: "stdout"
      })
      expect(status._tag).toBe("Ready")
      expect(resourcesBeforeClose.entries.map((entry) => entry.handle.kind).sort()).toEqual([
        "process",
        "sidecar"
      ])
      expect(resourcesAfterClose.entries).toEqual([])
    })
  ))

test("Sidecar reports typed readiness failure instead of polling a port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
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
        expect(encodeJsonString(exit.cause.toJSON())).toContain("SidecarError")
        expect(encodeJsonString(exit.cause.toJSON())).toContain("readiness")
      }
    })
  ))

test("MockProcess fails loudly when a command has no fixture", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const process = yield* makeMockProcess(registry, TEST_OWNER, {
        permissions: { spawn: ["missing"] }
      })

      const exit = yield* Effect.exit(process.spawn("missing", []))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(encodeJsonString(exit.cause.toJSON())).toContain("InvalidArgument")
      }
    })
  ))

test("MockProcess rejects stdin writes after process exit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const process = yield* makeMockProcess(registry, TEST_OWNER, {
        processes: [{ command: "cat", exit: { code: 0 } }],
        permissions: { spawn: ["cat"] }
      })
      const handle = yield* process.spawn("cat", [])
      yield* handle.exit

      const exit = yield* Effect.exit(Stream.make(bytes("late")).pipe(Stream.run(handle.stdin)))

      expect(Exit.isFailure(exit)).toBe(true)
      expect(process.calls()[0]?.stdin.map(text)).toEqual([])
    })
  ))

test("MockPTY layer emits output, records writes and resizes, and exits", () => {
  const layerRuntime = ManagedRuntime.make(
    MockPtyLayer({
      ptys: [{ command: "bash", args: ["-l"], output: [bytes("layer")], exit: { code: 0 } }],
      permissions: { spawn: ["bash"] },
      budgets: { outputCoalesceBytes: 1024, outputCoalesceMs: 1 }
    }).pipe(Layer.provide(ResourceRegistryLive), Layer.provide(ResourceOwner.test("scope-main")))
  )
  return layerRuntime
    .runPromise(
      Effect.gen(function* () {
        const pty = yield* PTY
        const handle = yield* pty.open({
          argv: ["bash", "-l"],
          rows: 24,
          cols: 80
        })
        const output = yield* Stream.runCollect(handle.output)
        const exit = yield* handle.onExit

        expect(Array.from(output).map(text)).toEqual(["layer"])
        expect(exit.code).toBe(0)
      })
    )
    .then(() =>
      Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeResourceRegistry()
          const pty = yield* makeMockPty(registry, TEST_OWNER, {
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

          const handle = yield* pty.open({ argv: ["bash", "-l"], rows: 24, cols: 80 })
          yield* handle.write(bytes("echo hi\n"))
          yield* handle.resize({ rows: 40, cols: 120 })
          const output = yield* Stream.runCollect(handle.output)
          yield* handle.kill("SIGTERM")
          const exit = yield* handle.onExit
          const calls = pty.calls()
          const afterExit = yield* registry.list()

          expect(handle.pid._tag).toBe("None")
          expect(Array.from(output).map(text)).toEqual(["prompt"])
          expect(exit.code).toBe(0)
          expect(exit.signal).toBe("SIGTERM")
          expect(calls[0]?.pid).toBeUndefined()
          expect(calls[0]?.writes.map(text)).toEqual(["echo hi\n"])
          expect(calls[0]?.resizes).toEqual([{ rows: 40, cols: 120 }])
          expect(afterExit.entries).toEqual([])
        })
      )
    )
})

test("MockPTY closes through scope cleanup with the real PTY disposer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({ nextId: () => id("pty-1") })
      const pty = yield* makeMockPty(registry, TEST_OWNER, {
        ptys: [{ command: "bash", exit: false }],
        permissions: { spawn: ["bash"] },
        gracefulShutdownMs: 1
      })

      yield* pty.open({ argv: ["bash"], rows: 24, cols: 80 })
      yield* registry.closeScope("scope-main")

      expect(pty.calls()[0]?.terminateTreeCalls).toBe(1)
    })
  ))

test("MockPTY fails loudly when a command has no fixture", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const pty = yield* makeMockPty(registry, TEST_OWNER, {
        permissions: { spawn: ["missing"] }
      })

      const exit = yield* Effect.exit(pty.open({ argv: ["missing"], rows: 24, cols: 80 }))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(encodeJsonString(exit.cause.toJSON())).toContain("InvalidArgument")
      }
    })
  ))

test("MockPTY rejects writes and resizes after exit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const pty = yield* makeMockPty(registry, TEST_OWNER, {
        ptys: [{ command: "bash", exit: { code: 0 } }],
        permissions: { spawn: ["bash"] },
        budgets: { outputCoalesceBytes: 1024, outputCoalesceMs: 1 }
      })
      const handle = yield* pty.open({ argv: ["bash"], rows: 24, cols: 80 })
      yield* handle.onExit

      const writeExit = yield* Effect.exit(handle.write(bytes("late")))
      const resizeExit = yield* Effect.exit(handle.resize({ rows: 40, cols: 120 }))

      expect(Exit.isFailure(writeExit)).toBe(true)
      expect(Exit.isFailure(resizeExit)).toBe(true)
      expect(pty.calls()[0]?.writes.map(text)).toEqual([])
      expect(pty.calls()[0]?.resizes).toEqual([])
    })
  ))

test("HeadlessRuntime run composes mocks with real registry telemetry and permissions", () => {
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
  return Effect.runPromise(
    HeadlessRuntime.run(
      Effect.gen(function* () {
        const filesystem = yield* Filesystem
        const process = yield* Process
        const pty = yield* PTY
        const telemetry = yield* Telemetry
        const permissions = yield* PermissionRegistry
        const host = yield* MockHost
        const window = makeHostWindowClient(host, {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace"),
          now: () => 1710000000800
        })
        const bridge = yield* MockBridge
        const owner = yield* ResourceOwner

        const createdWindow = yield* window.create({ title: "Headless QA" })
        yield* window.destroy(createdWindow.windowId)

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

        expect({
          opened,
          file: text(file),
          stdout: Array.from(stdout).map(text),
          processExit,
          terminalOutput: Array.from(terminalOutput).map(text),
          ptyExit,
          createdWindow,
          hostCalls: host.calls().map((call) => call.method),
          hostWindowCount: host.windows().size,
          bridgeCalls: bridge.calls().map((call) => call.method),
          logs: logs.map((log) => log.message),
          decisions,
          ownerKind: owner.kind,
          ownerScope: owner.scopeId
        }).toEqual({
          opened: { id: "project-1" },
          file: "file",
          stdout: ["ok\n"],
          processExit: { code: 0 },
          terminalOutput: ["prompt"],
          ptyExit: { code: 0 },
          createdWindow: { windowId: "headless-window-1" },
          hostCalls: [WINDOW_CREATE_METHOD, WINDOW_DESTROY_METHOD],
          hostWindowCount: 0,
          bridgeCalls: ["Test.HeadlessRuntime.Project.open"],
          logs: ["ran"],
          decisions: [],
          ownerKind: "test",
          ownerScope: "headless"
        })
      }),
      {
        leakDetection: { testName: "headless desktop QA demo" },
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
      }
    )
  )
})

test("HeadlessRuntime run fails when scoped resources leak", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
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
        expect(encodeJsonString(exit.cause.toJSON())).toContain("ResourceLeakError")
      }
    })
  ))

test("runHeadless fails when a headless window is left open", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        runHeadless((runtime) => runtime.window.create({ title: "Leaked" }), {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace"),
          now: () => 1710000000200
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
        const error = fail?.error
        expect(error).toBeInstanceOf(ResourceLeakError)
        if (error instanceof ResourceLeakError) {
          expect(error.message).toContain("kind: window")
          expect(error.message).toContain("ownerScope: headless")
        }
      }
    })
  ))

test("runHeadless preserves typed destroy errors from the mock host", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runHeadless(
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

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(encodeJsonString(result.cause.toJSON())).toContain("NotFound")
      }
    })
  ))

test("makeMemorySecretsSafeStorage backs Secrets with copied in-memory values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = makeMemorySecretsSafeStorage()
      const secrets = yield* makeSecrets(storage, {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] }
      })
      const original = makeSecretBytesFromUtf8("refresh-token")

      yield* secrets.set("auth", "token", original)
      yield* wipeSecretBytes(original)
      const stored = yield* secrets.get("auth", "token")
      const snapshot = yield* storage.snapshot()
      yield* secrets.delete("auth", "token")
      const missing = yield* Effect.exit(secrets.get("auth", "token"))

      expect(new TextDecoder().decode(unsafeSecretBytes(stored))).toBe("refresh-token")
      expect([...snapshot.keys()]).toEqual(["com.rika.test/auth/token"])
      expect(Exit.isFailure(missing)).toBe(true)
      if (Exit.isFailure(missing)) {
        expect(encodeJsonString(missing.cause.toJSON())).toContain("SecretNotFound")
      }
    })
  ))

test("makeMemorySecretsSafeStorage models unavailable platform storage as typed values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secrets = yield* makeSecrets(makeMemorySecretsSafeStorage({ available: false }), {
        appId: "com.rika.test",
        permissions: { read: ["auth"], write: ["auth"] }
      })

      const unavailable = yield* Effect.exit(
        secrets.set("auth", "token", makeSecretBytesFromUtf8("refresh-token"))
      )

      expect(Exit.isFailure(unavailable)).toBe(true)
      if (Exit.isFailure(unavailable)) {
        expect(encodeJsonString(unavailable.cause.toJSON())).toContain("SafeStorageUnavailable")
      }
    })
  ))

test("FailureAssertions matches tagged failures through Exit", () => {
  const runtime = ManagedRuntime.make(
    Layer.provide(ClipboardLive, Layer.succeed(ClipboardClient)(makeUnavailableClipboardClient()))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          yield* clipboard.writeText("blocked")
        })
      )
      FailureAssertions.expectFailureTag(exit, "Unsupported")
    })
  )
})

test("Clipboard unavailable platform layer reports unsupported selection capability", () => {
  const runtime = ManagedRuntime.make(
    Layer.succeed(ClipboardClient)(makeUnavailableClipboardClient())
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* ClipboardClient
      const result = yield* client.isSupported("selection")

      expect(result).toEqual(
        new ClipboardSupportedResult({
          supported: false,
          reason: "test clipboard client is unavailable"
        })
      )
    })
  )
})

test("Clipboard bridge layer propagates host failures through the service", () => {
  const bridge = makeMockBridge()
  const runtime = ManagedRuntime.make(
    Layer.provide(ClipboardLive, ClipboardSurface.bridgeClientLayer(bridge.exchange))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      yield* bridge.fail("Clipboard.readText", {
        tag: "Unsupported",
        reason: "host failure",
        message: "clipboard host failed",
        operation: "Clipboard.readText",
        recoverable: false
      })

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          return yield* clipboard.readText()
        })
      )

      FailureAssertions.expectFailureTag(exit, "Unsupported")
    })
  )
})

test("DialogTest represents save cancellation as data", () => {
  const runtime = ManagedRuntime.make(DialogTest({ saveFilePath: null }))
  return runtime.runPromise(
    Effect.gen(function* () {
      const dialog = yield* Dialog
      const savePath = yield* dialog.saveFile({ defaultPath: "/tmp/cancel.txt" })
      expect(savePath).toBeUndefined()
    })
  )
})

test("Dialog unavailable platform layer returns typed Unsupported failures", () => {
  const runtime = ManagedRuntime.make(
    Layer.provide(DialogLive, Layer.succeed(DialogClient)(makeUnavailableDialogClient()))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const dialog = yield* Dialog
          yield* dialog.openFile({ defaultPath: "/tmp/input.txt" })
        })
      )
      FailureAssertions.expectFailureTag(exit, "Unsupported")
    })
  )
})

test("Dialog bridge layer propagates host failures through the service", () => {
  const bridge = makeMockBridge()
  const runtime = ManagedRuntime.make(
    Layer.provide(DialogLive, DialogSurface.bridgeClientLayer(bridge.exchange))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      yield* bridge.fail("Dialog.openFile", {
        tag: "HostUnavailable",
        message: "host is unavailable",
        operation: "Dialog.openFile",
        recoverable: true
      })

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const dialog = yield* Dialog
          return yield* dialog.openFile({ defaultPath: "/tmp/input.txt" })
        })
      )

      FailureAssertions.expectFailureTag(exit, "HostUnavailable")
    })
  )
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

const makeUnavailableDialogClient = (): DialogClientApi => {
  const unsupported = (method: string) =>
    new HostProtocolUnsupportedError({
      tag: "Unsupported",
      reason: "test dialog client is unavailable",
      message: `unsupported Dialog method: ${method}`,
      operation: method,
      recoverable: false
    })

  const fail = <A>(method: string): Effect.Effect<A, HostProtocolUnsupportedError, never> =>
    Effect.fail(unsupported(method))

  return {
    openFile: () => fail("Dialog.openFile"),
    openDirectory: () => fail("Dialog.openDirectory"),
    saveFile: () => fail("Dialog.saveFile"),
    message: () => fail("Dialog.message"),
    confirm: () => fail("Dialog.confirm")
  }
}

test("LayerMatrix interruption closes scoped capability layers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      class InterruptibleService extends Context.Service<
        InterruptibleService,
        { readonly wait: Effect.Effect<never, never, never> }
      >()("@orika/test/index.test/InterruptibleService") {}

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

      const exit = yield* LayerMatrix.interrupt(
        layer,
        Effect.gen(function* () {
          const service = yield* InterruptibleService
          return yield* service.wait
        })
      )

      FailureAssertions.expectInterrupted(exit)
      expect(acquired).toBe(1)
      expect(released).toBe(1)
    })
  ))

test("native capability programs run unchanged through direct, bridge, and test layers", () => {
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
  const screenDirectClient: ScreenClientApi = Object.freeze({
    getDisplays: () => Effect.succeed([screenDisplay]),
    getPrimaryDisplay: () => Effect.succeed(screenDisplay),
    getPointerPoint: () => Effect.succeed(new ScreenPoint({ x: 10, y: 20 })),
    onDisplaysChanged: () => Stream.empty,
    isSupported: () => Effect.succeed(true)
  })
  const screenBridge = makeMockBridge()
  const screenDirectRuntime = ManagedRuntime.make(Layer.succeed(Screen)(screenDirectClient))
  const screenClientRuntime = ManagedRuntime.make(
    ScreenSurface.bridgeClientLayer(screenBridge.exchange)
  )
  const screenTestRuntime = ManagedRuntime.make(
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
  const dialogLiveRuntime = ManagedRuntime.make(
    Layer.provide(DialogLive, Layer.succeed(DialogClient)(dialogLiveClient))
  )
  const dialogClientRuntime = ManagedRuntime.make(
    Layer.provide(DialogLive, DialogSurface.bridgeClientLayer(dialogBridge.exchange))
  )
  const dialogTestRuntime = ManagedRuntime.make(DialogTest(dialogOptions))

  return Effect.runPromise(
    Effect.gen(function* () {
      yield* screenBridge.succeed("Screen.getPrimaryDisplay", screenDisplayPayload)
      yield* Effect.all([
        dialogBridge.succeed("Dialog.openFile", { paths: ["/tmp/input.txt"] }),
        dialogBridge.succeed("Dialog.saveFile", { path: "/tmp/output.txt" }),
        dialogBridge.succeed("Dialog.message", undefined),
        dialogBridge.succeed("Dialog.confirm", { confirmed: true })
      ])
    })
  ).then(() =>
    Promise.all([
      screenDirectRuntime.runPromise(screenProgram),
      screenClientRuntime.runPromise(screenProgram),
      screenTestRuntime.runPromise(screenProgram),
      dialogLiveRuntime.runPromise(dialogProgram),
      dialogClientRuntime.runPromise(dialogProgram),
      dialogTestRuntime.runPromise(dialogProgram)
    ]).then(([screenDirect, screenClient, screenTest, dialogLive, dialogClient, dialogTest]) => {
      expect({
        name: "Screen",
        direct: screenDirect,
        client: screenClient,
        test: screenTest
      }).toEqual({ name: "Screen", direct: "primary", client: "primary", test: "primary" })
      expect(screenBridge.calls().map((call) => call.method)).toEqual(["Screen.getPrimaryDisplay"])
      const dialogExpected = "/tmp/input.txt:/tmp/output.txt:confirmed"
      expect({
        name: "Dialog",
        live: dialogLive,
        client: dialogClient,
        test: dialogTest
      }).toEqual({
        name: "Dialog",
        live: dialogExpected,
        client: dialogExpected,
        test: dialogExpected
      })
      expect(dialogBridge.calls().map((call) => call.method)).toEqual([
        "Dialog.openFile",
        "Dialog.saveFile",
        "Dialog.message",
        "Dialog.confirm"
      ])
    })
  )
})

test("native test layers are derived from DesktopRpc surfaces", () => {
  expect(TestNativeSurfaces.map((surface) => surface.tag)).toEqual([
    "ActivationRegistry",
    "AppMetadata",
    "App",
    "Association",
    "Autostart",
    "BrowsingData",
    "AttachmentIntake",
    "Clipboard",
    "ContextMenu",
    "CookieStore",
    "CrashReporter",
    "DiagnosticsBundle",
    "DistributionParity",
    "DisplayCapture",
    "Download",
    "Dialog",
    "EgressPolicy",
    "ExecutionSandbox",
    "ExtensionConfig",
    "ExtensionPackage",
    "FocusedApplicationContext",
    "Job",
    "LocalToolRuntime",
    "NativeFileSystem",
    "NativeNetwork",
    "TransientWindowRole",
    "TransactionalFileMutation",
    "WorkspaceIndex",
    "Dock",
    "GlobalShortcut",
    "Menu",
    "NetworkAuth",
    "Notification",
    "Path",
    "PowerMonitor",
    "Protocol",
    "RealtimeMediaSession",
    "RecentDocuments",
    "ResidentLifecycle",
    "SafeStorage",
    "ScopedAccessGrant",
    "SelectionContext",
    "SessionPermission",
    "SessionProfile",
    "Screen",
    "Shell",
    "SystemAppearance",
    "Tray",
    "Updater",
    "WebRequest",
    "WebView",
    "Window"
  ])

  const malformedRuntime = ManagedRuntime.make(
    Layer.provide(ClipboardSurface.testClientLayer, makeClipboardScenarioLayer({}))
  )

  return Effect.runPromise(
    Effect.gen(function* () {
      for (const surface of TestNativeSurfaces) {
        for (const law of surface.contractLaws) {
          yield* law.check
        }
      }
    })
  ).then(() =>
    malformedRuntime
      .runPromiseExit(
        Effect.gen(function* () {
          const clipboard = yield* ClipboardClient
          // @ts-expect-error Runtime schema rejection is the contract under test.
          yield* clipboard.writeText(123)
        })
      )
      .then((malformedWrite) => {
        expect(Exit.isFailure(malformedWrite)).toBe(true)
      })
  )
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
