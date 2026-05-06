import {
  link as hardLink,
  lstat as nodeLstat,
  mkdir as mkdirOnDisk,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename as nodeRename,
  rm,
  stat as nodeStat,
  symlink,
  writeFile
} from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  HostProtocolPermissionDeniedError,
  type HostProtocolSymlinkEscapesRootError
} from "@effect-desktop/bridge"
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
  type FilesystemPermissionPolicy,
  type RawFilesystemEvent
} from "./filesystem.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"

test("Filesystem reads and writes bytes through typed Effects", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "hello.txt")
  const service = await makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

  await Effect.runPromise(service.write(path, new TextEncoder().encode("hello")))
  const bytes = await Effect.runPromise(service.read(path))

  expect(new TextDecoder().decode(bytes)).toBe("hello")
  expect(await readFile(path, "utf8")).toBe("hello")
})

test("Filesystem writeAtomic roundtrips a large payload", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "large.bin")
  const service = await makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })
  const bytes = new Uint8Array(10 * 1024 * 1024)
  bytes.fill(7)

  await Effect.runPromise(service.writeAtomic(path, bytes))

  expect(await readFile(path)).toEqual(Buffer.from(bytes))
})

test("Filesystem writeAtomic preserves destination and removes temp on write failure", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "config.json")
  await Bun.write(path, "old")
  const service = await makeTestFilesystem({
    adapter: {
      ...NodeTestFilesystemAdapter,
      writeFileSynced: async (tempPath, bytes) => {
        await Bun.write(tempPath, bytes.slice(0, 1))
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
      }
    },
    permissions: allowFilesystemRoot(directory)
  })

  const exit = await Effect.runPromiseExit(
    service.writeAtomic(path, new TextEncoder().encode("new"))
  )

  expectFailureTag(exit, "DiskFull")
  expect(await readFile(path, "utf8")).toBe("old")
  expect((await readdir(directory)).filter((entry) => entry.includes(".tmp."))).toEqual([])
})

test("Filesystem writeAtomic preserves destination and removes temp on rename failure", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "config.json")
  await Bun.write(path, "old")
  const service = await makeTestFilesystem({
    adapter: {
      ...NodeTestFilesystemAdapter,
      rename: () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
    },
    permissions: allowFilesystemRoot(directory)
  })

  const exit = await Effect.runPromiseExit(
    service.writeAtomic(path, new TextEncoder().encode("new"))
  )

  expectFailureTag(exit, "PermissionDenied")
  expect(await readFile(path, "utf8")).toBe("old")
  expect((await readdir(directory)).filter((entry) => entry.includes(".tmp."))).toEqual([])
})

test("Filesystem writeAtomic consumes the write capability", async () => {
  const allowed = await tempDirectory()
  const denied = await tempDirectory()
  const service = await makeTestFilesystem({ permissions: { writeRoots: [allowed] } })

  const exit = await Effect.runPromiseExit(
    service.writeAtomic(join(denied, "config.json"), new Uint8Array([1]))
  )

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem stat returns kind, size, and modified time", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "stat.txt")
  const service = await makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

  await Effect.runPromise(service.write(path, new Uint8Array([1, 2, 3])))
  const result = await Effect.runPromise(service.stat(path))

  expect(result).toBeInstanceOf(FilesystemStatResult)
  expect(result.kind).toBe("file")
  expect(result.sizeBytes).toBe(3)
  expect(result.modifiedAtMs).toBeGreaterThan(0)
})

test("Filesystem stat follows authorized symlink targets", async () => {
  const directory = await tempDirectory()
  const target = join(directory, "target.txt")
  const link = join(directory, "link")
  const service = await makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

  await Bun.write(target, "target")
  await symlink(target, link)
  const result = await Effect.runPromise(service.stat(link))

  expect(result.path).toBe(await realpath(target))
  expect(result.kind).toBe("file")
})

test("Filesystem mkdir and remove perform basic directory operations", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "nested")
  const service = await makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

  await Effect.runPromise(service.mkdir(path))
  expect((await nodeStat(path)).isDirectory()).toBe(true)

  await Effect.runPromise(service.remove(path))
  const exit = await Effect.runPromiseExit(service.stat(path))
  expectFailureTag(exit, "FileNotFound")
})

