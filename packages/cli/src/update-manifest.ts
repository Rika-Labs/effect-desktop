import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify
} from "node:crypto"
import { lstat, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { Data, Effect } from "effect"

import { decodeDesktopTarget, desktopPlatformDirectory, isDesktopArtifactKind } from "./targets.js"
import type { DesktopArtifactKind, DesktopTargetId } from "./targets.js"

export type PublishChannel = "stable" | "beta" | "canary"
export type PublishTarget = DesktopTargetId
export type PublishArtifactKind = DesktopArtifactKind

export class PublishConfigError extends Data.TaggedError("PublishConfigError")<{
  readonly field: string
  readonly message: string
  readonly remediation: string
}> {}

export class PublishFileError extends Data.TaggedError("PublishFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class PublishSignatureError extends Data.TaggedError("PublishSignatureError")<{
  readonly operation: string
  readonly message: string
}> {}

export type PublishPipelineError = PublishConfigError | PublishFileError | PublishSignatureError

export interface DesktopPublishOptions {
  readonly cwd: string
  readonly configPath: string
  readonly platform: string | undefined
  readonly now: () => number
  readonly env?: Readonly<Record<string, string | undefined>>
}

export interface UpdateArtifactManifest {
  readonly platform: PublishTarget
  readonly kind: PublishArtifactKind
  readonly url: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly signature: string
}

export interface UpdateManifest {
  readonly schemaVersion: 1
  readonly appId: string
  readonly version: string
  readonly channel: PublishChannel
  readonly keyVersion: number
  readonly publishedAt: string
  readonly rollback?: boolean
  readonly minVersion?: string
  readonly maxVersion?: string
  readonly artifacts: readonly UpdateArtifactManifest[]
  readonly signature: string
}

export interface DesktopPublishReport {
  readonly appId: string
  readonly version: string
  readonly channel: PublishChannel
  readonly keyVersion: number
  readonly manifestPath: string
  readonly canonicalBytes: string
  readonly artifacts: readonly UpdateArtifactManifest[]
}

interface AppConfig {
  readonly app?: {
    readonly id?: unknown
    readonly name?: unknown
    readonly version?: unknown
  }
  readonly update?: {
    readonly channel?: unknown
    readonly feedUrl?: unknown
    readonly publicKey?: unknown
    readonly privateKeyEnv?: unknown
    readonly keyVersion?: unknown
    readonly minVersion?: unknown
    readonly maxVersion?: unknown
    readonly rollback?: unknown
  }
}

interface PublishPlan {
  readonly appId: string
  readonly appName: string
  readonly version: string
  readonly channel: PublishChannel
  readonly feedUrl: string
  readonly publicKey: string
  readonly privateKeyEnv: string
  readonly keyVersion: number
  readonly minVersion: string | undefined
  readonly maxVersion: string | undefined
  readonly rollback: boolean | undefined
  readonly outputPath: string
  readonly target: PublishTarget | undefined
}

interface PackagedArtifact {
  readonly platform: PublishTarget
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly kind: PublishArtifactKind
  readonly fileName: string
  readonly artifactPath: string
  readonly sizeBytes: number
  readonly sha256: string
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

export const runDesktopPublish = (
  options: DesktopPublishOptions
): Effect.Effect<DesktopPublishReport, PublishPipelineError, never> =>
  Effect.gen(function* () {
    const absoluteConfigPath = resolvePath(options.cwd, options.configPath)
    const rawConfig = yield* loadConfig(absoluteConfigPath)
    const plan = yield* normalizePublishPlan(rawConfig, {
      configPath: absoluteConfigPath,
      platform: options.platform
    })
    const artifacts = yield* readPackagedArtifacts(plan)
    const privateKey = yield* resolvePrivateKey(plan.privateKeyEnv, options.env ?? {})
    const manifestArtifacts: UpdateArtifactManifest[] = []
    for (const artifact of artifacts) {
      const payload = yield* readArtifactPayload(artifact.artifactPath)
      const digest = payload.digest
      if (digest.sizeBytes !== artifact.sizeBytes || digest.sha256 !== artifact.sha256) {
        return yield* Effect.fail(
          new PublishConfigError({
            field: `${relative(plan.outputPath, artifact.artifactPath)}#sha256`,
            message: "package artifact metadata does not match artifact bytes",
            remediation: "Regenerate package metadata with `bun desktop package` before publishing."
          })
        )
      }
      manifestArtifacts.push({
        platform: artifact.platform,
        kind: artifact.kind,
        url: artifactUrl(plan.feedUrl, artifact.platform, plan.channel, artifact.fileName),
        sizeBytes: digest.sizeBytes,
        sha256: digest.sha256,
        signature: signEd25519(payload.signingBytes, privateKey)
      })
    }
    const publishedAt = yield* readPublishedAt(options.now)
    const unsigned: Omit<UpdateManifest, "signature"> = {
      schemaVersion: 1,
      appId: plan.appId,
      version: plan.version,
      channel: plan.channel,
      keyVersion: plan.keyVersion,
      publishedAt,
      ...(plan.rollback === undefined ? {} : { rollback: plan.rollback }),
      ...(plan.minVersion === undefined ? {} : { minVersion: plan.minVersion }),
      ...(plan.maxVersion === undefined ? {} : { maxVersion: plan.maxVersion }),
      artifacts: manifestArtifacts
    }
    const canonicalBytes = canonicalJson(unsigned)
    const signature = signEd25519(Buffer.from(canonicalBytes), privateKey)
    const manifest: UpdateManifest = { ...unsigned, signature }
    const stableBytes = canonicalUpdateManifestBytes(manifest)
    if (stableBytes !== canonicalBytes) {
      return yield* Effect.fail(
        new PublishSignatureError({
          operation: "canonicalize",
          message: "update manifest canonical encoding changed after signing"
        })
      )
    }
    yield* verifyManifestSignature(manifest, plan.publicKey)
    const manifestPath = join(plan.outputPath, "update-manifest.json")
    yield* writeJson(manifestPath, manifest)
    return {
      appId: plan.appId,
      version: plan.version,
      channel: plan.channel,
      keyVersion: plan.keyVersion,
      manifestPath,
      canonicalBytes,
      artifacts: manifestArtifacts
    }
  })

const readPublishedAt = (now: () => number): Effect.Effect<string, PublishConfigError, never> =>
  Effect.gen(function* () {
    const timestamp = now()
    if (!Number.isFinite(timestamp)) {
      return yield* invalidPublishTimestamp()
    }
    const date = new Date(timestamp)
    const time = date.getTime()
    if (!Number.isFinite(time)) {
      return yield* invalidPublishTimestamp()
    }
    return date.toISOString()
  })

const invalidPublishTimestamp = (): Effect.Effect<never, PublishConfigError, never> =>
  Effect.fail(
    new PublishConfigError({
      field: "publishedAt",
      message: "publish timestamp must be a finite valid JavaScript timestamp",
      remediation: "Use a finite publish clock value before publishing."
    })
  )

export const canonicalUpdateManifestBytes = (
  manifest: UpdateManifest | Record<string, unknown>
): string => {
  const { signature: _signature, ...unsigned } = manifest
  return canonicalJson(unsigned)
}

const normalizePublishPlan = (
  rawConfig: unknown,
  options: { readonly configPath: string; readonly platform: string | undefined }
): Effect.Effect<PublishPlan, PublishConfigError, never> =>
  Effect.gen(function* () {
    const config = yield* readConfigObject(rawConfig)
    const appRoot = dirname(options.configPath)
    const appId = yield* readAppId(config.app?.id, "app.id")
    const appName = yield* readRequiredString(config.app?.name, "app.name", "Set app.name.")
    const version = yield* readRequiredString(
      config.app?.version,
      "app.version",
      "Set app.version."
    )
    const update = config.update
    const channel = yield* readChannel(update?.channel)
    const feedUrl = yield* readRequiredString(
      update?.feedUrl,
      "update.feedUrl",
      "Set update.feedUrl to the published manifest URL template."
    )
    yield* validateFeedUrl(feedUrl)
    const publicKey = yield* readRequiredString(
      update?.publicKey,
      "update.publicKey",
      "Set update.publicKey to ed25519:<base64-public-key>."
    )
    yield* validateEd25519PublicKey(publicKey, "update.publicKey")
    const privateKeyEnv = yield* readRequiredString(
      update?.privateKeyEnv,
      "update.privateKeyEnv",
      "Set update.privateKeyEnv to the environment variable that contains the Ed25519 private key PEM."
    )
    const keyVersion = yield* readPositiveInteger(update?.keyVersion, "update.keyVersion")
    const appSemver = yield* readSemver(version, "app.version")
    const minVersion = yield* readOptionalSemver(update?.minVersion, "update.minVersion")
    const maxVersion = yield* readOptionalSemver(update?.maxVersion, "update.maxVersion")
    const rollback = yield* readOptionalBoolean(update?.rollback, "update.rollback")
    if (minVersion !== undefined && compareSemver(minVersion.parsed, appSemver) > 0) {
      return yield* Effect.fail(
        new PublishConfigError({
          field: "update.minVersion",
          message: `update.minVersion ${minVersion.value} must not exceed app.version ${version}`,
          remediation: "Lower update.minVersion to app.version or below."
        })
      )
    }
    if (
      maxVersion !== undefined &&
      minVersion !== undefined &&
      compareSemver(minVersion.parsed, maxVersion.parsed) > 0
    ) {
      return yield* Effect.fail(
        new PublishConfigError({
          field: "update.maxVersion",
          message: `update.maxVersion ${maxVersion.value} must not be lower than update.minVersion ${minVersion.value}`,
          remediation: "Raise update.maxVersion to update.minVersion or above."
        })
      )
    }
    if (rollback === true && maxVersion === undefined) {
      return yield* Effect.fail(
        new PublishConfigError({
          field: "update.maxVersion",
          message: "update.maxVersion is required when update.rollback is true",
          remediation:
            "Set update.maxVersion to the highest installed.version that should accept this rollback pack."
        })
      )
    }
    const target = yield* readOptionalTarget(options.platform)
    return {
      appId,
      appName,
      version,
      channel,
      feedUrl,
      publicKey,
      privateKeyEnv,
      keyVersion,
      minVersion: minVersion?.value,
      maxVersion: maxVersion?.value,
      rollback,
      outputPath: resolvePath(appRoot, join("dist", "desktop")),
      target
    }
  })

const readPackagedArtifacts = (
  plan: PublishPlan
): Effect.Effect<readonly PackagedArtifact[], PublishFileError | PublishConfigError, never> =>
  Effect.gen(function* () {
    yield* statPath(plan.outputPath).pipe(
      Effect.catch(() =>
        Effect.fail(
          new PublishFileError({
            operation: "discover",
            path: plan.outputPath,
            message: "no packaged artifacts found; run bun desktop package first",
            cause: undefined
          })
        )
      )
    )
    const platforms =
      plan.target === undefined
        ? yield* readDirectory(plan.outputPath)
        : [desktopPlatformDirectory(plan.target)]
    const artifacts: PackagedArtifact[] = []
    for (const platform of platforms.toSorted()) {
      const platformPath = join(plan.outputPath, platform)
      const platformStat = yield* statPath(platformPath).pipe(
        Effect.catch(() =>
          plan.target === undefined
            ? Effect.succeed(undefined)
            : Effect.fail(
                new PublishFileError({
                  operation: "discover",
                  path: platformPath,
                  message: `no packaged artifacts found for ${plan.target}`,
                  cause: undefined
                })
              )
        )
      )
      if (platformStat === undefined || !platformStat.isDirectory()) {
        continue
      }
      const entries = yield* readDirectory(platformPath)
      for (const entry of entries.toSorted()) {
        const rootPath = join(platformPath, entry)
        const rootStat = yield* statPath(rootPath)
        if (!rootStat.isDirectory()) {
          continue
        }
        const metadataPath = join(rootPath, "artifact.json")
        const metadata = yield* readJson<{
          readonly kind?: unknown
          readonly target?: unknown
          readonly fileName?: unknown
          readonly sizeBytes?: unknown
          readonly sha256?: unknown
          readonly appId?: unknown
          readonly appName?: unknown
          readonly appVersion?: unknown
        }>(metadataPath)
        const appIdField = `${relative(plan.outputPath, metadataPath)}#appId`
        const appNameField = `${relative(plan.outputPath, metadataPath)}#appName`
        const appVersionField = `${relative(plan.outputPath, metadataPath)}#appVersion`
        const appId = yield* readRequiredString(
          metadata.appId,
          appIdField,
          "Regenerate package metadata with `bun desktop package`."
        )
        const appName = yield* readRequiredString(
          metadata.appName,
          appNameField,
          "Regenerate package metadata with `bun desktop package`."
        )
        const appVersion = yield* readRequiredString(
          metadata.appVersion,
          appVersionField,
          "Regenerate package metadata with `bun desktop package`."
        )
        if (appId !== plan.appId) {
          return yield* Effect.fail(
            new PublishConfigError({
              field: appIdField,
              message: `${appIdField} ${appId} does not match active app.id ${plan.appId}`,
              remediation: "Run `bun desktop package` with the active config before publishing."
            })
          )
        }
        if (appVersion !== plan.version) {
          return yield* Effect.fail(
            new PublishConfigError({
              field: appVersionField,
              message: `${appVersionField} ${appVersion} does not match active app.version ${plan.version}`,
              remediation: "Run `bun desktop package` with the active config before publishing."
            })
          )
        }
        if (appName !== plan.appName) {
          return yield* Effect.fail(
            new PublishConfigError({
              field: appNameField,
              message: `${appNameField} ${appName} does not match active app.name ${plan.appName}`,
              remediation: "Run `bun desktop package` with the active config before publishing."
            })
          )
        }
        const target = yield* readTarget(
          metadata.target,
          `${relative(plan.outputPath, metadataPath)}#target`
        )
        if (desktopPlatformDirectory(target) !== platform) {
          return yield* Effect.fail(
            new PublishConfigError({
              field: `${relative(plan.outputPath, metadataPath)}#target`,
              message: `artifact target ${target} does not match platform directory ${platform}`,
              remediation: "Regenerate package metadata with the correct target."
            })
          )
        }
        if (plan.target !== undefined && target !== plan.target) {
          continue
        }
        const kind = yield* readArtifactKind(
          metadata.kind,
          `${relative(plan.outputPath, metadataPath)}#kind`
        )
        const fileNameField = `${relative(plan.outputPath, metadataPath)}#fileName`
        const fileName = yield* readContainedFileName(metadata.fileName, fileNameField)
        const sizeBytes = yield* readNonNegativeInteger(
          metadata.sizeBytes,
          `${relative(plan.outputPath, metadataPath)}#sizeBytes`
        )
        const sha256 = yield* readSha256(
          metadata.sha256,
          `${relative(plan.outputPath, metadataPath)}#sha256`
        )
        const artifactPath = yield* resolveContainedArtifactPath(rootPath, fileName, fileNameField)
        yield* statPath(artifactPath)
        artifacts.push({
          platform: target,
          kind,
          fileName,
          artifactPath,
          sizeBytes,
          sha256,
          appId,
          appName,
          appVersion
        })
      }
    }
    if (artifacts.length === 0) {
      return yield* Effect.fail(
        new PublishFileError({
          operation: "discover",
          path: plan.outputPath,
          message: "no package artifact metadata found; run bun desktop package first",
          cause: undefined
        })
      )
    }
    return artifacts
  })

const resolvePrivateKey = (
  envName: string,
  env: Readonly<Record<string, string | undefined>>
): Effect.Effect<ReturnType<typeof createPrivateKey>, PublishConfigError, never> =>
  Effect.try({
    try: () => {
      const value = env[envName]
      if (value === undefined || value.length === 0) {
        throw new Error(`${envName} is not set`)
      }
      return createPrivateKey(value)
    },
    catch: (cause) =>
      new PublishConfigError({
        field: "update.privateKeyEnv",
        message: `failed to load Ed25519 private key from ${envName}: ${formatUnknownError(cause)}`,
        remediation: "Set the environment variable to a PEM-encoded Ed25519 private key."
      })
  })

const verifyManifestSignature = (
  manifest: UpdateManifest,
  publicKey: string
): Effect.Effect<void, PublishSignatureError, never> =>
  Effect.try({
    try: () => {
      const verified = cryptoVerify(
        null,
        Buffer.from(canonicalUpdateManifestBytes(manifest)),
        publicKeyObject(publicKey),
        decodeEd25519Value(manifest.signature, "signature")
      )
      if (!verified) {
        throw new Error("signature did not verify")
      }
    },
    catch: (cause) =>
      new PublishSignatureError({
        operation: "verify",
        message: `generated update manifest signature failed verification: ${formatUnknownError(cause)}`
      })
  }).pipe(Effect.asVoid)

const signEd25519 = (bytes: Buffer, privateKey: ReturnType<typeof createPrivateKey>): string =>
  `ed25519:${cryptoSign(null, bytes, privateKey).toString("base64")}`

const readArtifactPayload = (
  path: string
): Effect.Effect<
  {
    readonly digest: { readonly sizeBytes: number; readonly sha256: string }
    readonly signingBytes: Buffer
  },
  PublishFileError,
  never
> =>
  Effect.gen(function* () {
    const pathStat = yield* lstatPath(path)
    if (pathStat.isSymbolicLink()) {
      return yield* Effect.fail(
        new PublishFileError({
          operation: "lstat",
          path,
          message: "publish artifacts must not be symbolic links",
          cause: undefined
        })
      )
    }
    if (!pathStat.isDirectory()) {
      const bytes = yield* readBytes(path)
      return { digest: digestBytes(bytes), signingBytes: bytes }
    }

    const files = yield* listFiles(path)
    const hash = createHash("sha256")
    let sizeBytes = 0
    for (const file of files.toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    )) {
      hash.update(file.kind)
      hash.update("\0")
      hash.update(file.relativePath)
      hash.update("\0")
      hash.update((file.mode & 0o777).toString(8))
      hash.update("\0")
      if (file.kind !== "file") {
        hash.update("\0")
        continue
      }
      const content = yield* readBytes(file.absolutePath)
      sizeBytes += content.byteLength
      hash.update(content)
      hash.update("\0")
    }
    const sha256 = hash.digest("hex")
    return { digest: { sizeBytes, sha256 }, signingBytes: Buffer.from(sha256) }
  })

const digestBytes = (bytes: Buffer): { readonly sizeBytes: number; readonly sha256: string } => ({
  sizeBytes: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex")
})

const validateEd25519PublicKey = (
  value: string,
  field: string
): Effect.Effect<void, PublishConfigError, never> =>
  Effect.try({
    try: () => {
      publicKeyObject(value)
    },
    catch: (cause) =>
      new PublishConfigError({
        field,
        message: `invalid Ed25519 public key: ${formatUnknownError(cause)}`,
        remediation: "Use ed25519:<base64-public-key> where the decoded key is 32 bytes."
      })
  }).pipe(Effect.asVoid)

const publicKeyObject = (publicKey: string): ReturnType<typeof createPublicKey> => {
  const raw = decodeEd25519Value(publicKey, "public key")
  if (raw.length !== 32) {
    throw new Error("Ed25519 public key must be 32 bytes")
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki"
  })
}

