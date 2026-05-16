# Effect primitive sweep

**Date:** 2026-05-16
**Scope:** Current pass over DevTools and inspector polling streams, inspector browser entrypoint launches, framework/Vite/Bridge test polling helpers, renderer fiber completion, stdio socket callback boundary, test-package polling helpers, core test scheduler yields, core runtime test wait helpers, core transport timeout assertions, the auto-save cadence loop, bridge stream queue offers, bridge unary transport queue consumption, lazy runtime provider loading, postMessage socket event streaming, Effect telemetry hook launch boundaries, Vite server/client HMR listener lifecycle, CLI doctor config imports, native capability permission snapshots, native crash-report workflow tests, bridge client exchange validation, bridge protocol fixture decoding, config production-check input validation, core runtime stdout frame decoding, backup/restore manifest decoding, package metadata fixture decoding, repo-shape JSON fixture decoding, and verification-matrix JSON fixture decoding.

## Current durable source change

Replaced repeated DevTools and inspector polling-stream composition with canonical Effect stream scheduling:

- `packages/devtools/src/event-log-panel.ts`
- `packages/devtools/src/diagnostics-panels.ts`
- `packages/devtools/src/embedded-inspector-panel.ts`
- `packages/devtools/src/persistence-panel.ts`
- `packages/devtools/src/layer-graph-panel.ts`
- `packages/devtools/src/performance-overlay.ts`
- `packages/devtools/src/live-panels.ts`
- `packages/devtools/src/index.ts`
- `packages/devtools/src/logs-panel.ts`
- `apps/inspector/src/inspector-app.ts`

Before:

```ts
Stream.fromEffect(list()).pipe(
  Stream.concat(Stream.fromEffectRepeat(Effect.sleep(frameInterval).pipe(Effect.andThen(list()))))
)
```

After:

```ts
Stream.fromEffectSchedule(list(), Schedule.spaced(frameInterval))
```

Added coverage in `packages/devtools/src/panels.test.ts` for `LogsPanel.observe()` emitting the initial snapshot and a scheduled refresh.

Replaced the inspector browser entrypoint's Promise chains with `Effect.runCallback`:

- `apps/inspector/src/main.tsx`
- `apps/inspector/src/styles.css`

Before:

```ts
void Effect.runPromise(boot).then(({ service, snapshot }) => {
  createRoot(root).render(<InspectorRoot service={service} initialSnapshot={snapshot} />)
})
```

After:

```ts
void Effect.runCallback(boot, {
  onExit: (exit) => {
    inspectorRoot.render(Exit.isSuccess(exit) ? app(exit.value) : error(exit.cause))
  }
})
```

Boot and session-selection failures are now observed through the Effect exit channel and rendered as an inspector error instead of becoming unhandled Promise rejections.

Replaced local host-timer polling helpers with bounded Effect retry schedules:

- `packages/solid/src/index.test.ts`
- `packages/vue/src/index.test.ts`
- `packages/vite/src/hmr-controller.test.ts`
- `packages/bridge/src/client.test.ts`
- `packages/bridge/src/streams.test.ts`
- `packages/devtools/src/index.test.ts`

Before:

```ts
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (predicate()) {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 1))
}
```

After:

```ts
Effect.suspend(() =>
  predicate() ? Effect.void : Effect.fail(new Error("condition not met"))
).pipe(Effect.retry(Schedule.spaced("1 millis").pipe(Schedule.both(Schedule.recurs(100)))))
```

Also replaced one bridge test scheduler yield from `Bun.sleep(0)` to `Effect.yieldNow`.

Replaced renderer framework Promise bridges over fiber observers with `Fiber.await`:

- `packages/core/src/runtime/renderer-stream.ts`
- `packages/core/src/runtime/renderer-stream.test.ts`

Before:

```ts
new Promise((resolve) => {
  fiber.addObserver((exit) => {
    queueMicrotask(() => resolve(exit))
  })
})
```

After:

```ts
Effect.runPromise(Fiber.await(fiber))
```

The remaining `fiber.addObserver` in `observeFrameworkFiber` is retained because it is the callback delivery boundary rather than a Promise bridge.

Replaced framework callback delivery that unnecessarily chained through the Promise helper:

- `packages/core/src/runtime/renderer-stream.ts`
- `packages/core/src/runtime/renderer-stream.test.ts`
- `packages/react/src/hooks/desktop.ts`
- `packages/react/src/index.test.ts`

Before:

```ts
void runLatestPromiseExit(effect).then(([exit, isLatest]) => {
  if (isLatest) {
    queueMicrotask(() => onExit(exit))
  }
})
```

After:

```ts
const fiber = runtime.runFork(effect)
observeFrameworkFiber(fiber, (exit) => {
  if (!disposed && generation === currentGeneration) {
    onExit(exit)
  }
})
```

`runLatestPromiseExit` remains because mutations expose a Promise-returning API to React callers. The callback API and React resource cleanup now use the Effect fiber observer path directly instead of manufacturing and chaining a Promise.

Replaced the stdio socket stdout callback boundary with `Effect.callback`:

- `packages/core/src/runtime/stdio-socket.ts`
- `packages/core/src/runtime/stdio-socket.test.ts`

Before:

```ts
new Promise((resolve, reject) => {
  process.stdout.write(chunk, (error) => {
    if (error) {
      reject(error)
    } else {
      resolve()
    }
  })
})
```

After:

```ts
Effect.callback((resume) => {
  process.stdout.write(chunk, (error) => {
    resume(error ? Effect.fail(error) : Effect.void)
  })
})
```

Replaced zero-delay host sleeps used as Effect scheduler yields with `Effect.yieldNow`:

- `packages/core/src/runtime/telemetry.test.ts`
- `packages/core/src/runtime/inspector-transport.test.ts`
- `packages/core/src/runtime/process.test.ts`

Before:

```ts
await Bun.sleep(0)
```

After:

```ts
await Effect.runPromise(Effect.yieldNow)
```

Added subscriber-lifecycle coverage for the retained inspector transport subscriber registry:

- `packages/core/src/runtime/inspector-transport.ts`
- `packages/core/src/runtime/inspector-transport.test.ts`

`InspectorTransport` keeps its local subscriber map instead of collapsing to `PubSub` because it owns replay cursors, retained-event snapshots, active-subscriber counts, and per-subscriber drop accounting. Effect `PubSub` owns fanout/backpressure well, but its shared queue semantics do not directly preserve those observable inspector metrics. The added test forks a subscription stream, waits until `activeSubscribers` is `1`, interrupts the fiber, and verifies `activeSubscribers` returns to `0`.

Added prompt-queue coverage for the retained approval broker actor queue:

- `packages/core/src/runtime/approval-broker.ts`
- `packages/core/src/runtime/approval-broker.test.ts`

`ApprovalBroker` already owns active prompt fibers with `FiberMap`; the remaining actor queue is local policy because it coalesces identical requests, enforces per-actor depth, tracks scope denials, and fans one prompt outcome out to multiple waiters. The added test blocks the active prompt, queues a distinct request for the same actor, verifies the queued prompt does not start early, releases the active prompt, and verifies both outcomes complete in order.

Replaced the React cleanup test's zero-delay host timer with the actual Promise microtask boundary used by `disposeRuntime`:

- `packages/react/src/index.test.ts`

Before:

```ts
await new Promise((resolve) => setTimeout(resolve, 0))
```

After:

```ts
await Promise.resolve()
```

Replaced test-support package polling loops with bounded Effect retry schedules:

- `packages/test/src/index.test.ts`

Before:

```ts
for (let attempt = 0; attempt < 100; attempt += 1) {
  const snapshot = yield * registry.list()
  if (snapshot.entries.length >= count) {
    return
  }
  yield * Effect.sleep("1 millis")
}
```

After:

```ts
registry.list().pipe(
  Effect.flatMap((snapshot) =>
    snapshot.entries.length >= count
      ? Effect.void
      : Effect.fail(new Error("waiting for registry entries"))
  ),
  Effect.retry(Schedule.spaced("1 millis").pipe(Schedule.both(Schedule.recurs(100))))
)
```

The remaining timers in `packages/test/src/index.ts` are retained because they model mock host and PTY async behavior at an adapter boundary.

Replaced Vue mutation's local fiber lifecycle with the shared framework scoped operation:

- `packages/vue/src/index.ts`

Before:

```ts
let currentFiber: Fiber.Fiber<A, E | ER> | undefined
const fiber = runtime.runFork(makeEffect(input as I))
const exit = await new Promise<Exit.Exit<A, E | ER>>((resolve) => {
  fiber.addObserver((completed) => queueMicrotask(() => resolve(completed)))
})
```

After:

```ts
const operation = makeFrameworkScopedOperation(runtime)
const [exit, isLatest] = await operation.runLatestPromiseExit(makeEffect(input as I))
```

The existing Vue mutation interruption test remains the behavioral guard for this change.

Replaced permission approval workflow's token polling loop with a bounded Effect retry schedule:

- `packages/core/src/runtime/permission-approval-workflow.test.ts`

Before:

```ts
for (let attempt = 0; attempt < 100; attempt += 1) {
  const token = read()
  if (token !== undefined) {
    return token
  }
  yield * Effect.sleep("1 millis")
}
```

After:

```ts
Effect.suspend(() => {
  const token = read()
  return token === undefined
    ? Effect.fail(new Error("waiting for approval token"))
    : Effect.succeed(token)
}).pipe(Effect.retry(Schedule.spaced("1 millis").pipe(Schedule.both(Schedule.recurs(100)))))
```

Replaced filesystem watch test's host-timer wait helper with a bounded Effect retry schedule:

- `packages/core/src/runtime/filesystem.test.ts`
- `packages/core/src/runtime/worker.test.ts`
- `packages/core/src/runtime/process.test.ts`
- `packages/core/src/runtime/pty.test.ts`

Before:

```ts
for (let attempt = 0; attempt < 50; attempt += 1) {
  if (predicate()) {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 10))
}
```

After:

```ts
Effect.suspend(() =>
  predicate() ? Effect.void : Effect.fail(new Error("condition was not met"))
).pipe(Effect.retry(Schedule.spaced("10 millis").pipe(Schedule.both(Schedule.recurs(50)))))
```

The process and PTY tests still retain fake child lifecycle timers where they model child-process or host behavior.

Replaced the in-memory transport blocked-send sentinel with `Effect.timeoutOption`:

- `packages/core/src/runtime/transport.test.ts`

Before:

```ts
Promise.race([
  Effect.runPromise(Fiber.join(blockedSecond)).then(() => false),
  new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(true), 25)
  })
])
```

After:

```ts
Fiber.join(blockedSecond).pipe(Effect.timeoutOption("25 millis"))
```

Replaced the auto-save service's explicit infinite sleep loop with scheduled Effect repetition:

- `packages/core/src/runtime/auto-save.ts`

Before:

```ts
while (true) {
  yield * Effect.sleep(interval)
  yield * flush
}
```

After:

```ts
Effect.sleep(interval).pipe(Effect.andThen(flush), Effect.repeat(Schedule.spaced(interval)))
```

Replaced normal bridge stream frame queue offers with the typed Effect queue primitive:

- `packages/bridge/src/streams.ts`

Before:

```ts
const offered = Queue.offerUnsafe(streamQueue.queue, frame)
```

After:

```ts
const offered = yield * Queue.offer(streamQueue.queue, frame)
```

The terminal-frame forced eviction loop remains because it owns bridge protocol policy: terminal state must be delivered even when data frames are dropped to make room.

Replaced process output queue insertion with safe Effect queue primitives while preserving explicit overflow failure:

- `packages/core/src/runtime/process.ts`

Before:

```ts
const offered = Queue.offerUnsafe(queue, chunk)
```

After:

```ts
const queueFull = yield * Queue.isFull(queue)
if (queueFull) {
  return yield * Effect.fail(makeBackpressureOverflow(streamName, command, limitBytes, 1))
}

const offered = yield * Queue.offer(queue, chunk)
```

