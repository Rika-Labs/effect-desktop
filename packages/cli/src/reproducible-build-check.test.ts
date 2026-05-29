import { readdir } from "node:fs/promises"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"

import {
  formatReproError,
  ReproPackageRunError,
  runDesktopReproCheck
} from "./reproducible-build-check.js"
import { PackageCommandFailedError } from "./package-pipeline.js"

const REPRO_WORKSPACE_PREFIX = "effect-desktop-repro-"

const listReproWorkspaces = (): Promise<readonly string[]> =>
  readdir(tmpdir()).then((entries) =>
    entries.filter((entry) => entry.startsWith(REPRO_WORKSPACE_PREFIX))
  )

test("runDesktopReproCheck removes its temp workspace when interrupted mid-pass", async () => {
  const before = new Set(await listReproWorkspaces())

  const started = await Effect.runPromise(Deferred.make<void>())

  const fiber = Effect.runFork(
    runDesktopReproCheck({
      buildRunner: () =>
        Effect.gen(function* () {
          // Signal that the first pass is in flight, then block forever so the
          // interrupt below always lands while inner work is running.
          yield* Deferred.succeed(started, undefined)
          yield* Effect.never
          return { target: "linux-x64", layoutPath: tmpdir() }
        })
          // Erase the never-failing error channel back to `unknown` to match the
          // runner contract without changing behavior.
          .pipe(Effect.orDie),
      packageRunner: () => Effect.die("package runner should not run after interrupt")
    })
  )

  await Effect.runPromise(Deferred.await(started))
  await Effect.runPromise(Fiber.interrupt(fiber))

  const after = await listReproWorkspaces()
  const leaked = after.filter((entry) => !before.has(entry))
  expect(leaked).toEqual([])
})

test("formatReproError surfaces nested package stderr (symmetric with build path)", () => {
  const stderr = "dpkg-deb: error: control file has bad permissions 0644"
  const cause = new PackageCommandFailedError({
    step: "linux-deb",
    command: ["dpkg-deb", "--build"],
    cwd: "/work",
    exitCode: 1,
    message: "linux-deb command exited with 1",
    stderr
  })
  const error = new ReproPackageRunError({
    pass: "second",
    message: cause.message,
    cause
  })

  const formatted = formatReproError(error)

  expect(formatted.tag).toBe("ReproPackageRunError")
  expect(formatted.message).toContain("second package failed: linux-deb command exited with 1")
  expect(formatted.message).toContain(stderr)
})
