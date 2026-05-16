import { BunRuntime, BunServices } from "@effect/platform-bun"
import { fileURLToPath } from "node:url"

import { Console, Data, Effect, FileSystem, Path, Schema } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { Argument, Command, type CliError } from "effect/unstable/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

interface PackageJson {
  readonly name?: string
  readonly dependencies?: Record<string, string>
  readonly [key: string]: unknown
}

const PACKAGE_NAMES = ["bridge", "config", "core", "cli"] as const

class PackInstallableCliError extends Data.TaggedError("PackInstallableCliError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export const runPackInstallableCli = (
  args: readonly string[],
  cwd: string
): Effect.Effect<void, PackInstallableCliError | CliError.CliError, BunServices.BunServices> =>
  Command.runWith(makePackCommand(cwd), { version: "0.0.0" })(args)

export const runPackInstallableCliMain = (args: readonly string[], cwd: string): void => {
  const program = runPackInstallableCli(args, cwd).pipe(
    Effect.provide(BunServices.layer),
    Effect.tapError((error) => Console.error(error.message))
  )

  BunRuntime.runMain(program, { disableErrorReporting: true })
}

const makePackCommand = (cwd: string) =>
  Command.make(
    "pack-installable-cli",
    {
      destination: Argument.directory("destination", { mustExist: false })
    },
    ({ destination }) => packInstallableCli(cwd, destination)
  ).pipe(Command.withDescription("Pack an installable desktop CLI artifact."))

const packInstallableCli = (
  cwd: string,
  destination: string
): Effect.Effect<void, PackInstallableCliError, BunServices.BunServices> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
    const outputRoot = path.resolve(cwd, destination)

    yield* fs
      .makeDirectory(path.dirname(outputRoot), { recursive: true })
      .pipe(mapPlatformError(`failed to create ${path.dirname(outputRoot)}`))
    yield* fs.makeDirectory(outputRoot).pipe(mapPlatformError(`failed to create ${outputRoot}`))

    for (const name of PACKAGE_NAMES) {
      yield* copyPackage(fs, path, repoRoot, outputRoot, name)
    }

    for (const name of PACKAGE_NAMES) {
      yield* rewriteLocalPackageDependencies(fs, path, outputRoot, name)
    }

    for (const name of PACKAGE_NAMES) {
      yield* installPackageDependencies(path, outputRoot, name)
    }
  })

const copyPackage = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  repoRoot: string,
  outputRoot: string,
  name: (typeof PACKAGE_NAMES)[number]
): Effect.Effect<void, PackInstallableCliError> => {
  const source = path.join(repoRoot, "packages", name)
  const target = path.join(outputRoot, "packages", name)
  return copyTree(fs, path, source, target)
}

const rewriteLocalPackageDependencies = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  outputRoot: string,
  name: (typeof PACKAGE_NAMES)[number]
): Effect.Effect<void, PackInstallableCliError> =>
  Effect.gen(function* () {
    const packagePath = path.join(outputRoot, "packages", name, "package.json")
    const packageJson = yield* readJson<PackageJson>(fs, packagePath)
    const dependencies = { ...packageJson.dependencies }
    for (const localName of PACKAGE_NAMES) {
      const dependencyName = `@effect-desktop/${localName}`
      if (dependencies[dependencyName] === "workspace:*") {
        dependencies[dependencyName] = `file:../${localName}`
      }
    }
    yield* writeJson(fs, packagePath, { ...packageJson, dependencies })
  })

const installPackageDependencies = (
  path: Path.Path,
  outputRoot: string,
  name: (typeof PACKAGE_NAMES)[number]
): Effect.Effect<void, PackInstallableCliError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const cwd = path.join(outputRoot, "packages", name)
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const command = ChildProcess.make("bun", ["install", "--production"], { cwd })
    const exitCode = yield* spawner
      .exitCode(command)
      .pipe(mapPlatformError(`failed to run dependency install for ${name}`))

    if (Number(exitCode) !== 0) {
      return yield* Effect.fail(
        new PackInstallableCliError({
          message: `failed to install ${name} artifact dependencies`
        })
      )
    }
  })

const copyTree = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  source: string,
  target: string
): Effect.Effect<void, PackInstallableCliError> =>
  Effect.gen(function* () {
    const sourceStat = yield* fs.stat(source).pipe(mapPlatformError(`failed to stat ${source}`))
    if (sourceStat.type === "Directory") {
      if (shouldSkipCopy(path.basename(source))) {
        return
      }
      yield* fs
        .makeDirectory(target, { recursive: true })
        .pipe(mapPlatformError(`failed to create ${target}`))
      const entries = yield* fs
        .readDirectory(source)
        .pipe(mapPlatformError(`failed to read ${source}`))
      for (const entry of entries) {
        yield* copyTree(fs, path, path.join(source, entry), path.join(target, entry))
      }
      return
    }

    if (sourceStat.type === "File") {
      yield* fs
        .makeDirectory(path.dirname(target), { recursive: true })
        .pipe(mapPlatformError(`failed to create ${path.dirname(target)}`))
      yield* fs.copyFile(source, target).pipe(mapPlatformError(`failed to copy ${source}`))
    }
  })

const shouldSkipCopy = (name: string): boolean => name === "node_modules" || name === ".turbo"

const readJson = <A>(
  fs: FileSystem.FileSystem,
  path: string
): Effect.Effect<A, PackInstallableCliError> =>
  Effect.gen(function* () {
    const content = yield* fs.readFileString(path).pipe(mapPlatformError(`failed to read ${path}`))
    return yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(content).pipe(
      Effect.map((value) => value as A),
      Effect.mapError(
        (cause) => new PackInstallableCliError({ message: `failed to parse ${path}`, cause })
      )
    )
  })

const writeJson = (
  fs: FileSystem.FileSystem,
  path: string,
  value: unknown
): Effect.Effect<void, PackInstallableCliError> =>
  fs
    .writeFileString(path, `${JSON.stringify(value, null, 2)}\n`)
    .pipe(mapPlatformError(`failed to write ${path}`))

const mapPlatformError =
  (message: string) =>
  <A, R>(
    effect: Effect.Effect<A, PlatformError, R>
  ): Effect.Effect<A, PackInstallableCliError, R> =>
    Effect.mapError(
      effect,
      (cause) =>
        new PackInstallableCliError({
          message,
          cause
        })
    )
