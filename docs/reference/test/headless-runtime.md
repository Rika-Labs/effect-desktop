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

- Real `PermissionRegistry`, `ResourceRegistry`, `AuditEvents`.
- Mock `MockHost`, `MockBridge`.
- `MemoryFilesystem`, `MockProcess`, `MockPTY`.

Compose with your handler layer:

```ts
const TestLive = Layer.merge(HeadlessRuntime.layer({ testName: "Notes.save" }), NotesHandlersLive)
```

## `HeadlessRuntime.run(effect, options)`

Runs an effect against the layer plus resource leak detection:

```ts
await HeadlessRuntime.run(
  Effect.gen(function* () {
    /* test body */
  }).pipe(Effect.provide(NotesHandlersLive)),
  { testName: "save persists" }
)
```

## Leak detection options

```ts
{
  allowedResourceIds?: ResourceId[]
  allowedResourceKinds?: ResourceKind[]
  testName?: string
}
```

## `runHeadless(body, options)`

Lower-level runner. Same shape as `HeadlessRuntime.run`.

## `assertNoOpenResourcesIn(registry, options)`

Direct assertion when you compose the layer manually.

## `installResourceLeakDetection(registry, options)`

Installs the leak check on a registry. Called automatically by `HeadlessRuntime.run`.

## Related

- Explanation: [Testability](../../explanation/testability.md)
- How-to: [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Reference: [Mock host and bridge](mock-host-and-bridge.md), [Memory filesystem](memory-filesystem.md)
- Source: [`packages/test/src/index.ts`](../../../packages/test/src/index.ts)