`Queue.offer` can suspend on a full bounded queue, so the code first checks fullness and fails with `BackpressureOverflow`. This keeps the process output policy non-blocking while removing the unsafe queue write from Effect-owned code.

Replaced lazy desktop runtime provider imports with typed Promise failure handling:

- `packages/core/src/runtime/desktop-app.ts`
- `packages/core/src/index.test.ts`

Before:

```ts
layer: Effect.promise(() =>
  import("../providers/bun.js").then((module) => module.BunRuntimeProviderLayer)
)
```

After:

```ts
layer: Effect.tryPromise({
  try: () => import("../providers/bun.js").then((module) => module.BunRuntimeProviderLayer),
  catch: (cause) => runtimeProviderLoadError("bun", cause)
})
```

`DesktopRuntimeProviderDescriptor.layer` can now fail with `DesktopConfigError`, and `DesktopConfigError` preserves the import failure cause. The regression test exercises the typed startup failure path with a custom lazy provider descriptor.

Simplified the same lazy runtime provider imports after the typed failure path existed:

- `packages/core/src/runtime/desktop-app.ts`

Before:

```ts
try: () => import("../providers/bun.js").then((module) => module.BunRuntimeProviderLayer)
```

After:

```ts
try: async () => (await import("../providers/bun.js")).BunRuntimeProviderLayer
```

This keeps `Effect.tryPromise` as the boundary and removes the inner Promise chain. The deleted-wrapper subpath test in `packages/core/src/index.test.ts` now uses explicit `try`/`catch` for the same reason.

Replaced the postMessage socket's manual inbound queue and read loop with `Stream.callback`:

- `packages/core/src/runtime/postmessage-socket.ts`
- `packages/core/src/runtime/postmessage-socket.test.ts`

Before:

```ts
const inbound = yield * Queue.unbounded<Uint8Array, Socket.SocketError>()
// listener offers into the queue
while (true) {
  const item = yield * Queue.take(inbound)
  // run handler
}
```

After:

```ts
Stream.callback<Uint8Array, Socket.SocketError>((queue) =>
  Effect.acquireRelease(registerListener(queue), unregisterListener)
).pipe(Stream.runForEach(runHandler))
```

The remaining `Queue.offerUnsafe` is inside the synchronous browser `message` callback owned by `Stream.callback`. Coverage now verifies inbound delivery and listener cleanup when the socket run scope closes.

Replaced the CLI doctor's config import Promise result union with `Effect.tryPromise` plus `Effect.match`:

- `packages/cli/src/doctor.ts`

Before:

```ts
yield *
  Effect.promise(async () => {
    try {
      return { ok: true, module: await import(configPath) }
    } catch (cause) {
      return { ok: false, cause }
    }
  })
```

After:

```ts
yield *
  Effect.tryPromise({
    try: async () => await import(configPath),
    catch: (cause) => cause
  }).pipe(Effect.match({ onFailure, onSuccess }))
```

The public doctor behavior remains no-fail diagnostic reporting, but Promise rejection now travels through the Effect failure channel before being folded into the diagnostic result.

Removed low-value native crash-report test surface:

- `packages/native/src/crash-report-workflow.test.ts`

First pass removed a dynamic import Promise:

```ts
const { CrashReportEventSchema } =
  yield * Effect.promise(() => import("./crash-report-workflow.js"))
```

Then the whole direct EventLog smoke test was removed after the real drain boundary test existed:

```ts
test("EventLog writes crash-report-submitted and crash-report-dropped events", ...)
```

That test manually wrote EventLog entries and mostly tested the EventLog library. The generic persisted-queue offer/take smoke test and toy `Activity.retry` workflow test were removed for the same reason. The remaining crash-report tests now keep package-owned checks: schema round-trip, fixed-id dedup behavior, upload handler enqueueing, submitted drain workflow path, and dropped workflow path after exhausted submit retries.

Grounded the native crash-report persisted queue drain against Effect's upstream persistence and workflow implementations:

- `repos/effect-smol/packages/effect/src/unstable/persistence/PersistedQueue.ts`
- `repos/effect-smol/packages/effect/src/unstable/workflow/DurableQueue.ts`
- `packages/native/src/crash-report-workflow.ts`
- `packages/native/src/crash-report-workflow.test.ts`

`PersistedQueue` exposes single-item `offer` and `take` operations. There is no Effect stream/drain API for persisted queues, and upstream `DurableQueue.makeWorker` repeats `queue.take(...)` with `Effect.forever` while letting `PersistedQueue.take` own the per-item retry/removal semantics. The native crash-report drain keeps that shape.

Added boundary coverage for the retained drain shape: the test starts `makeCrashReportDrainLayer`, offers a persisted crash report, waits with `Effect.retry` plus `Schedule`, and asserts the fake HTTP client and EventLog saw a submitted report.

Added dropped-report workflow coverage without adding a production seam. The test executes `CrashSubmissionWorkflow` with a fake 503 `HttpClient`, forks the workflow, advances Effect's `TestClock` by one hour to exhaust the real `DesktopSchedules.crashReportSubmission` retry schedule, then asserts the EventLog contains `crash-report-dropped` and not `crash-report-submitted`.

Grounding note: Effect upstream uses `TestClock.adjust(...)` and finite clock movement for scheduled tests. `TestClock.setTime(Number.POSITIVE_INFINITY)` is useful in some schedule tests but this installed runtime's tracing clock rejects infinite nanosecond timestamps, so this test uses a finite advance.

Grounded the native updater poll loop against `DurableClock.sleep`:

- `repos/effect-smol/packages/effect/src/unstable/workflow/DurableClock.ts`
- `packages/native/src/updater-workflow.ts`

The update scheduler remains an `Effect.forever` loop over `DurableClock.sleep` because the wait must be persisted by the workflow engine for long intervals. Replacing it with a normal `Schedule.spaced` would trade away durable wake-up semantics.

Simplified native updater staged-file cleanup inside the existing typed Promise boundary:

- `packages/native/src/updater-workflow.ts`

Before:

```ts
await import("node:fs/promises").then((m) => m.unlink(path))
```

After:

```ts
await unlink(path)
```

The cleanup still uses `Effect.tryPromise` and dies on cleanup failure as before, but no longer adds a dynamic import Promise chain inside the boundary.

Replaced repeated CLI build-test fixture I/O `Effect.promise` calls with a typed helper:

- `packages/cli/src/index.test.ts`

Before:

```ts
yield * Effect.promise(() => mkdir(outdir, { recursive: true }))
yield * Effect.promise(() => writeFile(join(outdir, "runtime.js"), "console.log('ok')\n"))
```

After:

```ts
yield * writeBuildFixtureOutput(invocation)
```

`writeBuildFixtureOutput` uses `Effect.tryPromise` and maps rejected fixture I/O to `BuildCommandFailedError`, matching the mocked `CommandRunner` contract instead of defecting the Effect. The converted build clusters cover normal staging, provider/cache reuse, web engine manifests, renderer symlink rejection, security policy serialization, disabled CSP serialization, and window manifest serialization.

Added typed CLI fixture I/O helpers for signing and packaging runners:

- `packages/cli/src/index.test.ts`

Before:

```ts
yield * Effect.promise(() => writeFile(outputPath, "signature"))
```

After:

```ts
yield * runSignFixtureIo(invocation, () => writeFile(outputPath, "signature"))
yield * runPackageFixtureIo(invocation, () => writeFile(output, invocation.step))
```

The helpers map rejected fixture filesystem Promises to `SignCommandFailedError` and `PackageCommandFailedError`, preserving the runner contracts. Package fixture reads now use `readPackageFixtureText` for the same typed boundary.

Removed the remaining executable `Effect.promise` calls from the CLI test fixture helpers:

- `packages/cli/src/index.test.ts`

The repro package-runner fixture now uses `Effect.tryPromise` directly, letting `runDesktopReproCheck` wrap failures as `ReproPackageRunError`. The deterministic build, package, mode-drift, and symlink-drift helpers now use the typed build/package fixture helpers. A repository scan now finds no executable `Effect.promise(` calls under `packages`, `apps`, or `tests`; the only remaining matches are instructional strings in `packages/core/src/runtime/desktop-app.ts`.

Replaced core runtime main-test child-process Promise bridges with `Effect.callback`:

- `packages/core/src/runtime/main.test.ts`

Before:

```ts
new Promise((resolve, reject) => {
  child.on("error", reject)
  child.on("close", resolve)
})
```

After:

```ts
Effect.callback((resume) => {
  child.on("error", (error) => resume(Effect.fail(error)))
  child.on("close", (exitCode) => resume(Effect.succeed(exitCode)))
  return Effect.sync(() => child.kill())
})
```

The helper still returns a Promise to keep the test call sites stable, but process lifecycle completion and interruption cleanup are now owned by the Effect callback primitive.

Verified native capability permission registration after `Native.*` became layer factories:

- `packages/native/src/native.ts`
- `packages/native/src/capabilities.ts`
- `packages/native/src/capabilities.test.ts`

`NativeCapabilitiesLive` now snapshots the default layer by calling `Native.all()`, and capability snapshotting provides both `DesktopNativeRegistryLive` and `DesktopPermissionRegistryLive` because native surface layers can register both the selected native surface and its permission capabilities.

Replaced Vite HMR controller's unmanaged server listener lifecycle with an Effect `Scope` finalizer:

- `packages/vite/src/hmr-controller.ts`
- `packages/vite/src/hmr-controller.test.ts`

Before:

```ts
server.ws.on(FRAME_UP_EVENT, handler)
server.watcher.on("change", handler)
```

After:

```ts
const listenerScope = Effect.runSync(Scope.make())
yield * Scope.addFinalizer(listenerScope, unregisterHandlers)
```

`dispose()` now closes the listener scope after closing the active runtime process, and the regression test verifies websocket and watcher listener counts return to zero.

Replaced Vite HMR controller detached runtime launches with `ManagedRuntime.runCallback`:

- `packages/vite/src/hmr-controller.ts`

Before:

```ts
runtime.runPromise(provideProcessLayer(effect)).catch((error) => {
  reportRuntimeError(server, error)
})
```

After:

```ts
void runtime.runCallback(provideProcessLayer(effect), {
  onExit: (exit) => {
    reportRuntimeExit(server, exit)
  }
})
```

The HMR callbacks do not need a JavaScript Promise; they need an observed asynchronous runtime launch. `runCallback` keeps that work at the Effect runtime edge and reports failed exits, including runtime acquisition failures, without creating ignored Promises.

Added client-side HMR listener disposal to the generated Vite virtual module:

- `packages/vite/src/virtual-module.ts`
- `packages/vite/src/virtual-module.test.ts`

The generated module-level `RUNTIME_READY` and runtime-restart handlers now have named callbacks and unregister through `import.meta.hot.dispose(...)`. The source test pins the generated cleanup calls so future edits cannot reintroduce accumulating HMR listeners.

Replaced bridge transport manual queue read loops with `Stream.fromQueue`:

- `packages/bridge/src/client.ts`
- `packages/bridge/src/rpc-handlers.ts`

Before:

```ts
Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
```

After:

```ts
Stream.fromQueue(queue).pipe(Stream.runForEach(onEnvelope), Effect.andThen(Effect.never))
```

This keeps each transport's non-returning `run` contract while moving queue consumption back to the canonical stream primitive.

Narrowed the Bridge RPC handler runtime contract to Effect RPC's actual server layer and runtime requirements:

- `packages/bridge/src/rpc-handlers.ts`
- `packages/native/src/native-rpc-runtime.ts`
- `packages/native/src/native-surface.ts`
- `packages/native/src/{app,clipboard,context-menu,crash-reporter,dialog,dock,global-shortcut,menu,notification,path,power-monitor,protocol,safe-storage,screen,shell,system-appearance,tray,updater,webview}.ts`