const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u

const decodeEd25519Value = (value: string, label: string): Buffer => {
  const encoded = value.startsWith("ed25519:") ? value.slice("ed25519:".length) : undefined
  if (encoded === undefined || encoded.length === 0) {
    throw new Error(`${label} must start with ed25519:`)
  }
  if (!CANONICAL_BASE64.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(`${label} must be canonical base64`)
  }
  const decoded = Buffer.from(encoded, "base64")
  if (decoded.toString("base64") !== encoded) {
    throw new Error(`${label} must be canonical base64`)
  }
  return decoded
}

const canonicalJson = (value: unknown): string => {
  if (value === null) {
    return "null"
  }
  if (typeof value === "string") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON does not support non-finite numbers")
    }
    return JSON.stringify(value)
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  throw new Error(`canonical JSON does not support ${typeof value}`)
}

const artifactUrl = (
  feedUrl: string,
  platform: PublishTarget,
  channel: PublishChannel,
  fileName: string
): string => {
  const manifestUrl = new URL(
    feedUrl.replaceAll("{platform}", platform).replaceAll("{channel}", channel)
  )
  const encodedName = encodeURIComponent(fileName)
  const parentPath = manifestUrl.pathname.endsWith("/")
    ? manifestUrl.pathname
    : manifestUrl.pathname.slice(0, manifestUrl.pathname.lastIndexOf("/") + 1)
  manifestUrl.pathname = `${parentPath}${encodedName}`
  return manifestUrl.toString()
}

