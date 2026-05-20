import { BunServices } from "@effect/platform-bun"
import { Context, Data, Effect, Layer, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export type ToolOutputMode = "ignore" | "pipe"

export interface ToolInvocation {
  readonly step: string
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly stdout?: ToolOutputMode
  readonly stderr?: ToolOutputMode
  readonly maxStdoutChars?: number
  readonly maxStderrChars?: number
}

export interface ToolResult {
  readonly command: readonly string[]
  readonly cwd: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export class ToolError extends Data.TaggedError("ToolError")<{
  readonly invocation: ToolInvocation
  readonly message: string
  readonly cause: unknown
}> {}

export interface ReleaseToolRunnerApi {
  readonly run: (invocation: ToolInvocation) => Effect.Effect<ToolResult, ToolError, never>
}

interface TextAccumulator {
  readonly text: string
  readonly truncated: boolean
}

const DEFAULT_TRUNCATED_SUFFIX = "\n[output truncated]"

export const makeReleaseToolRunner = (): Effect.Effect<
  ReleaseToolRunnerApi,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return {
      run: (invocation) => runTool(spawner, invocation)
    } satisfies ReleaseToolRunnerApi
  })

export class ReleaseToolRunner extends Context.Service<ReleaseToolRunner, ReleaseToolRunnerApi>()(
  "@orika/cli/ReleaseToolRunner"
) {}

export const ReleaseToolRunnerLive: Layer.Layer<
  ReleaseToolRunner,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(ReleaseToolRunner)(makeReleaseToolRunner())

export const runReleaseTool = (
  invocation: ToolInvocation
): Effect.Effect<ToolResult, ToolError, never> =>
  Effect.gen(function* () {
    const runner = yield* ReleaseToolRunner
    return yield* runner.run(invocation)
  }).pipe(Effect.provide(ReleaseToolRunnerLive), Effect.provide(BunServices.layer))

const runTool = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  invocation: ToolInvocation
): Effect.Effect<ToolResult, ToolError, never> =>
  Effect.gen(function* () {
    const stdoutMode = invocation.stdout ?? "pipe"
    const stderrMode = invocation.stderr ?? "pipe"
    const command = ChildProcess.make(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      extendEnv: invocation.env !== undefined,
      stdout: stdoutMode,
      stderr: stderrMode
    })
    const handle = yield* spawner.spawn(command)
    const [stdout, stderr, exitCode] = yield* Effect.all([
      readOutput(stdoutMode, handle.stdout, invocation.maxStdoutChars),
      readOutput(stderrMode, handle.stderr, invocation.maxStderrChars),
      handle.exitCode
    ])

    return {
      command: [invocation.command, ...invocation.args],
      cwd: invocation.cwd,
      exitCode: Number(exitCode),
      stdout,
      stderr
    }
  }).pipe(
    Effect.scoped,
    Effect.mapError(
      (cause) =>
        new ToolError({
          invocation,
          message: `failed to run ${invocation.step} command`,
          cause
        })
    ),
    Effect.catchDefect((cause) =>
      Effect.fail(
        new ToolError({
          invocation,
          message: `failed to run ${invocation.step} command`,
          cause
        })
      )
    )
  )

const readOutput = (
  mode: ToolOutputMode,
  stream: Stream.Stream<Uint8Array, PlatformError, never>,
  maxChars: number | undefined
): Effect.Effect<string, PlatformError, never> => {
  if (mode === "ignore") {
    return Stream.runDrain(stream).pipe(Effect.as(""))
  }
  return stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => ({ text: "", truncated: false }) satisfies TextAccumulator,
      appendTextChunk(maxChars)
    ),
    Effect.map(({ text, truncated }) => (truncated ? `${text}${DEFAULT_TRUNCATED_SUFFIX}` : text))
  )
}

const appendTextChunk =
  (maxChars: number | undefined) =>
  (state: TextAccumulator, chunk: string): TextAccumulator => {
    if (maxChars === undefined) {
      return { text: state.text + chunk, truncated: state.truncated }
    }
    if (state.text.length >= maxChars) {
      return { text: state.text, truncated: true }
    }

    const text = state.text + chunk
    return text.length <= maxChars
      ? { text, truncated: state.truncated }
      : { text: text.slice(0, maxChars), truncated: true }
  }
