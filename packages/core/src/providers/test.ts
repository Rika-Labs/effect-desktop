import { Effect, Layer } from "effect"
import * as FileSystemRuntime from "effect/FileSystem"
import * as PathRuntime from "effect/Path"
import * as StdioRuntime from "effect/Stdio"
import * as TerminalRuntime from "effect/Terminal"
import { ChildProcessSpawner as ChildProcessSpawnerRuntime } from "effect/unstable/process"

import type { DesktopRuntimeProviderServices } from "../runtime/desktop-app.js"

export const TestRuntimeProviderLayer: Layer.Layer<DesktopRuntimeProviderServices, never, never> =
  Layer.mergeAll(
    FileSystemRuntime.layerNoop({}),
    PathRuntime.layer,
    Layer.succeed(
      TerminalRuntime.Terminal,
      TerminalRuntime.make({
        columns: Effect.succeed(80),
        readInput: Effect.die("readInput not supported by Desktop test runtime provider"),
        readLine: Effect.die("readLine not supported by Desktop test runtime provider"),
        display: () => Effect.void
      })
    ),
    StdioRuntime.layerTest({}),
    Layer.succeed(
      ChildProcessSpawnerRuntime.ChildProcessSpawner,
      ChildProcessSpawnerRuntime.make(() =>
        Effect.die("spawn not supported by Desktop test runtime provider")
      )
    )
  ) as Layer.Layer<DesktopRuntimeProviderServices, never, never>
