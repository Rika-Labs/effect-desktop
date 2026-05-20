import { expect, test } from "bun:test"

import { Effect, Layer, ManagedRuntime, PlatformError, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import {
  ReleaseToolRunner,
  ReleaseToolRunnerLive,
  ToolError,
  type ToolInvocation
} from "./release-tool-runner.js"

const encoder = new TextEncoder()

test("ReleaseToolRunner runs tools through the Effect child-process spawner", () => {
  const records: ChildProcess.StandardCommand[] = []
  const runtime = makeRunnerRuntime(
    makeFakeSpawner({
      onCommand: (command) => {
        records.push(command)
      },
      stdout: "artifact path\n",
      stderr: "warning\n",
      exitCode: 7
    })
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* runnerProgram({
        step: "package",
        command: "tool",
        args: ["--flag"],
        cwd: "/repo",
        env: { RELEASE_CHANNEL: "stable" },
        maxStdoutChars: 8
      })

      expect(result).toEqual({
        command: ["tool", "--flag"],
        cwd: "/repo",
        exitCode: 7,
        stdout: "artifact\n[output truncated]",
        stderr: "warning\n"
      })
      expect(records).toHaveLength(1)
      expect(records[0]?.command).toBe("tool")
      expect(records[0]?.args).toEqual(["--flag"])
      expect(records[0]?.options.cwd).toBe("/repo")
      expect(records[0]?.options.env).toEqual({ RELEASE_CHANNEL: "stable" })
      expect(records[0]?.options.extendEnv).toBe(true)
    })
  )
})

test("ReleaseToolRunner maps missing tools to ToolError", () => {
  const spawner = ChildProcessSpawner.make(() =>
    Effect.fail(
      PlatformError.systemError({
        _tag: "NotFound",
        method: "spawn",
        module: "ReleaseToolRunnerTest"
      })
    )
  )
  const runtime = makeRunnerRuntime(spawner)
  return runtime.runPromise(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runnerProgram({
          step: "doctor",
          command: "missing-tool",
          args: [],
          cwd: "/repo"
        })
      )

      expect(error).toBeInstanceOf(ToolError)
      expect(error.invocation.command).toBe("missing-tool")
    })
  )
})

interface FakeSpawnerOptions {
  readonly onCommand?: (command: ChildProcess.StandardCommand) => void
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
}

const runnerProgram = (invocation: ToolInvocation) =>
  Effect.gen(function* () {
    const runner = yield* ReleaseToolRunner
    return yield* runner.run(invocation)
  })

const makeRunnerRuntime = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  ManagedRuntime.make(
    Layer.provide(
      ReleaseToolRunnerLive,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
    )
  )

const makeFakeSpawner = (options: FakeSpawnerOptions) =>
  ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      if (!ChildProcess.isStandardCommand(command)) {
        throw new Error("expected a standard command")
      }
      options.onCommand?.(command)
      return ChildProcessSpawner.makeHandle({
        all: streamText(`${options.stdout ?? ""}${options.stderr ?? ""}`),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.exitCode ?? 0)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        pid: ChildProcessSpawner.ProcessId(1),
        stderr: streamText(options.stderr ?? ""),
        stdin: Sink.drain,
        stdout: streamText(options.stdout ?? ""),
        unref: Effect.succeed(Effect.void)
      })
    })
  )

const streamText = (text: string): Stream.Stream<Uint8Array> =>
  text.length === 0 ? Stream.empty : Stream.fromIterable([encoder.encode(text)])
