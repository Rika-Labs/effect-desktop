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
import {
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Schedule,
  Schema,
  Stream
} from "effect"
import * as PlatformError from "effect/PlatformError"

import {
  FilesystemStatResult,
  makeFilesystem,
  type FilesystemError,
  type FilesystemApi,
  type FilesystemOptions,
  type FilesystemPermissionPolicy
} from "./filesystem.js"
import { PermissionActor } from "./permission-registry.js"
import type { ResourceOwnerApi } from "./resource-owner.js"
import { makeResourceRegistry } from "./resources.js"

const TEST_OWNER: ResourceOwnerApi = Object.freeze({
  kind: "test",
  scopeId: "scope-main",
  actor: new PermissionActor({ kind: "resource", id: "scope-main" }),
  attributes: Object.freeze({ scopeId: "scope-main" })
})

test("Filesystem reads and writes bytes through typed Effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "hello.txt")
      const service = yield* makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

      yield* service.write(path, new TextEncoder().encode("hello"))
      const bytes = yield* service.read(path)

      expect(new TextDecoder().decode(bytes)).toBe("hello")
      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe("hello")
    })
  ))

test("Filesystem writeAtomic roundtrips a large payload", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "large.bin")
      const service = yield* makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })
      const bytes = new Uint8Array(10 * 1024 * 1024)
      bytes.fill(7)

      yield* service.writeAtomic(path, bytes)

      expect(yield* Effect.promise(() => readFile(path))).toEqual(Buffer.from(bytes))
    })
  ))

test("Filesystem writeAtomic preserves destination and removes temp on write failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const root = mockWorkspaceRoot()
      const path = join(root, "config.json")
      const service = yield* makeTestFilesystem(
        {
          permissions: allowFilesystemRoot(root)
        },
        failingOpenFileSystem(calls, "ENOSPC")
      )

      const exit = yield* Effect.exit(service.writeAtomic(path, new TextEncoder().encode("new")))

      expectFailureTag(exit, "DiskFull")
      expect(calls.some((call) => call.startsWith(`open:${path}.tmp.`))).toBe(true)
      expect(calls.some((call) => call.startsWith(`remove:${path}.tmp.`))).toBe(true)
    })
  ))

test("Filesystem writeAtomic preserves destination and removes temp on rename failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const root = mockWorkspaceRoot()
      const path = join(root, "config.json")
      const service = yield* makeTestFilesystem(
        {
          permissions: allowFilesystemRoot(root)
        },
        failingRenameFileSystem(calls, "EACCES")
      )

      const exit = yield* Effect.exit(service.writeAtomic(path, new TextEncoder().encode("new")))

      expectFailureTag(exit, "PermissionDenied")
      expect(calls.some((call) => call.startsWith(`rename:${path}.tmp.`))).toBe(true)
      expect(calls.some((call) => call.startsWith(`remove:${path}.tmp.`))).toBe(true)
    })
  ))

test("Filesystem writeAtomic preserves destination when temp cleanup fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const root = mockWorkspaceRoot()
      const path = join(root, "config.json")
      const service = yield* makeTestFilesystem(
        {
          permissions: allowFilesystemRoot(root)
        },
        failingRenameAndCleanupFileSystem(calls)
      )

      const exit = yield* Effect.exit(service.writeAtomic(path, new TextEncoder().encode("new")))

      expectFailureTag(exit, "PermissionDenied")
      expect(calls.some((call) => call.startsWith(`remove:${path}.tmp.`))).toBe(true)
    })
  ))

test("Filesystem writeAtomic consumes the write capability", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allowed = yield* tempDirectory()
      const denied = yield* tempDirectory()
      const service = yield* makeTestFilesystem({ permissions: { writeRoots: [allowed] } })

      const exit = yield* Effect.exit(
        service.writeAtomic(join(denied, "config.json"), new Uint8Array([1]))
      )

      expectFailureTag(exit, "PermissionDenied")
    })
  ))