test("Filesystem recursive mkdir authorizes nested missing paths under an allowed root", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "a", "b")
  const service = await makeTestFilesystem({ permissions: { writeRoots: [directory] } })

  await Effect.runPromise(service.mkdir(path, { recursive: true }))

  expect((await nodeStat(path)).isDirectory()).toBe(true)
})

test("Filesystem remove deletes directory symlinks without following them", async () => {
  const directory = await tempDirectory()
  const target = join(directory, "target")
  const link = join(directory, "link")
  const service = await makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

  await Effect.runPromise(service.mkdir(target))
  await symlink(target, link)

  await Effect.runPromise(service.remove(link))

  const linkExit = await Effect.runPromiseExit(service.stat(link))
  expectFailureTag(linkExit, "FileNotFound")
  expect((await nodeStat(target)).isDirectory()).toBe(true)
})

test("Filesystem remove authorizes the directory entry being deleted", async () => {
  const allowed = await tempDirectory()
  const outside = await tempDirectory()
  const target = join(allowed, "target.txt")
  const link = join(outside, "link.txt")
  const service = await makeTestFilesystem({ permissions: { deleteRoots: [allowed] } })
  await Bun.write(target, "target")
  await symlink(target, link)

  const exit = await Effect.runPromiseExit(service.remove(link))

  expectFailureTag(exit, "PermissionDenied")
  expect((await nodeLstat(link)).isSymbolicLink()).toBe(true)
})

test("Filesystem returns FileNotFound for missing paths", async () => {
  const directory = await tempDirectory()
  const service = await makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

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

test("Filesystem denies reads outside the configured read roots", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "secret.txt")
  await Bun.write(path, "secret")
  const service = await makeTestFilesystem()

  const exit = await Effect.runPromiseExit(service.read(path))

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem allows writes inside configured write roots", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "allowed.txt")
  const service = await makeTestFilesystem({ permissions: { writeRoots: [directory] } })

  await Effect.runPromise(service.write(path, new TextEncoder().encode("allowed")))

  expect(await readFile(path, "utf8")).toBe("allowed")
})

test("Filesystem denies writes outside configured write roots", async () => {
  const allowed = await tempDirectory()
  const denied = await tempDirectory()
  const service = await makeTestFilesystem({ permissions: { writeRoots: [allowed] } })

  const exit = await Effect.runPromiseExit(
    service.write(join(denied, "denied.txt"), new Uint8Array([1]))
  )

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem denies recursive remove without the recursive delete capability", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "nested")
  const service = await makeTestFilesystem({ permissions: { deleteRoots: [directory] } })
  await mkdirOnDisk(path)

  const exit = await Effect.runPromiseExit(service.remove(path, { recursive: true }))

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem allows recursive remove with delete root and recursive capability", async () => {
  const directory = await tempDirectory()
  const path = join(directory, "nested")
  const service = await makeTestFilesystem({
    permissions: { deleteRoots: [directory], allowRecursiveRemove: true }
  })
  await mkdirOnDisk(path)

  await Effect.runPromise(service.remove(path, { recursive: true }))

  const exists = await nodeStat(path).then(
    () => true,
    () => false
  )
  expect(exists).toBe(false)
})

test("Filesystem canonicalizes symlink targets before permission checks", async () => {
  const allowed = await tempDirectory()
  const denied = await tempDirectory()
  const target = join(denied, "target.txt")
  const link = join(allowed, "link.txt")
  await Bun.write(target, "secret")
  await symlink(target, link)
  const service = await makeTestFilesystem({ permissions: { readRoots: [allowed] } })

  const exit = await Effect.runPromiseExit(service.read(link))

  expectFailureTag(exit, "SymlinkEscapesRoot")
  expectSymlinkEscapesRoot(exit, {
    requested: link,
    resolved: await realpath(target),
    capabilityRoots: [await realpath(allowed)]
  })
})

