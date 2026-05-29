import { expect, test } from "bun:test"

import { Console, Effect, FileSystem, Layer, ManagedRuntime, Path, PlatformError } from "effect"
import { CliError } from "effect/unstable/cli"
import { ChildProcessSpawner } from "effect/unstable/process"

import {
  PackInstallableCliError,
  packInstallableCli,
  reportPackInstallableCliError
} from "./pack-installable-cli.js"

const stubSpawner = ChildProcessSpawner.make(() =>
  Effect.die("spawner should not be reached in these tests")
)

interface MakeDirectoryCall {
  readonly path: string
  readonly recursive: boolean
}

// Simulates a real Node/Bun filesystem where the destination directory already
// exists: a non-recursive makeDirectory throws AlreadyExists (EEXIST), while a
// recursive one is idempotent. stat fails so the program short-circuits right
// after the two directory-creation calls without copying the real repo tree.
const makeFileSystemLayer = (records: MakeDirectoryCall[]) =>
  FileSystem.layerNoop({
    makeDirectory: (path, options) => {
      const recursive = options?.recursive === true
      records.push({ path, recursive })
      if (!recursive) {
        return Effect.fail(
          PlatformError.systemError({
            _tag: "AlreadyExists",
            module: "FileSystem",
            method: "mkdir",
            pathOrDescriptor: path
          })
        )
      }
      return Effect.void
    },
    stat: (path) =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "FileSystem",
          method: "stat",
          pathOrDescriptor: path
        })
      )
  })

const makePackRuntime = (records: MakeDirectoryCall[]) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      makeFileSystemLayer(records),
      Path.layer,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, stubSpawner)
    )
  )

test("pack-installable-cli does not abort with 'failed to create' on a pre-existing destination directory", async () => {
  const records: MakeDirectoryCall[] = []
  const runtime = makePackRuntime(records)
  const outputRoot = "/repo/out"

  const error = await runtime.runPromise(Effect.flip(packInstallableCli("/repo", outputRoot)))

  // The destination directory must be created recursively so an existing
  // directory is tolerated rather than tripping EEXIST.
  const outputRootCall = records.find((call) => call.path === outputRoot)
  expect(outputRootCall?.recursive).toBe(true)

  // The pack must not fail with the misleading 'failed to create <outputRoot>'
  // message just because the destination already exists.
  expect(error).toBeInstanceOf(PackInstallableCliError)
  expect(error.message).not.toBe(`failed to create ${outputRoot}`)
})

// A Console whose only behavior is recording the arguments passed to error.
// Every other method is an inert no-op so the test observes exactly what
// reportPackInstallableCliError writes to stderr.
const makeRecordingConsole = (errorLines: string[]): Console.Console => {
  const noop = () => {}
  return {
    assert: noop,
    clear: noop,
    count: noop,
    countReset: noop,
    debug: noop,
    dir: noop,
    dirxml: noop,
    error: (...args) => {
      errorLines.push(args.map(String).join(" "))
    },
    group: noop,
    groupCollapsed: noop,
    groupEnd: noop,
    info: noop,
    log: noop,
    table: noop,
    time: noop,
    timeEnd: noop,
    timeLog: noop,
    trace: noop,
    warn: noop
  }
}

test("reportPackInstallableCliError stays silent for ShowHelp control-flow errors", async () => {
  const errorLines: string[] = []

  const showHelp = new CliError.ShowHelp({
    commandPath: ["pack-installable-cli"],
    errors: []
  })

  await Effect.runPromise(
    reportPackInstallableCliError(showHelp).pipe(
      Effect.provideService(Console.Console, makeRecordingConsole(errorLines))
    )
  )

  expect(errorLines).toEqual([])
})

test("reportPackInstallableCliError reports application errors to stderr", async () => {
  const errorLines: string[] = []

  const appError = new PackInstallableCliError({ message: "failed to create /repo/out" })

  await Effect.runPromise(
    reportPackInstallableCliError(appError).pipe(
      Effect.provideService(Console.Console, makeRecordingConsole(errorLines))
    )
  )

  expect(errorLines).toEqual(["failed to create /repo/out"])
})
