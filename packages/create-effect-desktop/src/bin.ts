#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { basename, join } from "node:path"

import { Console, Data, Effect } from "effect"
import { Argument, Command, Flag, type CliError } from "effect/unstable/cli"

import { RENDERER_STORAGE_KINDS, scaffold, TEMPLATE_NAMES, type ScaffoldError } from "./index.js"

class CreateCliError extends Data.TaggedError("CreateCliError")<{
  readonly message: string
}> {}

export const runCreateEffectDesktop = (
  args: readonly string[],
  cwd: string
): Effect.Effect<
  void,
  CreateCliError | ScaffoldError | CliError.CliError,
  BunServices.BunServices
> =>
  Effect.andThen(
    validateRawArgs(args),
    Command.runWith(makeCreateCommand(cwd), { version: "0.0.0" })(args)
  )

const makeCreateCommand = (cwd: string) =>
  Command.make(
    "create-effect-desktop",
    {
      name: Argument.string("name").pipe(Argument.withDefault("my-effect-desktop-app")),
      template: Flag.choice("template", TEMPLATE_NAMES).pipe(
        Flag.withDefault("local-first-sqlite")
      ),
      rendererStorage: Flag.choice("renderer-storage", RENDERER_STORAGE_KINDS).pipe(
        Flag.withDefault("none")
      ),
      includeWorkflows: Flag.boolean("include-workflows"),
      includeCluster: Flag.boolean("include-cluster")
    },
    (args) =>
      Effect.gen(function* () {
        if (args.name !== basename(args.name) || args.name === "." || args.name === "..") {
          return yield* failCreate("project name must be a single directory name")
        }

        const outDir = join(cwd, args.name)

        yield* Console.log(`Scaffolding ${args.name} from template ${args.template}...`)

        const result = yield* scaffold({
          name: args.name,
          template: args.template,
          rendererStorage: args.rendererStorage,
          includeWorkflows: args.includeWorkflows,
          includeCluster: args.includeCluster,
          outDir
        }).pipe(
          Effect.tapError((error) => Console.error(`create-effect-desktop: ${formatError(error)}`))
        )

        yield* Console.log(`\nCreated ${result.path}`)

        yield* Console.log(`\nNext steps:
  cd ${args.name}
  bun install
  bun run dev
`)
      })
  ).pipe(Command.withDescription("Create a new Effect Desktop application from a template."))

const validateRawArgs = (args: readonly string[]): Effect.Effect<void, CreateCliError> =>
  Effect.gen(function* () {
    const positionals: string[] = []

    for (let index = 0; index < args.length; index += 1) {
      const token = args[index]
      if (token === undefined) {
        continue
      }
      if (token === "--template" || token === "--renderer-storage") {
        const value = args[index + 1]
        if (value === undefined || value.startsWith("--")) {
          return yield* failCreate(`${token} requires a value`)
        }
        index += 1
        continue
      }
      if (token.startsWith("--") || token === "-h") {
        continue
      }
      positionals.push(token)
    }

    if (positionals.length > 1) {
      return yield* failCreate(`unexpected positional argument '${positionals[1]}'`)
    }
    return undefined
  })

const failCreate = (message: string): Effect.Effect<never, CreateCliError> =>
  Effect.gen(function* () {
    const error = new CreateCliError({ message })
    yield* Console.error(`create-effect-desktop: ${formatError(error)}`)
    return yield* Effect.fail(error)
  })

function formatError(error: CreateCliError | ScaffoldError): string {
  switch (error._tag) {
    case "CreateCliError":
    case "ScaffoldTemplateError":
    case "ScaffoldTargetError":
    case "ScaffoldPackageJsonError":
    case "ScaffoldFileError":
      return error.message
  }
}

const program = runCreateEffectDesktop(Bun.argv.slice(2), process.cwd()).pipe(
  Effect.provide(BunServices.layer)
)

BunRuntime.runMain(program)
