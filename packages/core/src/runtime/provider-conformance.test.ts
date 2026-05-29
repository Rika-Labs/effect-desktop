import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema, Stream } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { ChildProcess } from "effect/unstable/process"

import { Desktop, DesktopRuntime } from "../index.js"
import { ProviderCapability, makeProviderRegistry } from "./provider-registry.js"

type RuntimeProviderEngine = "bun" | "node"

interface RuntimeProviderCase {
  readonly engine: RuntimeProviderEngine
  readonly executable: "bun" | "node"
}

class ProviderParityCell extends Schema.Class<ProviderParityCell>("ProviderParityCell")({
  engine: Schema.Literals(["bun", "node"]),
  selectedProvider: Schema.Literals(["bun", "node"]),
  cwdExists: Schema.Boolean,
  childStdout: Schema.String,
  childExitCode: Schema.Number
}) {}

class ProviderParityReport extends Schema.Class<ProviderParityReport>("ProviderParityReport")({
  cells: Schema.Array(ProviderParityCell)
}) {}

const providerCases = [
  {
    engine: "bun",
    executable: "bun"
  },
  {
    engine: "node",
    executable: "node"
  }
] as const satisfies readonly RuntimeProviderCase[]

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

test("Bun and Node runtime providers satisfy the same core provider contract", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cells = yield* Effect.all(providerCases.map(runProviderContract))
      const report = new ProviderParityReport({ cells })
      const observedEngines: readonly string[] = report.cells.map((cell) => cell.engine)

      expect(observedEngines).toEqual(["bun", "node"])
      expect(observedEngines).not.toContain("deno")
      expect(report.cells).toEqual([
        {
          engine: "bun",
          selectedProvider: "bun",
          cwdExists: true,
          childStdout: "runtime.ready",
          childExitCode: 0
        },
        {
          engine: "node",
          selectedProvider: "node",
          cwdExists: true,
          childStdout: "runtime.ready",
          childExitCode: 0
        }
      ])
    })
  ))

test("runtime provider conformance records missing executables as typed Effect failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exits = yield* Effect.all(providerCases.map(runMissingExecutableContract))

      for (const exit of exits) {
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find(Cause.isFailReason)
          expect(failure?.error).toMatchObject({
            _tag: "PlatformError",
            reason: expect.objectContaining({
              _tag: expect.any(String)
            })
          })
        }
      }
    })
  ))

test("runtime provider conformance has no experimental Deno cell", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const graph = yield* Desktop.runtimeGraph({
        id: "provider-parity",
        windows: Desktop.window("main", { title: "Provider Parity" }),
        providers: Desktop.provider(Desktop.Provider.Runtime.bun)
      })

      expect(providerCases.map((provider) => provider.engine)).toEqual(["bun", "node"])
      expect("deno" in Desktop.Provider.Runtime).toBe(false)
      expect(graph.providers.runtime).toBe("bun")
    })
  ))

test("provider registry exposes capabilities and rejects duplicate provider ids", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtimeCapability = new ProviderCapability({
        name: "FileSystem",
        description: "Provides Effect FileSystem service for desktop runtime programs"
      })
      const runtimeProvider = {
        kind: "runtime",
        id: "test-runtime",
        capabilities: [runtimeCapability]
      } as const

      const registry = yield* makeProviderRegistry([runtimeProvider])
      const provider = yield* registry.get("runtime", "test-runtime")
      const capabilities = yield* registry.capabilitiesFor("runtime", "test-runtime")
      const duplicateExit = yield* Effect.exit(
        makeProviderRegistry([runtimeProvider, runtimeProvider])
      )

      expect(provider.id).toBe("test-runtime")
      expect(capabilities).toEqual([runtimeCapability])
      expect(Exit.isFailure(duplicateExit)).toBe(true)
      if (Exit.isFailure(duplicateExit)) {
        const failure = duplicateExit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toMatchObject({
          _tag: "ProviderRegistryError",
          reason: "duplicate-provider",
          kind: "runtime",
          provider: "test-runtime"
        })
      }
    })
  ))

const runProviderContract = (provider: RuntimeProviderCase) =>
  runScoped(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* DesktopRuntime
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const cwdExists = yield* fs.exists(path.resolve("."))
        const handle = yield* ChildProcess.make(provider.executable, [
          "--eval",
          'process.stdout.write("runtime.ready")'
        ])
        const childStdout = yield* decodeByteStream(handle.stdout)
        const childExitCode = yield* handle.exitCode

        return new ProviderParityCell({
          engine: provider.engine,
          selectedProvider: runtime.providers.runtime as RuntimeProviderEngine,
          cwdExists,
          childStdout,
          childExitCode
        })
      })
    ),
    Desktop.runtime({
      id: "provider-parity",
      windows: Desktop.window("main", { title: "Provider Parity" }),
      providers: Desktop.provider(
        provider.engine === "node" ? Desktop.Provider.Runtime.node : Desktop.Provider.Runtime.bun
      )
    })
  )

const runMissingExecutableContract = (provider: RuntimeProviderCase) =>
  Effect.gen(function* () {
    const layer = Desktop.runtime({
      id: "provider-parity",
      windows: Desktop.window("main", { title: "Provider Parity" }),
      providers: Desktop.provider(
        provider.engine === "node" ? Desktop.Provider.Runtime.node : Desktop.Provider.Runtime.bun
      )
    })
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() =>
      runtime.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* ChildProcess.make(
              "__effect_desktop_missing_provider_parity_executable__",
              []
            )
            return yield* handle.exitCode
          })
        )
      )
    )
    yield* Effect.promise(() => runtime.dispose())
    return exit
  })

const decodeByteStream = <E, R>(
  stream: Stream.Stream<Uint8Array, E, R>
): Effect.Effect<string, E, R> =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) => {
      const bytes = Array.from(chunks)
      const totalLength = bytes.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      const output = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of bytes) {
        output.set(chunk, offset)
        offset += chunk.byteLength
      }
      return new TextDecoder().decode(output)
    })
  )

test("makeProviderRegistry freezes each registered capability against post-registration mutation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const capability = new ProviderCapability({ name: "filesystem", description: "original" })
      const registry = yield* makeProviderRegistry([
        { kind: "runtime", id: "bun", capabilities: [capability] }
      ])

      const capabilities = yield* registry.capabilitiesFor("runtime", "bun")
      expect(capabilities).toHaveLength(1)
      const registered = capabilities[0]
      expect(registered?.name).toBe("filesystem")
      expect(Object.isFrozen(registered)).toBe(true)
    })
  ))
