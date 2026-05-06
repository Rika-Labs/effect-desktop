import { mkdtemp, readFile, stat as nodeStat, symlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { HostProtocolPermissionDeniedError } from "@effect-desktop/bridge"
import { expect, test } from "bun:test"
import { Effect, Exit, Fiber, Stream } from "effect"

import {
  FilesystemStatResult,
  makeFilesystem,
  type FilesystemEvent,
  type FilesystemError,
  type FilesystemAdapter,
  type FilesystemApi,
  type FilesystemOptions,
  type RawFilesystemEvent
} from "./filesystem.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"

test("Filesystem reads and writes bytes through typed Effects", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "hello.txt")
  const service = await makeTestFilesystem()

  await Effect.runPromise(service.write(path, new TextEncoder().encode("hello")))
  const bytes = await Effect.runPromise(service.read(path))

  expect(new TextDecoder().decode(bytes)).toBe("hello")
  expect(await readFile(path, "utf8")).toBe("hello")
})

test("Filesystem stat returns kind, size, and modified time", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "stat.txt")
  const service = await makeTestFilesystem()

  await Effect.runPromise(service.write(path, new Uint8Array([1, 2, 3])))
  const result = await Effect.runPromise(service.stat(path))

  expect(result).toBeInstanceOf(FilesystemStatResult)
  expect(result.kind).toBe("file")
  expect(result.sizeBytes).toBe(3)
  expect(result.modifiedAtMs).toBeGreaterThan(0)
})

test("Filesystem stat reports symlink paths without following them", async () => {
  const directory = await tempDirectory()
  const target = join(directory, "target")
  const link = join(directory, "link")
  const service = await makeTestFilesystem()

  await Effect.runPromise(service.mkdir(target))
  await symlink(target, link)
  const result = await Effect.runPromise(service.stat(link))

  expect(result.kind).toBe("symlink")
})

test("Filesystem mkdir and remove perform basic directory operations", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "nested")
  const service = await makeTestFilesystem()

  await Effect.runPromise(service.mkdir(path))
  expect((await nodeStat(path)).isDirectory()).toBe(true)

  await Effect.runPromise(service.remove(path))
  const exit = await Effect.runPromiseExit(service.stat(path))
  expectFailureTag(exit, "FileNotFound")
})

test("Filesystem remove deletes directory symlinks without following them", async () => {
  const directory = await tempDirectory()
  const target = join(directory, "target")
  const link = join(directory, "link")
  const service = await makeTestFilesystem()

  await Effect.runPromise(service.mkdir(target))
  await symlink(target, link)

  await Effect.runPromise(service.remove(link))

  const linkExit = await Effect.runPromiseExit(service.stat(link))
  expectFailureTag(linkExit, "FileNotFound")
  expect((await nodeStat(target)).isDirectory()).toBe(true)
})

test("Filesystem returns FileNotFound for missing paths", async () => {
  const directory = await tempDirectory()
  const service = await makeTestFilesystem()

  const exit = await Effect.runPromiseExit(service.read(join(directory, "missing.txt")))

  expectFailureTag(exit, "FileNotFound")
})

test("Filesystem validates input before disk activity", async () => {
  const service = await makeTestFilesystem()

  const exit = await Effect.runPromiseExit(service.read(""))

  expectFailureTag(exit, "InvalidArgument")
})

test("Filesystem maps adapter permission failures to PermissionDenied", async () => {
  const service = await makeTestFilesystem({ adapter: permissionDeniedAdapter })

  const exit = await Effect.runPromiseExit(service.write("/denied.txt", new Uint8Array([1])))

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem maps adapter disk-full failures to DiskFull", async () => {
  const service = await makeTestFilesystem({ adapter: diskFullAdapter })

  const exit = await Effect.runPromiseExit(service.write("/full.txt", new Uint8Array([1])))

  expectFailureTag(exit, "DiskFull")
})

test("Filesystem watch emits typed events from the adapter", async () => {
  const fixture = await makeWatchFixture()
  const fiber = Effect.runFork(
    fixture.service
      .watch("/tmp/project", { ownerScope: "scope-main" })
      .pipe(Stream.take(1), Stream.runCollect)
  )

  await waitUntil(() => fixture.listener !== undefined)
  fixture.listener?.({ type: "change", filename: "a.txt" })
  const events = await Effect.runPromise(Fiber.join(fiber))
  const afterStreamEnd = await Effect.runPromise(fixture.registry.list())

  expect(Array.from(events)).toEqual([
    {
      kind: "modified",
      path: "/tmp/project/a.txt",
      directory: "/tmp/project",
      filename: "a.txt"
    }
  ])
  expect(fixture.closeCount).toBe(1)
  expect(afterStreamEnd.entries).toEqual([])
})

test("Filesystem watch classifies rename events as created or deleted", async () => {
  const created = await collectOneWatchEvent({ existingPaths: new Set(["/tmp/project/a.txt"]) })
  const deleted = await collectOneWatchEvent({ existingPaths: new Set() })

  expect(created.kind).toBe("created")
  expect(deleted.kind).toBe("deleted")
})

