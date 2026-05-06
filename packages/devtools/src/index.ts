import {
  CommandRegistry,
  type CommandInvocationRecord,
  type CommandSnapshot
} from "@effect-desktop/core"
import { Context, Effect, Layer, Stream } from "effect"

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
