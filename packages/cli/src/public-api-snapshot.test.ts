import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit } from "effect"

import { PublicApiFileError, runPublicApiCheck } from "./public-api-snapshot.js"

const isRoot = typeof process.getuid === "function" && process.getuid() === 0

const withWorkspace = <A>(use: (cwd: string) => Promise<A>): Promise<A> =>
  mkdtemp(join(tmpdir(), "orika-public-api-")).then(async (cwd) => {
    try {
      return await use(cwd)
    } finally {
      // Restore permissions before cleanup so rm can descend into the tree.
      await chmod(join(cwd, "packages", "foo"), 0o755).catch(() => undefined)
      await rm(cwd, { recursive: true, force: true })
    }
  })

test("runPublicApiCheck surfaces a typed access error instead of silently dropping a package", async () => {
  if (isRoot) {
    // Root bypasses POSIX permission checks, so EACCES cannot be provoked here.
    return
  }

  await withWorkspace(async (cwd) => {
    const packageDir = join(cwd, "packages", "foo")
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, "package.json"), JSON.stringify({ name: "@orika/foo" }))
    // Remove the search bit so probing the contained package.json fails with
    // EACCES while readdir of packages/ still lists "foo".
    await chmod(packageDir, 0o000)

    const exit = await Effect.runPromiseExit(runPublicApiCheck({ cwd }))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(PublicApiFileError)
      expect((error as PublicApiFileError).operation).toBe("access")
    }
  })
})

test("runPublicApiCheck skips a workspace directory with no package.json", async () => {
  await withWorkspace(async (cwd) => {
    // A directory with no package.json must be treated as a non-package and
    // skipped (ENOENT is a legitimate "does not exist"), not raised as an error.
    await mkdir(join(cwd, "packages", "foo"), { recursive: true })

    const exit = await Effect.runPromiseExit(runPublicApiCheck({ cwd }))

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.packages).toEqual([])
      expect(exit.value.passed).toBe(true)
    }
  })
})
