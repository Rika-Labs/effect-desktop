import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema, Stream } from "effect"
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

test("Bun and Node runtime providers satisfy the same core provider contract", async () => {
  const cells = await Promise.all(providerCases.map(runProviderContract))
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

test("runtime provider conformance records missing executables as typed Effect failures", async () => {
  const exits = await Promise.all(providerCases.map(runMissingExecutableContract))

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

test("runtime provider conformance has no experimental Deno cell", async () => {
  const exit = await Effect.runPromiseExit(
    Desktop.runtimeGraph({
      id: "provider-parity",
      windows: { main: { title: "Provider Parity" } },
      providers: { runtime: "deno" }
    })
  )

  expect(providerCases.map((provider) => provider.engine)).toEqual(["bun", "node"])
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toMatchObject({
      _tag: "DesktopConfigError",
      reason: "missing-provider",
      provider: "deno"
    })
  }
})

test("provider registry exposes capabilities and rejects duplicate provider ids", async () => {
  const runtimeCapability = new ProviderCapability({
    name: "FileSystem",
    description: "Provides Effect FileSystem service for desktop runtime programs"
  })
  const runtimeProvider = {
    kind: "runtime",
    id: "test-runtime",
    capabilities: [runtimeCapability]
  } as const

  const registry = await Effect.runPromise(makeProviderRegistry([runtimeProvider]))
  const provider = await Effect.runPromise(registry.get("runtime", "test-runtime"))
  const capabilities = await Effect.runPromise(registry.capabilitiesFor("runtime", "test-runtime"))
  const duplicateExit = await Effect.runPromiseExit(
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

const runProviderContract = (provider: RuntimeProviderCase): Promise<ProviderParityCell> =>
  Effect.runPromise(
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
      }).pipe(
        Effect.provide(
          Desktop.runtime({
            id: "provider-parity",
            windows: { main: { title: "Provider Parity" } },
            providers: { runtime: provider.engine }
          })
        )
      )
    )
  )

const runMissingExecutableContract = (provider: RuntimeProviderCase) =>
  Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(
          "__effect_desktop_missing_provider_parity_executable__",
          []
        )
        return yield* handle.exitCode
      }).pipe(
        Effect.provide(
          Desktop.runtime({
            id: "provider-parity",
            windows: { main: { title: "Provider Parity" } },
            providers: { runtime: provider.engine }
          })
        )
      )
    )
  )

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
