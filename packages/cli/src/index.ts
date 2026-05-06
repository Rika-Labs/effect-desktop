import { isAbsolute, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { Effect } from "effect"

import {
  formatProductionCheckReport,
  runProductionCheck,
  type ProductionCheckFile,
  type ProductionSecurityConfig
} from "@effect-desktop/config"

export class CliUsageError extends Error {
  public override readonly name = "CliUsageError"
}

export interface CliRunOptions {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly writeStdout: (text: string) => void
  readonly writeStderr: (text: string) => void
}

export const runCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    if (options.argv[0] !== "check" || !options.argv.includes("--production")) {
      options.writeStderr("Usage: desktop check --production --config <path>\n")
      return 1
    }

    const configPath = yield* readOptionalPathArg(options.argv, "--config", options.writeStderr)
    if (configPath === undefined && options.argv.includes("--config")) {
      return 1
    }

    const rendererPath = yield* readOptionalPathArg(options.argv, "--renderer", options.writeStderr)
    if (rendererPath === undefined && options.argv.includes("--renderer")) {
      return 1
    }

    const selectedConfigPath = configPath ?? "desktop.config.ts"
    const absoluteConfigPath = resolvePath(options.cwd, selectedConfigPath)
    const config = yield* loadConfig(absoluteConfigPath).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          options.writeStderr(`${error.name}: ${error.message}\n`)
          return undefined
        })
      )
    )
    if (config === undefined) {
      return 1
    }

    const rendererFiles = yield* loadRendererFiles(options.cwd, rendererPath).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          options.writeStderr(`${error.name}: ${error.message}\n`)
          return undefined
        })
      )
    )
    if (rendererFiles === undefined) {
      return 1
    }

    const report = yield* runProductionCheck({
      config,
      configPath: selectedConfigPath,
      rendererFiles
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          options.writeStderr(`${error._tag}: ${error.message}\n`)
          return undefined
        })
      )
    )
    if (report === undefined) {
      return 1
    }

    const formatted = formatProductionCheckReport(report)
    if (report.passed) {
      options.writeStdout(formatted)
      return 0
    }

    options.writeStderr(formatted)
    return 1
  })

const readOptionalPathArg = (
  argv: readonly string[],
  name: "--config" | "--renderer",
  writeStderr: (text: string) => void
): Effect.Effect<string | undefined, never, never> =>
  optionalPathArg(argv, name).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        writeStderr(`${error.name}: ${error.message}\n`)
        return undefined
      })
    )
  )

const optionalPathArg = (
  argv: readonly string[],
  name: "--config" | "--renderer"
): Effect.Effect<string | undefined, CliUsageError, never> =>
  Effect.sync(() => {
    const index = argv.indexOf(name)
    if (index === -1) {
      return undefined
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) {
      return new CliUsageError(`${name} requires a path`)
    }
    return value
  }).pipe(
    Effect.flatMap((value) =>
      value instanceof CliUsageError ? Effect.fail(value) : Effect.succeed(value)
    )
  )

const loadConfig = (path: string): Effect.Effect<ProductionSecurityConfig, Error, never> =>
  Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: async () => (await import(pathToFileUrl(path))) as { readonly default?: unknown },
      catch: (cause) =>
        cause instanceof Error ? cause : new CliUsageError(`failed to load config ${path}`)
    })
    if (!isRecord(module.default)) {
      return yield* Effect.fail(new CliUsageError(`config ${path} must export a default object`))
    }
    return module.default as ProductionSecurityConfig
  })

const loadRendererFiles = (
  cwd: string,
  rendererPath: string | undefined
): Effect.Effect<readonly ProductionCheckFile[], Error, never> =>
  Effect.gen(function* () {
    if (rendererPath === undefined) {
      return []
    }
    const absolutePath = resolvePath(cwd, rendererPath)
    const content = yield* Effect.tryPromise({
      try: () => Bun.file(absolutePath).text(),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new CliUsageError(`failed to read renderer ${rendererPath}`)
    })
    return [{ path: rendererPath, content }]
  })

const resolvePath = (cwd: string, path: string): string =>
  isAbsolute(path) ? path : resolve(cwd, path)

const pathToFileUrl = (path: string): string => pathToFileURL(path).href

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null
