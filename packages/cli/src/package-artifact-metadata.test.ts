import { expect, test } from "bun:test"
import { Effect } from "effect"

import {
  decodePackageArtifactMetadataJson,
  decodePackageArtifactSha256,
  decodePackageArtifactSizeBytes,
  packageArtifactDigestMatches,
  resolveContainedPackageArtifactPath
} from "./package-artifact-metadata.js"

const metadataJson = JSON.stringify({
  appId: "dev.effect-desktop.inspector",
  appName: "ORIKA Playground",
  appVersion: "0.0.0",
  kind: "appimage",
  target: "linux-x64",
  fileName: "ORIKA-Playground-0.0.0-linux-x64.AppImage",
  sizeBytes: 12,
  sha256: "a".repeat(64),
  linuxIntegration: {
    desktopFile: "dev.effect-desktop.inspector.desktop",
    appStreamId: "dev.effect-desktop.inspector.metainfo.xml",
    flatpakAppId: "dev.effect-desktop.inspector",
    snapName: "dev.effect-desktop.inspector"
  }
})

test("package artifact metadata decoder reads the package writer contract", async () => {
  const metadata = await Effect.runPromise(decodePackageArtifactMetadataJson(metadataJson))

  expect(metadata.appId).toBe("dev.effect-desktop.inspector")
  expect(metadata.kind).toBe("appimage")
  expect(metadata.target).toBe("linux-x64")
  expect(metadata.linuxIntegration?.flatpakAppId).toBe("dev.effect-desktop.inspector")
})

test("package artifact metadata rejects invalid digest fields", async () => {
  let sizeFailure = ""
  try {
    await Effect.runPromise(decodePackageArtifactSizeBytes(-1, "artifact.json#sizeBytes"))
  } catch (error) {
    sizeFailure = String(error)
  }

  let digestFailure = ""
  try {
    await Effect.runPromise(decodePackageArtifactSha256("ABC", "artifact.json#sha256"))
  } catch (error) {
    digestFailure = String(error)
  }

  expect(sizeFailure).toContain("artifact.json#sizeBytes must be a non-negative integer")
  expect(digestFailure).toContain("artifact.json#sha256 must be a lowercase SHA-256 hex digest")
})

test("package artifact metadata resolves only contained artifact file names", async () => {
  const artifactPath = await Effect.runPromise(
    resolveContainedPackageArtifactPath(
      "/release/linux/app",
      "ORIKA-Playground.AppImage",
      "artifact.json#fileName"
    )
  )

  let escapedFailure = ""
  try {
    await Effect.runPromise(
      resolveContainedPackageArtifactPath(
        "/release/linux/app",
        "../outside.AppImage",
        "artifact.json#fileName"
      )
    )
  } catch (error) {
    escapedFailure = String(error)
  }

  expect(artifactPath).toBe("/release/linux/app/ORIKA-Playground.AppImage")
  expect(escapedFailure).toContain(
    "artifact.json#fileName must be a single file name without path separators"
  )
})

test("package artifact metadata digest matcher checks size and sha together", () => {
  const expected = { sizeBytes: 12, sha256: "a".repeat(64) }

  expect(packageArtifactDigestMatches(expected, { sizeBytes: 12, sha256: "a".repeat(64) })).toBe(
    true
  )
  expect(packageArtifactDigestMatches(expected, { sizeBytes: 13, sha256: "a".repeat(64) })).toBe(
    false
  )
  expect(packageArtifactDigestMatches(expected, { sizeBytes: 12, sha256: "b".repeat(64) })).toBe(
    false
  )
})
