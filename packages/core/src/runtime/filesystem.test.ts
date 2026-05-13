import {
  link as hardLink,
  lstat as nodeLstat,
  mkdir as mkdirOnDisk,
  mkdtemp,
  readFile,
  realpath,
  stat as nodeStat,
  symlink
} from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { BunFileSystem } from "@effect/platform-bun"
import {
  HostProtocolPermissionDeniedError,
  type HostProtocolSymlinkEscapesRootError
} from "@effect-desktop/bridge"
import { expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Option, Queue, Stream } from "effect"
import * as PlatformError from "effect/PlatformError"

import {
  FilesystemStatResult,
  makeFilesystem,
  type FilesystemEvent,
  type FilesystemError,
  type FilesystemApi,
  type FilesystemOptions,
  type FilesystemPermissionPolicy
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
  const calls: string[] = []
  const path = "/workspace/config.json"
  const service = await makeTestFilesystem(
    {
      permissions: allowFilesystemRoot("/workspace")
    },
    failingOpenFileSystem(calls, "ENOSPC")
  )

  const exit = await Effect.runPromiseExit(
    service.writeAtomic(path, new TextEncoder().encode("new"))
  )

  expectFailureTag(exit, "DiskFull")
  expect(calls.some((call) => call.startsWith("open:/workspace/config.json.tmp."))).toBe(true)
  expect(calls.some((call) => call.startsWith("remove:/workspace/config.json.tmp."))).toBe(true)
})

test("Filesystem writeAtomic preserves destination and removes temp on rename failure", async () => {
  const calls: string[] = []
  const path = "/workspace/config.json"
  const service = await makeTestFilesystem(
    {
      permissions: allowFilesystemRoot("/workspace")
    },
    failingRenameFileSystem(calls, "EACCES")
  )

  const exit = await Effect.runPromiseExit(
    service.writeAtomic(path, new TextEncoder().encode("new"))
  )

  expectFailureTag(exit, "PermissionDenied")
  expect(calls.some((call) => call.startsWith("rename:/workspace/config.json.tmp."))).toBe(true)
  expect(calls.some((call) => call.startsWith("remove:/workspace/config.json.tmp."))).toBe(true)
})