const validateFeedUrl = (feedUrl: string): Effect.Effect<void, PublishConfigError, never> =>
  Effect.gen(function* () {
    if (!feedUrl.includes("{platform}")) {
      return yield* Effect.fail(
        new PublishConfigError({
          field: "update.feedUrl",
          message: "update.feedUrl must contain the {platform} placeholder",
          remediation:
            "Set update.feedUrl to an http(s) URL template with both {platform} and {channel} placeholders, e.g. https://example.invalid/{platform}/{channel}.json"
        })
      )
    }
    if (!feedUrl.includes("{channel}")) {
      return yield* Effect.fail(
        new PublishConfigError({
          field: "update.feedUrl",
          message: "update.feedUrl must contain the {channel} placeholder",
          remediation:
            "Set update.feedUrl to an http(s) URL template with both {platform} and {channel} placeholders, e.g. https://example.invalid/{platform}/{channel}.json"
        })
      )
    }
    const substituted = feedUrl
      .replaceAll("{platform}", "macos-arm64")
      .replaceAll("{channel}", "stable")
    try {
      const url = new URL(substituted)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("URL must use http or https protocol")
      }
    } catch {
      return yield* Effect.fail(
        new PublishConfigError({
          field: "update.feedUrl",
          message:
            "update.feedUrl must be a valid http(s) URL template with {platform} and {channel} placeholders",
          remediation:
            "Set update.feedUrl to a valid absolute URL like https://example.invalid/{platform}/{channel}.json"
        })
      )
    }
  })

