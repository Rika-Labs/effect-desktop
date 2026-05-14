#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { basename, join } from "node:path"

import { Console, Data, Effect } from "effect"
import { Argument, CliError, Command, Flag } from "effect/unstable/cli"

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
    validateValuedFlagOperands(args),
    Command.runWith(makeCreateCommand(cwd), { version: "0.0.0" })(args)
  )

const makeCreateCommand = (cwd: string) =>
  Command.make(
    "create-effect-desktop",
    {
      name: Argument.string("name").pipe(
        Argument.variadic(),
        Argument.mapEffect((names) =>
          names.length > 1
            ? Effect.fail(
                new CliError.InvalidValue({
                  option: "name",
                  value: names[1] ?? "",
                  expected: "at most 1 value",
                  kind: "argument"
                })
              )
            : Effect.succeed(names[0] ?? "my-effect-desktop-app")
        )
      ),
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

const VALUE_FLAGS = new Set(["--template", "--renderer-storage"])

const validateValuedFlagOperands = (args: readonly string[]): Effect.Effect<void, CreateCliError> =>
  Effect.gen(function* () {
    for (const [index, token] of args.entries()) {
      if (!VALUE_FLAGS.has(token)) {
        continue
      }

      const value = args[index + 1]
      if (value === undefined || value.startsWith("--")) {
        return yield* failCreate(`${token} requires a value`)
      }
    }
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
