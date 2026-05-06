import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli, type CommandRunner } from "./index.js"

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

test("desktop build stages renderer runtime host bridge manifests and report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-build-"))
  try {
    await writePlaygroundFixture(directory)
    const calls: string[] = []
    const runner: CommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
        if (invocation.step === "renderer") {
          yield* Effect.promise(() => mkdir(join(invocation.cwd, "dist"), { recursive: true }))
          yield* Effect.promise(() =>
            writeFile(join(invocation.cwd, "dist", "index.html"), "<h1>ok</h1>")
          )
        }
        if (invocation.step === "runtime") {
          const outdir = invocation.args[invocation.args.indexOf("--outdir") + 1]
          if (outdir !== undefined) {
            yield* Effect.promise(() => mkdir(outdir, { recursive: true }))
            yield* Effect.promise(() => writeFile(join(outdir, "main.js"), "console.log('ok')\n"))
          }
        }
        if (invocation.step === "native-host") {
          yield* Effect.promise(() =>
            writeFile(join(invocation.cwd, "target", "debug", "host"), "host")
          )
        }
      })

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["build", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "linux-x64",
        now: fixedClock([100, 125, 200, 260, 300, 305]),
        commandRunner: runner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const layout = join(directory, "apps", "playground", "build", "effect-desktop", "linux-x64")
    const report = JSON.parse(await readFile(join(layout, "build-report.json"), "utf8")) as Record<
      string,
      unknown
    >
    const appManifest = JSON.parse(
      await readFile(join(layout, "app-manifest.json"), "utf8")
    ) as Record<string, unknown>
    const bridgeManifest = JSON.parse(
      await readFile(join(layout, "bridge", "bridge-manifest.json"), "utf8")
    ) as Record<string, unknown>

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("Effect Desktop build")
    expect(calls).toEqual([
      "renderer:bun run build",
      `runtime:bun build ${join(directory, "apps", "playground", "runtime.ts")} --target=bun --outdir ${join(layout, "runtime")}`,
      "native-host:cargo build -p host"
    ])
    expect(await readFile(join(layout, "renderer", "index.html"), "utf8")).toBe("<h1>ok</h1>")
    expect(await readFile(join(layout, "runtime", "main.js"), "utf8")).toContain("ok")
    expect(await readFile(join(layout, "native", "host"), "utf8")).toBe("host")
    expect(appManifest).toMatchObject({
      id: "dev.effect-desktop.playground",
      name: "Effect Desktop Playground",
      target: "linux-x64"
    })
    expect(bridgeManifest).toMatchObject({
      apiContracts: []
    })
    expect(report).toMatchObject({
      appId: "dev.effect-desktop.playground",
      target: "linux-x64",
      layoutPath: layout
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop build refuses non-matching platform targets with doctor remediation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-build-"))
  try {
    await writePlaygroundFixture(directory)
    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "build",
          "--config",
          "apps/playground/desktop.config.ts",
          "--platform",
          "windows-x64"
        ],
        cwd: directory,
        hostTarget: "linux-x64",
        commandRunner: () => Effect.void,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("BuildUnsupportedTargetError")
    expect(stderr.join("")).toContain("bun desktop doctor")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const writePlaygroundFixture = async (directory: string): Promise<void> => {
  const appRoot = join(directory, "apps", "playground")
  await mkdir(appRoot, { recursive: true })
  await writeFile(
    join(appRoot, "desktop.config.ts"),
    [
      "export default {",
      "  app: {",
      "    id: 'dev.effect-desktop.playground',",
      "    name: 'Effect Desktop Playground',",
      "    version: '0.0.0'",
      "  },",
      "  runtime: { entry: 'runtime.ts' },",
      "  renderer: { dist: 'dist' }",
      "} as const"
    ].join("\n")
  )
  await writeFile(join(appRoot, "package.json"), '{"type":"module"}\n')
  await writeFile(join(appRoot, "runtime.ts"), "console.log('runtime')\n")
  await mkdir(join(directory, "target", "debug"), { recursive: true })
}

const fixedClock = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => {
    const value = values[index] ?? values[values.length - 1]
    index += 1
    return value ?? 0
  }
}
