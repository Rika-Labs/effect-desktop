import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "./index.js"

test("desktop check --production exits non-zero for unacknowledged CSP weakening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-"))
  try {
    await writeFile(
      join(directory, "desktop.config.ts"),
      [
        "export default {",
        "  security: {",
        "    csp: { policy: \"script-src 'self' 'unsafe-inline'\" }",
        "  }",
        "}"
      ].join("\n")
    )

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--production", "--config", "desktop.config.ts"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("weakened-csp")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --production exits zero and reports acknowledged weakenings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-"))
  try {
    await writeFile(
      join(directory, "desktop.config.ts"),
      [
        "export default {",
        "  security: {",
        "    csp: {",
        "      policy: \"script-src 'self' 'unsafe-inline'\",",
        "      acknowledgeWeakening: true,",
        "      justification: 'legacy provider migration'",
        "    }",
        "  }",
        "}"
      ].join("\n")
    )

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--production", "--config", "desktop.config.ts"],
        cwd: directory,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("ACK weakened-csp")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --production fails when an explicit renderer scan file is unreadable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-"))
  try {
    await writeFile(join(directory, "desktop.config.ts"), "export default {}\n")

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--production", "--renderer", "missing.ts"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("missing.ts")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --production treats missing renderer path as a usage error", async () => {
  const stderr: string[] = []
  const exitCode = await Effect.runPromise(
    runCli({
      argv: ["check", "--production", "--renderer", "--config", "desktop.config.ts"],
      cwd: process.cwd(),
      writeStdout: () => {},
      writeStderr: (text) => {
        stderr.push(text)
      }
    })
  )

  expect(exitCode).toBe(1)
  expect(stderr.join("")).toContain("--renderer requires a path")
})