const readConfigObject = (
  rawConfig: unknown
): Effect.Effect<AppConfig, PublishConfigError, never> =>
  isRecord(rawConfig)
    ? Effect.succeed(rawConfig as AppConfig)
    : Effect.fail(
        new PublishConfigError({
          field: "default",
          message: "desktop config must export an object",
          remediation: "Export a default object from desktop.config.ts."
        })
      )

const readRequiredString = (
  value: unknown,
  field: string,
  remediation: string
): Effect.Effect<string, PublishConfigError, never> =>
  typeof value === "string" && value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(new PublishConfigError({ field, message: `${field} is required`, remediation }))

const readAppId = (
  value: unknown,
  field: string
): Effect.Effect<string, PublishConfigError, never> =>
  readRequiredString(value, field, "Set app.id to a reverse-DNS ASCII identifier.").pipe(
    Effect.flatMap((appId) =>
      appIdMatch(appId)
        ? Effect.succeed(appId)
        : Effect.fail(
            new PublishConfigError({
              field,
              message: `${field} must be a reverse-DNS ASCII identifier`,
              remediation: "Set app.id to a value such as dev.example.app."
            })
          )
    )
  )

const appIdMatch = (value: string): boolean =>
  /^([a-zA-Z][a-zA-Z0-9-]*)(\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value) && isContainedFileName(value)

