import { mkdtemp, readFile, stat as nodeStat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import { FilesystemStatResult, makeFilesystem, type FilesystemAdapter } from "./filesystem.js"

test("Filesystem reads and writes bytes through typed Effects", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "hello.txt")
  const service = await Effect.runPromise(makeFilesystem())

  await Effect.runPromise(service.write(path, new TextEncoder().encode("hello")))
  const bytes = await Effect.runPromise(service.read(path))

  expect(new TextDecoder().decode(bytes)).toBe("hello")
  expect(await readFile(path, "utf8")).toBe("hello")
})

test("Filesystem stat returns kind, size, and modified time", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "stat.txt")
  const service = await Effect.runPromise(makeFilesystem())

  await Effect.runPromise(service.write(path, new Uint8Array([1, 2, 3])))
  const result = await Effect.runPromise(service.stat(path))

  expect(result).toBeInstanceOf(FilesystemStatResult)
  expect(result.kind).toBe("file")
  expect(result.sizeBytes).toBe(3)
  expect(result.modifiedAtMs).toBeGreaterThan(0)
})

test("Filesystem mkdir and remove perform basic directory operations", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "nested")
  const service = await Effect.runPromise(makeFilesystem())

  await Effect.runPromise(service.mkdir(path))
  expect((await nodeStat(path)).isDirectory()).toBe(true)

  await Effect.runPromise(service.remove(path))
  const exit = await Effect.runPromiseExit(service.stat(path))
  expectFailureTag(exit, "FileNotFound")
})

test("Filesystem returns FileNotFound for missing paths", async () => {
  const directory = await tempDirectory()
  const service = await Effect.runPromise(makeFilesystem())

  const exit = await Effect.runPromiseExit(service.read(join(directory, "missing.txt")))

  expectFailureTag(exit, "FileNotFound")
})

test("Filesystem validates input before disk activity", async () => {
  const service = await Effect.runPromise(makeFilesystem())

  const exit = await Effect.runPromiseExit(service.read(""))

  expectFailureTag(exit, "InvalidArgument")
})

test("Filesystem maps adapter permission failures to PermissionDenied", async () => {
  const service = await Effect.runPromise(makeFilesystem({ adapter: permissionDeniedAdapter }))

  const exit = await Effect.runPromiseExit(service.write("/denied.txt", new Uint8Array([1])))

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem maps adapter disk-full failures to DiskFull", async () => {
  const service = await Effect.runPromise(makeFilesystem({ adapter: diskFullAdapter }))

  const exit = await Effect.runPromiseExit(service.write("/full.txt", new Uint8Array([1])))

  expectFailureTag(exit, "DiskFull")
})

const tempDirectory = (): Promise<string> => mkdtemp(join(tmpdir(), "effect-desktop-fs-"))

const permissionDeniedAdapter: FilesystemAdapter = makeFailingAdapter("EACCES")
const diskFullAdapter: FilesystemAdapter = makeFailingAdapter("ENOSPC")

function makeFailingAdapter(code: string): FilesystemAdapter {
  const fail = () => Promise.reject(Object.assign(new Error(code), { code }))

  return {
    readFile: fail as FilesystemAdapter["readFile"],
    writeFile: fail as FilesystemAdapter["writeFile"],
    stat: fail as FilesystemAdapter["stat"],
    mkdir: fail as FilesystemAdapter["mkdir"],
    remove: fail as FilesystemAdapter["remove"]
  }
}

function expectFailureTag(exit: Exit.Exit<unknown, unknown>, tag: string): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect((fail?.error as { readonly _tag?: string } | undefined)?._tag).toBe(tag)
  }
}