test("Filesystem stat returns kind, size, and modified time", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "stat.txt")
      const service = yield* makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

      yield* service.write(path, new Uint8Array([1, 2, 3]))
      const result = yield* service.stat(path)

      expect(result).toBeInstanceOf(FilesystemStatResult)
      expect(result.kind).toBe("file")
      expect(result.sizeBytes).toBe(3)
      expect(result.modifiedAtMs).toBeGreaterThan(0)
    })
  ))

test("Filesystem stat preserves symlink identity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const target = join(directory, "target.txt")
      const link = join(directory, "link")
      const service = yield* makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

      yield* Effect.promise(() => Bun.write(target, "target"))
      yield* Effect.promise(() => symlink(target, link))
      const result = yield* service.stat(link)

      expect(result.path).toMatch(/link$/)
      expect(result.kind).toBe("symlink")
    })
  ))

test("Filesystem stat does not follow symlink targets outside the root", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allowed = yield* tempDirectory()
      const denied = yield* tempDirectory()
      const target = join(denied, "target.txt")
      const link = join(allowed, "link")
      const service = yield* makeTestFilesystem({ permissions: { readRoots: [allowed] } })

      yield* Effect.promise(() => Bun.write(target, "outside-target"))
      yield* Effect.promise(() => symlink(target, link))
      const result = yield* service.stat(link)

      expect(result.path).toMatch(/link$/)
      expect(result.kind).toBe("symlink")
      expect(result.sizeBytes).toBe(0)
      expect(result.modifiedAtMs).toBe(0)
    })
  ))

test("Filesystem mkdir and remove perform basic directory operations", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "nested")
      const service = yield* makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

      yield* service.mkdir(path)
      expect((yield* Effect.promise(() => nodeStat(path))).isDirectory()).toBe(true)

      yield* service.remove(path)
      const exit = yield* Effect.exit(service.stat(path))
      expectFailureTag(exit, "FileNotFound")
    })
  ))

test("Filesystem recursive mkdir authorizes nested missing paths under an allowed root", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "a", "b")
      const service = yield* makeTestFilesystem({ permissions: { writeRoots: [directory] } })

      yield* service.mkdir(path, { recursive: true })

      expect((yield* Effect.promise(() => nodeStat(path))).isDirectory()).toBe(true)
    })
  ))

test("Filesystem remove deletes directory symlinks without following them", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const target = join(directory, "target")
      const link = join(directory, "link")
      const service = yield* makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

      yield* service.mkdir(target)
      yield* Effect.promise(() => symlink(target, link))

      yield* service.remove(link)

      const linkExit = yield* Effect.exit(service.stat(link))
      expectFailureTag(linkExit, "FileNotFound")
      expect((yield* Effect.promise(() => nodeStat(target))).isDirectory()).toBe(true)
    })
  ))

test("Filesystem remove authorizes the directory entry being deleted", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allowed = yield* tempDirectory()
      const outside = yield* tempDirectory()
      const target = join(allowed, "target.txt")
      const link = join(outside, "link.txt")
      const service = yield* makeTestFilesystem({ permissions: { deleteRoots: [allowed] } })
      yield* Effect.promise(() => Bun.write(target, "target"))
      yield* Effect.promise(() => symlink(target, link))

      const exit = yield* Effect.exit(service.remove(link))

      expectFailureTag(exit, "PermissionDenied")
      expect((yield* Effect.promise(() => nodeLstat(link))).isSymbolicLink()).toBe(true)
    })
  ))

test("Filesystem returns FileNotFound for missing paths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const service = yield* makeTestFilesystem({ permissions: allowFilesystemRoot(directory) })

      const exit = yield* Effect.exit(service.read(join(directory, "missing.txt")))

      expectFailureTag(exit, "FileNotFound")
    })
  ))