interface Semver {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

interface SemverField {
  readonly value: string
  readonly parsed: Semver
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

const parseSemver = (value: string): Semver | undefined => {
  const match = SEMVER_PATTERN.exec(value)
  if (match === null) {
    return undefined
  }
  const [, major, minor, patch] = match
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined
  }
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10)
  }
}

const compareSemver = (left: Semver, right: Semver): number => {
  if (left.major !== right.major) {
    return left.major - right.major
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }
  return left.patch - right.patch
}

const readSemver = (
  value: string,
  field: string
): Effect.Effect<Semver, PublishConfigError, never> => {
  const parsed = parseSemver(value)
  if (parsed === undefined) {
    return Effect.fail(
      new PublishConfigError({
        field,
        message: `${field} must be a SemVer X.Y.Z string`,
        remediation: `Set ${field} to a SemVer string such as 1.2.3.`
      })
    )
  }
  return Effect.succeed(parsed)
}

const readOptionalSemver = (
  value: unknown,
  field: string
): Effect.Effect<SemverField | undefined, PublishConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  if (typeof value !== "string" || value.length === 0) {
    return Effect.fail(
      new PublishConfigError({
        field,
        message: `${field} must be a non-empty string when provided`,
        remediation: `Remove ${field} or set it to a SemVer string such as 1.2.3.`
      })
    )
  }
  const parsed = parseSemver(value)
  if (parsed === undefined) {
    return Effect.fail(
      new PublishConfigError({
        field,
        message: `${field} must be a SemVer X.Y.Z string when provided`,
        remediation: `Set ${field} to a SemVer string such as 1.2.3.`
      })
    )
  }
  return Effect.succeed({ value, parsed })
}

