import { expect, test } from "bun:test"
import {
  HostProtocolNotFoundError,
  HostProtocolResponseEnvelope,
  HostProtocolStaleHandleError,
  Handlers,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  type ApiClientExchange,
  type HostProtocolRequestEnvelope,
  type HostWindowClientOptions,
  type HostWindowExchange
} from "@effect-desktop/bridge"
import { ResourceRegistry, makeResourceRegistry } from "@effect-desktop/core"
import { Cause, Effect, Exit, Fiber, Layer, Stream } from "effect"

import {
  AppEventRouter,
  Window,
  WindowApi,
  WindowClient,
  WindowLive,
  WindowMethodNames,
  makeHostWindowApiLayer,
  makeAppEventRouter,
  makeWindowBridgeClientLayer,
  makeWindowServiceLayer,
  firstResponderRoute,
  broadcastRoute,
  targetedRoute,
  windowScope,
  type WindowClientApi,
  type WindowHandle
} from "./index.js"

const expectedWindowMethods: Array<(typeof WindowMethodNames)[number]> = [
  "create",
  "show",
  "hide",
  "focus",
  "close",
  "setTitle",
  "setSize",
  "setPosition",
  "setBackgroundColor",
  "setVibrancy",
  "setHasShadow",
  "setFullscreen",
  "enterFullScreen",
  "exitFullScreen",
  "onFullScreenChanged",
  "getScaleFactor",
  "onScaleChanged",
  "persistState"
]

const windowHandle: WindowHandle = {
  kind: "window",
  id: "window-1",
  generation: 0,
  ownerScope: "scope-1",
  state: "open"
}

test("WindowApi declares the Phase 5 Window method surface", () => {
  expect(WindowApi.tag).toBe("Window")
  expect([...WindowMethodNames]).toEqual(expectedWindowMethods)
  expect(Object.keys(WindowApi.spec)).toEqual(expectedWindowMethods)
  expect(WindowApi.spec.create.output).toMatchObject({
    _tag: "ApiResourceSpec",
    kind: "window",
    state: "open"
  })
})

test("Window service delegates through a substitutable WindowClient port", async () => {
  const calls: string[] = []
  const client: WindowClientApi = {
    create: (input) =>
      Effect.sync(() => {
        calls.push(`create:${input?.title ?? ""}`)
        return windowHandle
      }),
    show: () => recordVoid(calls, "show"),
    hide: () => recordVoid(calls, "hide"),
    focus: () => recordVoid(calls, "focus"),
    close: () => recordVoid(calls, "close"),
    setTitle: (_window, title) => recordVoid(calls, `setTitle:${title}`),
    setSize: (_window, size) => recordVoid(calls, `setSize:${size.width}x${size.height}`),
    setPosition: (_window, position) =>
      recordVoid(calls, `setPosition:${position.x},${position.y}`),
    setBackgroundColor: (_window, color) => recordVoid(calls, `setBackgroundColor:${color}`),
    setVibrancy: (_window, material) => recordVoid(calls, `setVibrancy:${material}`),
    setHasShadow: (_window, hasShadow) => recordVoid(calls, `setHasShadow:${hasShadow}`),
    setFullscreen: (_window, fullscreen) => recordVoid(calls, `setFullscreen:${fullscreen}`),
    enterFullScreen: () => recordVoid(calls, "enterFullScreen"),
    exitFullScreen: () => recordVoid(calls, "exitFullScreen"),
    onFullScreenChanged: () => Stream.empty,
    getScaleFactor: () => Effect.succeed({ scaleFactor: 2 }),
    onScaleChanged: () => Stream.empty,
    persistState: () => recordVoid(calls, "persistState")
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const window = yield* Window
      const created = yield* window.create({ title: "Main" })
      yield* window.setTitle(created, "Renamed")
      yield* window.setSize(created, { width: 800, height: 600 })
      const scale = yield* window.getScaleFactor(created)
      yield* window.close(created)

      return { created, scale }
    }).pipe(Effect.provide(makeWindowServiceLayer(client)))
  )

  expect(result.created).toEqual(windowHandle)
  expect(result.scale.scaleFactor).toBe(2)
  expect(calls).toEqual(["create:Main", "setTitle:Renamed", "setSize:800x600", "close"])
})

test("Window service can be composed from a separately provided WindowClient", async () => {
  const calls: string[] = []
  const client: WindowClientApi = {
    ...noopWindowClient,
    create: (input) =>
      Effect.sync(() => {
        calls.push(`create:${Object.keys(input).length}`)
        return windowHandle
      })
  }

  const created = await Effect.runPromise(
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.create()
    }).pipe(Effect.provide(Layer.provide(WindowLive, Layer.succeed(WindowClient)(client))))
  )

  expect(created.id).toBe("window-1")
  expect(calls).toEqual(["create:0"])
})

