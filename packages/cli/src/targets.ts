/* eslint-disable max-classes-per-file -- Canonical target boundary owns Schema classes and tagged errors. */
import { join } from "node:path"

import { Data, Effect, Schema } from "effect"

export const DesktopOs = Schema.Literals(["linux", "macos", "windows"])
export type DesktopOs = typeof DesktopOs.Type

export const DesktopArch = Schema.Literals(["arm64", "x64"])
export type DesktopArch = typeof DesktopArch.Type

const DesktopTargetIdLiterals = [
  "linux-arm64",
  "linux-x64",
  "macos-arm64",
  "macos-x64",
  "windows-arm64",
  "windows-x64"
] as const

export const DesktopTargetId = Schema.Literals(DesktopTargetIdLiterals)
export type DesktopTargetId = typeof DesktopTargetId.Type

const MacosDesktopTargetIdLiterals = ["macos-arm64", "macos-x64"] as const

export const MacosDesktopTargetId = Schema.Literals(MacosDesktopTargetIdLiterals)
export type MacosDesktopTargetId = typeof MacosDesktopTargetId.Type

export const desktopTargetId = (target: {
  readonly os: DesktopOs
  readonly arch: DesktopArch
}): DesktopTargetId => `${target.os}-${target.arch}`

export class DesktopTarget extends Schema.Class<DesktopTarget>("DesktopTarget")({
  arch: DesktopArch,
  os: DesktopOs
}) {
  get id(): DesktopTargetId {
    return desktopTargetId(this)
  }
}

const DesktopArtifactKindLiterals = ["app", "appimage", "deb", "dmg", "msi", "rpm", "zip"] as const

export const DesktopArtifactKind = Schema.Literals(DesktopArtifactKindLiterals)
export type DesktopArtifactKind = typeof DesktopArtifactKind.Type

export class DesktopArtifact extends Schema.Class<DesktopArtifact>("DesktopArtifact")({
  kind: DesktopArtifactKind,
  target: DesktopTarget
}) {}

export class UnsupportedDesktopHostTargetError extends Data.TaggedError(
  "UnsupportedDesktopHostTargetError"
)<{
  readonly platform: string
  readonly arch: string
}> {}

export class UnsupportedDesktopTargetError extends Data.TaggedError(
  "UnsupportedDesktopTargetError"
)<{
  readonly target: string
  readonly hostTarget: DesktopTargetId
  readonly reason: "unsupported" | "mismatch"
}> {}

export const DesktopTargetIds: readonly DesktopTargetId[] = DesktopTargetIdLiterals

export const parseDesktopTargetId = (id: DesktopTargetId): DesktopTarget => {
  const separator = id.indexOf("-")
  return new DesktopTarget({
    arch: id.slice(separator + 1) as DesktopArch,
    os: id.slice(0, separator) as DesktopOs
  })
}

export const decodeDesktopTarget = (
  value: unknown
): Effect.Effect<DesktopTarget, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(DesktopTargetId)(value).pipe(Effect.map(parseDesktopTargetId))

export const isDesktopTargetId = Schema.is(DesktopTargetId)

export const isMacosDesktopTargetId = Schema.is(MacosDesktopTargetId)

export const isDesktopArtifactKind = Schema.is(DesktopArtifactKind)

const normalizeDesktopOs = (platform: NodeJS.Platform): string => {
  if (platform === "darwin") {
    return "macos"
  }
  if (platform === "win32") {
    return "windows"
  }
  return platform
}

const normalizeDesktopArch = (arch: string): DesktopArch | undefined => {
  if (arch === "x64" || arch === "arm64") {
    return arch
  }
  return undefined
}

export const detectDesktopHostTarget = (
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): DesktopTargetId | undefined => {
  const os = normalizeDesktopOs(platform)
  const normalizedArch = normalizeDesktopArch(arch)
  return (os === "linux" || os === "macos" || os === "windows") && normalizedArch !== undefined
    ? desktopTargetId({ arch: normalizedArch, os })
    : undefined
}

export const resolveDesktopHostTarget = (
  override: DesktopTargetId | undefined,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Effect.Effect<DesktopTarget, UnsupportedDesktopHostTargetError, never> => {
  const hostTarget = override ?? detectDesktopHostTarget(platform, arch)
  return hostTarget === undefined
    ? Effect.fail(new UnsupportedDesktopHostTargetError({ arch, platform }))
    : Effect.succeed(parseDesktopTargetId(hostTarget))
}

export const resolveMacosDesktopHostTarget = (
  override: MacosDesktopTargetId | undefined,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Effect.Effect<DesktopTarget, UnsupportedDesktopHostTargetError, never> =>
  resolveDesktopHostTarget(override, platform, arch).pipe(
    Effect.flatMap((target) =>
      target.os === "macos"
        ? Effect.succeed(target)
        : Effect.fail(new UnsupportedDesktopHostTargetError({ arch, platform }))
    )
  )

export const resolveDesktopTarget = (
  requested: string | undefined,
  hostTarget: DesktopTarget
): Effect.Effect<DesktopTarget, UnsupportedDesktopTargetError, never> => {
  const target = requested ?? hostTarget.id
  return decodeDesktopTarget(target).pipe(
    Effect.mapError(
      () =>
        new UnsupportedDesktopTargetError({
          hostTarget: hostTarget.id,
          reason: "unsupported",
          target: String(target)
        })
    ),
    Effect.flatMap((decoded) =>
      decoded.id === hostTarget.id
        ? Effect.succeed(decoded)
        : Effect.fail(
            new UnsupportedDesktopTargetError({
              hostTarget: hostTarget.id,
              reason: "mismatch",
              target: decoded.id
            })
          )
    )
  )
}

export const desktopPlatformDirectory = (target: DesktopTargetId): DesktopOs =>
  parseDesktopTargetId(target).os

export const artifactKindsForTarget = (target: DesktopTargetId): readonly DesktopArtifactKind[] => {
  const os = desktopPlatformDirectory(target)
  if (os === "macos") {
    return ["app", "dmg", "zip"]
  }
  if (os === "windows") {
    return ["msi"]
  }
  return ["appimage", "deb", "rpm"]
}

export const desktopArtifactsForTarget = (target: DesktopTargetId): readonly DesktopArtifact[] => {
  const parsed = parseDesktopTargetId(target)
  return artifactKindsForTarget(target).map((kind) => new DesktopArtifact({ kind, target: parsed }))
}

export const desktopArtifactExtension = (kind: DesktopArtifactKind): string =>
  kind === "appimage" ? "AppImage" : kind

export const hostBinaryName = (target: DesktopTargetId): string =>
  desktopPlatformDirectory(target) === "windows" ? "host.exe" : "host"

export const hostBuildOutputPath = (repoRoot: string, target: DesktopTargetId): string =>
  join(repoRoot, "target", "release", hostBinaryName(target))

export const wixArch = (target: DesktopTargetId): string =>
  parseDesktopTargetId(target).arch === "arm64" ? "arm64" : "x64"

export const appImageArch = (target: DesktopTargetId): string =>
  parseDesktopTargetId(target).arch === "arm64" ? "aarch64" : "x86_64"

export const debArch = (target: DesktopTargetId): string =>
  parseDesktopTargetId(target).arch === "arm64" ? "arm64" : "amd64"

export const rpmArch = (target: DesktopTargetId): string =>
  parseDesktopTargetId(target).arch === "arm64" ? "aarch64" : "x86_64"