const readOptionalBoolean = (
  value: unknown,
  field: string
): Effect.Effect<boolean | undefined, PublishConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  if (typeof value === "boolean") {
    return Effect.succeed(value)
  }
  return Effect.fail(
    new PublishConfigError({
      field,
      message: `${field} must be a boolean when provided`,
      remediation: `Remove ${field} or set it to true or false.`
    })
  )
}

const readChannel = (value: unknown): Effect.Effect<PublishChannel, PublishConfigError, never> =>
  value === "stable" || value === "beta" || value === "canary"
    ? Effect.succeed(value)
    : Effect.fail(
        new PublishConfigError({
          field: "update.channel",
          message: "update.channel must be stable, beta, or canary",
          remediation: "Set update.channel to one of stable, beta, or canary."
        })
      )

const readPositiveInteger = (
  value: unknown,
  field: string
): Effect.Effect<number, PublishConfigError, never> =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Effect.succeed(value)
    : Effect.fail(
        new PublishConfigError({
          field,
          message: `${field} must be a positive integer`,
          remediation: `Set ${field} to a positive integer.`
        })
      )

const readNonNegativeInteger = (
  value: unknown,
  field: string
): Effect.Effect<number, PublishConfigError, never> =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Effect.succeed(value)
    : Effect.fail(
        new PublishConfigError({
          field,
          message: `${field} must be a non-negative integer`,
          remediation: "Regenerate package metadata."
        })
      )