test("host WindowClient adapter opens and closes through host envelopes with registry lifetime", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const registry = await Effect.runPromise(makeResourceRegistry())
  const apiExchange = makeWindowApiExchange(windowExchange(requests), registry, {
    nextRequestId: nextId(["create-request", "destroy-request"]),
    nextTraceId: nextId(["create-trace", "destroy-trace"]),
    now: nextNumber([1710000000000, 1710000000001])
  })
  const program = Effect.gen(function* () {
    const window = yield* Window
    const created = yield* window.create({
      title: "Main",
      width: 320,
      height: 240,
      persistState: true
    })
    const duringLifetime = yield* registry.list()
    yield* window.close(created)
    const afterClose = yield* registry.list()

    return { created, duringLifetime, afterClose }
  }).pipe(Effect.provide(Layer.provide(WindowLive, makeWindowBridgeClientLayer(apiExchange))))

  const result = await Effect.runPromise(program)

  expect(result.created).toMatchObject({
    kind: "window",
    id: "host-window-1",
    generation: 0,
    ownerScope: "window:host-window-1",
    state: "open"
  })
  expect(result.duringLifetime.entries.map((entry) => String(entry.handle.id))).toEqual([
    "host-window-1"
  ])
  expect(result.afterClose.entries).toEqual([])
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    [
      WINDOW_CREATE_METHOD,
      {
        title: "Main",
        width: 320,
        height: 240
      }
    ],
    [
      WINDOW_DESTROY_METHOD,
      {
        windowId: "host-window-1"
      }
    ]
  ])
})

test("AppEventRouter sends firstResponder events to the focused window only", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const router = yield* makeAppEventRouter()
      yield* router.windowOpened(handleFor("window-1"))
      yield* router.windowOpened(handleFor("window-2"))
      yield* router.windowFocused("window-2")
      const first = yield* router
        .subscribe<{ readonly path: string }>("window-1", "onOpenFile")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      const second = yield* router
        .subscribe<{ readonly path: string }>("window-2", "onOpenFile")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* router.publish({
        event: "onOpenFile",
        payload: { path: "README.md" },
        route: firstResponderRoute
      })
      yield* Effect.sleep("10 millis")
      yield* Fiber.interrupt(first)

      return yield* Fiber.join(second)
    })
  )

  expect(Array.from(result)).toEqual([
    {
      event: "onOpenFile",
      payload: { path: "README.md" },
      windowId: "window-2",
      ownerScope: "window:window-2"
    }
  ])
})

test("AppEventRouter buffers one firstResponder event per kind until a window opens", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const router = yield* makeAppEventRouter()
      yield* router.publish({
        event: "onOpenFile",
        payload: { path: "older.txt" },
        route: firstResponderRoute
      })
      yield* router.publish({
        event: "onOpenFile",
        payload: { path: "newer.txt" },
        route: firstResponderRoute
      })
      const audit = yield* router
        .audit()
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      yield* router.windowOpened(handleFor("window-1"))
      const events = yield* router
        .subscribe<{ readonly path: string }>("window-1", "onOpenFile")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      yield* router.publish({
        event: "onOpenFile",
        payload: { path: "after-open.txt" },
        route: firstResponderRoute
      })

      return {
        events: yield* Fiber.join(events),
        audit: yield* Fiber.join(audit)
      }
    })
  )

  expect(Array.from(result.events).map((event) => event.payload.path)).toEqual(["newer.txt"])
  expect(Array.from(result.audit).map((event) => event._tag)).toEqual(["EventBufferEvicted"])
})

test("AppEventRouter broadcasts in creation order and short-circuits on refusal", async () => {
  const seen: string[] = []
  const decision = await Effect.runPromise(
    Effect.gen(function* () {
      const router = yield* makeAppEventRouter()
      yield* router.windowOpened(handleFor("window-1"))
      yield* router.windowOpened(handleFor("window-2"))
      yield* router.windowOpened(handleFor("window-3"))

      return yield* router.dispatch(
        {
          event: "onWillQuit",
          payload: { reason: "test" },
          route: broadcastRoute
        },
        (event) =>
          Effect.sync(() => {
            seen.push(event.windowId)
            return event.windowId === "window-2" ? "refuse" : "continue"
          })
      )
    })
  )

  expect(decision).toBe("refuse")
  expect(seen).toEqual(["window-1", "window-2"])
})

test("AppEventRouter drops targeted events for closed targets with an audit row", async () => {
  const audit = await Effect.runPromise(
    Effect.gen(function* () {
      const router = yield* makeAppEventRouter()
      const fiber = yield* router
        .audit()
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* router.publish({
        event: "Tray.activation",
        payload: { button: "left" },
        route: targetedRoute("closed-window")
      })

      return yield* Fiber.join(fiber)
    })
  )

  expect(Array.from(audit)).toEqual([
    {
      _tag: "EventDroppedTargetClosed",
      event: "Tray.activation",
      windowId: "closed-window",
      dropped: {
        event: "Tray.activation",
        payload: { button: "left" }
      }
    }
  ])
})