test("Filesystem validates input before disk activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* makeTestFilesystem()

      const exit = yield* Effect.exit(service.read(""))

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("Filesystem rejects NUL path bytes before FileSystem calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const service = yield* makeTestFilesystem(
        {
          permissions: allowFilesystemRoot("/tmp")
        },
        recordingFileSystem(calls)
      )
      const path = "/tmp/a\u0000b"

      const exits = yield* Effect.all(
        [
          Effect.exit(service.read(path)),
          Effect.exit(service.realpath(path)),
          Effect.exit(service.write(path, new Uint8Array([1]))),
          Effect.exit(service.writeAtomic(path, new Uint8Array([1]))),
          Effect.exit(service.stat(path)),
          Effect.exit(service.mkdir(path)),
          Effect.exit(service.remove(path)),
          Effect.exit(service.watch(path).pipe(Stream.runDrain))
        ],
        { concurrency: "unbounded" }
      )

      for (const exit of exits) {
        expectFailureTag(exit, "InvalidArgument")
      }
      expect(calls).toEqual([])
    })
  ))

test("Filesystem maps Effect FileSystem permission failures to PermissionDenied", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* makeTestFilesystem(
        { permissions: allowFilesystemRoot("/workspace") },
        failingWriteFileSystem("EACCES")
      )

      const exit = yield* Effect.exit(service.write("/workspace/denied.txt", new Uint8Array([1])))

      expectFailureTag(exit, "PermissionDenied")
    })
  ))

test("Filesystem maps Effect FileSystem unknown EPERM failures to PermissionDenied", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* makeTestFilesystem(
        { permissions: allowFilesystemRoot("/workspace") },
        failingWriteFileSystem("EPERM")
      )

      const exit = yield* Effect.exit(service.write("/workspace/denied.txt", new Uint8Array([1])))

      expectFailureTag(exit, "PermissionDenied")
    })
  ))

test("Filesystem stat treats readLink EINVAL as a non-symlink", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const root = mockWorkspaceRoot()
      const service = yield* makeTestFilesystem(
        { permissions: allowFilesystemRoot(root) },
        readLinkFailureFileSystem("EINVAL")
      )

      const result = yield* service.stat(join(root, "file.txt"))

      expect(result.kind).toBe("file")
    })
  ))

test("Filesystem stat maps readLink permission failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const root = mockWorkspaceRoot()
      const service = yield* makeTestFilesystem(
        { permissions: allowFilesystemRoot(root) },
        readLinkFailureFileSystem("EACCES")
      )

      const exit = yield* Effect.exit(service.stat(join(root, "file.txt")))

      expectFailureTag(exit, "PermissionDenied")
    })
  ))

test("Filesystem maps remove EACCES to filesystem.delete", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const service = yield* makeTestFilesystem(
        {
          permissions: { deleteRoots: [directory], allowRecursiveRemove: false }
        },
        failingRemoveFileSystem(directory, "EACCES")
      )

      const exit = yield* Effect.exit(service.remove(join(directory, "remove-target.txt")))
      const error = expectFailurePermissionDenied(exit)

      expect(error.capability).toBe("filesystem.delete")
    })
  ))

test("Filesystem maps recursive remove EACCES to filesystem.delete.recursive", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const service = yield* makeTestFilesystem(
        {
          permissions: { deleteRoots: [directory], allowRecursiveRemove: true }
        },
        failingRemoveFileSystem(directory, "EACCES")
      )

      const exit = yield* Effect.exit(
        service.remove(join(directory, "remove-target.txt"), { recursive: true })
      )
      const error = expectFailurePermissionDenied(exit)

      expect(error.capability).toBe("filesystem.delete.recursive")
    })
  ))

test("Filesystem maps Effect FileSystem disk-full failures to DiskFull", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* makeTestFilesystem(
        { permissions: allowFilesystemRoot("/workspace") },
        failingWriteFileSystem("ENOSPC")
      )

      const exit = yield* Effect.exit(service.write("/workspace/full.txt", new Uint8Array([1])))

      expectFailureTag(exit, "DiskFull")
    })
  ))

test("Filesystem denies reads outside the configured read roots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "secret.txt")
      yield* Effect.promise(() => Bun.write(path, "secret"))
      const service = yield* makeTestFilesystem()

      const exit = yield* Effect.exit(service.read(path))

      expectFailureTag(exit, "PermissionDenied")
    })
  ))

