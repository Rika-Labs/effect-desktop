import {
  CommandRegistry,
  type CommandInvocationRecord,
  type CommandSnapshot,
  Job,
  redact,
  type JobSnapshot,
  Worker,
  type WorkerSnapshot
} from "@effect-desktop/core"
import { Context, Effect, Layer, Stream } from "effect"

export * from "./shell.js"

export interface CommandsDevtoolsApi {
  readonly list: () => Effect.Effect<readonly CommandSnapshot[], never, never>
  readonly observeInvocations: () => Stream.Stream<CommandInvocationRecord, never, never>
}

export class CommandsDevtools extends Context.Service<CommandsDevtools, CommandsDevtoolsApi>()(
  "@effect-desktop/devtools/CommandsDevtools"
) {}

export const CommandsDevtoolsLive = Layer.effect(CommandsDevtools)(
  Effect.gen(function* () {
    const commands = yield* CommandRegistry
    return Object.freeze({
      list: () => commands.list(),
      observeInvocations: () => commands.observeInvocations()
    } satisfies CommandsDevtoolsApi)
  })
)

export interface WorkersJobsSnapshot {
  readonly workers: readonly WorkerSnapshot[]
  readonly jobs: readonly JobSnapshot[]
}

export interface WorkersJobsDevtoolsApi {
  readonly list: () => Effect.Effect<WorkersJobsSnapshot, never, never>
  readonly observe: () => Stream.Stream<WorkersJobsSnapshot, never, never>
}

export class WorkersJobsDevtools extends Context.Service<
  WorkersJobsDevtools,
  WorkersJobsDevtoolsApi
>()("@effect-desktop/devtools/WorkersJobsDevtools") {}

export const WorkersJobsDevtoolsLive = Layer.effect(WorkersJobsDevtools)(
  Effect.gen(function* () {
    const workers = yield* Worker
    const jobs = yield* Job
    const list = (): Effect.Effect<WorkersJobsSnapshot, never, never> =>
      Effect.gen(function* () {
        const workerRows = yield* workers.list()
        const jobRows = yield* jobs.list()
        return redact({
          workers: workerRows,
          jobs: jobRows
        })
      })

    return Object.freeze({
      list,
      observe: () =>
        Stream.fromEffect(list()).pipe(
          Stream.concat(
            Stream.fromEffectRepeat(Effect.sleep("16 millis").pipe(Effect.andThen(list())))
          )
        )
    } satisfies WorkersJobsDevtoolsApi)
  })
)
