import { expect, test } from "bun:test"

import { Effect } from "effect"

import {
  DesktopTarget,
  DesktopTargetIds,
  appImageArch,
  artifactKindsForTarget,
  debArch,
  decodeDesktopTarget,
  desktopArtifactExtension,
  desktopArtifactsForTarget,
  desktopPlatformDirectory,
  desktopTargetId,
  detectDesktopHostTarget,
  hostBinaryName,
  isDesktopTargetId,
  isMacosDesktopTargetId,
  parseDesktopTargetId,
  resolveDesktopHostTarget,
  resolveDesktopTarget,
  resolveMacosDesktopHostTarget,
  rpmArch,
  wixArch
} from "./targets.js"

test("release target parser does not assert target id segments", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(new URL("./targets.ts", import.meta.url)).text()
      )

      expect(source).not.toContain("as DesktopArch")
      expect(source).not.toContain("as DesktopOs")
    })
  ))

test("release targets decode every supported target id", () => {
  for (const id of DesktopTargetIds) {
    const target = parseDesktopTargetId(id)
    expect(target).toBeInstanceOf(DesktopTarget)
    expect(target.id).toBe(id)
    expect(desktopTargetId(target)).toBe(id)
    expect(isDesktopTargetId(id)).toBe(true)
  }
})

test("release targets reject unsupported target ids", () => {
  expect(isDesktopTargetId("freebsd-x64")).toBe(false)
  expect(isDesktopTargetId("linux-ia32")).toBe(false)
  expect(isDesktopTargetId("macos")).toBe(false)
})

test("release targets normalize host platform aliases", () => {
  expect(detectDesktopHostTarget("darwin", "arm64")).toBe("macos-arm64")
  expect(detectDesktopHostTarget("win32", "x64")).toBe("windows-x64")
  expect(detectDesktopHostTarget("linux", "x64")).toBe("linux-x64")
  expect(detectDesktopHostTarget("freebsd", "x64")).toBeUndefined()
  expect(detectDesktopHostTarget("linux", "ia32")).toBeUndefined()
})

test("release target policy owns platform artifacts and binary names", () => {
  const matrix = {
    "linux-arm64": {
      artifacts: ["appimage", "deb", "rpm"],
      binary: "host",
      os: "linux"
    },
    "linux-x64": {
      artifacts: ["appimage", "deb", "rpm"],
      binary: "host",
      os: "linux"
    },
    "macos-arm64": {
      artifacts: ["app", "dmg", "zip"],
      binary: "host",
      os: "macos"
    },
    "macos-x64": {
      artifacts: ["app", "dmg", "zip"],
      binary: "host",
      os: "macos"
    },
    "windows-arm64": { artifacts: ["msi"], binary: "host.exe", os: "windows" },
    "windows-x64": { artifacts: ["msi"], binary: "host.exe", os: "windows" }
  } as const

  for (const target of DesktopTargetIds) {
    const expected = matrix[target]
    expect(desktopPlatformDirectory(target)).toBe(expected.os)
    expect(artifactKindsForTarget(target)).toEqual([...expected.artifacts])
    expect(desktopArtifactsForTarget(target).map((artifact) => artifact.kind)).toEqual([
      ...expected.artifacts
    ])
    expect(desktopArtifactsForTarget(target)[0]?.target.id).toBe(target)
    expect(hostBinaryName(target)).toBe(expected.binary)
  }
})

test("release target policy owns artifact extensions and arch renderers", () => {
  expect(desktopArtifactExtension("appimage")).toBe("AppImage")
  expect(desktopArtifactExtension("rpm")).toBe("rpm")
  expect(wixArch("windows-arm64")).toBe("arm64")
  expect(wixArch("windows-x64")).toBe("x64")
  expect(appImageArch("linux-arm64")).toBe("aarch64")
  expect(appImageArch("linux-x64")).toBe("x86_64")
  expect(debArch("linux-arm64")).toBe("arm64")
  expect(debArch("linux-x64")).toBe("amd64")
  expect(rpmArch("linux-arm64")).toBe("aarch64")
  expect(rpmArch("linux-x64")).toBe("x86_64")
})

test("release target policy exposes the macOS-only subset", () => {
  expect(isMacosDesktopTargetId("macos-arm64")).toBe(true)
  expect(isMacosDesktopTargetId("macos-x64")).toBe(true)
  expect(isMacosDesktopTargetId("linux-x64")).toBe(false)
  expect(isMacosDesktopTargetId("windows-x64")).toBe(false)
})

test("release target schema reports decode failures as Effect errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(decodeDesktopTarget("linux-ia32"))

      expect(exit._tag).toBe("Failure")
    })
  ))

test("release target resolution decodes defaults and rejects mismatches", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* resolveDesktopHostTarget(undefined, "linux", "x64")
      expect(host.id).toBe("linux-x64")
      expect(yield* resolveDesktopTarget(undefined, host)).toEqual(host)
      const requestedTarget = yield* resolveDesktopTarget("linux-x64", host)
      expect(requestedTarget.id).toBe("linux-x64")

      const unsupported = yield* Effect.exit(resolveDesktopTarget("linux-ia32", host))
      expect(unsupported._tag).toBe("Failure")

      const mismatch = yield* Effect.exit(resolveDesktopTarget("windows-x64", host))
      expect(mismatch._tag).toBe("Failure")
    })
  ))

test("release target resolution keeps macOS host requirements centralized", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const macosHost = yield* resolveMacosDesktopHostTarget(undefined, "darwin", "arm64")
      expect(macosHost.id).toBe("macos-arm64")
      const exit = yield* Effect.exit(resolveMacosDesktopHostTarget(undefined, "linux", "x64"))
      expect(exit._tag).toBe("Failure")
    })
  ))