test("Filesystem allows writes inside configured write roots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "allowed.txt")
      const service = yield* makeTestFilesystem({ permissions: { writeRoots: [directory] } })

      yield* service.write(path, new TextEncoder().encode("allowed"))

      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe("allowed")
    })
  ))

test("Filesystem denies writes outside configured write roots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allowed = yield* tempDirectory()
      const denied = yield* tempDirectory()
      const service = yield* makeTestFilesystem({ permissions: { writeRoots: [allowed] } })

      const exit = yield* Effect.exit(
        service.write(join(denied, "denied.txt"), new Uint8Array([1]))
      )

      expectFailureTag(exit, "PermissionDenied")
    })
  ))

test("Filesystem denies recursive remove without the recursive delete capability", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "nested")
      const service = yield* makeTestFilesystem({ permissions: { deleteRoots: [directory] } })
      yield* Effect.promise(() => mkdirOnDisk(path))

      const exit = yield* Effect.exit(service.remove(path, { recursive: true }))

      expectFailureTag(exit, "PermissionDenied")
    })
  ))

test("Filesystem allows recursive remove with delete root and recursive capability", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const path = join(directory, "nested")
      const service = yield* makeTestFilesystem({
        permissions: { deleteRoots: [directory], allowRecursiveRemove: true }
      })
      yield* Effect.promise(() => mkdirOnDisk(path))

      yield* service.remove(path, { recursive: true })

      const exists = yield* pathExists(path)
      expect(exists).toBe(false)
    })
  ))

test("Filesystem canonicalizes symlink targets before permission checks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allowed = yield* tempDirectory()
      const denied = yield* tempDirectory()
      const target = join(denied, "target.txt")
      const link = join(allowed, "link.txt")
      yield* Effect.promise(() => Bun.write(target, "secret"))
      yield* Effect.promise(() => symlink(target, link))
      const service = yield* makeTestFilesystem({ permissions: { readRoots: [allowed] } })

      const exit = yield* Effect.exit(service.read(link))

      expectFailureTag(exit, "SymlinkEscapesRoot")
      const resolved1 = yield* Effect.promise(() => realpath(target))
      const allowedReal1 = yield* Effect.promise(() => realpath(allowed))
      yield* expectSymlinkEscapesRoot(exit, {
        requested: link,
        resolved: resolved1,
        capabilityRoots: [allowedReal1]
      })
    })
  ))

test("Filesystem reports SymlinkEscapesRoot for intermediate symlink escapes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allowed = yield* tempDirectory()
      const denied = yield* tempDirectory()
      const targetDirectory = join(denied, "target")
      const target = join(targetDirectory, "secret.txt")
      const linkDirectory = join(allowed, "linkdir")
      const linkPath = join(linkDirectory, "secret.txt")
      const service = yield* makeTestFilesystem({ permissions: { readRoots: [allowed] } })
      yield* Effect.promise(() => mkdirOnDisk(targetDirectory))
      yield* Effect.promise(() => Bun.write(target, "secret"))
      yield* Effect.promise(() => symlink(targetDirectory, linkDirectory))

      const exit = yield* Effect.exit(service.read(linkPath))

      expectFailureTag(exit, "SymlinkEscapesRoot")
      const resolved2 = yield* Effect.promise(() => realpath(target))
      const allowedReal2 = yield* Effect.promise(() => realpath(allowed))
      yield* expectSymlinkEscapesRoot(exit, {
        requested: linkPath,
        resolved: resolved2,
        capabilityRoots: [allowedReal2]
      })
    })
  ))

test("Filesystem realpath returns the authorized canonical path", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory()
      const target = join(directory, "target.txt")
      const link = join(directory, "link.txt")
      const service = yield* makeTestFilesystem({ permissions: { readRoots: [directory] } })
      yield* Effect.promise(() => Bun.write(target, "target"))
      yield* Effect.promise(() => symlink(target, link))

      const resolved = yield* service.realpath(link)

      const realTarget = yield* Effect.promise(() => realpath(target))
      yield* expectSameFilesystemEntry(resolved, realTarget)
    })
  ))