test("host WindowClient adapter declares per-window scopes and closes scoped resources", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const router = await Effect.runPromise(makeAppEventRouter())
  const apiExchange = makeWindowApiExchange(windowExchange([]), registry, {}, router)
  const program = Effect.gen(function* () {
    const window = yield* Window
    const created = yield* window.create({})
    const child = yield* registry.register({
      kind: "stream",
      ownerScope: created.ownerScope,
      state: "open"
    })
    yield* window.close(created)
    const afterClose = yield* registry.list()

    return { child, afterClose }
  }).pipe(Effect.provide(Layer.provide(WindowLive, makeWindowBridgeClientLayer(apiExchange))))

  const result = await Effect.runPromise(program)

  expect(result.child.ownerScope).toBe("window:host-window-1")
  expect(result.afterClose.entries).toEqual([])
})

test("host WindowClient adapter returns typed failures for invalid input and bad handles", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const apiExchange = makeWindowApiExchange(windowExchange([]), registry)
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* WindowClient
    }).pipe(Effect.provide(makeWindowBridgeClientLayer(apiExchange)))
  )

  const invalidCreateExit = await Effect.runPromiseExit(client.create({ width: 0 }))
  const unknownExit = await Effect.runPromiseExit(client.close(windowHandle))
  const created = await Effect.runPromise(client.create({}))
  const staleExit = await Effect.runPromiseExit(
    client.close({
      ...created,
      generation: created.generation + 1
    })
  )
  await Effect.runPromise(client.close(created))
  const repeatedCloseExit = await Effect.runPromiseExit(client.close(created))

  expectExitFailure(invalidCreateExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(
    unknownExit,
    (error) => error instanceof HostProtocolNotFoundError && error.operation === "Window.close"
  )
  expectExitFailure(
    staleExit,
    (error) => error instanceof HostProtocolStaleHandleError && error.operation === "Window.close"
  )
  expectExitFailure(
    repeatedCloseExit,
    (error) => error instanceof HostProtocolStaleHandleError && error.operation === "Window.close"
  )
})

const recordVoid = (calls: string[], call: string): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    calls.push(call)
  })

const noopWindowClient: WindowClientApi = {
  create: () => Effect.succeed(windowHandle),
  show: () => Effect.void,
  hide: () => Effect.void,
  focus: () => Effect.void,
  close: () => Effect.void,
  setTitle: () => Effect.void,
  setSize: () => Effect.void,
  setPosition: () => Effect.void,
  setBackgroundColor: () => Effect.void,
  setVibrancy: () => Effect.void,
  setHasShadow: () => Effect.void,
  setFullscreen: () => Effect.void,
  enterFullScreen: () => Effect.void,
  exitFullScreen: () => Effect.void,
  onFullScreenChanged: () => Stream.empty,
  getScaleFactor: () => Effect.succeed({ scaleFactor: 1 }),
  onScaleChanged: () => Stream.empty,
  persistState: () => Effect.void
}

const handleFor = (id: string): WindowHandle => ({
  kind: "window",
  id,
  generation: 0,
  ownerScope: windowScope(id),
  state: "open"
})

const windowExchange = (requests: HostProtocolRequestEnvelope[]): HostWindowExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        ...(request.method === WINDOW_CREATE_METHOD
          ? { payload: { windowId: "host-window-1" } }
          : {})
      })
    )
  }
})

const makeWindowApiExchange = (
  hostExchange: HostWindowExchange,
  registry: ResourceRegistry["Service"],
  options: HostWindowClientOptions = {},
  appEventRouter?: AppEventRouter["Service"]
): ApiClientExchange => {
  const runtime = Handlers(
    makeHostWindowApiLayer(hostExchange, {
      ...options,
      ...(appEventRouter === undefined ? {} : { appEventRouter })
    })
  )
  const registryLayer = Layer.succeed(ResourceRegistry)(registry)
  const request: ApiClientExchange["request"] = (request) =>
    runtime.dispatch(request).pipe(Effect.provide(registryLayer)) as ReturnType<
      ApiClientExchange["request"]
    >

  return {
    request,
    resource: {
      dispose: () => Effect.void
    }
  }
}

const nextId = (ids: readonly string[]) => {
  let index = 0
  return (): string => {
    const value = ids[index]
    if (value === undefined) {
      throw new Error("test exhausted ids")
    }
    index += 1
    return value
  }
}

const nextNumber = (values: readonly number[]) => {
  let index = 0
  return (): number => {
    const value = values[index]
    if (value === undefined) {
      throw new Error("test exhausted numbers")
    }
    index += 1
    return value
  }
}

const expectExitFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  predicate: (error: E) => boolean
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(predicate(fail.error as E)).toBe(true)
      return
    }
  }

  throw new Error("expected typed failure")
}

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag
