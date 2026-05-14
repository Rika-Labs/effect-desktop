---
date: 2026-05-12
type: in-flight-refactor
topic: Introduce the Desktop runtime layer graph
issue: https://github.com/Rika-Labs/effect-desktop/issues/1229
pr: none
---

# Introduce the Desktop runtime layer graph

## Decision

Provider choice must remain real Effect `Layer` composition, not metadata beside an erased provider layer.

## What changed

The plan was to expose `Desktop.runtime(config)`, `DesktopRuntime`, and an inspectable `DesktopRuntimeGraph`. That shipped, but review changed the important detail: the runtime provider could not be typed or built as `Layer<never, ...>` just because the graph named it.

`Desktop.runtime(config)` now provides `DesktopRuntime`, `DesktopApp`, and the selected runtime provider services. `runtime: "bun"` keeps the Bun platform services. `runtime: "test"` supplies deterministic no-op platform services for tests and graph inspection. `Desktop.runtimeGraph(config)` returns an `Effect`, so unknown providers fail with the same typed `DesktopConfigError` path as runtime acquisition.

## Why it mattered

The first implementation made provider selection visible but not actually substitutable. A user layer requiring `FileSystem` could still fail under the default runtime because the provider layer's services had been erased from the composition contract. The invariant is that graph metadata must describe the Layer graph that actually runs.

## Example

```ts
const program = Effect.gen(function* () {
  const runtime = yield* DesktopRuntime
  const fs = yield* FileSystem.FileSystem
  return { provider: runtime.providers.runtime, cwdExists: yield* fs.exists(".") }
})

yield * program.pipe(Effect.provide(Desktop.runtime({ id: "notes", windows })))
```

## Rule candidate

When adding inspectable runtime metadata, also test a program or configured layer that consumes the services the metadata claims are provided.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it.