test("Filesystem watch reports missing options as typed invalid input", async () => {
  const service = await makeTestFilesystem()

  const exit = await Effect.runPromiseExit(
    service.watch("/tmp/project").pipe(Stream.take(1), Stream.runCollect)
  )

  expectFailureTag(exit, "InvalidArgument")
})

test("Filesystem watch maps asynchronous adapter errors into the stream failure channel", async () => {
  const fixture = await makeWatchFixture()
  const fiber = Effect.runFork(
    fixture.service.watch("/tmp/project", { ownerScope: "scope-main" }).pipe(Stream.runDrain)
  )

  await waitUntil(() => fixture.fail !== undefined)
  fixture.fail?.(makePermissionDeniedError())
  const exit = await Effect.runPromiseExit(Fiber.join(fiber))

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem watch registers a scope-bound resource and closes on scope close", async () => {
  const fixture = await makeWatchFixture()
  const fiber = Effect.runFork(
    fixture.service.watch("/tmp/project", { ownerScope: "scope-main" }).pipe(Stream.runDrain)
  )

  await waitUntil(() => fixture.listener !== undefined)
  const registered = await Effect.runPromise(fixture.registry.list())
  expect(registered.entries.map((entry) => entry.handle.kind)).toEqual(["filesystem-watch"])

  await Effect.runPromise(fixture.registry.closeScope("scope-main"))
  const afterClose = await Effect.runPromise(fixture.registry.list())
  await Effect.runPromise(Fiber.join(fiber))

  expect(fixture.closeCount).toBe(1)
  expect(afterClose.entries).toEqual([])
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
    remove: fail as FilesystemAdapter["remove"],
    watch: () =>
      Effect.fail(Object.assign(new Error(code), { code }) as never) as ReturnType<
        FilesystemAdapter["watch"]
      >
  }
}

async function makeTestFilesystem(options: FilesystemOptions = {}): Promise<FilesystemApi> {
  const registry = await Effect.runPromise(makeResourceRegistry())
  return await Effect.runPromise(makeFilesystem(registry, options))
}

async function collectOneWatchEvent(options: {
  readonly existingPaths: ReadonlySet<string>
}): Promise<FilesystemEvent> {
  const fixture = await makeWatchFixture(options)
  const fiber = Effect.runFork(
    fixture.service
      .watch("/tmp/project", { ownerScope: "scope-main" })
      .pipe(Stream.take(1), Stream.runCollect)
  )

  await waitUntil(() => fixture.listener !== undefined)
  fixture.listener?.({ type: "rename", filename: "a.txt" })
  const events = await Effect.runPromise(Fiber.join(fiber))

  const event = Array.from(events)[0]
  if (event === undefined) {
    throw new Error("expected watch event")
  }
  return event
}

async function makeWatchFixture(
  options: {
    readonly existingPaths?: ReadonlySet<string>
  } = {}
): Promise<{
  readonly service: FilesystemApi
  readonly registry: ResourceRegistryApi
  readonly listener: ((event: RawFilesystemEvent) => void) | undefined
  readonly fail: ((error: FilesystemError) => void) | undefined
  readonly closeCount: number
}> {
  let listener: ((event: RawFilesystemEvent) => void) | undefined
  let fail: ((error: FilesystemError) => void) | undefined
  let closeCount = 0
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await Effect.runPromise(
    makeFilesystem(registry, {
      adapter: {
        readFile: (() => Promise.reject(new Error("not used"))) as FilesystemAdapter["readFile"],
        writeFile: () =>
          Promise.reject(new Error("not used")) as ReturnType<FilesystemAdapter["writeFile"]>,
        stat: ((path) =>
          options.existingPaths?.has(path.toString()) === true
            ? Promise.resolve(fakeStats())
            : Promise.reject(
                Object.assign(new Error("missing"), { code: "ENOENT" })
              )) as FilesystemAdapter["stat"],
        mkdir: () => Promise.reject(new Error("not used")),
        remove: () => Promise.reject(new Error("not used")),
        watch: (_path, next, onError) =>
          Effect.sync(() => {
            listener = next
            fail = onError
            return {
              close: () => {
                closeCount += 1
              }
            }
          })
      }
    })
  )

  return {
    service,
    registry,
    get listener() {
      return listener
    },
    get fail() {
      return fail
    },
    get closeCount() {
      return closeCount
    }
  }
}

function makePermissionDeniedError(): FilesystemError {
  return new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: "filesystem.watch",
    resource: "/tmp/project",
    message: "permission denied: /tmp/project",
    operation: "Filesystem.watch",
    recoverable: false
  })
}

function fakeStats(): Awaited<ReturnType<FilesystemAdapter["stat"]>> {
  return {
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    size: 1,
    mtimeMs: 1
  } as Awaited<ReturnType<FilesystemAdapter["stat"]>>
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("condition was not met")
}

function expectFailureTag(exit: Exit.Exit<unknown, unknown>, tag: string): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect((fail?.error as { readonly _tag?: string } | undefined)?._tag).toBe(tag)
  }
}