test("Filesystem writeAtomic preserves destination when temp cleanup fails", async () => {
  const calls: string[] = []
  const path = "/workspace/config.json"
  const service = await makeTestFilesystem(
    {
      permissions: allowFilesystemRoot("/workspace")
    },
    failingRenameAndCleanupFileSystem(calls)
  )

  const exit = await Effect.runPromiseExit(
    service.writeAtomic(path, new TextEncoder().encode("new"))
  )

  expectFailureTag(exit, "PermissionDenied")
  expect(calls.some((call) => call.startsWith("remove:/workspace/config.json.tmp."))).toBe(true)
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

test("Filesystem stat preserves symlink identity", async () => {
  const directory = await tempDirectory()
  const target = join(directory, "target.txt")
  const link = join(directory, "link")
  const service = await makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

  await Bun.write(target, "target")
  await symlink(target, link)
  const result = await Effect.runPromise(service.stat(link))

  expect(result.path).toMatch(/link$/)
  expect(result.kind).toBe("symlink")
})

test("Filesystem stat does not follow symlink targets outside the root", async () => {
  const allowed = await tempDirectory()
  const denied = await tempDirectory()
  const target = join(denied, "target.txt")
  const link = join(allowed, "link")
  const service = await makeTestFilesystem({ permissions: { readRoots: [allowed] } })

  await Bun.write(target, "outside-target")
  await symlink(target, link)
  const result = await Effect.runPromise(service.stat(link))

  expect(result.path).toMatch(/link$/)
  expect(result.kind).toBe("symlink")
  expect(result.sizeBytes).toBe(0)
  expect(result.modifiedAtMs).toBe(0)
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

test("Filesystem rejects NUL path bytes before FileSystem calls", async () => {
  const calls: string[] = []
  const service = await makeTestFilesystem(
    {
      permissions: allowFilesystemRoot("/tmp")
    },
    recordingFileSystem(calls)
  )
  const path = "/tmp/a\u0000b"

  const exits = await Promise.all([
    Effect.runPromiseExit(service.read(path)),
    Effect.runPromiseExit(service.realpath(path)),
    Effect.runPromiseExit(service.write(path, new Uint8Array([1]))),
    Effect.runPromiseExit(service.writeAtomic(path, new Uint8Array([1]))),
    Effect.runPromiseExit(service.stat(path)),
    Effect.runPromiseExit(service.mkdir(path)),
    Effect.runPromiseExit(service.remove(path)),
    Effect.runPromiseExit(service.watch(path, { ownerScope: "scope-main" }).pipe(Stream.runDrain))
  ])

  for (const exit of exits) {
    expectFailureTag(exit, "InvalidArgument")
  }
  expect(calls).toEqual([])
})

test("Filesystem maps Effect FileSystem permission failures to PermissionDenied", async () => {
  const service = await makeTestFilesystem(
    { permissions: allowFilesystemRoot("/workspace") },
    failingWriteFileSystem("EACCES")
  )

  const exit = await Effect.runPromiseExit(
    service.write("/workspace/denied.txt", new Uint8Array([1]))
  )

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem maps Effect FileSystem unknown EPERM failures to PermissionDenied", async () => {
  const service = await makeTestFilesystem(
    { permissions: allowFilesystemRoot("/workspace") },
    failingWriteFileSystem("EPERM")
  )

  const exit = await Effect.runPromiseExit(
    service.write("/workspace/denied.txt", new Uint8Array([1]))
  )

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem maps remove EACCES to filesystem.delete", async () => {
  const directory = await tempDirectory()
  const service = await makeTestFilesystem(
    {
      permissions: { deleteRoots: [directory], allowRecursiveRemove: false }
    },
    failingRemoveFileSystem(directory, "EACCES")
  )

  const exit = await Effect.runPromiseExit(service.remove(join(directory, "remove-target.txt")))
  const error = expectFailurePermissionDenied(exit)

  expect(error.capability).toBe("filesystem.delete")
})

test("Filesystem maps recursive remove EACCES to filesystem.delete.recursive", async () => {
  const directory = await tempDirectory()
  const service = await makeTestFilesystem(
    {
      permissions: { deleteRoots: [directory], allowRecursiveRemove: true }
    },
    failingRemoveFileSystem(directory, "EACCES")
  )

  const exit = await Effect.runPromiseExit(
    service.remove(join(directory, "remove-target.txt"), { recursive: true })
  )
  const error = expectFailurePermissionDenied(exit)

  expect(error.capability).toBe("filesystem.delete.recursive")
})

test("Filesystem maps Effect FileSystem disk-full failures to DiskFull", async () => {
  const service = await makeTestFilesystem(
    { permissions: allowFilesystemRoot("/workspace") },
    failingWriteFileSystem("ENOSPC")
  )

  const exit = await Effect.runPromiseExit(
    service.write("/workspace/full.txt", new Uint8Array([1]))
  )

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

test("Filesystem reports SymlinkEscapesRoot for intermediate symlink escapes", async () => {
  const allowed = await tempDirectory()
  const denied = await tempDirectory()
  const targetDirectory = join(denied, "target")
  const target = join(targetDirectory, "secret.txt")
  const linkDirectory = join(allowed, "linkdir")
  const linkPath = join(linkDirectory, "secret.txt")
  const service = await makeTestFilesystem({ permissions: { readRoots: [allowed] } })
  await mkdirOnDisk(targetDirectory)
  await Bun.write(target, "secret")
  await symlink(targetDirectory, linkDirectory)

  const exit = await Effect.runPromiseExit(service.read(linkPath))

  expectFailureTag(exit, "SymlinkEscapesRoot")
  expectSymlinkEscapesRoot(exit, {
    requested: linkPath,
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

test("Filesystem watch emits typed events from Effect FileSystem", async () => {
  const fixture = await makeWatchFixture()
  const fiber = Effect.runFork(
    fixture.service
      .watch("/tmp/project", { ownerScope: "scope-main" })
      .pipe(Stream.take(1), Stream.runCollect)
  )

  await waitUntil(() => fixture.watchStarted)
  await fixture.emit({ _tag: "Update", path: "/tmp/project/a.txt" })
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

test("Filesystem watch reclassifies Effect create and remove events from current path state", async () => {
  const created = await collectOneWatchEvent({
    existingPaths: new Set(["/tmp/project/a.txt"]),
    event: { _tag: "Remove", path: "/tmp/project/a.txt" }
  })
  const deleted = await collectOneWatchEvent({
    existingPaths: new Set(),
    event: { _tag: "Remove", path: "/tmp/project/a.txt" }
  })

  expect(created.kind).toBe("created")
  expect(deleted.kind).toBe("deleted")
})

test("Filesystem watch rejects control-byte filenames in FileSystem events", async () => {
  const fixture = await makeWatchFixture()
  const fiber = Effect.runFork(
    fixture.service.watch("/tmp/project", { ownerScope: "scope-main" }).pipe(Stream.runCollect)
  )

  await waitUntil(() => fixture.watchStarted)
  await fixture.emit({ _tag: "Update", path: "/tmp/project/audit\nlog.txt" })
  const exit = await Effect.runPromiseExit(Fiber.join(fiber))

  expectFailureTag(exit, "InvalidArgument")
})

test("Filesystem watch reports missing options as typed invalid input", async () => {
  const service = await makeTestFilesystem()

  const exit = await Effect.runPromiseExit(
    service.watch("/tmp/project").pipe(Stream.take(1), Stream.runCollect)
  )

  expectFailureTag(exit, "InvalidArgument")
})

test("Filesystem watch maps FileSystem errors into the stream failure channel", async () => {
  const fixture = await makeWatchFixture()
  const fiber = Effect.runFork(
    fixture.service.watch("/tmp/project", { ownerScope: "scope-main" }).pipe(Stream.runDrain)
  )

  await waitUntil(() => fixture.watchStarted)
  await fixture.fail(makePermissionDeniedError())
  const exit = await Effect.runPromiseExit(Fiber.join(fiber))

  expectFailureTag(exit, "PermissionDenied")
})

test("Filesystem watch closes exactly once when the stream fiber is interrupted", async () => {
  const fixture = await makeWatchFixture()
  const fiber = Effect.runFork(
    fixture.service.watch("/tmp/project", { ownerScope: "scope-main" }).pipe(Stream.runDrain)
  )

  await waitUntil(() => fixture.watchStarted)
  await Effect.runPromise(Fiber.interrupt(fiber))
  const afterInterrupt = await Effect.runPromise(fixture.registry.list())
  await fixture.emit({ _tag: "Update", path: "/tmp/project/after-close.txt" })

  expect(fixture.closeCount).toBe(1)
  expect(afterInterrupt.entries).toEqual([])
})

test("Filesystem watch scope close does not wait for a busy downstream consumer", async () => {
  const fixture = await makeWatchFixture()
  const consumerStarted = Effect.runSync(Deferred.make<void>())
  const releaseConsumer = Effect.runSync(Deferred.make<void>())
  const fiber = Effect.runFork(
    fixture.service.watch("/tmp/project", { ownerScope: "scope-main" }).pipe(
      Stream.mapEffect((event) =>
        Deferred.succeed(consumerStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseConsumer)),
          Effect.as(event)
        )
      ),
      Stream.runDrain
    )
  )

  await waitUntil(() => fixture.watchStarted)
  await fixture.emit({ _tag: "Update", path: "/tmp/project/busy.txt" })
  await Effect.runPromise(Deferred.await(consumerStarted))
  const closeResult = await Effect.runPromise(
    fixture.registry.closeScope("scope-main").pipe(Effect.timeoutOption("100 millis"))
  )
  await Effect.runPromise(Deferred.succeed(releaseConsumer, undefined))
  await Effect.runPromise(Fiber.join(fiber))

  expect(Option.isSome(closeResult)).toBe(true)
  expect(fixture.closeCount).toBe(1)
})

test("Filesystem watch registers a scope-bound resource and closes on scope close", async () => {
  const fixture = await makeWatchFixture()
  const fiber = Effect.runFork(
    fixture.service.watch("/tmp/project", { ownerScope: "scope-main" }).pipe(Stream.runDrain)
  )

  await waitUntil(() => fixture.watchStarted)
  const registered = await Effect.runPromise(fixture.registry.list())
  expect(registered.entries.map((entry) => entry.handle.kind)).toEqual(["filesystem-watch"])

  await Effect.runPromise(fixture.registry.closeScope("scope-main"))
  const afterClose = await Effect.runPromise(fixture.registry.list())
  expect(fixture.closeCount).toBe(1)
  await Effect.runPromise(Fiber.join(fiber))

  expect(afterClose.entries).toEqual([])
})

const tempDirectory = (): Promise<string> => mkdtemp(join(tmpdir(), "effect-desktop-fs-"))

const BunFileSystemLayer: Layer.Layer<FileSystem.FileSystem> = BunFileSystem.layer

async function makeTestFilesystem(
  options: FilesystemOptions = {},
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = BunFileSystemLayer
): Promise<FilesystemApi> {
  const registry = await Effect.runPromise(makeResourceRegistry())
  return await Effect.runPromise(
    makeFilesystem(registry, options).pipe(Effect.provide(fileSystemLayer))
  )
}

const recordingFileSystem = (calls: string[]): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    readFile: (path) =>
      Effect.sync(() => {
        calls.push(`readFile:${path}`)
        return new Uint8Array()
      }),
    realPath: (path) =>
      Effect.sync(() => {
        calls.push(`realPath:${path}`)
        return path
      }),
    writeFile: (path) =>
      Effect.sync(() => {
        calls.push(`writeFile:${path}`)
      }),
    open: (path) =>
      Effect.sync(() => {
        calls.push(`open:${path}`)
        return testFile(calls)
      }),
    stat: (path) =>
      Effect.sync(() => {
        calls.push(`stat:${path}`)
        return testFileInfo()
      }),
    makeDirectory: (path) =>
      Effect.sync(() => {
        calls.push(`makeDirectory:${path}`)
      }),
    remove: (path) =>
      Effect.sync(() => {
        calls.push(`remove:${path}`)
      }),
    rename: (from, to) =>
      Effect.sync(() => {
        calls.push(`rename:${from}:${to}`)
      }),
    readLink: (path) =>
      Effect.sync(() => {
        calls.push(`readLink:${path}`)
        return path
      }),
    watch: (path) =>
      Stream.sync(() => {
        calls.push(`watch:${path}`)
        return { _tag: "Update" as const, path }
      })
  })

const failingOpenFileSystem = (calls: string[], code: string): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    stat: (path) => Effect.fail(platformError("NotFound", "stat", path, "ENOENT")),
    open: (path) =>
      Effect.sync(() => {
        calls.push(`open:${path}`)
      }).pipe(Effect.andThen(Effect.fail(platformError("Unknown", "open", path, code)))),
    remove: (path) =>
      Effect.sync(() => {
        calls.push(`remove:${path}`)
      })
  })

const failingRenameFileSystem = (
  calls: string[],
  code: string
): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    stat: (path) => Effect.fail(platformError("NotFound", "stat", path, "ENOENT")),
    open: (path) =>
      Effect.sync(() => {
        calls.push(`open:${path}`)
        return testFile(calls)
      }),
    rename: (from, to) =>
      Effect.sync(() => {
        calls.push(`rename:${from}:${to}`)
      }).pipe(Effect.andThen(Effect.fail(platformError("PermissionDenied", "rename", to, code)))),
    remove: (path) =>
      Effect.sync(() => {
        calls.push(`remove:${path}`)
      })
  })

const failingRenameAndCleanupFileSystem = (calls: string[]): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    stat: (path) => Effect.fail(platformError("NotFound", "stat", path, "ENOENT")),
    open: (path) =>
      Effect.sync(() => {
        calls.push(`open:${path}`)
        return testFile(calls)
      }),
    rename: (from, to) =>
      Effect.sync(() => {
        calls.push(`rename:${from}:${to}`)
      }).pipe(
        Effect.andThen(Effect.fail(platformError("PermissionDenied", "rename", to, "EACCES")))
      ),
    remove: (path) =>
      Effect.sync(() => {
        calls.push(`remove:${path}`)
      }).pipe(Effect.andThen(Effect.fail(platformError("Busy", "remove", path, "EBUSY"))))
  })

const failingWriteFileSystem = (code: string): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    stat: (path) => Effect.fail(platformError("NotFound", "stat", path, "ENOENT")),
    writeFile: (path) =>
      Effect.fail(
        platformError(
          code === "ENOSPC" || code === "EPERM" ? "Unknown" : "PermissionDenied",
          "writeFile",
          path,
          code
        )
      )
  })