Before:

```ts
dispatch(...) as Effect.Effect<BridgeClientResponse, HostProtocolError | E, R>
return Object.freeze({...}) as BridgeHandlerRuntime<R>
```

After:

```ts
type RpcServerLayerRequirements<Rpcs extends Rpc.Any> = Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>

type RpcServerRuntimeEnvironment<Rpcs extends Rpc.Any, R> = R | Rpc.ServicesServer<Rpcs>

handlers: Layer.Layer<RpcServerLayerRequirements<Rpcs>, E, R>
```

`dispatch` and `runDispatch` now carry handler, middleware, and schema-service requirements through the Effect type instead of casting the whole runtime object. Handler-layer construction errors are constrained to `HostProtocolError`, matching the public `BridgeHandlerRuntime` failure channel. Native handler aliases now use `RpcGroup.HandlersFrom<...>` instead of the widened `Parameters<typeof group.toLayer>[0]` union so native host runtimes pass handler objects into `group.toLayer(...)` without erasing the layer error to `unknown`.

Replaced Bridge/Core test transport queue consumers with `Stream.fromQueue`:

- `packages/bridge/src/protocol.rpc.test.ts`
- `packages/core/src/index.test.ts`

Before:

```ts
run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
```

After:

```ts
run: (onEnvelope) =>
  Stream.fromQueue(queue).pipe(Stream.runForEach(onEnvelope), Effect.andThen(Effect.never))
```

One Bridge namespacing assertion now sorts by client id before comparing replies. The behavior under test is duplicate request-id isolation across clients, not cross-client delivery order.

Replaced Effect telemetry collector hook launches with `Effect.runFork`:

- `packages/core/src/runtime/telemetry.ts`

Before:

```ts
void Effect.runPromise(telemetry.log(input).pipe(Effect.catch(() => Effect.void)))
```

After:

```ts
void Effect.runFork(telemetry.log(input).pipe(Effect.catch(() => Effect.void)))
```

Logger and tracer hooks are synchronous callback boundaries, so they still launch telemetry capture in the background and swallow telemetry recording failures. `runFork` expresses that detached Effect fiber directly without manufacturing a Promise that no caller observes.

Verification:

- `bun test packages/devtools/src/panels.test.ts`
- `bun x ultracite check apps/inspector/src/inspector-app.ts packages/devtools/src/event-log-panel.ts packages/devtools/src/diagnostics-panels.ts packages/devtools/src/embedded-inspector-panel.ts packages/devtools/src/persistence-panel.ts packages/devtools/src/layer-graph-panel.ts packages/devtools/src/performance-overlay.ts packages/devtools/src/live-panels.ts packages/devtools/src/index.ts packages/devtools/src/logs-panel.ts packages/devtools/src/panels.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/devtools`
- `bun run typecheck --filter @effect-desktop/inspector`
- `bun test apps/inspector/src/inspector-app.test.ts`
- `bunx ultracite check apps/inspector/src/main.tsx apps/inspector/src/styles.css`
- `bun run typecheck --filter @effect-desktop/inspector`
- `bun test packages/solid/src/index.test.ts packages/vue/src/index.test.ts packages/vite/src/hmr-controller.test.ts packages/bridge/src/client.test.ts packages/bridge/src/streams.test.ts`
- `bun x ultracite check packages/solid/src/index.test.ts packages/vue/src/index.test.ts packages/vite/src/hmr-controller.test.ts packages/bridge/src/client.test.ts packages/bridge/src/streams.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/bridge`
- `bun run typecheck --filter @effect-desktop/solid`
- `bun run typecheck --filter @effect-desktop/vue`
- `bun run typecheck --filter @effect-desktop/vite`
- `bun test packages/devtools/src/index.test.ts packages/devtools/src/panels.test.ts`
- `bun x ultracite check packages/devtools/src/index.test.ts packages/devtools/src/panels.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/devtools`
- `bun test packages/core/src/runtime/renderer-stream.test.ts`
- `bun x ultracite check packages/core/src/runtime/renderer-stream.ts packages/core/src/runtime/renderer-stream.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/renderer-stream.test.ts`
- `bun test packages/react/src/index.test.ts --test-name-pattern "React adapter lifecycle paths"`
- `bun test packages/react/src/index.test.ts packages/react/src/hooks/effect-runner.test.ts packages/react/src/permission-approval.test.ts packages/react/src/sql-pglite.test.ts packages/react/src/sqlite-wasm.test.ts`
- `bunx ultracite check packages/core/src/runtime/renderer-stream.ts packages/core/src/runtime/renderer-stream.test.ts packages/react/src/hooks/desktop.ts packages/react/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/core --filter @effect-desktop/react`
- `bun test packages/core/src/runtime/stdio-socket.test.ts`
- `bun x ultracite check packages/core/src/runtime/stdio-socket.ts packages/core/src/runtime/stdio-socket.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/telemetry.test.ts packages/core/src/runtime/inspector-transport.test.ts packages/core/src/runtime/process.test.ts`
- `bun x ultracite check packages/core/src/runtime/telemetry.test.ts packages/core/src/runtime/inspector-transport.test.ts packages/core/src/runtime/process.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/inspector-transport.test.ts`
- `bunx ultracite check packages/core/src/runtime/inspector-transport.test.ts packages/core/src/runtime/inspector-transport.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/approval-broker.test.ts`
- `bunx ultracite check packages/core/src/runtime/approval-broker.test.ts packages/core/src/runtime/approval-broker.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/react/src/index.test.ts`
- `bun x ultracite check packages/react/src/index.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/react`
- `bun test packages/test/src/index.test.ts`
- `bun x ultracite check packages/test/src/index.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/test`
- `bun test packages/vue/src/index.test.ts`
- `bun x ultracite check packages/vue/src/index.ts packages/vue/src/index.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/vue`
- `bun test packages/core/src/runtime/permission-approval-workflow.test.ts`
- `bun x ultracite check packages/core/src/runtime/permission-approval-workflow.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/filesystem.test.ts`
- `bun x ultracite check packages/core/src/runtime/filesystem.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/worker.test.ts`
- `bun x ultracite check packages/core/src/runtime/worker.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/process.test.ts`
- `bun test packages/core/src/runtime/process.test.ts --test-name-pattern "BackpressureOverflow"`
- `bunx ultracite check packages/core/src/runtime/process.ts packages/core/src/runtime/process.test.ts`
- `bun x ultracite check packages/core/src/runtime/process.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/pty.test.ts`
- `bun x ultracite check packages/core/src/runtime/pty.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/commands.test.ts`
- `bun x ultracite check packages/core/src/runtime/commands.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/react/src/index.test.ts packages/solid/src/index.test.ts packages/vue/src/index.test.ts`
- `bun x ultracite check packages/react/src/index.test.ts packages/solid/src/index.test.ts packages/vue/src/index.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/react --filter @effect-desktop/solid --filter @effect-desktop/vue`
- `bun test packages/vite/src/virtual-module.test.ts packages/vite/src/hmr-controller.test.ts`
- `bun test packages/vite/src/virtual-module.test.ts packages/vite/src/hmr-controller.test.ts packages/vite/src/index.test.ts`
- `bun x ultracite check packages/vite/src/virtual-module.ts packages/vite/src/virtual-module.test.ts packages/vite/src/hmr-controller.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun x ultracite check packages/vite/src/virtual-module.ts packages/vite/src/virtual-module.test.ts packages/vite/src/hmr-controller.test.ts packages/vite/src/index.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/vite`
- `bun test packages/core/src/runtime/transport.test.ts`
- `bun x ultracite check packages/core/src/runtime/transport.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/auto-save.test.ts`
- `bun x ultracite check packages/core/src/runtime/auto-save.ts packages/core/src/runtime/auto-save.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/bridge/src/streams.test.ts`
- `bun x ultracite check packages/bridge/src/streams.ts packages/bridge/src/streams.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/bridge`
- `bun run typecheck`
- `bun test packages/core/src/runtime/renderer-rpc-client.test.ts`
- `bun x ultracite check packages/core/src/runtime/renderer-rpc-client.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/devtools/src/shell.test.ts`
- `bun x ultracite check packages/devtools/src/shell.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/devtools`
- `bun test packages/test/src/index.test.ts --test-name-pattern MockPTY`
- `bun x ultracite check packages/test/src/index.ts packages/test/src/index.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/test`
- `bun test packages/core/src/runtime/pty.test.ts`
- `bun x ultracite check packages/core/src/runtime/pty.test.ts --type-aware --type-check --deny-warnings --disable-nested-config --quiet`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/index.test.ts --test-name-pattern "lazy runtime provider load failures"`
- `bun test packages/core/src/index.test.ts`
- `bunx ultracite check packages/core/src/runtime/desktop-app.ts packages/core/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/index.test.ts --test-name-pattern "deleted zero-policy runtime wrapper|lazy runtime provider load failures"`
- `bunx ultracite check packages/core/src/runtime/desktop-app.ts packages/core/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/bridge/src/protocol.rpc.test.ts --test-name-pattern "makeDesktop(Client|Server)Protocol"`
- `bun test packages/bridge/src/protocol.rpc.test.ts`
- `bun test packages/core/src/index.test.ts --test-name-pattern "Desktop\.Rpc\.surface derives|Desktop\.app permission middleware declares"`
- `bun test packages/core/src/index.test.ts`
- `bunx ultracite check packages/bridge/src/protocol.rpc.test.ts packages/core/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/bridge`
- `bun run typecheck --filter @effect-desktop/core`
- `rg -n "Effect\.forever\(Queue\.take|Queue\.take\(.*Effect\.flatMap" packages apps tests --glob '!**/node_modules/**'`
- `bun test packages/core/src/runtime/postmessage-socket.test.ts`
- `bunx ultracite fix packages/core/src/runtime/postmessage-socket.ts packages/core/src/runtime/postmessage-socket.test.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/cli/src/index.test.ts --test-name-pattern "desktop doctor reports config import failures"`
- `bunx ultracite check packages/cli/src/doctor.ts`
- `bun run typecheck --filter @effect-desktop/cli`
- `bun test packages/native/src/crash-report-workflow.test.ts --test-name-pattern "CrashReport drain consumes queued reports"`
- `bun test packages/native/src/crash-report-workflow.test.ts --test-name-pattern "dropped reports"`
- `bun test packages/native/src/crash-report-workflow.test.ts`
- `bunx ultracite check packages/native/src/crash-report-workflow.test.ts`
- `bun run typecheck --filter @effect-desktop/native`
- `bun test packages/native/src/updater-workflow.test.ts`
- `bunx ultracite check packages/native/src/updater-workflow.ts packages/native/src/updater-workflow.test.ts`
- `bun run typecheck --filter @effect-desktop/native`
- `bun test packages/cli/src/index.test.ts --test-name-pattern "desktop build (stages renderer runtime host bridge manifests and report|emits explicit chrome web engine selection|emits node runtime launch manifest|reuses provider-owned nodes|reuses native host)"`
- `bun test packages/cli/src/index.test.ts --test-name-pattern "desktop build (refuses renderer dist symlinks|emits validated renderer security policy|emits disabled renderer CSP policy|emits validated window config)"`
- `bun test packages/cli/src/index.test.ts --test-name-pattern "desktop sign (GPG-signs Linux AppImage|rejects artifact fileName)"`
- `bun test packages/cli/src/index.test.ts --test-name-pattern "desktop package (accepts node runtime launch manifests|emits macOS app dmg zip artifacts|stages macOS app bundle before explicit dmg artifact|stages macOS app bundle before explicit zip artifact|preserves sibling artifacts|emits Linux AppImage deb rpm artifacts|maps linux arm64 RPM metadata|emits Windows per-user MSI)"`
- `bun test packages/cli/src/index.test.ts --test-name-pattern "desktop check --repro"`
- `bun test packages/cli/src/index.test.ts --test-name-pattern "desktop check --release|desktop publish"`
- `rg -n "Effect\\.promise\\(" packages apps tests --glob '!**/node_modules/**'`
- `bun test packages/core/src/runtime/main.test.ts`
- `bunx ultracite check packages/core/src/runtime/main.test.ts`
- `bunx ultracite check packages/cli/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/cli`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/index.test.ts --test-name-pattern "NativeCapabilities|Native\.all|Native\.clipboard|permission"`
- `bun run typecheck --filter @effect-desktop/native`
- `bun run typecheck`
- `git diff --check`
- `bunx ultracite check engineering/audits/v1.0.0/2026-05-16-effect-primitive-sweep.md`
- `rg -n "new Promise|Promise\\.race|setTimeout|setInterval|Bun\\.sleep\\(|Queue\\.offerUnsafe|Effect\\.async\\(|Effect\\.promise\\(" packages apps tests --glob '!**/node_modules/**'`
- `rg -n "while \\(true\\)|for \\(;;\\)|new Promise|Promise\\.race|setTimeout|setInterval|Bun\\.sleep\\(|Queue\\.offerUnsafe|Effect\\.async\\(|Effect\\.promise\\(" packages/core/src/runtime/resources.ts packages/core/src/runtime/transport.ts packages/core/src/runtime/process.ts packages/bridge/src/streams.ts packages/test/src/index.ts packages/vite/src/virtual-module.ts --glob '!**/node_modules/**'`
- `bun test packages/vite/src/hmr-controller.test.ts`
- `bunx ultracite check packages/vite/src/hmr-controller.ts packages/vite/src/hmr-controller.test.ts`
- `bun run typecheck --filter @effect-desktop/vite`
- `bun test packages/vite/src/hmr-controller.test.ts packages/vite/src/virtual-module.test.ts packages/vite/src/index.test.ts`
- `bunx ultracite check packages/vite/src/hmr-controller.ts packages/vite/src/hmr-controller.test.ts packages/vite/src/virtual-module.ts packages/vite/src/virtual-module.test.ts`
- `bun run typecheck --filter @effect-desktop/vite`
- `bun test packages/vite/src/hmr-controller.test.ts`
- `bunx ultracite check packages/vite/src/hmr-controller.ts packages/vite/src/hmr-controller.test.ts`
- `bun run typecheck --filter @effect-desktop/vite`
- `bun test packages/vite/src/hmr-controller.test.ts packages/vite/src/virtual-module.test.ts packages/vite/src/index.test.ts`
- `bun test packages/bridge/src/client.test.ts --test-name-pattern "makeUnaryDesktopTransportFromBridgeClientExchange"`
- `bunx ultracite check packages/bridge/src/client.ts packages/bridge/src/client.test.ts`
- `bun run typecheck --filter @effect-desktop/bridge`
- `bun test packages/bridge/src/client.test.ts`
- `bunx ultracite check packages/bridge/src/client.ts packages/bridge/src/client.test.ts`
- `bun run typecheck --filter @effect-desktop/bridge`
- `bun test packages/cli/src/index.test.ts --test-name-pattern "desktop build emits explicit chrome web engine selection"`
- `bunx ultracite check packages/cli/src/index.ts packages/cli/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/cli`
- `bun test packages/native/src/index.test.ts --test-name-pattern "native host RPC runtime uses the Effect Clock"`
- `bunx ultracite check packages/native/src/native-rpc-runtime.ts packages/native/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/native`
- `bun test packages/devtools/src/panels.test.ts --test-name-pattern "ReactivityTracker records invalidation events"`
- `bun test packages/devtools/src/index.test.ts --test-name-pattern "LiveRuntimePanels projects"`
- `bunx ultracite check packages/devtools/src/live-panels.ts packages/devtools/src/reactivity-panel.ts packages/devtools/src/panels.test.ts packages/devtools/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/devtools`
- `bun test packages/test/src/index.test.ts --test-name-pattern "MockHost calls returns immutable|MockBridge replays pinned stream"`
- `bunx ultracite check packages/test/src/index.ts packages/test/src/index.test.ts`
- `bun run typecheck --filter @effect-desktop/test`
- `bun test packages/native/src/crash-report-workflow.test.ts`
- `bunx ultracite check packages/native/src/crash-report-workflow.test.ts`
- `bun test packages/core/src/runtime/renderer-rpc-client.test.ts`
- `bunx ultracite check packages/core/src/runtime/desktop-rpc-registry.ts packages/core/src/runtime/renderer-rpc-client.ts packages/core/src/runtime/renderer-rpc-client.test.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/renderer-rpc-client.test.ts`
- `bunx ultracite check packages/core/src/runtime/renderer-rpc-client.ts packages/core/src/runtime/renderer-rpc-client.test.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/audit-events.test.ts`
- `bunx ultracite check packages/core/src/runtime/audit-events.ts packages/core/src/runtime/audit-events.test.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/settings.test.ts`
- `bunx ultracite check packages/core/src/runtime/settings.ts packages/core/src/runtime/settings.test.ts`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/settings.test.ts -t "invalid set value returns typed InvalidArgument before writing"`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/permission-registry.test.ts -t "validates inputs before audit side effects|rejects control bytes in actor ids"`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/worker.test.ts -t "Worker validates channel send"`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/commands.test.ts -t "CommandRegistry rejects control characters in command ids"`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/commands.test.ts`
- `bun test packages/core/src/runtime/transport.test.ts -t "Transport service validates unframeStream chunks input|Transport service returns typed failures"`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/transport.test.ts`
- `bunx ultracite check packages/core/src/runtime/transport.ts packages/core/src/runtime/transport.test.ts`
- `bun test packages/core/src/runtime/pty.test.ts -t "PTY rejects invalid output overflow policies before adapter open"`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/runtime/pty.test.ts`
- `bunx ultracite check packages/core/src/runtime/pty.ts packages/core/src/runtime/pty.test.ts`
- `bun test packages/core/src/index.test.ts -t "Desktop.make returns metadata descriptor"`
- `bun run typecheck --filter @effect-desktop/core`
- `bun test packages/core/src/index.test.ts`
- `bunx ultracite check packages/core/src/index.ts packages/core/src/index.test.ts packages/core/src/runtime/desktop-app.ts`
- `bun test packages/bridge/src/client.test.ts -t "Client normalizes outbound requests before exchange dispatch"`
- `bun run typecheck --filter @effect-desktop/bridge`
- `bun run typecheck --filter @effect-desktop/native`
- `bun test packages/bridge/src/client.test.ts`
- `bun test packages/native/src/index.test.ts -t "Screen bridge client sends typed host envelopes and decodes values"`
- `bunx ultracite check packages/bridge/src/client.ts packages/bridge/src/client.test.ts packages/native/src/screen.ts`
- `bun desktop check --api --write`
- `bun desktop check --api`
- `bun test packages/bridge/src/protocol.rpc.test.ts`
- `bunx ultracite check packages/bridge/src/rpc-handlers.ts packages/bridge/src/protocol.rpc.test.ts`
- `bun run typecheck --filter @effect-desktop/bridge`
- `bun test packages/native/src/index.test.ts --test-name-pattern "native host RPC runtime uses the Effect Clock"`
- `bunx ultracite check packages/bridge/src/rpc-handlers.ts packages/native/src/native-rpc-runtime.ts packages/native/src/native-surface.ts packages/native/src/*.ts`
- `bun run typecheck --filter @effect-desktop/native`
- `git diff --check`
- `bun test packages/core/src/runtime/telemetry.test.ts`
- `bunx ultracite check packages/core/src/runtime/telemetry.ts packages/core/src/runtime/telemetry.test.ts`
- `bun run typecheck --filter @effect-desktop/core`

## Verified but not durable

No verified source edits from this pass are known to be missing from the current working tree. Earlier transient restoration risk was rechecked with final `git status` and targeted source scans before this note was updated.

The `CommandRegistry.registerGroup` cast around `RpcTest.makeClient(group.middleware(PermissionInterceptor))` was rechecked. Removing the cast by moving permission checks directly into `invokeCommandRpc` changed observable behavior: permission audit happened before RPC payload validation, and `packages/core/src/runtime/commands.test.ts` caught the regression in `CommandRegistry validates input before permission and handler side effects`. The local attempt was reverted. The remaining cast is tied to Effect RPC middleware typing, not a removable local assertion.

## Current source state

Current durable artifacts:

- DevTools and inspector polling source changes listed above.
- Inspector browser entrypoint launches now use `Effect.runCallback`, and failures render an inspector error surface.
- Framework/Vite/Bridge test polling helper changes listed above.
- Renderer fiber completion source and test changes listed above.
- Framework scoped operation callback delivery and React resource cleanup now use the fiber observer callback path directly instead of Promise continuations.
- Stdio socket callback boundary source and test changes listed above.
- Core scheduler-yield test changes listed above.
- Inspector transport now has explicit subscriber cleanup coverage for its retained manual registry.
- ApprovalBroker now has explicit queued-prompt ordering coverage for its retained actor queue policy.
- React cleanup microtask-boundary test change listed above.
- Test-support package polling helper changes listed above.
- Vue mutation lifecycle source change listed above.
- Permission approval token polling helper change listed above.
- Core runtime filesystem, worker, process, and PTY test wait helper changes listed above.
- Core transport blocked-send timeout assertion change listed above.
- Auto-save cadence loop change listed above.
- Bridge stream normal-frame queue offer change listed above.
- Process output queues now use `Queue.isFull` plus `Queue.offer` instead of `Queue.offerUnsafe`, while preserving the bounded-buffer overflow failure policy.
- Renderer RPC client test lifecycle latches now use Effect `Deferred` instead of raw Promises.
- DevTools shell close-completion test now uses Effect `Deferred` and `Effect.yieldNow` instead of a raw Promise latch and Promise microtask.
- Test-support mock PTY exit state now uses Effect `Deferred` internally while preserving the Promise-shaped adapter contract.
- Core PTY fake child exit state now uses Effect `Deferred` internally while preserving the Promise-shaped adapter contract.
- CommandRegistry empty-trace test now uses the real `PermissionRegistry` with a declared rule instead of a partial `unknown as` registry fake.
- React, Solid, and Vue reserved endpoint property tests now inspect generated clients directly instead of casting them through `Record<string, unknown>`.
- Vite generated runtime source now uses `Effect.callback` instead of `Effect.async` for HMR ready-event callback registration, and the virtual-module test pins that primitive.
- Lazy desktop runtime provider imports now use `Effect.tryPromise` and report typed `DesktopConfigError` startup failures with the original cause.
- Lazy desktop runtime provider imports no longer contain inner Promise `.then` chains inside the `Effect.tryPromise` boundary.
- PostMessage socket inbound events now use `Stream.callback` instead of a manually allocated queue and infinite take loop.
- CLI doctor config import failure now uses `Effect.tryPromise` before folding the failure into the diagnostic result.
- Native crash-report tests removed a direct EventLog smoke test after the workflow drain boundary covered package-owned event writing.
- Native crash-report tests removed a generic PersistedQueue offer/take smoke test after upload-handler and drain coverage exercised package-owned queue behavior.
- Native crash-report tests removed a toy `Activity.retry` workflow test that exercised Effect workflow library behavior instead of crash-report behavior.
- Native crash-report drain coverage now exercises the retained `PersistedQueue.take` plus `Effect.forever` worker through the scoped drain layer, fake HTTP client, and EventLog.
- Native crash-report dropped-event coverage now uses Effect `TestClock` to exhaust the real submission retry schedule deterministically.
- Native updater cleanup no longer uses a dynamic import Promise chain inside its `Effect.tryPromise` boundary.
- CLI build tests now route fixture filesystem effects through a typed helper that returns `BuildCommandFailedError`.
- CLI sign and package tests now route fixture filesystem effects through typed helpers that return their command-runner error types.
- No executable `Effect.promise(` calls remain under `packages`, `apps`, or `tests`; only instructional strings remain.
- Core runtime main tests no longer hand-roll child-process callback completion with raw Promises.
- Native capability snapshots now provide the permission registry required by option-bearing `Native.*` layer factories.
- Vite HMR controller server listeners are now scoped and removed on controller disposal.
- Vite HMR controller detached runtime launches now use `ManagedRuntime.runCallback` instead of ignored Promises.
- Vite virtual-module HMR listeners are now unregistered through `import.meta.hot.dispose(...)`.
- Bridge unary and RPC handler transports now consume their internal queues through `Stream.fromQueue` instead of hand-rolled forever take loops.
- Bridge RPC handler runtime now accepts Effect RPC handler/middleware layer requirements, keeps schema-service requirements in the runtime environment, and no longer casts the whole dispatch/runtime object back to `BridgeHandlerRuntime`.
- Native host handler aliases now use `RpcGroup.HandlersFrom<...>` instead of the widened `Parameters<typeof group.toLayer>[0]` union.
- Bridge/Core RPC test transports now consume their internal queues through `Stream.fromQueue` instead of hand-rolled forever take loops.
- Effect telemetry logger and tracer hooks now launch detached telemetry recording with `Effect.runFork` instead of unobserved Promises.
- Native event streams now share one Effect stream boundary for subscription support checks, method-envelope validation, and Schema decoding instead of duplicating that policy per surface.
- React provider runtime cleanup now uses `ManagedRuntime.disposeEffect` observed through `Effect.runCallback` instead of an ignored Promise cleanup chain.
- Renderer framework runtimes now expose `disposeEffect`; React, Solid, and Vue generated desktop roots use that Effect cleanup primitive instead of private async disposal wrappers and ignored Promise cleanup calls.
- Renderer framework runtime tests now exercise `disposeEffect` directly instead of the compatibility Promise wrapper.
- Test-support MemoryFilesystem and CLI release filesystem Promise boundaries now use explicit `async` functions inside `Effect.tryPromise` instead of inner `.then` chains.
- Test-support MockPTY async lifecycle methods no longer use Promise `.then` chains; they keep the host-style microtask boundary with explicit `async` functions.
- Core filesystem/SQLite and Bridge stream test helpers no longer use Promise `.then`/`Promise.resolve` chains for existence probes or async predicate polling.
- Core process and React permission approval tests no longer wrap synchronous fixture predicates/results in `Promise.resolve`; helper boundaries now accept sync or async results explicitly.
- Test-support MemoryFilesystem synchronous map mutations now use `Effect.try` instead of Promise-returning helpers wrapped in `Effect.tryPromise`.
- Core PTY and worker polling helpers now accept sync or async predicates through an explicit async `Effect.tryPromise` boundary instead of passing predicate functions directly.
- Test-support MockPTY async host-turn simulation now uses a named `Effect.yieldNow` helper instead of raw `Promise.resolve()` calls.
- Renderer `FrameworkRuntime` no longer exposes the unused Promise `dispose()` wrapper; `disposeEffect` is the only framework-runtime cleanup surface.
- Renderer `runFrameworkPromiseExit` has been removed; tests now use `runFork` plus `Fiber.await` directly, while scoped mutation APIs keep `runLatestPromiseExit` because they own latest-result suppression and Promise-returning UI API semantics.
- Core workflow tests no longer force partial SQLite clients and workflow layers through `as never`; backup coverage uses the real Effect SQLite layer, and workflow dependencies are wired with `Layer.provide`.
- Native updater workflow tests no longer force partial HTTP clients or workflow layers through `as never`; they use `HttpClient.make`, `HttpClientResponse.fromWeb`, and `Layer.provide`.
- Native app HTTP server tests no longer hand-roll partial `HttpServerRequest` objects; the request helper uses `HttpClientRequest.get` plus `HttpServerRequest.fromClientRequest` so traversal tests preserve raw relative URLs while using Effect request constructors.
- CommandRegistry command registration now carries the concrete `RpcGroup.RpcGroup<Rpcs>` type through its API instead of widening to a structural request-map view and casting back before `RpcTest.makeClient`.
- Desktop RPC surfaces now pass the concrete Effect `RpcGroup` directly to `Desktop.rpc`, `RpcClient.make`, and `RpcTest.makeClient`; the old structural fake missing-schema test was removed because non-Effect groups are rejected by the typed surface API.
- This audit note.

## Restore investigation

- `core.hookspath` points at `.husky/_`, but the checked-in Husky shims only dispatch to sibling hooks such as `.husky/pre-commit`; no such sibling hook files are present.
- Repo-local searches across `.husky`, `.agents`, `.claude`, `scripts`, `package.json`, and `turbo.json` found no reset, restore, checkout, clean, or worktree command that explains the earlier tracked-file restoration.
- `lsof` shows two Codex CLI sessions with their current working directory set to this worktree:
  - `node`/`codex` PIDs `59589`/`59590`
  - `node`/`codex` PIDs `78558`/`78559`
- That concurrent-agent state is the likely source of tracked-file edits being restored after verification. Do not continue source edits in this worktree until only one agent owns it or the agents are intentionally coordinated.

## Remaining candidates

- The residual primitive scan reports only owned boundary or algorithm cases in the checked TypeScript paths: `Queue.offerUnsafe` inside callback delivery or explicit terminal-frame policy, fake host timers in process/PTY adapters, and instructional/string-fixture matches.
- `packages/core/src/runtime/transport.ts` keeps a `while (true)` parser loop because `FrameDecoder.push` drains complete frames from an in-memory buffer until it needs more bytes. This is a pure parser loop, not an Effect lifecycle loop.
- `packages/core/src/runtime/resources.ts` keeps a `while (true)` ID-collision loop because it deterministically probes generated UUIDv7 candidates until one is not in the current registry. This is allocation logic, not scheduling or resource lifecycle.
- `packages/test/src/index.ts`, runtime fake process/PTY lifecycle paths, and `crates/host/src/runtime/mod.rs` include timers that model external host behavior. Keep them as host timers unless the fake adapters or embedded host script are redesigned around Effect services.
- `packages/test/src/index.ts` still has one `Date.now` fallback in `makeMemoryFilesystemRuntime`; that constructor builds an in-memory fixture synchronously and already accepts an explicit `now` callback, so moving it to `Clock.currentTimeMillis` would require changing the fixture API from a synchronous layer factory to an Effect constructor.
- `packages/native/src/app-http-server.test.ts` keeps a `for (;;)` loop that drains a Web `ReadableStream` in a test helper. This is byte collection at a Web API boundary, not an Effect lifecycle loop.
- `packages/core/src/runtime/process.test.ts` and `packages/core/src/runtime/pty.test.ts` keep fake-child natural-exit timers because those tests model external process/PTY lifecycle behavior.
- `packages/core/src/runtime/commands.ts` keeps the `registerGroup` cast at the Effect RPC middleware test-client boundary. Directly checking permission in `invokeCommandRpc` would remove the middleware type mismatch, but it changes the required ordering by auditing permission before RPC payload validation.
- `packages/native/src/crash-report-workflow.ts` keeps `Effect.forever(queue.take(...))` because Effect's `PersistedQueue` API exposes single-item `take`, and upstream `DurableQueue.makeWorker` uses the same repeat shape for persisted queue workers.
- `packages/native/src/updater-workflow.ts` keeps `Effect.forever(...DurableClock.sleep(...))` because `DurableClock.sleep` is the workflow-persisted wait primitive for long update polling intervals; `Schedule.spaced` would be an in-memory timer.
- Follow-up #1312 tracks the broader bridge/core Effect RPC type-assertion debt found during the architecture sweep.

## Architecture-debt outcome

Removed two classes of thin Effect reimplementation:

- DevTools and inspector panels no longer hand-roll scheduled polling streams over `Stream.fromEffectRepeat` plus `Effect.sleep`.
- Inspector browser boot and session-selection paths no longer use Promise chains where `Effect.runCallback` can observe success and failure exits directly.
- Framework, Vite, and Bridge tests no longer hand-roll bounded polling loops with host timers where `Effect.retry` plus `Schedule` expresses the policy directly.
- Renderer framework Promise completion no longer bridges `Fiber.addObserver` manually where `Fiber.await` owns the exit await primitive.
- Framework scoped operation callback delivery no longer routes through the Promise-returning helper; direct fiber observation owns stale-result suppression for callback consumers.
- Stdio stdout writes no longer wrap a callback API in a raw Promise before returning to Effect.
- Core tests no longer use host sleeps for zero-delay Effect scheduler yields.
- Inspector transport subscriber bookkeeping remains local policy, but stream interruption cleanup is now covered by a boundary test.
- ApprovalBroker actor queues remain local policy, but queued prompt start ordering is now covered by a boundary test.
- React cleanup test no longer waits on a host timer when the production path reports through a Promise microtask.
- Test-support package tests no longer hand-roll polling loops where `Effect.retry` plus `Schedule` owns the retry policy.
- Vue mutation lifecycle no longer duplicates the shared framework scoped operation or bridges fiber completion manually.
- Permission approval workflow tests no longer hand-roll token polling where `Effect.retry` plus `Schedule` owns the retry policy.
- Core runtime filesystem, worker, process, and PTY tests no longer use host timers for in-memory fixture readiness polling.
- Core transport tests no longer use a raw `Promise.race` timer where `Effect.timeoutOption` owns the timeout policy.
- Auto-save no longer hand-rolls a forever sleep loop where `Effect.repeat` plus `Schedule.spaced` owns the cadence policy.
- Bridge stream normal data/error frame dispatch no longer calls `Queue.offerUnsafe` where `Queue.offer` expresses the same policy directly.
- Process output buffering no longer calls `Queue.offerUnsafe`; safe queue primitives own fullness detection and insertion.
- Renderer RPC client tests no longer use raw Promise lifecycle latches where `Deferred` models one-shot Effect synchronization directly.
- DevTools shell tests no longer use a raw Promise latch where `Deferred` models close completion directly.
- Test-support mock PTY no longer hand-rolls exit-state Promise resolution where `Deferred` owns the one-shot completion state.
- Core PTY tests no longer hand-roll fake-child exit Promise resolution where `Deferred` owns the one-shot completion state.
- CommandRegistry tests no longer hide permission registry contract drift behind a partial `unknown as` fake for the empty-trace fallback case.
- Framework adapter tests no longer erase generated client types just to inspect reserved own-property behavior.
- Vite runtime source no longer uses the legacy async constructor for callback-style HMR readiness; `Effect.callback` now owns that boundary.
- Lazy runtime provider imports no longer use `Effect.promise` for work that can fail; `Effect.tryPromise` maps failed built-in provider loading into typed startup failure evidence.
- Lazy runtime provider imports no longer add inner Promise chains where `async`/`await` keeps the typed `Effect.tryPromise` boundary simpler.
- PostMessage socket no longer reimplements an event stream with a queue and read loop; `Stream.callback` owns listener acquisition, finalization, and item delivery.
- CLI doctor no longer catches dynamic import failure inside `Effect.promise`; `Effect.tryPromise` owns the Promise boundary and `Effect.match` preserves the no-fail probe contract.
- Native crash-report tests no longer keep direct EventLog, generic PersistedQueue, or toy workflow retry smoke tests that do not belong to package behavior.
- Native crash-report tests now cover the real persisted-queue drain boundary instead of only testing queue/event-log pieces independently.
- Native crash-report tests now cover both submitted and dropped audit events through workflow execution paths.
- Native updater staged-file cleanup no longer adds a dynamic import Promise chain where a static `unlink` import is the simpler Node boundary.
- CLI build tests no longer duplicate renderer/runtime/native-host fixture output writers or defect on rejected fixture filesystem Promises in the converted cluster.
- CLI sign/package tests no longer defect on rejected fixture filesystem Promises in the converted command-runner clusters.
- CLI repro/release/publish fixture helpers no longer use `Effect.promise`; rejected fixture Promises flow through `Effect.tryPromise` and the relevant typed runner wrappers.
- Core runtime main tests now use `Effect.callback` for spawned child-process callback completion and interruption cleanup.
- Native capability snapshots now use the canonical native layer factory and provide the permission registry required by native permission declarations.
- Vite HMR controller no longer leaves websocket or watcher listeners attached after disposal; an Effect `Scope` owns the listener finalizer.
- Vite HMR controller no longer uses ignored Promises for restart, frame-send, and disposal cleanup launches; `ManagedRuntime.runCallback` observes each exit and reports failures.
- Vite generated runtime source no longer leaves module-level HMR callbacks attached across client hot replacement cycles.
- Bridge unary and RPC handler transports no longer hand-roll queue consumption where `Stream.fromQueue` owns the consumer loop.
- Bridge/Core RPC tests no longer hand-roll queue consumer loops for fake transports; they use the same stream consumer primitive as the production transports.
- Effect telemetry logger/tracer hooks no longer allocate unobserved Promises for fire-and-forget recording; `Effect.runFork` owns the detached fiber boundary.
- Native App/WebView/Menu/ContextMenu/Tray/Notification/Updater/PowerMonitor/SystemAppearance/GlobalShortcut event streams no longer duplicate the same subscription and envelope decode helper; `subscribeNativeEvent` owns the shared host-event boundary policy, with a wrong-method regression test.
- React provider cleanup no longer wraps runtime disposal in an ignored Promise chain; `disposeRuntime` observes `ManagedRuntime.disposeEffect` with `Effect.runCallback` and reports cleanup defects through the existing hook.
- React/Solid/Vue generated desktop roots no longer use private async disposal wrappers around framework/runtime cleanup; the shared `FrameworkRuntime` exposes `disposeEffect`, and framework root cleanup runs that Effect directly.
- Core renderer-stream tests no longer use the FrameworkRuntime Promise compatibility wrapper for cleanup; they verify `disposeEffect` is the primary cleanup primitive.
- Test-support MemoryFilesystem file writes and CLI release `lstat` no longer hide Promise sequencing inside `.then`; `Effect.tryPromise` remains the typed external boundary.
- Test-support MockPTY terminate/kill methods no longer use Promise `.then` chains for host-style async behavior; they preserve the asynchronous edge with explicit `async` methods.
- Core filesystem/SQLite tests now use explicit async existence helpers, and Bridge stream polling uses an explicit `Effect.tryPromise` async predicate boundary without `Promise.resolve`.
- Core process polling now accepts synchronous predicates directly through the same `Effect.tryPromise` wait helper, and React permission approval fixture promises use explicit `async` results.
- Test-support MemoryFilesystem write/open/mkdir paths no longer manufacture resolved/rejected Promises for synchronous in-memory mutations; `Effect.try` owns the typed failure boundary.
- Core PTY and worker test polling now use the same explicit async predicate boundary as process tests, keeping synchronous throws and Promise rejections mapped consistently through `Effect.retry`.
- Test-support MockPTY write/resize/terminate/kill methods still model an async host boundary, but the scheduler yield is now expressed through `Effect.yieldNow` instead of raw resolved Promises.
- Renderer `FrameworkRuntime` no longer keeps a shallow Promise cleanup method after all React/Solid/Vue/root tests moved to `disposeEffect`.
- Renderer `runFrameworkPromiseExit` no longer exists as a public shallow wrapper over `runFork` plus `Fiber.await`; tests call the Effect primitives directly, and `runLatestPromiseExit` remains only for the Promise-shaped mutation boundary that also owns stale-exit suppression.
- Core workflow tests now compose test dependencies with `Layer.provide` instead of broad `as never` casts, and the backup test exercises the real `@effect/sql-sqlite-bun` export path rather than a partial fake that only proved the test double.
- Native updater workflow tests now compose updater dependencies with `Layer.provide` and use a real Effect `HttpClient` test layer, replacing partial method-only HTTP fakes that bypassed the client interface.
- Native app HTTP server tests now use Effect HTTP request constructors instead of a structural `unknown as HttpServerRequest` fake, while preserving the raw URL behavior required by the path-traversal edge-case tests.
- CommandRegistry no longer uses a structural `DesktopRpcRegistrationGroup` view as its internal registration contract; the real Effect `RpcGroup.RpcGroup<Rpcs>` reaches `RpcTest.makeClient` directly.
- Desktop RPC surface construction no longer widens its group to a structural request-map view and casts it back before building server/client/test layers; schema-doc and contract-law inspection keep only a narrow request-map metadata view.
- Renderer RPC test-client registration snapshots no longer cast the declaration layer back to a plain `Layer`, and the local request-map alias was removed; `DesktopRpcsLayer` already carries the exact `DesktopRpcRegistry` layer contract.
- Desktop window and workflow registration no longer cast narrower public `Layer` values into erased registry slots; the registry contracts already accept the public layer shapes directly.
- CLI build-cache parsing no longer hand-rolls `JSON.parse` inside `Effect.try`; `Schema.UnknownFromJsonString` owns the external JSON boundary, with a malformed-cache rebuild regression test.
- CLI notarization no longer hand-rolls `JSON.parse` for `notarytool` output; `Schema.UnknownFromJsonString` owns the external JSON boundary while the existing status-shape validation remains explicit.
- Bridge redaction no longer parses materialized `Redacted` JSON with raw `JSON.parse`; the same Schema JSON decoder used by bridge protocol frames owns that decode.
- Core Settings persisted-value reads no longer parse raw KeyValueStore strings with `JSON.parse`; `Schema.UnknownFromJsonString` now owns the JSON decode boundary before schema-specific value validation.
- Core Settings value encode/decode no longer casts `Schema.encodeUnknownEffect` and `Schema.decodeUnknownEffect` results back to service-free effects. Settings now names the service-free schema contract as `SettingSchema<A>`, and `encodeValue`/`decodeValue` call `Schema.encodeEffect` and `Schema.decodeUnknownEffect` directly.
- Core Restore workflow manifest validation no longer casts raw parsed JSON; `Schema.fromJsonString` owns JSON parsing and manifest shape validation, with a malformed-manifest no-mutation regression test.
- CLI a11y, semver, release, package, sign, and notarize JSON file readers no longer duplicate `JSON.parse` inside local `Effect.try` wrappers; `Schema.UnknownFromJsonString` owns the parse boundary while each command keeps its typed file error.
- Remaining CLI JSON readers for pack-installable, public API snapshots, docs release gate, doctor package metadata, and update manifest now use `Schema.UnknownFromJsonString`; the source scan no longer reports production `JSON.parse` outside tests.
- Renderer RPC client/test-client construction now uses Effect RPC's `flatten: true` client primitive instead of casting typed clients into string-keyed method tables; the remaining payload/result assertion is isolated at the heterogeneous desktop RPC boundary.
- Stream callback emitters that still call `Queue.offerUnsafe` were inspected against `repos/effect-smol`; that is the documented `Stream.callback` emitter pattern, so no wrapper debt was found there.
- Desktop RPC registration now keeps `Rpc.ToHandler<Rpcs>` tied to the concrete `RpcGroup` at the `Desktop.rpc(...)` boundary; the registry snapshot is the explicit erased shape, and native surface snapshot tests consume that shape without a test-only layer cast.
- Desktop RPC server binding no longer rebuilds `RpcServer.layer(...)` from an erased registry group; `Desktop.rpc(...)` constructs the middleware-bound server layer while the concrete `Rpcs` type is still available, leaving `bindRegistration` as a simple stored-layer projection.
- Telemetry span capture no longer hand-rolls `Option.some` plus `Effect.catch` around `Effect.currentSpan`; `Effect.option` now owns the no-current-span fallback.
- Test-support mock process/PTY auto-exit timers were inspected. Replacing the zero-delay host timer with Effect scheduler yields changed the PTY write/resize window, so the timer remains as callback-style host behavior rather than removable Effect debt.
- CLI public API package discovery no longer hand-rolls `tryPromise` plus `catch(false)` for existence probing; `Effect.option` owns the failed-access-to-absence conversion.
- CLI packaging no longer swallows all `ReleaseFileSystem.exists` failures as missing files; Effect FileSystem already maps `NotFound` to `false`, and unexpected probe failures now surface as `PackageFileError`.
- CLI doctor path probes no longer reimplement existence checks with `access` plus `catch(false)`; `ReleaseFileSystem.exists` owns `NotFound` handling and `Effect.option` preserves doctor's non-failing diagnostic fallback for unreadable probes.
- Core filesystem symlink probing no longer catches every `readLink` failure as "not a symlink"; it preserves `ENOENT`/`EINVAL` as the absence cases and maps permission or unexpected `readLink` failures through the typed filesystem error boundary.
- CLI doctor package metadata no longer decodes JSON and retypes the result with a structural cast; a narrow `PackageJsonMetadata` Schema owns the package-manager field contract.
- CLI build-cache loading no longer catches every `BuildFileError` as an empty cache; `Effect.option` now scopes the intentional fallback to malformed cache parsing, while unreadable cache files fail before build commands run.
- CLI chrome webview-runtime build timing no longer reads `Date.now` directly; it uses the build pipeline's injected clock like the other build nodes, with a deterministic elapsed-time regression test.
- CLI doctor optional package/config probes no longer hand-roll `catch(() => undefined)`; `Effect.option` now owns the optional-probe fallback while existing doctor diagnostics stay unchanged.
- Bridge cancellation dispatch and telemetry fire-and-forget recording no longer hand-roll `catch(() => Effect.void)`; `Effect.ignore` now expresses the deliberate "run side effect, ignore regular failure" policy.
- Native app HTTP server CSP inspection no longer reads `Date.now` directly; CSP decision timestamps now use `Clock.currentTimeMillis`, and tests override `Clock.Clock` to assert deterministic timestamps and trace IDs.
- Native CrashReporter breadcrumb timestamping no longer uses `Date.now` in the memory client only; shared breadcrumb normalization now uses `Clock.currentTimeMillis` before memory storage or bridge transport, with the bridge payload test asserting the deterministic timestamp.
- Core DesktopEventLog query inspector timestamps no longer read `Date.now`; query success/failure events use `Clock.currentTimeMillis`, with a Clock-overridden inspector-event regression test.
- Core Process and Worker invalid-clock failure inspector timestamps no longer fall back to `Date.now`; both use `Clock.currentTimeMillis` for the fallback path, with targeted tests overriding `Clock.Clock`.
- Core PTY output coalescing no longer reads `Date.now` internally; the coalescer uses the existing PTY service clock, and the quiet-window flush test now drives time deterministically.
- Core renderer RPC inspector timestamps no longer default to `Date.now`; they use `Clock.currentTimeMillis` when no caller `now` callback is supplied, with a renderer inspector lifecycle test overriding `Clock.Clock`.
- Core DesktopDevtools runtime-event timestamp fallbacks no longer read `Date.now`; inspector and telemetry fallback events use `Clock.currentTimeMillis`, with a Clock-overridden telemetry fallback test.
- Core Backup workflow manifest creation no longer reads `Date.now` inside the archive activity; it uses `Clock.currentTimeMillis`, and the archive integration test asserts the persisted manifest timestamp with an overridden `Clock.Clock`.
- Bridge client decode-failure inspector events no longer keep an ambient `Date.now` fallback for an internally impossible missing-envelope case; decode failure reporting now requires the request/stream envelope already present at every call site, and the client test asserts the inspector timestamp.
- ApprovalBroker outcome creation no longer bypasses the configured trace-id generator with a second `randomUUID()` fallback; `ask` already validates a trace id up front, and the unreachable fallback now uses the validated request id instead of hidden entropy.
- Core InspectorTransport no longer defaults to `Date.now` inside its Effect service constructor; when callers do not inject `now`, the service captures `Clock.Clock`, and the transport test asserts deterministic session/event timestamps.
- PermissionApproval workflow grant timestamps no longer capture `Date.now` when the workflow layer is constructed; grant time is read from `Clock.currentTimeMillis` at workflow execution, with the TTL grant test overriding `Clock.Clock`.
- Core runtime service clock defaults no longer capture `Date.now` in CommandRegistry, PermissionRegistry, ResourceRegistry, Filesystem, ApprovalBroker, Process, Worker, PTY, or transport instrumentation; explicit `options.now` still wins, while the default path now uses `Clock.Clock`, with PermissionRegistry and transport instrumentation tests proving the Clock-backed default.
- Bridge Effect protocol construction no longer defaults request/response timestamps to `Date.now` in `makeDesktopClientProtocol`, `makeDesktopServerProtocol`, or the unary bridge exchange transport adapter; explicit `options.now` still wins, and protocol/client tests now prove the `Clock.Clock` default path.
- Bridge RPC handler runtime no longer resolves its default dispatch clock to `Date.now` when the runtime object is constructed; dispatch, terminal-state, and inspector event timestamps read `Clock.currentTimeMillis` inside the Effect path unless callers provide `options.now`.
- Bridge EventHub publish timestamps no longer default to `Date.now`; `publish` reads `Clock.currentTimeMillis` when no explicit `now` callback is supplied, with the encoded-event fanout test asserting the default-clock timestamp.
- Bridge host handshake and window clients no longer default request timestamps to `Date.now`; request construction reads `Clock.currentTimeMillis` inside each returned Effect when no explicit `now` callback is supplied, with ping/destroy tests asserting Clock-backed request timestamps.
- Bridge generic `Client` request, cancel, and inspector timestamps no longer default to `Date.now`; returned Effect methods read `Clock.currentTimeMillis` when no explicit `now` callback is supplied, with the typed namespace request test asserting the default-clock timestamp.
- CLI build/package/sign/notarize/publish/release command wrappers no longer inject `Date.now` into pipeline APIs; `runCli` captures `Clock.Clock` once and passes a Clock-backed `now` callback unless callers provide `options.now`, with the chrome web-engine build test asserting deterministic elapsed time through the default Clock path.
- Native host RPC inspector state events no longer default to `Date.now`; non-terminal state timestamps read `Clock.currentTimeMillis` inside the `onState` Effect when no explicit `options.now` callback is supplied, with a Screen host runtime test asserting a Clock-backed `Pending` event timestamp.
- DevTools LiveRuntimePanels and ReactivityTracker no longer default age/invalidation timestamps to `Date.now`; `list` and `trackInvalidation` read `Clock.currentTimeMillis` inside their returned Effects when no explicit `now` callback is supplied, with focused tests asserting Clock-backed resource age and invalidation timestamps.
- Test-support MockHost responses and MockBridge stream envelopes no longer default to `Date.now`; their request/stream Effects read `Clock.currentTimeMillis` when no explicit `now` callback is supplied, with mock host and pinned stream tests asserting Clock-backed timestamps.
- Native crash-report workflow tests no longer use ambient wall time for fixture reports; the helper uses a fixed `capturedAt` timestamp.
- Renderer RPC test-client acquisition no longer casts the whole `Effect.gen` result from `unknown` failure/runtime back to `never`; the erased RPC registry now records handler-layer `E/R` parameters, and the renderer test snapshot narrows `DesktopRpcsLayer<never, never>` registrations at the registry boundary. The remaining group/tag casts are the explicit heterogeneous-map boundary where Effect RPC's typed `Flat` client cannot prove a string-keyed renderer lookup.
- Renderer RPC client maps no longer build plain objects with `Object.fromEntries(... ) as DesktopRendererRpcClient`; both host and test client constructors now assign into a typed `Record<string, DesktopRendererRpcClientMethod>` and freeze it without a result assertion.
- The default `AuditEvents` no-op service no longer casts `Effect.void` to an `EventJournalError`-typed effect; `never` already satisfies the error channel, and the audit-event suite verifies the no-op and EventLog-backed paths.
- Bridge client exchanges now model host responses as `unknown` at the boundary instead of pretending every exchange returns a trusted `BridgeClientResponse`. The client validates response kind before decoding success/error payloads, and the unary transport adapter converts invalid exchange responses into `InvalidOutput` failure frames while keeping `send` non-failing. Added coverage for the invalid exchange response frame path and removed the `as never` from the unknown-response-kind client test.
- Config `runProductionCheck` now models raw production-check inputs more honestly: `security.externalNavigation` can carry raw string values that the checker must flag, and `rendererFiles` arrives as `unknown[]` before `decodeProductionCheckInput` validates and narrows it to `ProductionCheckFile[]`. This removed the checker tests' `as never` casts while preserving the existing invalid-input failure cases.
- Bridge protocol fixture tests no longer parse shared host-protocol JSON fixtures with raw `JSON.parse` before calling protocol decoders. Envelope fixtures now pass through `decodeHostProtocolFrame`, so fixture coverage exercises UTF-8 decode, JSON decode, and schema validation in the same Effect boundary as production. Error fixtures decode through `Schema.fromJsonString(Schema.Array(HostProtocolError))`.
- Core runtime main tests no longer parse spawned runtime stdout with raw `JSON.parse` plus local structural guards. The ready line decodes through `Schema.fromJsonString(RuntimeReadyEvent)`, and length-prefixed host request frames decode through the bridge `decodeHostProtocolFrame` Effect boundary before the fake host replies.
- Core backup/restore workflows now share one exported `BackupManifest` / `BackupManifestJson` Schema. Backup manifest creation encodes through `Schema.encodeSync(Schema.fromJsonString(...))`, restore validation decodes the full manifest shape through the same Schema, and the workflow test no longer casts parsed manifest JSON. Added a regression test proving a partial manifest shape is rejected before restore mutates the database.
- React and platform-browser package export tests no longer cast `package.json` through bespoke TypeScript interfaces after `JSON.parse`. Each test decodes the manifest through a narrow `Schema.fromJsonString` package-export contract, keeping malformed fixture shape at the Schema boundary while preserving the checked-in source-file assertions.
- The repo-shape test no longer uses a generic `JSON.parse(...) as T` fixture helper. Package manifest and package `tsconfig.json` reads now decode through narrow `Schema.fromJsonString` Schemas for the fields the guardrail tests inspect, so malformed shape fails at the fixture boundary with a cause.
- The verification-matrix spec test no longer casts `JSON.parse` output or returns `undefined as never` after failed fixture loading. It decodes `engineering/verification-matrix.json` with `Schema.fromJsonString(VerificationMatrix)` and `Schema.decodeUnknownExit`, throws fixture load errors with the original cause, and declares a repo-level `effect` dev dependency plus `tests/tsconfig.json` so the root test has explicit Effect and Bun type contracts.
- Core `DesktopObservability.layer` now models raw layer mode input as `string` and narrows it through the existing `ObservabilityMode` Schema before constructing services. The service API still exposes the precise `DesktopObservabilityModeName`, and the invalid-mode regression test no longer needs `as never`.
- Core `ApprovalBroker.ask` now models approval requests as raw ingress (`unknown`) and narrows them through the existing `ApprovalRequest` Schema before prompt, queue, audit, or span metadata handling. The prompt port still receives decoded `ApprovalRequest` values, and the invalid-request regression test no longer needs `as never`.
- Inspected remaining casts in transport framing, command registration, and filesystem realpath tests. No wrapper debt was removed there: transport and filesystem casts are defensive misuse coverage for typed internal APIs, and the command registration cast remains the known heterogeneous Effect RPC handler-map boundary.
- Native Shell external URL policy no longer casts a reserved-scheme allowlist option in its bridge-client test. The `Shell.openExternal` option type already admits raw scheme strings; runtime policy rejects `javascript:` through the existing Effect failure path before transport. Menu, Dialog, Notification, and Tray casts were inspected and retained as deliberate typed developer API or lifecycle-state misuse coverage.
- Test-support `MemoryFilesystem` no longer defaults modification timestamps to ambient `Date.now`. Its Effect constructor now captures `Clock.Clock` when callers do not provide `options.now`, and the MemoryFilesystem suite asserts Clock-backed `modifiedAtMs` through an overridden clock. The remaining test-support timers are the inspected mock Process/PTY host-turn callbacks.
- CLI JSON error assertions now share a narrow `Schema.fromJsonString` decoder for `{ tag, message }` payloads instead of repeated `JSON.parse(... ) as ...` casts. This covers simple structured stderr errors across usage, signing, notarization, and publishing tests while leaving richer report-shape decoders for later focused passes.
- CLI production-check JSON report assertions now decode through a narrow `Schema.fromJsonString` report contract for `passed`, failure `rule`, and acknowledgement arrays. The full CLI test file covers the failed-report and passed-report paths after replacing the ad hoc casts.
- CLI doctor JSON report assertions now decode through a narrow `Schema.fromJsonString` report contract for `passed` and probe rows, including optional install guidance. This replaced local report casts in missing toolchain, missing config, outside-workspace config, and invalid-security-config tests.
- CLI reproducibility diff JSON assertions now decode through a narrow `Schema.fromJsonString` error contract for `ReproDiffError` and the drift fields asserted by the tests: content byte offset, entry kind, symlink target, and mode. The full CLI test file covers the converted repro drift cases.
- CLI public API JSON error assertions now reuse the shared narrow `{ tag, message }` `Schema.fromJsonString` decoder for stderr payloads. This removed local `JSON.parse(... ) as ...` casts from wrong-package, invalid-package-name, and missing-snapshot API tests while preserving richer report-shape work for later passes.
- The shared CLI `{ tag, message }` JSON decoder now covers the remaining simple stderr error assertions across docs, release, accessibility, semver, build, package, sign, notarize, and publish command tests. Richer payloads with fields such as `field`, `remediation`, or report bodies remain for focused shape-specific decoder passes.
- The remaining CLI stderr JSON assertions now use shape-specific `Schema.fromJsonString` decoders for config errors with optional `field`, message-only nested build failures, and package missing-build-artifact remediation payloads. The CLI test file no longer contains raw `JSON.parse(stderr.join("")) as ...` assertions.
- CLI sign, notarize, publish, build, docs, and package JSON fixture assertions now decode through narrow `Schema.fromJsonString` contracts instead of raw `JSON.parse` casts. Publish manifest tests reuse the production `UpdateManifest` Schema, mutable fixture-corruption tests decode raw JSON objects through `Schema.Record(Schema.String, Schema.Unknown)` before explicit object copies, and the CLI test file no longer contains raw `JSON.parse(...)` calls.
- Permission interceptor direct middleware tests now build real Effect RPC request context values with `Rpc.ServerClient` and `RequestId` instead of `undefined as never` / numeric request-id casts, and denied handlers now die if invoked rather than returning an impossible success value. The remaining RPC erasure is localized in one documented helper because Effect RPC's `AnyWithProps` widens middleware error types beyond `PermissionInterceptor`'s concrete service error.
- Worker send now models its ingress as `unknown` because `Worker.send` already validates every message with the configured Effect Schema before transport. This removed the malformed-send test's `as never` cast while preserving typed output streams and keeping the existing high-value regression that malformed input is rejected before adapter transmission.
- Worker spawn now has a raw options boundary for schema validation while retaining a typed overload for normal callers. `validateChannelSchema` accepts `unknown` and narrows through the Effect Schema shape, so malformed `inputSchema` / `outputSchema` tests no longer use `as never` and still prove adapter spawn is skipped on invalid channel schemas.
- Process stdin and kill plus PTY write and kill now model their external ingress as `unknown` at the handle boundary, matching the existing Effect Schema / byte decoders that run before host adapter calls. This removed malformed stdin/write/signal test casts while preserving typed host adapter contracts and the regressions that invalid chunks or control-byte signals do not reach the child process.
- Settings `set` now models the value argument as `unknown` at the public write boundary while preserving typed schemas for reads, defaults, and updates. `Schema.encodeUnknownEffect` owns the value validation before persistence, mutation options decode through Schema instead of a cast, and the malformed-value regression no longer needs `as never`.
- PermissionRegistry `check` and `grant` now model caller context as `unknown`, matching the existing `PermissionContext` Schema decoder that runs before rule resolution, audit writes, or grant creation. This removed malformed-context casts while keeping normalized capability inputs typed.
- Worker fixture resource IDs now use the existing branded `ResourceId` helper instead of an impossible `as never` cast in the generated `nextId` callback. No runtime abstraction changed; the fixture now matches the ResourceRegistry's explicit branded-id contract.
- CommandRegistry dynamic test registrations now use Effect RPC's `RpcGroup.toLayer(Effect.succeed(record))` path instead of casting a computed handler object to the exact static handler map. This keeps the test's dynamic malformed-command IDs while relying on the upstream string-keyed handler primitive.
- Transport service methods now model frame/unframe/connect inputs as `unknown`, matching the Effect Schema decoders already at each boundary. `unframeStream` extracts raw object fields before Schema validation and keeps a separate Stream-like check for `chunks`, removing malformed frame/chunk test casts while preserving typed errors.
- PTY budget options now separate raw caller policy from `ResolvedPtyBudgetPolicy`. Invalid `outputOverflow` values remain accepted at the options boundary, are rejected before adapter open, and only validated overflow literals reach output buffering and metrics.
- `Desktop.app(config)` now advertises the `DesktopRuntimeServices` layer it already builds instead of narrowing the public overload to `DesktopApp` only. The runtime descriptor test now provides the layer directly and the redundant internal runtime-layer cast was removed.
- `BridgeClientOptions` now exposes the `normalizeRequest` hook already used by the unary bridge transport, and `Client` applies it before dispatching `exchange.request`. This removes the native Screen bridge client type blocker, adds a bridge client regression test for request normalization, and lets `bun desktop check --api --write` pass again with no additional snapshot changes from the current dirty baseline.
- Native crash-report EventLog primary keys now use the Effect `EventGroup.add` payload schema type directly instead of casting callback payloads from `unknown`. The updater weekly polling loop was inspected and retained because `DurableClock.sleep` preserves workflow timer semantics that `Schedule.spaced` would not.
- Native command-binding warning extraction now uses Effect's `Predicate.isObject` guard instead of a local record cast before reading bounded error attributes.
- Native menu, context-menu, notification, and global-shortcut client handle cloning no longer asserts already typed window/notification handles back to the same resource-handle type. The existing Schema decoders still own raw host/client input validation; these helpers now preserve the structural resource type directly.
- Native surface capability selection no longer builds method capabilities through `Object.fromEntries` plus a broad `NativeSurfaceApi` result assertion. The dynamic method map is now accumulated as the narrow `Record<Method, NativeCapabilitySelection>` boundary, and the returned surface shape is checked structurally.
- Defensive malformed-input tests in native, core filesystem, core secrets, and bridge client no longer use `as never` / `unknown as` to bypass TypeScript. They now use `@ts-expect-error` at the invalid call site, preserving the static API contract while still proving the Effect Schema/runtime guard rejects boundary misuse.
- Core now exposes `makeResourceId`, a ResourceId constructor backed by `ResourceIdSchema`, and production/native resource id constructors use it instead of direct brand casts. Invalid-id tests now inject raw invalid values with `@ts-expect-error`, while valid fixtures use the schema-backed constructor. Public API snapshots were updated and `bun desktop check --api` passes with zero pending changes.
- Test support and DevTools resource-id fixtures now use `makeResourceId` instead of local `as ResourceId` / `as never` casts for valid fixture ids. The remaining mock Process/PTY timers were left unchanged because they model host callback turns, not Effect scheduler policy.
- Native Tray and WebView client handle cloning no longer asserts already typed handles back to the same resource-handle type. The cloned object preserves `kind` and `state` from the typed input directly, while the existing Effect Schema decoders still own raw boundary validation.
- Test-support MockHost and MockBridge immutability assertions no longer mutate snapshots through `as any`. The tests now treat recorded payloads as raw `unknown`, guard for object shape, and use `Reflect.set` / `Reflect.get` to prove frozen snapshot behavior without erasing the test boundary type.
- CLI malformed docs and semver fixture tests no longer cast invalid fixture JSON into typed shapes. The docs manifest writer now accepts raw fixture rows, and the semver manifest fixture guard exposes only the record field needed to patch malformed policy data.
- Bridge and core redaction tests no longer widen generic redacted values with `as unknown` before assertions. Redaction shape assertions now pass through an `unknown` helper/local value, and Map/cycle redaction assertions use a runtime Map guard instead of test-side casts, keeping the public `redact<A>(A): A` contract visible without assertion syntax in the tests.
- CLI doctor command probes no longer use `Effect.catch` to turn command failures into successful diagnostic rows. `Effect.result` now captures the recoverable command outcome and `Result.match` folds success/missing branches explicitly.
- Worker Bun-adapter shutdown no longer uses `Effect.catch` to recover from `postMessage` / `terminate` failures. Each shutdown step now observes failures with `Effect.tapError` for warning telemetry and uses `Effect.ignore` to make the best-effort shutdown policy explicit.
- CLI update-manifest artifact discovery no longer uses `Effect.catch` for simple stat-path translation or optional platform probing. Missing output-root failures now use `Effect.mapError`, while absent non-target platform directories use `Effect.option` and `Option.getOrUndefined`.
- CLI signing and notarization artifact discovery no longer use `Effect.catch` to translate missing packaged-output roots into typed file errors. Both paths now use `Effect.mapError`, matching the publish pipeline's explicit error-translation shape.
- CLI build config file validation no longer catches containment and directory validation failures while translating missing file stats. `readRequiredExistingFile` now maps only the `statPath` failure, preserves the precise directory-valued file error, and has a regression test proving `runtime.entry` directories fail before build steps run.
- Core Sidecar start failure reporting no longer catches only to publish failure state and re-fail the same `SidecarError`. Start failure side effects now use a shared `Effect.tapError` helper, preserving the original typed error channel through retry and non-retry paths, with a focused retry-exhaustion regression proving attempts, failure type, and resource cleanup.
- Core Sidecar readiness and exit observer failures no longer use `Effect.catch` as implicit background-fiber suppression. The observers now publish failure state with `Effect.tapError` and then apply `Effect.ignore`, making the best-effort observer policy explicit; the readiness regression proves `handle.ready` fails and status becomes `Failed` when readiness is never observed.
- Core DesktopEventLog append/query failure inspector events no longer catch only to publish telemetry and re-fail the same `EventJournalError`. Both paths now use `Effect.tapError`, and the query-failure regression proves the inspector event is still published while the original journal error remains in the error channel.
- Bridge unary transport response folding no longer uses nested `Effect.catch` blocks to turn exchange and response-validation failures into protocol failure frames. It now captures recoverable outcomes with `Effect.result` and folds them with `Result.match`, while the existing unary transport tests prove success, Clock-backed timestamps, invalid exchange responses, and exchange failure propagation.
- DevTools PersistencePanel health probing no longer uses `Effect.catch` to turn `KeyValueStore.size` failures into unhealthy snapshots. It now captures the probe with `Effect.result` and folds success/failure with `Result.match`, with existing panel tests proving healthy memory stores and typed store failures.
- CLI docs release gate page reads no longer use `Effect.catch` to translate unreadable pages into missing-page errors. The file-read failure now maps directly with `Effect.mapError`, and the existing `desktop check --docs` missing-page test proves the CLI still reports the typed JSON error.
- Vite HMR runtime frame forwarding no longer uses `Effect.catch` as implicit detached-fiber suppression. Frame stream failures now publish runtime errors with `Effect.tapError` and then use `Effect.ignore`; a malformed-frame regression proves the controller reports the runtime error and still disposes cleanly.
- CLI semver guard API snapshot checking no longer uses `Effect.catch` to recover snapshot mismatch reports. It now captures checker outcomes with `Effect.result` and folds mismatch reports vs other snapshot errors explicitly, with the existing additive/removal policy tests proving both report and failure paths.
- Core transport `unframeStream` producer failures no longer use `Effect.catch` as implicit queue-publication suppression. The producer now publishes the stream failure with `Effect.tapError` and applies `Effect.ignore`, while the unframeStream and bad-frame tests prove typed failures still reach consumers.
- Native Menu, ContextMenu, and GlobalShortcut command invocation failure handlers no longer use `Effect.catch` to log and suppress activation errors. Each handler now observes command registry failures with `Effect.tapError` and explicitly applies `Effect.ignore`; the new Menu regression proves a failed activation logs the warning path without killing the command listener. GlobalShortcut scope-dispose cleanup warning handling now uses the same `tapError` plus `ignore` policy, and the existing GlobalShortcut binding tests prove failed command activations and scope-close unregisters still behave correctly.
- Core Secrets audit-warning recovery no longer uses `Effect.catch` to log and suppress audit-write failures. `auditSecretAccessOrWarn` observes failures with `Effect.tapError` and explicitly applies `Effect.ignore`, while the focused Secrets tests prove denied/storage failures remain the primary result when audit logging also fails.
- Core PTY best-effort disposal no longer uses `Effect.catch` to suppress `terminateTree` or `forceKillTree` failures. Terminate and force-kill failures now log through `Effect.tapError` and then apply `Effect.ignore`, with new scope-close regressions proving terminate failure still escalates to SIGKILL and force-kill failure does not fail registry scope close.
- Core Process best-effort scope disposal no longer uses `Effect.catch` to suppress process-tree kill failures. The kill failure path now logs with `Effect.tapError` and applies `Effect.ignore`, while the existing `isRunning` fallback remains policy code because it returns a shutdown decision; a new scope-close regression proves kill failure does not fail registry cleanup.
- Core ResourceRegistry disposal failure handling no longer uses `Effect.catch` / `Effect.catchDefect` only to report cleanup failures and continue. Direct dispose and scope-close cleanup now observe typed failures with `Effect.tapError`, observe defects with `Effect.tapDefect`, and explicitly suppress the whole cause with `Effect.ignoreCause`; a new direct-dispose regression proves a defecting cleanup still removes the resource.
- Native crash-report HTTP submission no longer uses `Effect.catch` to translate exhausted HTTP client failures into `CrashReportSubmitError`. The activity now maps the retry-exhausted `HttpClientError` with `Effect.mapError`, and the crash-report workflow tests prove both successful drain submission and exhausted-retry drop recording.
- Core socket transport cleanup no longer uses `Effect.catch` for finish-time queue failure publication or close-failure reader interruption. Decoder finish failures now fail the open deferred / receive queue with `Effect.tapError` and explicitly suppress with `Effect.ignore`, while close-write failures interrupt the reader with `Effect.tapErrorTag` and preserve the original `TransportCloseFailed`; the transport suite covers partial-frame finalization, read failures, close receive failures, and adapter close failures.
- Core Process exit observation no longer catches only to fail the exit deferred, mark observer state, dispose the resource, close the child scope, log the warning, and suppress the observer fiber. The observer now performs those failure side effects with `Effect.tapError` and applies `Effect.ignore`, with focused observer tests and the full Process suite covering invalid exit timestamps, cleanup, stale handles, and scope-close interruption.
- CLI root command execution no longer catches only to set exit code and suppress command parser failures; `Command.runWith` now observes failures with `Effect.tapError` and applies `Effect.ignore`. Build, package, sign, notarize, publish, and release command handlers no longer use `Effect.catch` to fold typed pipeline failures into optional reports; they now use `Effect.result` plus `Result.match`, with focused CLI tests covering parser errors and the main command success/failure output paths.

Follow-up issue opened and tracked in the roadmap: #1312.