test("Filesystem realpath returns the authorized canonical path", async () => {
  const directory = await tempDirectory()
  const target = join(directory, "target.txt")
  const link = join(directory, "link.txt")
  const service = await makeTestFilesystem({ permissions: { readRoots: [directory] } })
  await Bun.write(target, "target")
  await symlink(target, link)

  const resolved = await Effect.runPromise(service.realpath(link))

  expect(resolved).toBe(await realpath(target))
})

test("Filesystem realpath returns SymlinkEscapesRoot for symlink escapes", async () => {
  const allowed = await tempDirectory()
  const denied = await tempDirectory()
  const target = join(denied, "target.txt")
  const link = join(allowed, "link.txt")
  const service = await makeTestFilesystem({ permissions: { readRoots: [allowed] } })
  await Bun.write(target, "secret")
  await symlink(target, link)

  const exit = await Effect.runPromiseExit(service.realpath(link))

  expectFailureTag(exit, "SymlinkEscapesRoot")
})

test("Filesystem realpath validates capability input", async () => {
  const service = await makeTestFilesystem()

  const exit = await Effect.runPromiseExit(
    service.realpath("/tmp/project", "filesystem.delete" as never)
  )

  expectFailureTag(exit, "InvalidArgument")
})

test("Filesystem denies hard-linked files with SymlinkEscapesRoot", async () => {
  const allowed = await tempDirectory()
  const denied = await tempDirectory()
  const target = join(denied, "target.txt")
  const linked = join(allowed, "linked.txt")
  const service = await makeTestFilesystem({ permissions: { readRoots: [allowed] } })
  await Bun.write(target, "secret")
  await hardLink(target, linked)

  const exit = await Effect.runPromiseExit(service.read(linked))

  expectFailureTag(exit, "SymlinkEscapesRoot")
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

const NodeTestFilesystemAdapter: FilesystemAdapter = {
  readFile,
  realpath,
  rename: nodeRename,
  writeFile,
  writeFileSynced: (path, bytes) => Bun.write(path, bytes).then(() => undefined),
  stat: nodeLstat,
  mkdir: (path, options) => mkdirOnDisk(path, options).then(() => undefined),
  remove: (path, options) =>
    options?.recursive === true
      ? rm(path, { recursive: true }).then(() => undefined)
      : rm(path).then(() => undefined),
  watch: () => Effect.fail(makePermissionDeniedError()) as ReturnType<FilesystemAdapter["watch"]>
}

function makeFailingAdapter(code: string): FilesystemAdapter {
  const fail = () => Promise.reject(Object.assign(new Error(code), { code }))

  return {
    readFile: fail as FilesystemAdapter["readFile"],
    realpath: fail as FilesystemAdapter["realpath"],
    rename: fail as FilesystemAdapter["rename"],
    writeFile: fail as FilesystemAdapter["writeFile"],
    writeFileSynced: fail as FilesystemAdapter["writeFileSynced"],
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

function allowFilesystemRoot(root: string): FilesystemPermissionPolicy {
  return {
    readRoots: [root],
    writeRoots: [root],
    deleteRoots: [root],
    allowRecursiveRemove: true
  }
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
      permissions: { readRoots: ["/tmp/project"] },
      adapter: {
        readFile: (() => Promise.reject(new Error("not used"))) as FilesystemAdapter["readFile"],
        realpath: ((path) => Promise.resolve(path.toString())) as FilesystemAdapter["realpath"],
        rename: (() => Promise.reject(new Error("not used"))) as FilesystemAdapter["rename"],
        writeFile: () =>
          Promise.reject(new Error("not used")) as ReturnType<FilesystemAdapter["writeFile"]>,
        writeFileSynced: () =>
          Promise.reject(new Error("not used")) as ReturnType<FilesystemAdapter["writeFileSynced"]>,
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

function expectSymlinkEscapesRoot(
  exit: Exit.Exit<unknown, unknown>,
  expected: {
    readonly requested: string
    readonly resolved: string
    readonly capabilityRoots: readonly string[]
  }
): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    const error = fail?.error as HostProtocolSymlinkEscapesRootError | undefined
    expect(error?.requested).toBe(expected.requested)
    expect(error?.resolved).toBe(expected.resolved)
    expect(error?.capabilityRoots).toEqual(expected.capabilityRoots)
  }
}