test("Filesystem realpath returns SymlinkEscapesRoot for symlink escapes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allowed = yield* tempDirectory()
      const denied = yield* tempDirectory()
      const target = join(denied, "target.txt")
      const link = join(allowed, "link.txt")
      const service = yield* makeTestFilesystem({ permissions: { readRoots: [allowed] } })
      yield* Effect.promise(() => Bun.write(target, "secret"))
      yield* Effect.promise(() => symlink(target, link))

      const exit = yield* Effect.exit(service.realpath(link))

      expectFailureTag(exit, "SymlinkEscapesRoot")
    })
  ))

test("Filesystem realpath validates capability input", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* makeTestFilesystem()

      // @ts-expect-error intentionally invalid capability exercises runtime decoding.
      const exit = yield* Effect.exit(service.realpath("/tmp/project", "filesystem.delete"))

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("Filesystem denies hard-linked files with SymlinkEscapesRoot", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allowed = yield* tempDirectory()
      const denied = yield* tempDirectory()
      const target = join(denied, "target.txt")
      const linked = join(allowed, "linked.txt")
      const service = yield* makeTestFilesystem({ permissions: { readRoots: [allowed] } })
      yield* Effect.promise(() => Bun.write(target, "secret"))
      yield* Effect.promise(() => hardLink(target, linked))

      const exit = yield* Effect.exit(service.read(linked))

      expectFailureTag(exit, "SymlinkEscapesRoot")
    })
  ))

test("Filesystem watch emits typed events from Effect FileSystem", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeWatchFixture()
      const fiber = yield* Effect.forkChild(
        fixture.service.watch("/tmp/project").pipe(Stream.take(1), Stream.runCollect),
        { startImmediately: true }
      )

      yield* waitUntil(() => fixture.watchStarted)
      yield* fixture.emit({ _tag: "Update", path: "/tmp/project/a.txt" })
      const events = yield* Fiber.join(fiber)
      const afterStreamEnd = yield* fixture.registry.list()

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
  ))

test("Filesystem watch reclassifies Effect create and remove events from current path state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const created = yield* collectOneWatchEvent({
        existingPaths: new Set(["/tmp/project/a.txt"]),
        event: { _tag: "Remove", path: "/tmp/project/a.txt" }
      })
      const deleted = yield* collectOneWatchEvent({
        existingPaths: new Set(),
        event: { _tag: "Remove", path: "/tmp/project/a.txt" }
      })

      expect(created.kind).toBe("created")
      expect(deleted.kind).toBe("deleted")
    })
  ))

test("Filesystem watch rejects control-byte filenames in FileSystem events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeWatchFixture()
      const fiber = yield* Effect.forkChild(
        fixture.service.watch("/tmp/project").pipe(Stream.runCollect),
        { startImmediately: true }
      )

      yield* waitUntil(() => fixture.watchStarted)
      yield* fixture.emit({ _tag: "Update", path: "/tmp/project/audit\nlog.txt" })
      const exit = yield* Effect.exit(Fiber.join(fiber))

      expectFailureTag(exit, "InvalidArgument")
    })
  ))

test("Filesystem watch maps FileSystem errors into the stream failure channel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeWatchFixture()
      const fiber = yield* Effect.forkChild(
        fixture.service.watch("/tmp/project").pipe(Stream.runDrain),
        { startImmediately: true }
      )

      yield* waitUntil(() => fixture.watchStarted)
      yield* fixture.fail(makePermissionDeniedError())
      const exit = yield* Effect.exit(Fiber.join(fiber))

      expectFailureTag(exit, "PermissionDenied")
    })
  ))

test("Filesystem watch closes exactly once when the stream fiber is interrupted", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeWatchFixture()
      const fiber = yield* Effect.forkChild(
        fixture.service.watch("/tmp/project").pipe(Stream.runDrain),
        { startImmediately: true }
      )

      yield* waitUntil(() => fixture.watchStarted)
      yield* Fiber.interrupt(fiber)
      const afterInterrupt = yield* fixture.registry.list()
      yield* fixture.emit({ _tag: "Update", path: "/tmp/project/after-close.txt" })

      expect(fixture.closeCount).toBe(1)
      expect(afterInterrupt.entries).toEqual([])
    })
  ))

