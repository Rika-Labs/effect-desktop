import { expect, test } from "bun:test"
import { Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"

import {
  Api,
  HOST_PING_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  HostProtocolNotFoundError,
  makeHostHandshakeClient,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  type ApiContractClass,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer
} from "@effect-desktop/bridge"
import {
  Filesystem,
  ResourceRegistryLive,
  SecretValue,
  makeSecrets,
  makeResourceRegistry,
  type ResourceId
} from "@effect-desktop/core"

import {
  assertNoOpenResourcesIn,
  formatLeakedHandleReport,
  leakedHandles,
  makeMemorySecretsSafeStorage,
  makeMemoryFilesystem,
  makeMockBridge,
  MemoryFilesystemLive,
  MockHost,
  MockHostLive,
  registerLeakMatchers,
  runHeadless,
  ResourceLeakError
} from "./index.js"

const id = (value: string): ResourceId => value as ResourceId

registerLeakMatchers()

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
        ownerScope: "app",
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
  expect(result.protocolVersion).toBe("0.0.0")
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
    protocolVersion: "0.0.0",
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

test("MockBridge records typed client calls and returns pinned successes", async () => {
  const ProjectApi = testContract("Test.MockBridge.Success", {
    open: {
      input: Schema.Struct({ path: Schema.String }),
      output: Schema.Struct({ id: Schema.String }),
      error: Schema.Never
    }
  })
  const bridge = makeMockBridge({ now: () => 1710000000400 })
  await Effect.runPromise(bridge.succeed("Test.MockBridge.Success.open", { id: "project-1" }))
  const client = bridge.client(
    { project: ProjectApi },
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

test("MockBridge returns pinned contract errors through the typed error channel", async () => {
  const Failure = Schema.Struct({ tag: Schema.Literal("Denied"), reason: Schema.String })
  const ProjectApi = testContract("Test.MockBridge.Failure", {
    open: {
      input: Schema.Struct({ path: Schema.String }),
      output: Schema.Struct({ id: Schema.String }),
      error: Failure
    }
  })
  const bridge = makeMockBridge()
  await Effect.runPromise(
    bridge.fail("Test.MockBridge.Failure.open", { tag: "Denied", reason: "not allowed" })
  )
  const client = bridge.client(
    { project: ProjectApi },
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
  const ProjectApi = testContract("Test.MockBridge.Stream", {
    watch: {
      input: Schema.Struct({ path: Schema.String }),
      output: Api.Stream(Schema.String, Schema.Never),
      error: Schema.Never
    }
  })
  const bridge = makeMockBridge({ now: () => 1710000000500 })
  await Effect.runPromise(bridge.streamChunks("Test.MockBridge.Stream.watch", ["a", "b"]))
  const client = bridge.client(
    { project: ProjectApi },
    {
      nextRequestId: nextSequence("request"),
      nextTraceId: nextSequence("trace"),
      now: () => 1710000000500
    }
  )

  const chunks = await Effect.runPromise(
    client.project.watch({ path: "/tmp/project" }).pipe(Stream.runCollect)
  )

  expect(Array.from(chunks)).toEqual(["a", "b"])
  expect(bridge.calls().map((call) => call.method)).toEqual(["Test.MockBridge.Stream.watch"])
})

test("MockBridge returns disposable resource proxies through the registry", async () => {
  const ProcessApi = testContract("Test.MockBridge.Resource", {
    spawn: {
      input: Schema.Void,
      output: Api.Resource("process", "running"),
      error: Schema.Never
    }
  })
  const registry = await Effect.runPromise(makeResourceRegistry({ nextId: () => id("process-1") }))
  const bridge = makeMockBridge({ registry })
  await Effect.runPromise(
    bridge.resource("Test.MockBridge.Resource.spawn", {
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

  const proxy = await Effect.runPromise(client.process.spawn())
  const beforeDispose = await Effect.runPromise(registry.list())
  await Effect.runPromise(proxy.dispose())
  const afterDispose = await Effect.runPromise(registry.list())

  expect(proxy.kind).toBe("process")
  expect(beforeDispose.entries.map((entry) => entry.handle.id)).toEqual([id("process-1")])
  expect(afterDispose.entries).toEqual([])
  expect(bridge.disposedResources()).toEqual([
    {
      kind: "process",
      id: "process-1",
      generation: 0,
      ownerScope: "window-1",
      state: "running"
    }
  ])
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
        }).pipe(Layer.provide(ResourceRegistryLive))
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

test("MemoryFilesystem watcher emits contract events and closes its registry resource", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({ nextId: () => id("watch-1") })
      const filesystem = yield* makeMemoryFilesystem(registry, {
        directories: ["/workspace"],
        permissions: {
          readRoots: ["/workspace"],
          writeRoots: ["/workspace"]
        }
      })
      const fiber = yield* filesystem
        .watch("/workspace", { ownerScope: "test-watch", bufferSize: 8 })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* Effect.sleep(1)
      yield* filesystem.write("/workspace/file.txt", bytes("one"))
      yield* filesystem.write("/workspace/file.txt", bytes("two"))
      const events = yield* Fiber.join(fiber)
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

  expect(result.events).toEqual([
    {
      kind: "created",
      path: "/workspace/file.txt",
      directory: "/workspace",
      filename: "file.txt"
    },
    {
      kind: "modified",
      path: "/workspace/file.txt",
      directory: "/workspace",
      filename: "file.txt"
    }
  ])
  expect(result.leaks).toEqual([])
})

test("MemoryFilesystem preserves symlink escape failures through the real service policy", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, {
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
    makeMemoryFilesystem(registry, {
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

test("MemoryFilesystem rejects directory targets for writes and atomic renames", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const filesystem = await Effect.runPromise(
    makeMemoryFilesystem(registry, {
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
    makeMemoryFilesystem(registry, {
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
  const original = SecretValue.fromUtf8("refresh-token")

  await Effect.runPromise(secrets.set("auth", "token", original))
  await Effect.runPromise(original.dispose())
  const stored = await Effect.runPromise(secrets.get("auth", "token"))
  const snapshot = await Effect.runPromise(storage.snapshot())
  await Effect.runPromise(secrets.delete("auth", "token"))
  const missing = await Effect.runPromiseExit(secrets.get("auth", "token"))

  expect(new TextDecoder().decode(stored.unsafeBytes())).toBe("refresh-token")
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
    secrets.set("auth", "token", SecretValue.fromUtf8("refresh-token"))
  )

  expect(Exit.isFailure(unavailable)).toBe(true)
  if (Exit.isFailure(unavailable)) {
    expect(JSON.stringify(unavailable.cause.toJSON())).toContain("SafeStorageUnavailable")
  }
})

const nextSequence = (prefix: string): (() => string) => {
  let next = 0

  return () => `${prefix}-${next++}`
}

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

const text = (value: Uint8Array): string => new TextDecoder().decode(value)

const testContract = <Tag extends string, Spec extends ApiContractSpec>(
  tag: Tag,
  spec: Spec
): ApiContractClass<Tag, Spec> => {
  const contract = class {
    static readonly tag = tag
    static readonly spec = Object.freeze(spec)
    static readonly events = Object.freeze({})

    static layer<Handlers extends ApiHandlers<Spec>>(
      handlers: Handlers
    ): ApiLayer<Tag, Spec, Handlers> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<Tag, Spec>

  return Object.freeze(contract)
}
