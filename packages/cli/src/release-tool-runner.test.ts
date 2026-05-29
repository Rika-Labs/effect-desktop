import { expect, test } from "bun:test"

import {
  Deferred,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  PlatformError,
  Sink,
  Stream
} from "effect"
import { TestClock } from "effect/testing"
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

test("ReleaseToolRunner drains stdout and stderr concurrently", () => {
  const runtime = makeRunnerRuntime(makeBackpressuredSpawner())
  return runtime.runPromise(
    Effect.gen(function* () {
      const fiber = yield* runnerProgram({
        step: "build",
        command: "tool",
        args: [],
        cwd: "/repo"
      }).pipe(Effect.timeoutOption("1 minute"), Effect.forkChild)

      yield* TestClock.adjust("1 minute")
      const outcome = yield* Fiber.join(fiber)

      expect(Option.isSome(outcome)).toBe(true)
      const result = Option.getOrThrow(outcome)
      expect(result.stdout).toBe("stdout")
      expect(result.stderr).toBe("stderr")
      expect(result.exitCode).toBe(0)
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
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

const makeBackpressuredSpawner = () =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.die(new Error("expected a standard command"))
      }
      const stderrPulled = yield* Deferred.make<void>()
      const stdoutGatedOnStderr = Stream.fromIterable([encoder.encode("stdout")]).pipe(
        Stream.concat(Stream.fromEffect(Deferred.await(stderrPulled)).pipe(Stream.drain))
      )
      const stderrSignalsWhenPulled = Stream.fromEffect(
        Deferred.succeed(stderrPulled, undefined)
      ).pipe(Stream.drain, Stream.concat(Stream.fromIterable([encoder.encode("stderr")])))
      return ChildProcessSpawner.makeHandle({
        all: Stream.empty,
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        pid: ChildProcessSpawner.ProcessId(1),
        stderr: stderrSignalsWhenPulled,
        stdin: Sink.drain,
        stdout: stdoutGatedOnStderr,
        unref: Effect.succeed(Effect.void)
      })
    })
  )