const readContainedFileName = (
  value: unknown,
  field: string
): Effect.Effect<string, PublishConfigError, never> => {
  if (typeof value !== "string" || value.length === 0) {
    return Effect.fail(
      new PublishConfigError({
        field,
        message: `${field} is required`,
        remediation: "Regenerate package metadata."
      })
    )
  }
  if (!isContainedFileName(value)) {
    return Effect.fail(
      new PublishConfigError({
        field,
        message: `${field} must be a single file name without path separators`,
        remediation: "Regenerate package metadata with `bun desktop package`."
      })
    )
  }
  return Effect.succeed(value)
}

const isContainedFileName = (value: string): boolean => {
  if (value === "." || value === "..") {
    return false
  }
  if (value.includes("/") || value.includes("\\")) {
    return false
  }
  if (isAbsolute(value)) {
    return false
  }
  if (basename(value) !== value) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }
  return true
}

const resolveContainedArtifactPath = (
  rootPath: string,
  fileName: string,
  field: string
): Effect.Effect<string, PublishConfigError, never> => {
  const candidate = resolve(rootPath, fileName)
  const containedPrefix = `${rootPath}${sep}`
  if (candidate !== rootPath && !candidate.startsWith(containedPrefix)) {
    return Effect.fail(
      new PublishConfigError({
        field,
        message: `${field} resolves outside the artifact metadata directory`,
        remediation: "Regenerate package metadata with `bun desktop package`."
      })
    )
  }
  return Effect.succeed(candidate)
}

const readSha256 = (
  value: unknown,
  field: string
): Effect.Effect<string, PublishConfigError, never> =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new PublishConfigError({
          field,
          message: `${field} must be a lowercase SHA-256 hex digest`,
          remediation: "Regenerate package metadata."
        })
      )

const readOptionalTarget = (
  value: string | undefined
): Effect.Effect<PublishTarget | undefined, PublishConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  return decodeDesktopTarget(value).pipe(
    Effect.map((target) => target.id),
    Effect.mapError(
      () =>
        new PublishConfigError({
          field: "--platform",
          message: `unsupported publish target ${value}`,
          remediation:
            "Use macos-arm64, macos-x64, windows-x64, windows-arm64, linux-x64, or linux-arm64."
        })
    )
  )
}

const readTarget = (
  value: unknown,
  field: string
): Effect.Effect<PublishTarget, PublishConfigError, never> =>
  decodeDesktopTarget(value).pipe(
    Effect.map((target) => target.id),
    Effect.mapError(
      () =>
        new PublishConfigError({
          field,
          message: `${field} must be a supported publish target`,
          remediation: "Regenerate package metadata."
        })
    )
  )