test("Filesystem watch scope close does not wait for a busy downstream consumer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeWatchFixture()
      const consumerStarted = yield* Deferred.make<void>()
      const releaseConsumer = yield* Deferred.make<void>()
      const fiber = yield* Effect.forkChild(
        fixture.service.watch("/tmp/project").pipe(
          Stream.mapEffect((event) =>
            Deferred.succeed(consumerStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseConsumer)),
              Effect.as(event)
            )
          ),
          Stream.runDrain
        ),
        { startImmediately: true }
      )

      yield* waitUntil(() => fixture.watchStarted)
      yield* fixture.emit({ _tag: "Update", path: "/tmp/project/busy.txt" })
      yield* Deferred.await(consumerStarted)
      const closeResult = yield* fixture.registry
        .closeScope("scope-main")
        .pipe(Effect.timeoutOption("100 millis"))
      yield* Deferred.succeed(releaseConsumer, undefined)
      yield* Fiber.join(fiber)

      expect(Option.isSome(closeResult)).toBe(true)
      expect(fixture.closeCount).toBe(1)
    })
  ))

test("Filesystem watch registers a scope-bound resource and closes on scope close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeWatchFixture()
      const fiber = yield* Effect.forkChild(
        fixture.service.watch("/tmp/project").pipe(Stream.runDrain),
        { startImmediately: true }
      )

      yield* waitUntil(() => fixture.watchStarted)
      const registered = yield* fixture.registry.list()
      expect(registered.entries.map((entry) => entry.handle.kind)).toEqual(["filesystem-watch"])

      yield* fixture.registry.closeScope("scope-main")
      const afterClose = yield* fixture.registry.list()
      expect(fixture.closeCount).toBe(1)
      yield* Fiber.join(fiber)

      expect(afterClose.entries).toEqual([])
    })
  ))

const tempDirectory = (): Effect.Effect<string> =>
  Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-fs-")))

const mockWorkspaceRoot = (): string =>
  process.platform === "win32" ? "C:\\workspace" : "/workspace"

const BunFileSystemLayer: Layer.Layer<FileSystem.FileSystem> = BunFileSystem.layer

const makeTestFilesystem = (
  options: FilesystemOptions = {},
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = BunFileSystemLayer
): Effect.Effect<FilesystemApi> =>
  Effect.gen(function* () {
    const registry = yield* makeResourceRegistry()
    return yield* runtimeProvide(makeFilesystem(registry, TEST_OWNER, options), fileSystemLayer)
  })

const runtimeProvide = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit as Exit.Exit<A, E | LE>
  })

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

const readLinkFailureFileSystem = (code: string): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    readLink: (path) =>
      Effect.fail(
        platformError(code === "EINVAL" ? "Unknown" : "PermissionDenied", "readLink", path, code)
      ),
    stat: () => Effect.succeed(testFileInfo())
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
  mtime: Option.some(DateTime.toDateUtc(DateTime.makeUnsafe(1))),
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

const collectOneWatchEvent = (options: {
  readonly existingPaths: ReadonlySet<string>
  readonly event: FileSystem.WatchEvent
}) =>
  Effect.gen(function* () {
    const fixture = yield* makeWatchFixture({ existingPaths: options.existingPaths })
    const fiber = yield* Effect.forkChild(
      fixture.service.watch("/tmp/project").pipe(Stream.take(1), Stream.runCollect),
      { startImmediately: true }
    )

    yield* waitUntil(() => fixture.watchStarted)
    yield* fixture.emit(options.event)
    const events = yield* Fiber.join(fiber)

    const event = Array.from(events)[0]
    if (event === undefined) {
      return yield* new ExpectedWatchEventMissing()
    }
    return event
  })

class ExpectedWatchEventMissing extends Schema.TaggedErrorClass<ExpectedWatchEventMissing>()(
  "ExpectedWatchEventMissing",
  {}
) {}

