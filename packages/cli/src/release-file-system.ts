import { lstat } from "node:fs/promises"
import type { Stats } from "node:fs"

import { BunServices } from "@effect/platform-bun"
import { Context, Effect, FileSystem, Layer } from "effect"

export type ReleaseFileType = "directory" | "file" | "other" | "symlink"

export interface ReleaseFileInfo {
  readonly type: ReleaseFileType
  readonly mode: number
  readonly size: number
  readonly isDirectory: () => boolean
  readonly isFile: () => boolean
  readonly isSymbolicLink: () => boolean
}

export interface ReleaseFileSystemApi {
  readonly access: (path: string) => Effect.Effect<void, unknown, never>
  readonly chmod: (path: string, mode: number) => Effect.Effect<void, unknown, never>
  readonly copyFile: (source: string, destination: string) => Effect.Effect<void, unknown, never>
  readonly exists: (path: string) => Effect.Effect<boolean, unknown, never>
  readonly lstat: (path: string) => Effect.Effect<ReleaseFileInfo, unknown, never>
  readonly makeDirectory: (path: string) => Effect.Effect<void, unknown, never>
  readonly makeTempDirectory: (options: {
    readonly directory: string
    readonly prefix: string
  }) => Effect.Effect<string, unknown, never>
  readonly readDirectory: (path: string) => Effect.Effect<readonly string[], unknown, never>
  readonly readFile: (path: string) => Effect.Effect<Uint8Array, unknown, never>
  readonly readFileString: (path: string) => Effect.Effect<string, unknown, never>
  readonly readLink: (path: string) => Effect.Effect<string, unknown, never>
  readonly remove: (path: string) => Effect.Effect<void, unknown, never>
  readonly stat: (path: string) => Effect.Effect<ReleaseFileInfo, unknown, never>
  readonly writeFileString: (path: string, content: string) => Effect.Effect<void, unknown, never>
}

export const makeReleaseFileSystem = (): Effect.Effect<
  ReleaseFileSystemApi,
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return {
      access: (path) => fs.access(path),
      chmod: (path, mode) => fs.chmod(path, mode),
      copyFile: (source, destination) => fs.copyFile(source, destination),
      exists: (path) => fs.exists(path),
      lstat: (path) =>
        Effect.tryPromise({
          try: async () => releaseFileInfoFromNodeStats(await lstat(path)),
          catch: (cause) => cause
        }),
      makeDirectory: (path) => fs.makeDirectory(path, { recursive: true }),
      makeTempDirectory: (options) => fs.makeTempDirectory(options),
      readDirectory: (path) => fs.readDirectory(path),
      readFile: (path) => fs.readFile(path),
      readFileString: (path) => fs.readFileString(path),
      readLink: (path) => fs.readLink(path),
      remove: (path) => fs.remove(path, { recursive: true, force: true }),
      stat: (path) => fs.stat(path).pipe(Effect.map(releaseFileInfoFromEffectInfo)),
      writeFileString: (path, content) => fs.writeFileString(path, content)
    } satisfies ReleaseFileSystemApi
  })

export class ReleaseFileSystem extends Context.Service<ReleaseFileSystem, ReleaseFileSystemApi>()(
  "@effect-desktop/cli/ReleaseFileSystem"
) {}

export const ReleaseFileSystemLive: Layer.Layer<ReleaseFileSystem, never, FileSystem.FileSystem> =
  Layer.effect(ReleaseFileSystem)(makeReleaseFileSystem())

export const runReleaseFileSystem = <A, E>(
  effect: Effect.Effect<A, E, ReleaseFileSystem>
): Effect.Effect<A, E, never> =>
  effect.pipe(Effect.provide(ReleaseFileSystemLive), Effect.provide(BunServices.layer))

const releaseFileInfoFromEffectInfo = (info: FileSystem.File.Info): ReleaseFileInfo =>
  makeReleaseFileInfo(
    info.type === "File" ? "file" : info.type === "Directory" ? "directory" : "other",
    info.mode,
    Number(info.size)
  )

const releaseFileInfoFromNodeStats = (stats: Stats): ReleaseFileInfo =>
  makeReleaseFileInfo(
    stats.isFile()
      ? "file"
      : stats.isDirectory()
        ? "directory"
        : stats.isSymbolicLink()
          ? "symlink"
          : "other",
    stats.mode,
    stats.size
  )

const makeReleaseFileInfo = (
  type: ReleaseFileType,
  mode: number,
  size: number
): ReleaseFileInfo => ({
  type,
  mode,
  size,
  isDirectory: () => type === "directory",
  isFile: () => type === "file",
  isSymbolicLink: () => type === "symlink"
})