const readArtifactKind = (
  value: unknown,
  field: string
): Effect.Effect<PublishArtifactKind, PublishConfigError, never> =>
  isDesktopArtifactKind(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new PublishConfigError({
          field,
          message: `${field} must be a supported artifact kind`,
          remediation: "Regenerate package metadata."
        })
      )

const loadConfig = (path: string): Effect.Effect<unknown, PublishConfigError, never> =>
  Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: async () => (await import(pathToFileURL(path).href)) as { readonly default?: unknown },
      catch: (cause) =>
        new PublishConfigError({
          field: "default",
          message: `failed to load config ${path}: ${formatUnknownError(cause)}`,
          remediation: "Fix desktop.config.ts before publishing."
        })
    })
    if (!isRecord(module.default)) {
      return yield* Effect.fail(
        new PublishConfigError({
          field: "default",
          message: `config ${path} must export a default object`,
          remediation: "Export a default object from desktop.config.ts."
        })
      )
    }
    return module.default
  })

const readJson = <A>(path: string): Effect.Effect<A, PublishFileError, never> =>
  Effect.tryPromise({
    try: async () => JSON.parse(await readFile(path, "utf8")) as A,
    catch: (cause) =>
      new PublishFileError({
        operation: "read-json",
        path,
        message: `failed to read JSON ${path}`,
        cause
      })
  })

const writeJson = (path: string, value: unknown): Effect.Effect<void, PublishFileError, never> =>
  Effect.tryPromise({
    try: () => writeFile(path, `${JSON.stringify(value, null, 2)}\n`),
    catch: (cause) =>
      new PublishFileError({
        operation: "write",
        path,
        message: `failed to write ${path}`,
        cause
      })
  })

const readBytes = (path: string): Effect.Effect<Buffer, PublishFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path),
    catch: (cause) =>
      new PublishFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const readDirectory = (path: string): Effect.Effect<readonly string[], PublishFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new PublishFileError({
        operation: "readdir",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

type DirectoryEntryKind = "directory" | "file"

interface DirectoryEntry {
  readonly absolutePath: string
  readonly kind: DirectoryEntryKind
  readonly relativePath: string
  readonly mode: number
}

const listFiles = (
  path: string
): Effect.Effect<readonly DirectoryEntry[], PublishFileError, never> =>
  walkDirectoryEntries(path, path)

const walkDirectoryEntries = (
  rootPath: string,
  currentPath: string
): Effect.Effect<readonly DirectoryEntry[], PublishFileError, never> =>
  Effect.gen(function* () {
    const entries = yield* readDirectory(currentPath)
    const files: DirectoryEntry[] = []
    for (const entry of entries.toSorted()) {
      const child = join(currentPath, entry)
      const childStat = yield* lstatPath(child)
      if (childStat.isSymbolicLink()) {
        return yield* Effect.fail(
          new PublishFileError({
            operation: "lstat",
            path: child,
            message: "publish directory artifacts must not contain symbolic links",
            cause: undefined
          })
        )
      }
      const childRelativePath = relative(rootPath, child)
      if (childStat.isDirectory()) {
        files.push({
          absolutePath: child,
          kind: "directory",
          relativePath: childRelativePath,
          mode: Number(childStat.mode)
        })
        files.push(...(yield* walkDirectoryEntries(rootPath, child)))
      } else {
        files.push({
          absolutePath: child,
          kind: "file",
          relativePath: childRelativePath,
          mode: Number(childStat.mode)
        })
      }
    }
    return files
  })

const statPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof stat>>, PublishFileError, never> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new PublishFileError({
        operation: "stat",
        path,
        message: `failed to stat ${path}`,
        cause
      })
  })

const lstatPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof lstat>>, PublishFileError, never> =>
  Effect.tryPromise({
    try: () => lstat(path),
    catch: (cause) =>
      new PublishFileError({
        operation: "lstat",
        path,
        message: `failed to lstat ${path}`,
        cause
      })
  })

const resolvePath = (cwd: string, path: string): string =>
  isAbsolute(path) ? path : resolve(cwd, path)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const formatUnknownError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)
