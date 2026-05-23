---
title: HeadlessRuntime
description: Compose mock host, bridge, filesystem, process, and PTY into one test layer.
kind: reference
audience: app-developers
effect_version: 4
---

# `HeadlessRuntime`

Composes the most common test layers into one runnable layer. Used in the majority of handler tests.

## Import

```ts
import { Effect, Layer } from "effect"
import {
  HeadlessRuntime,
  type LeakDetectionOptions,
  runHeadless,
  assertNoOpenResourcesIn,
  installResourceLeakDetection
} from "@orika/test"
```

## `HeadlessRuntime.layer(options)`

Returns a `Layer` providing:

- Real `PermissionRegistry`, `ResourceRegistry`, `Telemetry`, `ResourceOwner`.
- Mock `MockHost`, `MockBridge`.
- `Filesystem`, `Process`, and `PTY` services backed by memory fixtures.

Compose with your handler layer:

```ts
const TestLive = NotesHandlersLive.pipe(Layer.provideMerge(HeadlessRuntime.layer()))
```

## `HeadlessRuntime.run(effect, options)`

Runs an effect against the layer plus resource leak detection:

```ts
await Effect.runPromise(
  HeadlessRuntime.run(
    Effect.gen(function* () {
      /* test body */
    }).pipe(Effect.provide(NotesHandlersLive)),
    { leakDetection: { testName: "save persists" } }
  )
)
```

`HeadlessRuntime.run` returns an `Effect`; run it with `Effect.runPromise` or the
test runner helper you normally use for Effect tests.

## Runtime options

```ts
{
  bridge?: { now?: () => number }
  filesystem?: MemoryFilesystemOptions
  host?: MockHostOptions
  leakDetection?: false | LeakDetectionOptions
  permissions?: PermissionRegistryOptions
  process?: MockProcessOptions
  pty?: MockPtyOptions
  registry?: Parameters<typeof makeResourceRegistry>[0]
  telemetry?: TelemetryOptions
}
```

## Leak detection options

Pass these under `leakDetection` for `HeadlessRuntime.run`.

```ts
{
  allowedResourceIds?: ResourceId[]
  allowedResourceKinds?: ResourceKind[]
  testName?: string
}
```

## `runHeadless(body, options)`

Lower-level host-protocol runner. The body receives a `HeadlessRuntime` value
with `handshake`, `window`, `request`, `registry`, and recorded `calls()`.

## `assertNoOpenResourcesIn(registry, options)`

Direct assertion when you compose the layer manually.

## `installResourceLeakDetection(registry, options)`

Installs the leak check on a registry. Called automatically by `HeadlessRuntime.run`.

## Related

- Explanation: [Testability](../../explanation/testability.md)
- How-to: [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Reference: [Mock host and bridge](mock-host-and-bridge.md), [Memory filesystem](memory-filesystem.md)
- Source: [`packages/test/src/index.ts`](../../../packages/test/src/index.ts)