const failingRemoveFileSystem = (root: string, code: string): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    stat: (path) =>
      path === root
        ? Effect.succeed(testFileInfo({ type: "Directory" }))
        : Effect.fail(platformError("NotFound", "stat", path, "ENOENT")),
    remove: (path) => Effect.fail(platformError("PermissionDenied", "remove", path, code))
  })

const watchFixtureFileSystem = (
  queue: Queue.Queue<FileSystem.WatchEvent, PlatformError.PlatformError>,
  existingPaths: ReadonlySet<string>,
  onStart: () => void,
  onClose: () => void
): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    stat: (path) =>
      path === "/tmp/project" || existingPaths.has(path)
        ? Effect.succeed(testFileInfo({ type: path === "/tmp/project" ? "Directory" : "File" }))
        : Effect.fail(platformError("NotFound", "stat", path, "ENOENT")),
    readLink: (path) => Effect.fail(platformError("BadResource", "readLink", path, "EINVAL")),
    watch: () =>
      Stream.suspend(() => {
        onStart()
        return Stream.fromQueue(queue).pipe(Stream.ensuring(Effect.sync(onClose)))
      })
  })

const testFile = (calls: string[]): FileSystem.File => ({
  [FileSystem.FileTypeId]: FileSystem.FileTypeId,
  fd: FileSystem.FileDescriptor(1),
  stat: Effect.succeed(testFileInfo()),
  seek: () => Effect.void,
  sync: Effect.sync(() => {
    calls.push("sync")
  }),
  read: () => Effect.succeed(FileSystem.Size(0)),
  readAlloc: () => Effect.succeed(Option.none()),
  truncate: () => Effect.void,
  write: (buffer) => Effect.succeed(FileSystem.Size(buffer.byteLength)),
  writeAll: (buffer) =>
    Effect.sync(() => {
      calls.push(`writeAll:${buffer.byteLength}`)
    })
})

