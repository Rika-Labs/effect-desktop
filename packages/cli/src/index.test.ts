import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as cryptoVerify
} from "node:crypto"
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises"
import { basename, dirname, join, relative } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import {
  canonicalUpdateManifestBytes,
  DoctorMissing,
  runCli,
  runDesktopPackage,
  runSemverGuard,
  type CommandRunner,
  type DoctorCommandRunner,
  type NotarizeCommandRunner,
  type PublicApiSnapshotReport,
  type SignCommandRunner
} from "./index.js"
import type { UpdateManifest } from "./update-manifest.js"
import type { PackageCommandRunner } from "./package-pipeline.js"

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

test("desktop doctor reports typed missing Rust toolchain failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
  try {
    await writePlaygroundFixture(directory)
    await writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
    await writeFile(join(directory, "bun.lock"), "")
    const runner = doctorRunner({
      cargo: false,
      rustc: true,
      "pkg-config": true,
      "dpkg-deb": true
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["doctor", "--config", "apps/playground/desktop.config.ts", "--json"],
        cwd: directory,
        platform: "linux",
        arch: "x64",
        bunVersion: "1.3.13",
        doctorCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    const report = JSON.parse(stderr.join("")) as {
      readonly passed: boolean
      readonly probes: readonly [{ readonly name: string; readonly status: string }]
    }
    expect(exitCode).toBe(1)
    expect(report.passed).toBe(false)
    expect(report.probes.find((probe) => probe.name === "rust-toolchain")?.status).toBe("missing")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop doctor exits zero with warnings for optional signing and host cache probes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
  try {
    await writePlaygroundFixture(directory)
    await writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
    await writeFile(join(directory, "bun.lock"), "")
    const runner = doctorRunner({
      cargo: true,
      rustc: true,
      "xcode-select": true,
      hdiutil: true
    })
    const stdout: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["doctor", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        platform: "darwin",
        arch: "arm64",
        bunVersion: "1.3.13",
        doctorCommandRunner: runner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const output = stdout.join("")
    expect(exitCode).toBe(0)
    expect(output).toContain("WARN")
    expect(output).toContain("signing credentials are not configured")
    expect(output).toContain("native host build cache is empty")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop doctor fails when package manager state is not Bun-pinned", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
  try {
    await writePlaygroundFixture(directory)
    await writeFile(join(directory, "package.json"), '{"packageManager":"npm@10.0.0"}\n')
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["doctor", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        platform: "darwin",
        arch: "arm64",
        bunVersion: "1.3.13",
        doctorCommandRunner: doctorRunner({
          cargo: true,
          rustc: true,
          "xcode-select": true,
          hdiutil: true
        }),
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("package.json#packageManager must be pinned to bun")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --repro exits zero for byte-identical staged and packaged outputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
  try {
    await writePlaygroundFixture(directory)
    const commandRunner = deterministicBuildRunner()
    const packageRunner = deterministicPackageRunner(() => "deb")
    const stdout: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "check",
          "--repro",
          "--config",
          "apps/playground/desktop.config.ts",
          "--platform",
          "linux-x64",
          "--artifact",
          "deb"
        ],
        cwd: directory,
        hostTarget: "linux-x64",
        commandRunner,
        packageCommandRunner: packageRunner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("byte-identical")
    expect(stdout.join("")).toContain("target            linux-x64")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --repro reports the differing file and byte offset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
  try {
    await writePlaygroundFixture(directory)
    const commandRunner = deterministicBuildRunner()
    let packagePass = 0
    const packageRunner = deterministicPackageRunner(() => {
      packagePass += 1
      return packagePass === 1 ? "deb-a" : "deb-b"
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "check",
          "--repro",
          "--config",
          "apps/playground/desktop.config.ts",
          "--platform",
          "linux-x64",
          "--artifact",
          "deb"
        ],
        cwd: directory,
        hostTarget: "linux-x64",
        commandRunner,
        packageCommandRunner: packageRunner,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    const output = stderr.join("")
    expect(exitCode).toBe(1)
    expect(output).toContain("package-output")
    expect(output).toContain(".deb")
    expect(output).toContain("offset          4")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --repro --json returns structured diff reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
  try {
    await writePlaygroundFixture(directory)
    const commandRunner = deterministicBuildRunner()
    let packagePass = 0
    const packageRunner = deterministicPackageRunner(() => {
      packagePass += 1
      return packagePass === 1 ? "deb-a" : "deb-b"
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "check",
          "--repro",
          "--config",
          "apps/playground/desktop.config.ts",
          "--platform",
          "linux-x64",
          "--artifact",
          "deb",
          "--json"
        ],
        cwd: directory,
        hostTarget: "linux-x64",
        commandRunner,
        packageCommandRunner: packageRunner,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    const report = JSON.parse(stderr.join("")) as {
      readonly tag: string
      readonly report: {
        readonly differences: readonly [{ readonly firstDifferenceOffset: number }]
      }
    }
    expect(exitCode).toBe(1)
    expect(report.tag).toBe("ReproDiffError")
    expect(report.report.differences[0]?.firstDifferenceOffset).toBe(4)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const reproSymlinkTest = process.platform === "win32" ? test.skip : test

reproSymlinkTest(
  "desktop check --repro reports entry-type drift between symlink and regular file",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
    try {
      await writePlaygroundFixture(directory)
      const commandRunner = deterministicBuildRunner()
      let pass = 0
      const packageRunner = symlinkDriftPackageRunner(() => {
        pass += 1
        return pass === 1 ? "symlink" : "regular"
      })
      const stderr: string[] = []

      const exitCode = await Effect.runPromise(
        runCli({
          argv: [
            "check",
            "--repro",
            "--config",
            "apps/playground/desktop.config.ts",
            "--platform",
            "linux-x64",
            "--artifact",
            "deb",
            "--json"
          ],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner,
          packageCommandRunner: packageRunner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })
      )

      const report = JSON.parse(stderr.join("")) as {
        readonly tag: string
        readonly report: {
          readonly differences: ReadonlyArray<{
            readonly relativePath: string
            readonly kind: string
            readonly firstEntryKind?: string
            readonly secondEntryKind?: string
          }>
        }
      }
      expect(exitCode).toBe(1)
      expect(report.tag).toBe("ReproDiffError")
      const drift = report.report.differences.find((difference) =>
        difference.relativePath.endsWith("app-link")
      )
      expect(drift?.kind).toBe("entry-type")
      expect(drift?.firstEntryKind).toBe("symlink")
      expect(drift?.secondEntryKind).toBe("file")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)

reproSymlinkTest(
  "desktop check --repro reports symlink-target drift between two symlinks",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
    try {
      await writePlaygroundFixture(directory)
      const commandRunner = deterministicBuildRunner()
      let pass = 0
      const packageRunner = symlinkDriftPackageRunner(() => {
        pass += 1
        return pass === 1 ? "symlink-a" : "symlink-b"
      })
      const stderr: string[] = []

      const exitCode = await Effect.runPromise(
        runCli({
          argv: [
            "check",
            "--repro",
            "--config",
            "apps/playground/desktop.config.ts",
            "--platform",
            "linux-x64",
            "--artifact",
            "deb",
            "--json"
          ],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner,
          packageCommandRunner: packageRunner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })
      )

      const report = JSON.parse(stderr.join("")) as {
        readonly tag: string
        readonly report: {
          readonly differences: ReadonlyArray<{
            readonly relativePath: string
            readonly kind: string
            readonly firstSymlinkTarget?: string
            readonly secondSymlinkTarget?: string
          }>
        }
      }
      expect(exitCode).toBe(1)
      expect(report.tag).toBe("ReproDiffError")
      const drift = report.report.differences.find((difference) =>
        difference.relativePath.endsWith("app-link")
      )
      expect(drift?.kind).toBe("symlink-target")
      expect(drift?.firstSymlinkTarget).toBe("target-a.txt")
      expect(drift?.secondSymlinkTarget).toBe("target-b.txt")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)

reproSymlinkTest(
  "desktop check --repro passes when both passes emit identical symlinks",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
    try {
      await writePlaygroundFixture(directory)
      const commandRunner = deterministicBuildRunner()
      const packageRunner = symlinkDriftPackageRunner(() => "symlink")
      const stdout: string[] = []

      const exitCode = await Effect.runPromise(
        runCli({
          argv: [
            "check",
            "--repro",
            "--config",
            "apps/playground/desktop.config.ts",
            "--platform",
            "linux-x64",
            "--artifact",
            "deb"
          ],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner,
          packageCommandRunner: packageRunner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })
      )

      expect(exitCode).toBe(0)
      expect(stdout.join("")).toContain("byte-identical")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)

const reproModeTest = process.platform === "win32" ? test.skip : test

reproModeTest("desktop check --repro reports mode drift between byte-identical files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
  try {
    await writePlaygroundFixture(directory)
    const commandRunner = deterministicBuildRunner()
    let pass = 0
    const packageRunner = modeDriftPackageRunner(() => {
      pass += 1
      return pass === 1 ? 0o755 : 0o644
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "check",
          "--repro",
          "--config",
          "apps/playground/desktop.config.ts",
          "--platform",
          "linux-x64",
          "--artifact",
          "deb",
          "--json"
        ],
        cwd: directory,
        hostTarget: "linux-x64",
        commandRunner,
        packageCommandRunner: packageRunner,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    const report = JSON.parse(stderr.join("")) as {
      readonly tag: string
      readonly report: {
        readonly differences: ReadonlyArray<{
          readonly relativePath: string
          readonly kind: string
          readonly firstMode?: number
          readonly secondMode?: number
        }>
      }
    }
    expect(exitCode).toBe(1)
    expect(report.tag).toBe("ReproDiffError")
    const drift = report.report.differences.find((difference) =>
      difference.relativePath.endsWith("host")
    )
    expect(drift?.kind).toBe("mode")
    expect((drift?.firstMode ?? 0) & 0o111).toBe(0o111)
    expect((drift?.secondMode ?? 0) & 0o111).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

reproModeTest(
  "desktop check --repro passes when both passes set the same executable bits",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
    try {
      await writePlaygroundFixture(directory)
      const commandRunner = deterministicBuildRunner()
      const packageRunner = modeDriftPackageRunner(() => 0o755)
      const stdout: string[] = []

      const exitCode = await Effect.runPromise(
        runCli({
          argv: [
            "check",
            "--repro",
            "--config",
            "apps/playground/desktop.config.ts",
            "--platform",
            "linux-x64",
            "--artifact",
            "deb"
          ],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner,
          packageCommandRunner: packageRunner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })
      )

      expect(exitCode).toBe(0)
      expect(stdout.join("")).toContain("byte-identical")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)

test("desktop check --api writes and verifies public API snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
  try {
    await writeApiFixturePackage(directory, "export interface Widget { readonly id: string }\n")
    const writeStdout: string[] = []

    const writeExitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--api", "--write"],
        cwd: directory,
        writeStdout: (text) => {
          writeStdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    expect(writeExitCode).toBe(0)
    expect(writeStdout.join("")).toContain("mode              write")

    const checkStdout: string[] = []
    const checkExitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--api"],
        cwd: directory,
        writeStdout: (text) => {
          checkStdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    expect(checkExitCode).toBe(0)
    expect(checkStdout.join("")).toContain("@effect-desktop/fixture")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --api fails when the public API changes without a snapshot update", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
  try {
    await writeApiFixturePackage(directory, "export interface Widget { readonly id: string }\n")
    await Effect.runPromise(
      runCli({
        argv: ["check", "--api", "--write"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )
    await writeFile(
      join(directory, "packages/fixture/src/index.ts"),
      "export interface Widget { readonly id: string }\nexport const added = 1\n"
    )

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--api"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("ADD @effect-desktop/fixture added")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --api fails when a public signature changes without a snapshot update", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
  try {
    await writeApiFixturePackage(directory, "export interface Widget { readonly id: string }\n")
    await Effect.runPromise(
      runCli({
        argv: ["check", "--api", "--write"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )
    await writeFile(
      join(directory, "packages/fixture/src/index.ts"),
      "export interface Widget { readonly id: number }\n"
    )

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--api"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("SIGNATURE-CHANGED @effect-desktop/fixture Widget")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --api --json reports missing snapshots as typed values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
  try {
    await writeApiFixturePackage(directory, "export const present = true\n")
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--api", "--json"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    const payload = JSON.parse(stderr.join("")) as {
      readonly tag: string
      readonly message: string
    }
    expect(exitCode).toBe(1)
    expect(payload.tag).toBe("PublicApiFileError")
    expect(payload.message).toContain("snapshot")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --docs verifies manifest pages and runnable examples", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
  try {
    await writeDocsFixture(directory, {
      "docs/user/installation.md": [
        "# Installation",
        "",
        "```ts run",
        "const value: string = 'docs'",
        "if (value.length === 0) throw new Error('empty')",
        "```"
      ].join("\n")
    })
    const stdout: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--docs"],
        cwd: directory,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("pages             1")
    expect(stdout.join("")).toContain("examples          1")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --docs reports missing pages as typed values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
  try {
    await writeDocsManifest(directory, [
      { id: "installation", title: "Installation", path: "docs/user/missing.md" }
    ])
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--docs", "--json"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    const payload = JSON.parse(stderr.join("")) as {
      readonly tag: string
      readonly message: string
    }
    expect(exitCode).toBe(1)
    expect(payload.tag).toBe("DocsGateMissingPageError")
    expect(payload.message).toContain("missing.md")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --docs rejects an incomplete spec manifest even with 24 rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
  try {
    await mkdir(join(directory, "docs"), { recursive: true })
    await writeFile(
      join(directory, "docs", "docs-manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          source: "docs/SPEC.md §25.3",
          pages: Array.from({ length: 24 }, (_, index) => ({
            id: `page-${index}`,
            title: `Page ${index}`,
            path: `docs/user/page-${index}.md`
          }))
        },
        null,
        2
      )
    )
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--docs"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("DocsGateManifestError")
    expect(stderr.join("")).toContain("installation")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --docs reports failing runnable examples", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
  try {
    await writeDocsFixture(directory, {
      "docs/user/installation.md": [
        "# Installation",
        "",
        "```ts run",
        "throw new Error('broken docs example')",
        "```"
      ].join("\n")
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--docs"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("DocsGateExampleFailedError")
    expect(stderr.join("")).toContain("installation.md#1")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --docs rejects manifest paths outside the repo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
  try {
    await writeDocsManifest(directory, [{ id: "escape", title: "Escape", path: "../outside.md" }])

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--docs", "--json"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )
    expect(exitCode).toBe(1)
    const payload = JSON.parse(stderr.join("")) as {
      readonly tag: string
      readonly message: string
    }
    expect(payload.tag).toBe("DocsGateManifestError")
    expect(payload.message).toContain("escapes the repo")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --docs rejects absolute manifest paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
  try {
    await writeDocsManifest(directory, [{ id: "absolute", title: "Absolute", path: "/etc/passwd" }])

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--docs", "--json"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )
    expect(exitCode).toBe(1)
    const payload = JSON.parse(stderr.join("")) as {
      readonly tag: string
      readonly message: string
    }
    expect(payload.tag).toBe("DocsGateManifestError")
    expect(payload.message).toContain("escapes the repo")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --release verifies the release supply-chain posture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
  try {
    await writeReleaseFixture(directory)
    const stdout: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--release"],
        cwd: directory,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("gates             8")
    expect(stdout.join("")).toContain("spdx-sbom")
    expect(stdout.join("")).toContain("branch-protection")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --release rejects incomplete spec gate identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
  try {
    await writeReleaseFixture(directory, {
      checklist: {
        schemaVersion: 1,
        source: "docs/SPEC.md §25.4",
        gates: Array.from({ length: 8 }, (_, index) => ({
          id: `gate-${index}`,
          title: `Gate ${index}`,
          kind: "workflow-step",
          evidence: [".github/workflows/release.yml#Gate"]
        }))
      }
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--release", "--json"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    const payload = JSON.parse(stderr.join("")) as {
      readonly tag: string
      readonly message: string
    }
    expect(exitCode).toBe(1)
    expect(payload.tag).toBe("ReleaseGateManifestError")
    expect(payload.message).toContain("unknown")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --release rejects runner-local release signing policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
  try {
    await writeReleaseFixture(directory, {
      keyManagement: "# Release Key Management\n\nHSM-backed release signing uses rotation.\n"
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--release"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("ReleaseGateEvidenceError")
    expect(stderr.join("")).toContain("runner-local keys are forbidden")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --release rejects stale workflow evidence in the checklist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
  try {
    const checklist = releaseChecklistFixture()
    if (!isReleaseChecklistFixture(checklist)) {
      throw new Error("invalid release checklist fixture")
    }
    await writeReleaseFixture(directory, {
      checklist: {
        ...checklist,
        gates: checklist.gates.map((gate) =>
          gate.id === "spdx-sbom"
            ? { ...gate, evidence: [".github/workflows/release.yml#Missing SBOM Step"] }
            : gate
        )
      }
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--release"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("ReleaseGateEvidenceError")
    expect(stderr.join("")).toContain("Missing SBOM Step")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --release rejects unpinned release workflow actions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
  try {
    await writeReleaseFixture(directory, {
      releaseWorkflow: releaseWorkflowFixture().replace(
        "actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26 # v4.1.0",
        "actions/attest@v4"
      )
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--release"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("ReleaseGateEvidenceError")
    expect(stderr.join("")).toContain("unpinned or uncommented action reference")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --a11y verifies template accessibility evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
  try {
    await writeAccessibilityFixture(directory)
    const stdout: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--a11y"],
        cwd: directory,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("templates         1")
    expect(stdout.join("")).toContain("basic-react-tailwind")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --a11y rejects hardcoded template English outside i18n files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
  try {
    await writeAccessibilityFixture(directory, {
      appSource: [
        "import { templateMessages } from './messages'",
        "export function App() {",
        "  return <button>Open window</button>",
        "}"
      ].join("\n")
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--a11y"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("AccessibilityGateEvidenceError")
    expect(stderr.join("")).toContain("hardcoded user-visible English")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --a11y rejects contrast below the WCAG floor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
  try {
    const manifest = accessibilityManifestFixture()
    if (!isAccessibilityManifestFixture(manifest)) {
      throw new Error("invalid accessibility manifest fixture")
    }
    await writeAccessibilityFixture(directory, {
      manifest: {
        ...manifest,
        templates: manifest.templates.map((template) => ({
          ...template,
          contrastPairs: [
            {
              id: "bad-body",
              foreground: "#777777",
              background: "#888888",
              minimumRatio: 4.5
            }
          ]
        }))
      }
    })
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--a11y"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("AccessibilityGateEvidenceError")
    expect(stderr.join("")).toContain("contrast ratio")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("semver guard verifies additive release posture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
  try {
    await writeSemverFixture(directory)
    const report = await Effect.runPromise(
      runSemverGuard({
        cwd: directory,
        publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
      })
    )

    expect(report.passed).toBe(true)
    expect(report.appendixCRows).toHaveLength(4)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("semver guard rejects missing Appendix C rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
  try {
    const manifest = semverManifestFixture()
    if (!isSemverManifestFixture(manifest)) {
      throw new Error("invalid semver manifest fixture")
    }
    await writeSemverFixture(directory, {
      manifest: { ...manifest, appendixCRows: ["C.54", "C.404"] }
    })
    const exit = await Effect.runPromiseExit(
      runSemverGuard({
        cwd: directory,
        publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
      })
    )

    expect(exit._tag).toBe("Failure")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("semver guard allows additive public API changes and blocks removals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
  try {
    await writeSemverFixture(directory)
    const additive = await Effect.runPromise(
      runSemverGuard({
        cwd: directory,
        publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
      })
    )
    expect(additive.passed).toBe(true)

    const removalExit = await Effect.runPromiseExit(
      runSemverGuard({
        cwd: directory,
        publicApiCheck: () => Effect.succeed(publicApiReportFixture("removed"))
      })
    )
    expect(removalExit._tag).toBe("Failure")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("semver guard rejects additive public API changes in patch releases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
  try {
    const manifest = semverManifestFixture()
    if (!isSemverManifestFixture(manifest)) {
      throw new Error("invalid semver manifest fixture")
    }
    await writeSemverFixture(directory, {
      manifest: { ...manifest, release: "1.1.1", releaseKind: "patch" }
    })

    const exit = await Effect.runPromiseExit(
      runSemverGuard({
        cwd: directory,
        publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
      })
    )

    expect(exit._tag).toBe("Failure")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("semver guard rejects release kind drift from the semantic version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
  try {
    const manifest = semverManifestFixture()
    if (!isSemverManifestFixture(manifest)) {
      throw new Error("invalid semver manifest fixture")
    }
    await writeSemverFixture(directory, {
      manifest: { ...manifest, release: "1.1.1", releaseKind: "minor" }
    })

    const exit = await Effect.runPromiseExit(
      runSemverGuard({
        cwd: directory,
        publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
      })
    )

    expect(exit._tag).toBe("Failure")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop sign signs macOS app bundle with hardened runtime entitlements", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
  try {
    await writePlaygroundFixture(directory, {
      signing: {
        macos: { identity: "Developer ID Application: Example Inc.", teamId: "ABCD1234" }
      },
      security: {
        permissions: ["device.camera", "network.client"]
      }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "app")
    const calls: string[] = []
    const runner: SignCommandRunner = (invocation) => {
      calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
      return Effect.void
    }

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["sign", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        now: fixedClock([100, 125, 200, 230, 300, 330, 400, 430]),
        signCommandRunner: runner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "macos")
    const artifactRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.app")
    const entitlements = await readFile(
      join(artifactRoot, "effect-desktop-entitlements.plist"),
      "utf8"
    )
    const report = JSON.parse(await readFile(join(outputRoot, "sign-report.json"), "utf8")) as {
      readonly artifacts: readonly [{ readonly signedPaths: readonly string[] }]
    }

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("Effect Desktop sign")
    expect(entitlements).toContain("<key>com.apple.security.cs.allow-jit</key>")
    expect(entitlements).toContain("<key>com.apple.security.device.camera</key>")
    expect(entitlements).toContain("<key>com.apple.security.device.microphone</key>\n  <false/>")
    expect(calls.at(-1)).toContain("codesign --force --sign Developer ID Application: Example Inc.")
    expect(calls.at(-1)).toContain("--options runtime --entitlements")
    expect(report.artifacts[0]?.signedPaths).toHaveLength(4)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop sign fails macOS signing without a Developer ID identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
  try {
    await writePlaygroundFixture(directory)
    await writePackagedArtifactFixture(directory, "macos-arm64", "app")
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["sign", "--config", "apps/playground/desktop.config.ts", "--json"],
        cwd: directory,
        hostTarget: "macos-arm64",
        signCommandRunner: () => Effect.die("sign runner should not run without identity"),
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    const error = JSON.parse(stderr.join("")) as { readonly tag: string; readonly message: string }
    expect(exitCode).toBe(1)
    expect(error.tag).toBe("SignConfigError")
    expect(error.message).toContain("signing.macos.identity")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop sign Authenticode-signs Windows MSI with RFC 3161 timestamp", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
  try {
    await writePlaygroundFixture(directory, {
      signing: {
        windows: { thumbprint: "a1b2c3d4", timestampUrl: "http://timestamp.digicert.com" }
      }
    })
    await writePackagedArtifactFixture(directory, "windows-x64", "msi")
    const calls: string[] = []
    const runner: SignCommandRunner = (invocation) => {
      calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
      return Effect.void
    }

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["sign", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "windows-x64",
        signCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(calls[0]).toContain("windows-unblock:powershell")
    expect(calls[0]).toContain("Unblock-File")
    expect(calls[1]).toContain("windows-authenticode:signtool sign /fd SHA256")
    expect(calls[1]).toContain("/tr http://timestamp.digicert.com /td SHA256 /sha1 a1b2c3d4")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop sign resolves Windows PFX password env without recording the secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
  const previousPassword = process.env["EFFECT_DESKTOP_TEST_PFX_PASSWORD"]
  try {
    process.env["EFFECT_DESKTOP_TEST_PFX_PASSWORD"] = "secret-password"
    await writePlaygroundFixture(directory, {
      signing: {
        windows: {
          pfx: { path: "certs/release.pfx", passwordEnv: "EFFECT_DESKTOP_TEST_PFX_PASSWORD" }
        }
      }
    })
    await writePackagedArtifactFixture(directory, "windows-x64", "msi")
    let signArgs: readonly string[] = []
    const runner: SignCommandRunner = (invocation) => {
      if (invocation.step === "windows-authenticode") {
        signArgs = invocation.args
      }
      return Effect.void
    }

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["sign", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "windows-x64",
        signCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    const report = await readFile(
      join(directory, "apps", "playground", "dist", "desktop", "windows", "sign-report.json"),
      "utf8"
    )

    expect(exitCode).toBe(0)
    expect(signArgs).toContain("secret-password")
    expect(report).toContain("<redacted>")
    expect(report).not.toContain("secret-password")
  } finally {
    if (previousPassword === undefined) {
      delete process.env["EFFECT_DESKTOP_TEST_PFX_PASSWORD"]
    } else {
      process.env["EFFECT_DESKTOP_TEST_PFX_PASSWORD"] = previousPassword
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop sign GPG-signs Linux AppImage and writes Linux metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
  try {
    await writePlaygroundFixture(directory, { signing: { linux: { gpgKey: "ABCD1234" } } })
    const artifactPath = await writePackagedArtifactFixture(directory, "linux-x64", "appimage")
    const calls: string[] = []
    const runner: SignCommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
        const outputPath = invocation.args[invocation.args.indexOf("--output") + 1]
        if (typeof outputPath === "string") {
          yield* Effect.promise(() => writeFile(outputPath, "signature"))
        }
      })

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["sign", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "linux-x64",
        signCommandRunner: runner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const artifactRoot = dirname(artifactPath)
    const metainfo = await readFile(
      join(artifactRoot, "share", "metainfo", "dev.effect-desktop.playground.metainfo.xml"),
      "utf8"
    )
    const desktop = await readFile(
      join(artifactRoot, "share", "applications", "dev.effect-desktop.playground.desktop"),
      "utf8"
    )

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("appimage")
    expect(calls[0]).toContain("linux-gpg:gpg --batch --yes --armor --detach-sign")
    expect(calls[0]).toContain("--local-user ABCD1234")
    expect(await readFile(`${artifactPath}.asc`, "utf8")).toBe("signature")
    expect(metainfo).toContain("<id>dev.effect-desktop.playground</id>")
    expect(desktop).toContain("Name=Effect Desktop Playground")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop notarize submits staples and assesses unstapled macOS artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
  try {
    await writePlaygroundFixture(directory, {
      signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
    })
    const appPath = await writePackagedArtifactFixture(directory, "macos-arm64", "app")
    const calls: string[] = []
    const runner: NotarizeCommandRunner = (invocation) => {
      calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
      if (invocation.step === "stapler-validate") {
        return Effect.succeed({ stdout: "", stderr: "ticket not found", exitCode: 65 })
      }
      if (invocation.step === "notarytool-submit") {
        return Effect.succeed({
          stdout: JSON.stringify({ id: "submission-1", status: "Accepted" }),
          stderr: "",
          exitCode: 0
        })
      }
      return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
    }

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["notarize", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        now: fixedClock([100, 110, 200, 220, 300, 330, 400, 440]),
        notarizeCommandRunner: runner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const report = JSON.parse(
      await readFile(
        join(directory, "apps", "playground", "dist", "desktop", "macos", "notarize-report.json"),
        "utf8"
      )
    ) as { readonly artifacts: readonly [{ readonly submissionId: string }] }

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("Effect Desktop notarize")
    expect(calls).toEqual([
      `stapler-validate:xcrun stapler validate ${appPath}`,
      `notarytool-submit:xcrun notarytool submit ${appPath} --wait --output-format json --keychain-profile release-profile`,
      `stapler-staple:xcrun stapler staple ${appPath}`,
      `spctl-assess:spctl --assess --type execute --verbose=4 ${appPath}`
    ])
    expect(report.artifacts[0]?.submissionId).toBe("submission-1")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop notarize is a no-op submit when staple validation already passes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
  try {
    await writePlaygroundFixture(directory, {
      signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
    const calls: string[] = []
    const runner: NotarizeCommandRunner = (invocation) => {
      calls.push(invocation.step)
      return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
    }

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["notarize", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        notarizeCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual(["stapler-validate", "spctl-assess"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop notarize rejects artifact file names outside the metadata directory", async () => {
  const invalidFileNames = [
    "../outside.dmg",
    "nested/artifact.dmg",
    "nested\\artifact.dmg",
    "file:artifact.dmg",
    "artifact\u0000.dmg"
  ] as const

  for (const fileName of invalidFileNames) {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-containment-"))
    try {
      await writePlaygroundFixture(directory, {
        signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
      })
      const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "macos")
      const artifactRoot = join(outputRoot, "artifact-root")
      await mkdir(artifactRoot, { recursive: true })
      await writeFile(join(outputRoot, "outside.dmg"), "outside artifact bytes")
      await writeFile(
        join(artifactRoot, "artifact.json"),
        `${JSON.stringify({ kind: "dmg", target: "macos-arm64", fileName }, null, 2)}\n`
      )
      const calls: string[] = []
      const stderr: string[] = []
      const runner: NotarizeCommandRunner = (invocation) => {
        calls.push(invocation.step)
        return Effect.die("notarization commands should not run for invalid artifact metadata")
      }

      const exitCode = await Effect.runPromise(
        runCli({
          argv: ["notarize", "--config", "apps/playground/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })
      )

      expect(exitCode).toBe(1)
      expect(calls).toEqual([])
      expect(stderr.join("")).toContain("NotarizeConfigError")
      expect(stderr.join("")).toContain("artifact-root")
      expect(stderr.join("")).toContain("artifact.json#fileName")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

test("desktop notarize ignores zip sidecars that stapler cannot staple", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
  try {
    await writePlaygroundFixture(directory, {
      signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "app")
    await writePackagedArtifactFixture(directory, "macos-arm64", "zip")
    const calls: string[] = []
    const runner: NotarizeCommandRunner = (invocation) => {
      calls.push(invocation.step)
      return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
    }

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["notarize", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        notarizeCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    const report = JSON.parse(
      await readFile(
        join(directory, "apps", "playground", "dist", "desktop", "macos", "notarize-report.json"),
        "utf8"
      )
    ) as { readonly artifacts: readonly unknown[] }

    expect(exitCode).toBe(0)
    expect(calls).toEqual(["stapler-validate", "spctl-assess"])
    expect(report.artifacts).toHaveLength(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop notarize redacts Apple ID password credentials in the persisted report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
  const passwordEnv = "EFFECT_DESKTOP_TEST_NOTARY_PASSWORD"
  const previousPassword = process.env[passwordEnv]
  process.env[passwordEnv] = "real-app-specific-password"
  try {
    await writePlaygroundFixture(directory, {
      signing: {
        macos: {
          teamId: "ABCD1234",
          appleId: "release@example.com",
          passwordEnv
        }
      }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "app")
    const calls: string[] = []
    const runner: NotarizeCommandRunner = (invocation) => {
      calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
      if (invocation.step === "stapler-validate") {
        return Effect.succeed({ stdout: "", stderr: "ticket not found", exitCode: 65 })
      }
      if (invocation.step === "notarytool-submit") {
        return Effect.succeed({
          stdout: JSON.stringify({ id: "submission-1", status: "Accepted" }),
          stderr: "",
          exitCode: 0
        })
      }
      return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
    }

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["notarize", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        notarizeCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    const report = JSON.parse(
      await readFile(
        join(directory, "apps", "playground", "dist", "desktop", "macos", "notarize-report.json"),
        "utf8"
      )
    ) as { readonly steps: readonly [{ readonly command?: readonly string[] }] }
    const submitStep = report.steps.find((step) => step.command?.includes("notarytool") === true)

    expect(exitCode).toBe(0)
    expect(calls.join("\n")).toContain("--password real-app-specific-password")
    expect(submitStep?.command).toContain("--password")
    expect(submitStep?.command).toContain("<redacted>")
    expect(submitStep?.command).not.toContain("real-app-specific-password")
  } finally {
    if (previousPassword === undefined) {
      delete process.env[passwordEnv]
    } else {
      process.env[passwordEnv] = previousPassword
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop notarize surfaces rejected notarytool output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
  try {
    await writePlaygroundFixture(directory, {
      signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "app")
    const stderr: string[] = []
    const runner: NotarizeCommandRunner = (invocation) => {
      if (invocation.step === "stapler-validate") {
        return Effect.succeed({ stdout: "", stderr: "ticket not found", exitCode: 65 })
      }
      if (invocation.step === "notarytool-submit") {
        return Effect.succeed({
          stdout: JSON.stringify({ id: "submission-1", status: "Rejected" }),
          stderr: "LogFileURL: https://example.invalid/notary-log.json",
          exitCode: 0
        })
      }
      return Effect.die("staple and assess should not run after rejection")
    }

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["notarize", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        notarizeCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("notarytool returned Rejected")
    expect(stderr.join("")).toContain("https://example.invalid/notary-log.json")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop notarize returns malformed notarytool JSON as a typed failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
  try {
    await writePlaygroundFixture(directory, {
      signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "app")
    const stderr: string[] = []
    const runner: NotarizeCommandRunner = (invocation) => {
      if (invocation.step === "stapler-validate") {
        return Effect.succeed({ stdout: "", stderr: "ticket not found", exitCode: 65 })
      }
      if (invocation.step === "notarytool-submit") {
        return Effect.succeed({ stdout: "not json", stderr: "", exitCode: 0 })
      }
      return Effect.die("staple and assess should not run after malformed notarytool JSON")
    }

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["notarize", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        notarizeCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("failed to parse notarytool JSON output")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop publish writes a byte-stable Ed25519-signed update manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-"))
  const key = testEd25519Key()
  const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
  const previousPrivateKey = process.env[privateKeyEnv]
  process.env[privateKeyEnv] = key.privateKeyPem
  try {
    await writePlaygroundFixture(directory, {
      update: {
        channel: "stable",
        feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
        publicKey: key.publicKey,
        privateKeyEnv,
        keyVersion: 5,
        minVersion: "0.0.0"
      }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "dmg")

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["publish", "--config", "apps/playground/desktop.config.ts", "--json"],
        cwd: directory,
        now: () => 1_772_923_200_000,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const manifestPath = join(
      directory,
      "apps",
      "playground",
      "dist",
      "desktop",
      "update-manifest.json"
    )
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as UpdateManifest
    const report = JSON.parse(stdout.join("")) as { readonly manifestPath: string }

    expect(exitCode).toBe(0)
    expect(report.manifestPath).toBe(manifestPath)
    expect(verifyUpdateManifest(manifest, key.publicKey)).toBe(true)
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      appId: "dev.effect-desktop.playground",
      version: "0.0.0",
      channel: "stable",
      keyVersion: 5,
      publishedAt: "2026-03-07T22:40:00.000Z",
      minVersion: "0.0.0"
    })
    expect(manifest.artifacts).toHaveLength(1)
    expect(manifest.artifacts[0]).toMatchObject({
      platform: "macos-arm64",
      kind: "dmg",
      url: "https://updates.example.invalid/macos-arm64/Effect-Desktop-Playground-0.0.0-macos-arm64.dmg",
      signature: expect.stringContaining("ed25519:")
    })
  } finally {
    if (previousPrivateKey === undefined) {
      delete process.env[privateKeyEnv]
    } else {
      process.env[privateKeyEnv] = previousPrivateKey
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop publish canonical bytes ignore object insertion order", async () => {
  const manifest = {
    signature: "ed25519:signature",
    version: "1.0.0",
    schemaVersion: 1,
    publishedAt: "2026-05-06T00:00:00.000Z",
    keyVersion: 2,
    channel: "stable",
    artifacts: [
      {
        signature: "ed25519:artifact",
        sha256: "0".repeat(64),
        sizeBytes: 1,
        url: "https://updates.example.invalid/app.dmg",
        kind: "dmg",
        platform: "macos-arm64"
      }
    ],
    appId: "dev.effect-desktop.playground"
  }
  const reordered = {
    appId: manifest.appId,
    artifacts: manifest.artifacts,
    channel: manifest.channel,
    keyVersion: manifest.keyVersion,
    publishedAt: manifest.publishedAt,
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    signature: manifest.signature
  }

  expect(canonicalUpdateManifestBytes(manifest)).toBe(canonicalUpdateManifestBytes(reordered))
})

test("desktop publish rejects tampered manifest signatures through canonical bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-"))
  const key = testEd25519Key()
  const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
  const previousPrivateKey = process.env[privateKeyEnv]
  process.env[privateKeyEnv] = key.privateKeyPem
  try {
    await writePlaygroundFixture(directory, {
      update: {
        channel: "stable",
        feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
        publicKey: key.publicKey,
        privateKeyEnv,
        keyVersion: 5
      }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "dmg")

    await Effect.runPromise(
      runCli({
        argv: ["publish", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        now: () => 1_772_923_200_000,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    const manifest = JSON.parse(
      await readFile(
        join(directory, "apps", "playground", "dist", "desktop", "update-manifest.json"),
        "utf8"
      )
    ) as UpdateManifest
    const tampered = { ...manifest, version: "9.9.9" }

    expect(verifyUpdateManifest(manifest, key.publicKey)).toBe(true)
    expect(verifyUpdateManifest(tampered, key.publicKey)).toBe(false)
  } finally {
    if (previousPrivateKey === undefined) {
      delete process.env[privateKeyEnv]
    } else {
      process.env[privateKeyEnv] = previousPrivateKey
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop publish rejects stale package metadata before signing the manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-"))
  const key = testEd25519Key()
  const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
  const previousPrivateKey = process.env[privateKeyEnv]
  process.env[privateKeyEnv] = key.privateKeyPem
  try {
    await writePlaygroundFixture(directory, {
      update: {
        channel: "stable",
        feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
        publicKey: key.publicKey,
        privateKeyEnv,
        keyVersion: 5
      }
    })
    const artifactPath = await writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
    await writeFile(
      join(dirname(artifactPath), "artifact.json"),
      `${JSON.stringify(
        {
          kind: "dmg",
          target: "macos-arm64",
          fileName: "Effect-Desktop-Playground-0.0.0-macos-arm64.dmg",
          sizeBytes: 1,
          sha256: "0".repeat(64)
        },
        null,
        2
      )}\n`
    )
    const stderr: string[] = []

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["publish", "--config", "apps/playground/desktop.config.ts", "--json"],
        cwd: directory,
        now: () => 1_772_923_200_000,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("PublishConfigError")
    expect(stderr.join("")).toContain("package artifact metadata does not match artifact bytes")
  } finally {
    if (previousPrivateKey === undefined) {
      delete process.env[privateKeyEnv]
    } else {
      process.env[privateKeyEnv] = previousPrivateKey
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop publish rejects invalid feedUrl", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-invalid-feed-url-"))
  const key = testEd25519Key()
  const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
  const previousPrivateKey = process.env[privateKeyEnv]
  process.env[privateKeyEnv] = key.privateKeyPem
  try {
    await writePlaygroundFixture(directory, {
      update: {
        channel: "stable",
        feedUrl: "not-a-url",
        publicKey: key.publicKey,
        privateKeyEnv,
        keyVersion: 5
      }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["publish", "--config", "apps/playground/desktop.config.ts", "--json"],
        cwd: directory,
        now: () => 1_772_923_200_000,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )
    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("update.feedUrl")
    expect(stderr.join("")).toContain("valid http(s) URL template")
  } finally {
    if (previousPrivateKey === undefined) {
      delete process.env[privateKeyEnv]
    } else {
      process.env[privateKeyEnv] = previousPrivateKey
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop publish rejects artifact target mismatching platform directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-target-mismatch-"))
  const key = testEd25519Key()
  const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
  const previousPrivateKey = process.env[privateKeyEnv]
  process.env[privateKeyEnv] = key.privateKeyPem
  try {
    await writePlaygroundFixture(directory, {
      update: {
        channel: "stable",
        feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
        publicKey: key.publicKey,
        privateKeyEnv,
        keyVersion: 5
      }
    })
    const artifactPath = await writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
    const artifactJsonPath = join(dirname(artifactPath), "artifact.json")
    const artifactJson = JSON.parse(await readFile(artifactJsonPath, "utf8")) as Record<
      string,
      unknown
    >
    artifactJson["target"] = "linux-x64"
    await writeFile(artifactJsonPath, `${JSON.stringify(artifactJson, null, 2)}\n`)

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["publish", "--config", "apps/playground/desktop.config.ts", "--json"],
        cwd: directory,
        now: () => 1_772_923_200_000,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )
    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("does not match platform directory")
  } finally {
    if (previousPrivateKey === undefined) {
      delete process.env[privateKeyEnv]
    } else {
      process.env[privateKeyEnv] = previousPrivateKey
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop publish signs macOS app directory artifacts with deterministic directory digests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-"))
  const key = testEd25519Key()
  const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
  const previousPrivateKey = process.env[privateKeyEnv]
  process.env[privateKeyEnv] = key.privateKeyPem
  try {
    await writePlaygroundFixture(directory, {
      update: {
        channel: "stable",
        feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
        publicKey: key.publicKey,
        privateKeyEnv,
        keyVersion: 5
      }
    })
    await writePackagedArtifactFixture(directory, "macos-arm64", "app")

    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "publish",
          "--config",
          "apps/playground/desktop.config.ts",
          "--platform",
          "macos-arm64"
        ],
        cwd: directory,
        now: () => 1_772_923_200_000,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    const manifest = JSON.parse(
      await readFile(
        join(directory, "apps", "playground", "dist", "desktop", "update-manifest.json"),
        "utf8"
      )
    ) as UpdateManifest

    expect(exitCode).toBe(0)
    expect(manifest.artifacts).toHaveLength(1)
    expect(verifyUpdateManifest(manifest, key.publicKey)).toBe(true)
    expect(manifest.artifacts[0]).toMatchObject({
      platform: "macos-arm64",
      kind: "app",
      signature: expect.stringContaining("ed25519:")
    })
  } finally {
    if (previousPrivateKey === undefined) {
      delete process.env[privateKeyEnv]
    } else {
      process.env[privateKeyEnv] = previousPrivateKey
    }
    await rm(directory, { recursive: true, force: true })
  }
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
          const entryPath = invocation.args[1]
          if (outdir !== undefined && entryPath !== undefined) {
            const entryBase = basename(entryPath)
            const outputFile = entryBase.replace(/\.tsx?$/, ".js")
            yield* Effect.promise(() => mkdir(outdir, { recursive: true }))
            yield* Effect.promise(() => writeFile(join(outdir, outputFile), "console.log('ok')\n"))
          }
        }
        if (invocation.step === "native-host") {
          yield* Effect.promise(() =>
            mkdir(join(invocation.cwd, "target", "release"), { recursive: true })
          )
          yield* Effect.promise(() =>
            writeFile(join(invocation.cwd, "target", "release", "host"), "host")
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
      "native-host:cargo build -p host --release"
    ])
    expect(await readFile(join(layout, "renderer", "index.html"), "utf8")).toBe("<h1>ok</h1>")
    expect(await readFile(join(layout, "runtime", "runtime.js"), "utf8")).toContain("ok")
    expect(appManifest).toMatchObject({
      runtime: { entry: "runtime/runtime.js" }
    })
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

test("desktop build rejects missing runtime.entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-build-missing-runtime-entry-"))
  try {
    await writePlaygroundFixture(directory, { runtime: {} })
    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["build", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "linux-x64",
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )
    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("runtime.entry is required")
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

test("desktop package --help exits zero with usage", async () => {
  const stdout: string[] = []
  const exitCode = await Effect.runPromise(
    runCli({
      argv: ["package", "--help"],
      cwd: process.cwd(),
      packageCommandRunner: () => Effect.die("package runner should not run for help"),
      writeStdout: (text) => {
        stdout.push(text)
      },
      writeStderr: () => {}
    })
  )

  expect(exitCode).toBe(0)
  expect(stdout.join("")).toContain("Usage: desktop package")
})

test("desktop package emits macOS app dmg zip artifacts with metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "macos-arm64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "macos")
    const calls: string[] = []
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
        const output = invocation.args.at(-1)
        if (output !== undefined) {
          yield* Effect.promise(() => writeFile(output, invocation.step))
        }
      })

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["package", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        now: fixedClock([100, 120, 200, 230, 300, 340]),
        packageCommandRunner: runner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const appRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.app")
    const dmgRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.dmg")
    const zipRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.zip")
    const appMetadata = JSON.parse(await readFile(join(appRoot, "artifact.json"), "utf8")) as {
      readonly kind: string
      readonly sha256: string
    }

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("Effect Desktop package")
    expect(calls).toEqual([
      `macos-dmg:hdiutil create -srcFolder ${join(appRoot, "Effect-Desktop-Playground.app")} -o ${join(dmgRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.dmg")}`,
      `macos-zip:ditto -c -k --keepParent ${join(appRoot, "Effect-Desktop-Playground.app")} ${join(zipRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.zip")}`
    ])
    expect(
      await readFile(
        join(appRoot, "Effect-Desktop-Playground.app", "Contents", "Info.plist"),
        "utf8"
      )
    ).toContain("dev.effect-desktop.playground")
    expect(appMetadata.kind).toBe("app")
    expect(appMetadata.sha256).toHaveLength(64)
    expect(await readFile(join(dmgRoot, "checksums.txt"), "utf8")).toContain(".dmg")
    expect(await readFile(join(zipRoot, "checksums.txt"), "utf8")).toContain(".zip")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package stages macOS app bundle before explicit dmg artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-dmg-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "macos-arm64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "macos")
    const appRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.app")
    const appBundle = join(appRoot, "Effect-Desktop-Playground.app")
    const dmgRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.dmg")
    const dmgPath = join(dmgRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.dmg")
    const calls: string[] = []
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
        yield* Effect.promise(() => writeFile(dmgPath, invocation.step))
      })

    const report = await Effect.runPromise(
      runDesktopPackage({
        cwd: directory,
        configPath: "apps/playground/desktop.config.ts",
        platform: undefined,
        artifact: "dmg",
        commandRunner: runner,
        now: fixedClock([100, 120, 200, 230]),
        hostTarget: "macos-arm64"
      })
    )

    expect(report.steps.map((step) => step.name)).toEqual(["macos-app", "macos-dmg", "metadata"])
    expect(calls).toEqual([`macos-dmg:hdiutil create -srcFolder ${appBundle} -o ${dmgPath}`])
    expect(await readFile(join(appBundle, "Contents", "Info.plist"), "utf8")).toContain(
      "dev.effect-desktop.playground"
    )
    expect(report.artifacts.map((artifact) => artifact.kind)).toEqual(["dmg"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package stages macOS app bundle before explicit zip artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-zip-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "macos-arm64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "macos")
    const appRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.app")
    const appBundle = join(appRoot, "Effect-Desktop-Playground.app")
    const zipRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.zip")
    const zipPath = join(zipRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.zip")
    const calls: string[] = []
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
        yield* Effect.promise(() => writeFile(zipPath, invocation.step))
      })

    const report = await Effect.runPromise(
      runDesktopPackage({
        cwd: directory,
        configPath: "apps/playground/desktop.config.ts",
        platform: undefined,
        artifact: "zip",
        commandRunner: runner,
        now: fixedClock([100, 120, 200, 230]),
        hostTarget: "macos-arm64"
      })
    )

    expect(report.steps.map((step) => step.name)).toEqual(["macos-app", "macos-zip", "metadata"])
    expect(calls).toEqual([`macos-zip:ditto -c -k --keepParent ${appBundle} ${zipPath}`])
    expect(await readFile(join(appBundle, "Contents", "Info.plist"), "utf8")).toContain(
      "dev.effect-desktop.playground"
    )
    expect(report.artifacts.map((artifact) => artifact.kind)).toEqual(["zip"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package emits Linux AppImage deb rpm artifacts with metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "linux-x64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "linux")
    const artifactPaths = {
      appimage: join(
        outputRoot,
        "Effect-Desktop-Playground-0.0.0-linux-x64.AppImage",
        "Effect-Desktop-Playground-0.0.0-linux-x64.AppImage"
      ),
      deb: join(
        outputRoot,
        "Effect-Desktop-Playground-0.0.0-linux-x64.deb",
        "Effect-Desktop-Playground-0.0.0-linux-x64.deb"
      ),
      rpm: join(
        outputRoot,
        "Effect-Desktop-Playground-0.0.0-linux-x64.rpm",
        "Effect-Desktop-Playground-0.0.0-linux-x64.rpm"
      )
    } as const
    const calls: string[] = []
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command}`)
        if (invocation.step === "linux-appimage") {
          yield* Effect.promise(() => writeFile(artifactPaths.appimage, "appimage"))
        }
        if (invocation.step === "linux-deb") {
          yield* Effect.promise(() => writeFile(artifactPaths.deb, "deb"))
        }
        if (invocation.step === "linux-rpm") {
          yield* Effect.promise(() => writeFile(artifactPaths.rpm, "rpm"))
        }
      })

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["package", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "linux-x64",
        packageCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    const appImageRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-linux-x64.AppImage")
    const debMetadata = JSON.parse(
      await readFile(
        join(outputRoot, "Effect-Desktop-Playground-0.0.0-linux-x64.deb", "artifact.json"),
        "utf8"
      )
    ) as {
      readonly kind: string
      readonly sizeBytes: number
      readonly linuxIntegration?: {
        readonly desktopFile: string
        readonly appStreamId: string
        readonly flatpakAppId: string
        readonly snapName: string
      }
    }

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      "linux-appimage:appimagetool",
      "linux-deb:dpkg-deb",
      "linux-rpm:rpmbuild"
    ])
    expect(debMetadata).toMatchObject({ kind: "deb", sizeBytes: 3 })
    expect(debMetadata.linuxIntegration).toEqual({
      desktopFile: "dev.effect-desktop.playground.desktop",
      appStreamId: "dev.effect-desktop.playground.metainfo.xml",
      flatpakAppId: "dev.effect-desktop.playground",
      snapName: "dev.effect-desktop.playground"
    })
    expect(
      await readFile(
        join(
          appImageRoot,
          "Effect-Desktop-Playground.AppDir",
          "share",
          "applications",
          "dev.effect-desktop.playground.desktop"
        ),
        "utf8"
      )
    ).toContain("X-Flatpak=dev.effect-desktop.playground")
    expect(
      await readFile(
        join(appImageRoot, "Effect-Desktop-Playground.AppDir", "share", "snap", "snapcraft.yaml"),
        "utf8"
      )
    ).toContain("name: dev.effect-desktop.playground")
    expect(
      await readFile(
        join(outputRoot, "Effect-Desktop-Playground-0.0.0-linux-x64.rpm", "checksums.txt"),
        "utf8"
      )
    ).toContain(".rpm")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package maps linux arm64 RPM metadata to aarch64", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "linux-arm64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "linux")
    const rpmPath = join(
      outputRoot,
      "Effect-Desktop-Playground-0.0.0-linux-arm64.rpm",
      "Effect-Desktop-Playground-0.0.0-linux-arm64.rpm"
    )
    let spec = ""
    let args: readonly string[] = []
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        args = invocation.args
        const specPath = invocation.args[1]
        if (typeof specPath === "string") {
          spec = yield* Effect.promise(() => readFile(specPath, "utf8"))
        }
        yield* Effect.promise(() => writeFile(rpmPath, "rpm"))
      })

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["package", "--config", "apps/playground/desktop.config.ts", "--artifact", "rpm"],
        cwd: directory,
        hostTarget: "linux-arm64",
        packageCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(spec).toContain("BuildArch: aarch64")
    expect(args).toContain("_rpmfilename Effect-Desktop-Playground-0.0.0-linux-arm64.rpm")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package emits Windows per-user MSI with app-specific UpgradeCode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "windows-x64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "windows")
    const msiPath = join(
      outputRoot,
      "Effect-Desktop-Playground-0.0.0-windows-x64.msi",
      "Effect-Desktop-Playground-0.0.0-windows-x64.msi"
    )
    let wxs = ""
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        const wxsPath = invocation.args[1]
        if (typeof wxsPath === "string") {
          wxs = yield* Effect.promise(() => readFile(wxsPath, "utf8"))
        }
        yield* Effect.promise(() => writeFile(msiPath, "msi"))
      })

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["package", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "windows-x64",
        packageCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(wxs).toContain('Scope="perUser"')
    expect(wxs).toContain('<ComponentGroupRef Id="StartMenuShortcuts" />')
    expect(wxs).toContain('<StandardDirectory Id="ProgramMenuFolder">')
    expect(wxs).toContain(
      '<Directory Id="ApplicationProgramsFolder" Name="Effect Desktop Playground" />'
    )
    expect(wxs).toContain(
      '<Shortcut Id="ApplicationStartMenuShortcut" Name="Effect Desktop Playground" Description="Effect Desktop Playground" Target="[INSTALLFOLDER]native\\host.exe" WorkingDirectory="INSTALLFOLDER" />'
    )
    expect(wxs).toContain(
      '<RemoveFolder Id="RemoveApplicationProgramsFolder" Directory="ApplicationProgramsFolder" On="uninstall" />'
    )
    expect(wxs).not.toContain("00000000-0000-0000-0000-000000000064")
    expect(wxs).toMatch(
      /UpgradeCode="[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/
    )
    expect(wxs).toMatch(
      /<Component Id="StartMenuShortcut" Guid="[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}">/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package rejects Windows system-mode MSI as deferred scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "windows-x64")
    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "package",
          "--config",
          "apps/playground/desktop.config.ts",
          "--artifact",
          "system-msi"
        ],
        cwd: directory,
        hostTarget: "windows-x64",
        packageCommandRunner: () => Effect.void,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("PackageUnsupportedArtifactError")
    expect(stderr.join("")).toContain("deferred to v1.1")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const writePlaygroundFixture = async (
  directory: string,
  extraConfig: Record<string, unknown> = {}
): Promise<void> => {
  const appRoot = join(directory, "apps", "playground")
  const config = {
    app: {
      id: "dev.effect-desktop.playground",
      name: "Effect Desktop Playground",
      version: "0.0.0"
    },
    runtime: { entry: "runtime.ts" },
    renderer: { dist: "dist" },
    ...extraConfig
  }
  await mkdir(appRoot, { recursive: true })
  await writeFile(
    join(appRoot, "desktop.config.ts"),
    `export default ${JSON.stringify(config, null, 2)} as const\n`
  )
  await writeFile(join(appRoot, "package.json"), '{"type":"module"}\n')
  await writeFile(join(appRoot, "runtime.ts"), "console.log('runtime')\n")
  await mkdir(join(directory, "target", "debug"), { recursive: true })
}

const writeBuildLayoutFixture = async (
  directory: string,
  target: "linux-arm64" | "linux-x64" | "macos-arm64" | "windows-x64"
): Promise<void> => {
  const layout = join(directory, "apps", "playground", "build", "effect-desktop", target)
  const hostBinary = target.startsWith("windows-") ? "host.exe" : "host"
  await mkdir(join(layout, "renderer"), { recursive: true })
  await mkdir(join(layout, "runtime"), { recursive: true })
  await mkdir(join(layout, "native"), { recursive: true })
  await writeFile(join(layout, "renderer", "index.html"), "<h1>ok</h1>")
  await writeFile(join(layout, "runtime", "main.js"), "console.log('runtime')\n")
  await writeFile(join(layout, "native", hostBinary), "host")
  await writeFile(
    join(layout, "app-manifest.json"),
    `${JSON.stringify(
      {
        id: "dev.effect-desktop.playground",
        name: "Effect Desktop Playground",
        version: "0.0.0",
        target,
        renderer: { path: "renderer" },
        runtime: { entry: "runtime/main.js" },
        nativeHost: { binary: `native/${hostBinary}` }
      },
      null,
      2
    )}\n`
  )
}

const writePackagedArtifactFixture = async (
  directory: string,
  target: "linux-x64" | "macos-arm64" | "windows-x64",
  kind: "app" | "appimage" | "dmg" | "msi" | "zip"
): Promise<string> => {
  const platform = target.startsWith("macos-")
    ? "macos"
    : target.startsWith("windows-")
      ? "windows"
      : "linux"
  const extension = kind === "appimage" ? "AppImage" : kind
  const root = join(
    directory,
    "apps",
    "playground",
    "dist",
    "desktop",
    platform,
    `Effect-Desktop-Playground-0.0.0-${target}.${extension}`
  )
  const fileName =
    kind === "app"
      ? "Effect-Desktop-Playground.app"
      : `Effect-Desktop-Playground-0.0.0-${target}.${extension}`
  const artifactPath = join(root, fileName)
  if (kind === "app") {
    await mkdir(join(artifactPath, "Contents", "MacOS"), { recursive: true })
    await mkdir(join(artifactPath, "Contents", "Resources", "effect-desktop", "native"), {
      recursive: true
    })
    await mkdir(join(artifactPath, "Contents", "Resources", "effect-desktop", "runtime"), {
      recursive: true
    })
    await writeFile(join(artifactPath, "Contents", "MacOS", "Effect-Desktop-Playground"), "host")
    await writeFile(
      join(artifactPath, "Contents", "Resources", "effect-desktop", "native", "host"),
      "host"
    )
    await writeFile(
      join(artifactPath, "Contents", "Resources", "effect-desktop", "runtime", "main.js"),
      "runtime"
    )
  } else {
    await mkdir(root, { recursive: true })
    await writeFile(artifactPath, kind)
  }
  const digest = await digestArtifactFixture(artifactPath)
  await writeFile(
    join(root, "artifact.json"),
    `${JSON.stringify({ kind, target, fileName, ...digest }, null, 2)}\n`
  )
  return artifactPath
}

const digestArtifactFixture = async (
  path: string
): Promise<{ readonly sizeBytes: number; readonly sha256: string }> => {
  const pathStat = await stat(path)
  if (!pathStat.isDirectory()) {
    const bytes = await readFile(path)
    return {
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }
  }
  const files = await listFixtureFiles(path)
  const hash = createHash("sha256")
  let sizeBytes = 0
  for (const file of files) {
    const rel = relative(path, file)
    const content = await readFile(file)
    sizeBytes += content.byteLength
    hash.update(rel)
    hash.update("\0")
    hash.update(content)
    hash.update("\0")
  }
  return { sizeBytes, sha256: hash.digest("hex") }
}

const listFixtureFiles = async (path: string): Promise<readonly string[]> => {
  const entries = await readdir(path)
  const files: string[] = []
  for (const entry of entries.toSorted()) {
    const child = join(path, entry)
    const childStat = await stat(child)
    if (childStat.isDirectory()) {
      files.push(...(await listFixtureFiles(child)))
    } else {
      files.push(child)
    }
  }
  return files
}

const writeApiFixturePackage = async (root: string, source: string): Promise<void> => {
  const packageRoot = join(root, "packages", "fixture")
  await mkdir(join(packageRoot, "src"), { recursive: true })
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "@effect-desktop/fixture",
        type: "module",
        exports: {
          ".": {
            types: "./src/index.ts",
            default: "./src/index.ts"
          }
        }
      },
      null,
      2
    )
  )
  await writeFile(
    join(packageRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: []
        },
        include: ["src"]
      },
      null,
      2
    )
  )
  await writeFile(join(packageRoot, "src", "index.ts"), source)
}

const writeDocsFixture = async (
  root: string,
  pages: Readonly<Record<string, string>>
): Promise<void> => {
  await writeDocsManifest(
    root,
    Object.keys(pages).map((path) => ({
      id: "installation",
      title: "Installation",
      path
    }))
  )
  for (const [path, body] of Object.entries(pages)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), body)
  }
}

const writeDocsManifest = async (
  root: string,
  pages: readonly { readonly id: string; readonly title: string; readonly path: string }[]
): Promise<void> => {
  await mkdir(join(root, "docs"), { recursive: true })
  await writeFile(
    join(root, "docs", "docs-manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        source: "test",
        pages
      },
      null,
      2
    )
  )
}

const writeReleaseFixture = async (
  root: string,
  overrides: {
    readonly checklist?: unknown
    readonly ciWorkflow?: string
    readonly releaseWorkflow?: string
    readonly keyManagement?: string
    readonly releaseSettings?: string
  } = {}
): Promise<void> => {
  await mkdir(join(root, "release"), { recursive: true })
  await mkdir(join(root, ".github", "workflows"), { recursive: true })
  await mkdir(join(root, "docs", "security"), { recursive: true })
  await writeFile(
    join(root, "release", "checklist.json"),
    JSON.stringify(overrides.checklist ?? releaseChecklistFixture(), null, 2)
  )
  await writeFile(
    join(root, ".github", "workflows", "ci.yml"),
    overrides.ciWorkflow ?? ciWorkflowFixture()
  )
  await writeFile(
    join(root, ".github", "workflows", "release.yml"),
    overrides.releaseWorkflow ?? releaseWorkflowFixture()
  )
  await writeFile(
    join(root, "docs", "security", "key-management.md"),
    overrides.keyManagement ?? keyManagementFixture()
  )
  await writeFile(
    join(root, "docs", "security", "release-settings.md"),
    overrides.releaseSettings ?? releaseSettingsFixture()
  )
}

const writeAccessibilityFixture = async (
  root: string,
  overrides: {
    readonly manifest?: unknown
    readonly appSource?: string
    readonly styles?: string
    readonly messages?: string
    readonly manualAudit?: string
  } = {}
): Promise<void> => {
  const auditRoot = join(root, "docs", "audits", "v1.0.0", "basic-react-tailwind")
  const sourceRoot = join(root, "templates", "basic-react-tailwind", "src")
  await mkdir(join(root, "release"), { recursive: true })
  await mkdir(auditRoot, { recursive: true })
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(
    join(root, "release", "accessibility.json"),
    JSON.stringify(overrides.manifest ?? accessibilityManifestFixture(), null, 2)
  )
  await writeFile(join(sourceRoot, "App.tsx"), overrides.appSource ?? accessibilityAppFixture())
  await writeFile(join(sourceRoot, "styles.css"), overrides.styles ?? accessibilityStylesFixture())
  await writeFile(
    join(sourceRoot, "messages.ts"),
    overrides.messages ?? accessibilityMessagesFixture()
  )
  await writeFile(
    join(auditRoot, "manual-keyboard.md"),
    overrides.manualAudit ?? accessibilityManualAuditFixture()
  )
  await writeFile(join(auditRoot, "keyboard-walkthrough.webm"), "fixture screencast\n")
  for (const mode of ["light-ltr", "dark-ltr", "light-rtl", "dark-rtl"]) {
    await writeFile(
      join(auditRoot, `axe.${mode}.json`),
      JSON.stringify(axeAuditFixture(mode), null, 2)
    )
    await writeFile(
      join(auditRoot, `pa11y.${mode}.json`),
      JSON.stringify(pa11yAuditFixture(mode), null, 2)
    )
  }
}

const accessibilityManifestFixture = (): unknown => ({
  schemaVersion: 1,
  source: "docs/SPEC.md §25.5",
  release: "v1.0.0",
  templates: [
    {
      id: "basic-react-tailwind",
      root: "templates/basic-react-tailwind",
      sourceFiles: [
        "templates/basic-react-tailwind/src/App.tsx",
        "templates/basic-react-tailwind/src/messages.ts",
        "templates/basic-react-tailwind/src/styles.css"
      ],
      i18nFiles: ["templates/basic-react-tailwind/src/messages.ts"],
      auditDir: "docs/audits/v1.0.0/basic-react-tailwind",
      auditModes: [
        {
          id: "light-ltr",
          direction: "ltr",
          colorScheme: "light",
          axe: "docs/audits/v1.0.0/basic-react-tailwind/axe.light-ltr.json",
          pa11y: "docs/audits/v1.0.0/basic-react-tailwind/pa11y.light-ltr.json"
        },
        {
          id: "dark-ltr",
          direction: "ltr",
          colorScheme: "dark",
          axe: "docs/audits/v1.0.0/basic-react-tailwind/axe.dark-ltr.json",
          pa11y: "docs/audits/v1.0.0/basic-react-tailwind/pa11y.dark-ltr.json"
        },
        {
          id: "light-rtl",
          direction: "rtl",
          colorScheme: "light",
          axe: "docs/audits/v1.0.0/basic-react-tailwind/axe.light-rtl.json",
          pa11y: "docs/audits/v1.0.0/basic-react-tailwind/pa11y.light-rtl.json"
        },
        {
          id: "dark-rtl",
          direction: "rtl",
          colorScheme: "dark",
          axe: "docs/audits/v1.0.0/basic-react-tailwind/axe.dark-rtl.json",
          pa11y: "docs/audits/v1.0.0/basic-react-tailwind/pa11y.dark-rtl.json"
        }
      ],
      contrastPairs: [
        { id: "light-body", foreground: "#020617", background: "#f8fafc", minimumRatio: 4.5 }
      ],
      requiredTokens: [
        { file: "templates/basic-react-tailwind/src/styles.css", token: "prefers-reduced-motion" },
        { file: "templates/basic-react-tailwind/src/styles.css", token: "prefers-color-scheme" },
        { file: "templates/basic-react-tailwind/src/App.tsx", token: "templateMessages" },
        { file: "templates/basic-react-tailwind/src/messages.ts", token: "ar" }
      ]
    }
  ]
})

const isAccessibilityManifestFixture = (
  value: unknown
): value is {
  readonly templates: readonly {
    readonly contrastPairs: readonly unknown[]
  }[]
} =>
  typeof value === "object" &&
  value !== null &&
  "templates" in value &&
  Array.isArray(value.templates)

const accessibilityAppFixture = (): string =>
  [
    "import { templateMessages } from './messages'",
    "const copy = templateMessages.en",
    "export function App() {",
    "  return <button>{copy.openWindow}</button>",
    "}"
  ].join("\n")

const accessibilityStylesFixture = (): string =>
  [
    "@media (prefers-color-scheme: dark) { :root { color-scheme: dark; } }",
    "@media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms; } }"
  ].join("\n")

const accessibilityMessagesFixture = (): string =>
  [
    "export const templateMessages = {",
    "  en: { openWindow: 'Open window' },",
    "  ar: { openWindow: 'افتح نافذة' }",
    "}"
  ].join("\n")

const accessibilityManualAuditFixture = (): string =>
  [
    "# basic-react-tailwind Manual Keyboard Audit",
    "Keyboard-only walkthrough: complete.",
    "Screencast: keyboard-walkthrough.webm",
    "RTL example: Arabic fixture complete.",
    "Sign-off: release operator"
  ].join("\n")

const axeAuditFixture = (mode: string): unknown => ({
  url: `fixture:${mode}`,
  testEngine: { name: "axe-core", version: "4.x" },
  violations: [],
  incomplete: [],
  passes: []
})

const pa11yAuditFixture = (mode: string): unknown => ({
  url: `fixture:${mode}`,
  runner: "pa11y",
  standard: "WCAG2AA",
  issues: []
})

const writeSemverFixture = async (
  root: string,
  overrides: {
    readonly manifest?: unknown
    readonly matrix?: unknown
  } = {}
): Promise<void> => {
  await mkdir(join(root, "release"), { recursive: true })
  await mkdir(join(root, "docs"), { recursive: true })
  await writeFile(
    join(root, "release", "semver.json"),
    JSON.stringify(overrides.manifest ?? semverManifestFixture(), null, 2)
  )
  await writeFile(
    join(root, "docs", "verification-matrix.json"),
    JSON.stringify(overrides.matrix ?? semverMatrixFixture(), null, 2)
  )
}

const semverManifestFixture = (): unknown => ({
  schemaVersion: 1,
  source: "docs/SPEC.md §25.6",
  release: "1.1.0",
  releaseKind: "minor",
  publicApiSnapshots: "api/snapshots",
  verificationMatrix: "docs/verification-matrix.json",
  appendixCRows: ["C.54", "C.71", "C.72", "C.81"],
  bridgeEnvelopePolicy: {
    source: "docs/SPEC.md §9.3",
    frozenBetweenMajors: true,
    allowedChange: "fields may be added with defaults; fields may not be removed or reordered"
  },
  deprecationPolicy: {
    minimumMinorReleases: 3,
    requiresJSDocDeprecated: true
  }
})

const isSemverManifestFixture = (
  value: unknown
): value is {
  readonly appendixCRows: readonly string[]
} =>
  typeof value === "object" &&
  value !== null &&
  "appendixCRows" in value &&
  Array.isArray(value.appendixCRows)

const semverMatrixFixture = (): unknown => ({
  rows: {
    "C.54": {},
    "C.71": {},
    "C.72": {},
    "C.81": {}
  }
})

const publicApiReportFixture = (kind: "added" | "removed"): PublicApiSnapshotReport => ({
  passed: kind === "added",
  updated: false,
  packages: [],
  changes: [
    {
      packageName: "@effect-desktop/core",
      symbol: "Example",
      kind,
      ...(kind === "added"
        ? { after: { name: "Example", kind: "function", signature: "function Example(): void" } }
        : {
            before: {
              name: "Example",
              kind: "function",
              signature: "function Example(): void"
            }
          })
    }
  ]
})

const releaseChecklistFixture = (): unknown => ({
  schemaVersion: 1,
  source: "docs/SPEC.md §25.4",
  gates: [
    {
      id: "spdx-sbom",
      title: "SPDX SBOM generation and signing",
      kind: "workflow-step",
      evidence: [".github/workflows/release.yml#Generate SPDX SBOM"]
    },
    {
      id: "cvss-scan",
      title: "CVSS >= 7.0 vulnerability scan",
      kind: "workflow-step",
      evidence: [
        ".github/workflows/release.yml#Scan release SBOM for high vulnerabilities",
        "docs/security/release-settings.md#docs/security/exemptions"
      ]
    },
    {
      id: "reproducible-build",
      title: "Reproducible build check",
      kind: "workflow-step",
      evidence: [".github/workflows/release.yml#Reproducible build gate"]
    },
    {
      id: "slsa-provenance",
      title: "SLSA v1.0 provenance attestation",
      kind: "workflow-step",
      evidence: [".github/workflows/release.yml#Attest release provenance"]
    },
    {
      id: "hsm-signing",
      title: "HSM-backed release signing",
      kind: "policy-document",
      evidence: [
        "docs/security/key-management.md#HSM-backed",
        "docs/security/key-management.md#runner-local keys are forbidden"
      ]
    },
    {
      id: "secret-scanning",
      title: "Secret scanning on every branch",
      kind: "repository-setting",
      evidence: ["docs/security/release-settings.md#Secret scanning is enabled for every branch"]
    },
    {
      id: "ephemeral-runners",
      title: "Ephemeral self-hosted runner posture",
      kind: "repository-setting",
      evidence: [
        "docs/security/release-settings.md#Blacksmith",
        "docs/security/release-settings.md#persistent self-hosted runners are forbidden"
      ]
    },
    {
      id: "branch-protection",
      title: "Branch protection review requirements",
      kind: "repository-setting",
      evidence: [
        "docs/security/release-settings.md#main requires at least one review",
        "docs/security/release-settings.md#release branches require at least two reviews"
      ]
    }
  ]
})

const isReleaseChecklistFixture = (
  value: unknown
): value is {
  readonly schemaVersion: 1
  readonly source: string
  readonly gates: readonly {
    readonly id: string
    readonly title: string
    readonly kind: string
    readonly evidence: readonly string[]
  }[]
} => typeof value === "object" && value !== null && "gates" in value && Array.isArray(value.gates)

const ciWorkflowFixture = (): string =>
  [
    "on:",
    "  push:",
    '    branches: ["**"]',
    "jobs:",
    "  validate:",
    "    runs-on: blacksmith-2vcpu-ubuntu-2404",
    "    steps:",
    "      - name: bun desktop check --repro regression tests",
    "        run: bun test packages/cli/src/index.test.ts -t repro",
    "      - name: bun desktop check --release",
    "        run: bun packages/cli/src/bin.ts check --release"
  ].join("\n")

const releaseWorkflowFixture = (): string =>
  [
    "name: release",
    "permissions:",
    "  artifact-metadata: write",
    "  attestations: write",
    "  id-token: write",
    "jobs:",
    "  release-gates:",
    "    runs-on: blacksmith-2vcpu-ubuntu-2404",
    "    env:",
    "      RELEASE_SIGNING_BACKEND: hsm",
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2",
    "      - name: Reproducible build gate",
    "        run: bun packages/cli/src/bin.ts check --repro --config apps/playground/desktop.config.ts",
    "      - name: Sign release artifacts with HSM backend",
    "        run: |",
    '          test "$RELEASE_SIGNING_BACKEND" = "hsm"',
    "          bun packages/cli/src/bin.ts sign --config apps/playground/desktop.config.ts",
    "      - name: Generate SPDX SBOM",
    "        uses: anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610 # v0.24.0",
    "        with:",
    "          format: spdx-json",
    "      - name: CVSS exemption policy",
    "        run: test -d docs/security/exemptions",
    "      - name: Scan release SBOM for high vulnerabilities",
    "        uses: anchore/scan-action@e1165082ffb1fe366ebaf02d8526e7c4989ea9d2 # v7.4.0",
    "        with:",
    "          severity-cutoff: high",
    "          sbom: dist/desktop/effect-desktop.spdx.json",
    "      - name: Upload SBOM artifacts",
    "        run: echo sbom-artifacts",
    "      - name: Attest release provenance",
    "        uses: actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26 # v4.1.0",
    "        with:",
    "          subject-path: dist/desktop/**",
    "      - name: Attest signed SBOM",
    "        uses: actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26 # v4.1.0",
    "        with:",
    "          subject-path: dist/desktop/effect-desktop.spdx.json",
    "          sbom-path: dist/desktop/effect-desktop.spdx.json"
  ].join("\n")

const keyManagementFixture = (): string =>
  [
    "# Release Key Management",
    "",
    "Release artifacts use an HSM-backed key.",
    "runner-local keys are forbidden for release jobs.",
    "Key rotation is recorded for every trust-anchor change."
  ].join("\n")

const releaseSettingsFixture = (): string =>
  [
    "# Release Repository Settings",
    "",
    "Secret scanning is enabled for every branch.",
    "main requires at least one review.",
    "release branches require at least two reviews.",
    "Blacksmith ephemeral runners are rebuilt from a clean image per job.",
    "persistent self-hosted runners are forbidden for release jobs.",
    "CVSS exemptions live under docs/security/exemptions."
  ].join("\n")

const testEd25519Key = (): { readonly privateKeyPem: string; readonly publicKey: string } => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const publicDer = publicKey.export({ type: "spki", format: "der" })
  return {
    privateKeyPem,
    publicKey: `ed25519:${publicDer.subarray(publicDer.length - 32).toString("base64")}`
  }
}

const verifyUpdateManifest = (manifest: UpdateManifest, publicKey: string): boolean => {
  const publicKeyBytes = Buffer.from(publicKey.slice("ed25519:".length), "base64")
  const publicKeyObject = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKeyBytes]),
    format: "der",
    type: "spki"
  })
  return cryptoVerify(
    null,
    Buffer.from(canonicalUpdateManifestBytes(manifest)),
    publicKeyObject,
    Buffer.from(manifest.signature.slice("ed25519:".length), "base64")
  )
}

const deterministicBuildRunner = (): CommandRunner => (invocation) =>
  Effect.gen(function* () {
    if (invocation.step === "renderer") {
      yield* Effect.promise(() => mkdir(join(invocation.cwd, "dist"), { recursive: true }))
      yield* Effect.promise(() =>
        writeFile(join(invocation.cwd, "dist", "index.html"), "<h1>ok</h1>")
      )
    }
    if (invocation.step === "runtime") {
      const outdir = invocation.args[invocation.args.indexOf("--outdir") + 1]
      const entryPath = invocation.args[1]
      if (outdir !== undefined && entryPath !== undefined) {
        const entryBase = basename(entryPath)
        const outputFile = entryBase.replace(/\.tsx?$/, ".js")
        yield* Effect.promise(() => mkdir(outdir, { recursive: true }))
        yield* Effect.promise(() => writeFile(join(outdir, outputFile), "console.log('runtime')\n"))
      }
    }
    if (invocation.step === "native-host") {
      yield* Effect.promise(() =>
        mkdir(join(invocation.cwd, "target", "release"), { recursive: true })
      )
      yield* Effect.promise(() =>
        writeFile(join(invocation.cwd, "target", "release", "host"), "host")
      )
    }
  })

const deterministicPackageRunner =
  (content: () => string): PackageCommandRunner =>
  (invocation) =>
    Effect.gen(function* () {
      if (invocation.step === "linux-deb") {
        const output = invocation.args.at(-1)
        if (output !== undefined) {
          yield* Effect.promise(() => writeFile(output, content()))
        }
      }
    })

const modeDriftPackageRunner =
  (mode: () => number): PackageCommandRunner =>
  (invocation) =>
    Effect.gen(function* () {
      if (invocation.step === "linux-deb") {
        const output = invocation.args.at(-1)
        if (output !== undefined) {
          yield* Effect.promise(() => writeFile(output, "deb"))
          const dir = dirname(output)
          const hostPath = join(dir, "host")
          yield* Effect.promise(() => writeFile(hostPath, "host"))
          yield* Effect.promise(() => chmod(hostPath, mode()))
        }
      }
    })

const symlinkDriftPackageRunner =
  (mode: () => "symlink" | "symlink-a" | "symlink-b" | "regular"): PackageCommandRunner =>
  (invocation) =>
    Effect.gen(function* () {
      if (invocation.step === "linux-deb") {
        const output = invocation.args.at(-1)
        if (output !== undefined) {
          yield* Effect.promise(() => writeFile(output, "deb"))
          const dir = dirname(output)
          const linkPath = join(dir, "app-link")
          yield* Effect.promise(() => writeFile(join(dir, "target-a.txt"), "a"))
          yield* Effect.promise(() => writeFile(join(dir, "target-b.txt"), "b"))
          const decision = mode()
          if (decision === "symlink") {
            yield* Effect.promise(() => symlink("target-a.txt", linkPath))
          } else if (decision === "symlink-a") {
            yield* Effect.promise(() => symlink("target-a.txt", linkPath))
          } else if (decision === "symlink-b") {
            yield* Effect.promise(() => symlink("target-b.txt", linkPath))
          } else {
            yield* Effect.promise(() => writeFile(linkPath, "regular"))
          }
        }
      }
    })

const doctorRunner =
  (available: Readonly<Record<string, boolean>>): DoctorCommandRunner =>
  (invocation) =>
    available[invocation.command] === true
      ? Effect.succeed({ stdout: `${invocation.command} ok`, stderr: "" })
      : Effect.fail(
          new DoctorMissing({
            probe: invocation.probe,
            component: invocation.command,
            platform: "test",
            message: `${invocation.command} missing`,
            remediation: `install ${invocation.command}`,
            installHint: `install ${invocation.command}`,
            docsUrl: "https://example.invalid"
          })
        )

const fixedClock = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => {
    const value = values[index] ?? values[values.length - 1]
    index += 1
    return value ?? 0
  }
}
