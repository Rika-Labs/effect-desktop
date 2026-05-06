import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import {
  DoctorMissing,
  runCli,
  type CommandRunner,
  type DoctorCommandRunner,
  type NotarizeCommandRunner,
  type SignCommandRunner
} from "./index.js"
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

    const debMetadata = JSON.parse(
      await readFile(
        join(outputRoot, "Effect-Desktop-Playground-0.0.0-linux-x64.deb", "artifact.json"),
        "utf8"
      )
    ) as { readonly kind: string; readonly sizeBytes: number }

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      "linux-appimage:appimagetool",
      "linux-deb:dpkg-deb",
      "linux-rpm:rpmbuild"
    ])
    expect(debMetadata).toMatchObject({ kind: "deb", sizeBytes: 3 })
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
    expect(wxs).not.toContain("00000000-0000-0000-0000-000000000064")
    expect(wxs).toMatch(
      /UpgradeCode="[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/
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
  await writeFile(
    join(root, "artifact.json"),
    `${JSON.stringify({ kind, target, fileName, sizeBytes: 1, sha256: "0".repeat(64) }, null, 2)}\n`
  )
  return artifactPath
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
      if (outdir !== undefined) {
        yield* Effect.promise(() => mkdir(outdir, { recursive: true }))
        yield* Effect.promise(() => writeFile(join(outdir, "main.js"), "console.log('runtime')\n"))
      }
    }
    if (invocation.step === "native-host") {
      yield* Effect.promise(() =>
        writeFile(join(invocation.cwd, "target", "debug", "host"), "host")
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