const testFileInfo = (overrides: Partial<FileSystem.File.Info> = {}): FileSystem.File.Info => ({
  type: "File",
  mtime: Option.some(new Date(1)),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 1,
  ino: Option.some(1),
  mode: 0o644,
  nlink: Option.some(1),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(1),
  blksize: Option.none(),
  blocks: Option.none(),
  ...overrides
})

const platformError = (
  tag:
    | "AlreadyExists"
    | "BadResource"
    | "Busy"
    | "InvalidData"
    | "NotFound"
    | "PermissionDenied"
    | "Unknown",
  method: string,
  path: string,
  code: string
): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: tag,
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    description: `${code}: ${path}`,
    cause: Object.assign(new Error(`${code}: ${path}`), { code, path })
  })

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
  readonly event: FileSystem.WatchEvent
}): Promise<FilesystemEvent> {
  const fixture = await makeWatchFixture({ existingPaths: options.existingPaths })
  const fiber = Effect.runFork(
    fixture.service
      .watch("/tmp/project", { ownerScope: "scope-main" })
      .pipe(Stream.take(1), Stream.runCollect)
  )

  await waitUntil(() => fixture.watchStarted)
  await fixture.emit(options.event)
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
  readonly emit: (event: FileSystem.WatchEvent) => Promise<void>
  readonly fail: (error: PlatformError.PlatformError) => Promise<void>
  readonly watchStarted: boolean
  readonly closeCount: number
}> {
  const watchQueue = await Effect.runPromise(
    Queue.unbounded<FileSystem.WatchEvent, PlatformError.PlatformError>()
  )
  let watchStarted = false
  let closeCount = 0
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await Effect.runPromise(
    makeFilesystem(registry, {
      permissions: { readRoots: ["/tmp/project"] }
    }).pipe(
      Effect.provide(
        watchFixtureFileSystem(
          watchQueue,
          options.existingPaths ?? new Set(),
          () => {
            watchStarted = true
          },
          () => {
            closeCount += 1
          }
        )
      )
    )
  )

  return {
    service,
    registry,
    emit: (event) => Effect.runPromise(Queue.offer(watchQueue, event).pipe(Effect.asVoid)),
    fail: (error) => Effect.runPromise(Queue.fail(watchQueue, error).pipe(Effect.asVoid)),
    get watchStarted() {
      return watchStarted
    },
    get closeCount() {
      return closeCount
    }
  }
}

function makePermissionDeniedError(): PlatformError.PlatformError {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "watch",
    pathOrDescriptor: "/tmp/project",
    description: "permission denied: /tmp/project",
    cause: Object.assign(new Error("EACCES: /tmp/project"), {
      code: "EACCES",
      path: "/tmp/project"
    })
  })
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

const expectFailurePermissionDenied = (
  exit: Exit.Exit<unknown, FilesystemError>
): HostProtocolPermissionDeniedError => {
  expectFailureTag(exit, "PermissionDenied")
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    const error = fail?.error
    expect(error instanceof HostProtocolPermissionDeniedError).toBe(true)
    if (error instanceof HostProtocolPermissionDeniedError) {
      return error
    }
  }
  throw new Error("expected permission denied error")
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