const makeWatchFixture = (
  options: {
    readonly existingPaths?: ReadonlySet<string>
  } = {}
) =>
  Effect.gen(function* () {
    const watchQueue = yield* Queue.unbounded<FileSystem.WatchEvent, PlatformError.PlatformError>()
    let watchStarted = false
    let closeCount = 0
    const registry = yield* makeResourceRegistry()
    const fsLayer = watchFixtureFileSystem(
      watchQueue,
      options.existingPaths ?? new Set(),
      () => {
        watchStarted = true
      },
      () => {
        closeCount += 1
      }
    )
    const service = yield* runtimeProvide(
      makeFilesystem(registry, TEST_OWNER, {
        permissions: { readRoots: ["/tmp/project"] }
      }),
      fsLayer
    )

    return {
      service,
      registry,
      emit: (event: FileSystem.WatchEvent): Effect.Effect<void> =>
        Queue.offer(watchQueue, event).pipe(Effect.asVoid),
      fail: (error: PlatformError.PlatformError): Effect.Effect<void> =>
        Queue.fail(watchQueue, error).pipe(Effect.asVoid),
      get watchStarted() {
        return watchStarted
      },
      get closeCount() {
        return closeCount
      }
    }
  })

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

class WaitUntilTimeout extends Schema.TaggedErrorClass<WaitUntilTimeout>()(
  "WaitUntilTimeout",
  {}
) {}

const waitUntil = (predicate: () => boolean): Effect.Effect<void, WaitUntilTimeout> =>
  Effect.suspend(() => (predicate() ? Effect.void : Effect.fail(new WaitUntilTimeout()))).pipe(
    Effect.retry(Schedule.spaced("10 millis").pipe(Schedule.both(Schedule.recurs(50)))),
    Effect.mapError(() => new WaitUntilTimeout())
  )

const pathExists = (path: string): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: () => nodeStat(path),
    catch: () => null
  }).pipe(
    Effect.match({
      onFailure: () => false,
      onSuccess: () => true
    })
  )

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
    const isPermissionDenied = Schema.is(HostProtocolPermissionDeniedError)
    expect(isPermissionDenied(error)).toBe(true)
    if (isPermissionDenied(error)) {
      return error
    }
  }
  throw new ExpectedPermissionDeniedMissing()
}

class ExpectedPermissionDeniedMissing extends Schema.TaggedErrorClass<ExpectedPermissionDeniedMissing>()(
  "ExpectedPermissionDeniedMissing",
  {}
) {}

const expectSymlinkEscapesRoot = (
  exit: Exit.Exit<unknown, unknown>,
  expected: {
    readonly requested: string
    readonly resolved: string
    readonly capabilityRoots: readonly string[]
  }
): Effect.Effect<void> =>
  Effect.gen(function* () {
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
      const error = fail?.error as HostProtocolSymlinkEscapesRootError | undefined
      expect(error?.requested).toBe(expected.requested)
      if (error?.resolved !== undefined) {
        yield* expectSameFilesystemEntry(error.resolved, expected.resolved)
      }
      expect(error?.capabilityRoots.length).toBe(expected.capabilityRoots.length)
      for (let index = 0; index < expected.capabilityRoots.length; index += 1) {
        const actualRoot = error?.capabilityRoots[index]
        expect(actualRoot).toBeDefined()
        if (actualRoot !== undefined) {
          yield* expectSameFilesystemEntry(actualRoot, expected.capabilityRoots[index] ?? "")
        }
      }
    }
  })

const expectSameFilesystemEntry = (actual: string, expected: string): Effect.Effect<void> =>
  Effect.promise(() => Promise.all([nodeStat(actual), nodeStat(expected)])).pipe(
    Effect.tap(([actualStat, expectedStat]) =>
      Effect.sync(() => {
        expect(actualStat.dev).toBe(expectedStat.dev)
        expect(actualStat.ino).toBe(expectedStat.ino)
      })
    ),
    Effect.asVoid
  )
