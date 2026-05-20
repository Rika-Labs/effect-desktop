import { readdir, readFile, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

import { Data, Effect, Schema } from "effect"

export interface AccessibilityGateOptions {
  readonly cwd: string
}

export class AccessibilityAuditMode extends Schema.Class<AccessibilityAuditMode>(
  "AccessibilityAuditMode"
)({
  id: Schema.String,
  direction: Schema.Literals(["ltr", "rtl"]),
  colorScheme: Schema.Literals(["light", "dark"]),
  axe: Schema.String,
  pa11y: Schema.String
}) {}

export class AccessibilityContrastPair extends Schema.Class<AccessibilityContrastPair>(
  "AccessibilityContrastPair"
)({
  id: Schema.String,
  foreground: Schema.String,
  background: Schema.String,
  minimumRatio: Schema.Number
}) {}

export class AccessibilityRequiredToken extends Schema.Class<AccessibilityRequiredToken>(
  "AccessibilityRequiredToken"
)({
  file: Schema.String,
  token: Schema.String
}) {}

export class AccessibilityTemplate extends Schema.Class<AccessibilityTemplate>(
  "AccessibilityTemplate"
)({
  id: Schema.String,
  root: Schema.String,
  sourceFiles: Schema.Array(Schema.String),
  i18nFiles: Schema.Array(Schema.String),
  auditDir: Schema.String,
  auditModes: Schema.Array(AccessibilityAuditMode),
  contrastPairs: Schema.Array(AccessibilityContrastPair),
  requiredTokens: Schema.Array(AccessibilityRequiredToken)
}) {}

export class AccessibilityManifest extends Schema.Class<AccessibilityManifest>(
  "AccessibilityManifest"
)({
  schemaVersion: Schema.Literal(1),
  source: Schema.String,
  release: Schema.String,
  templates: Schema.Array(AccessibilityTemplate)
}) {}

export interface AccessibilityGateReport {
  readonly passed: true
  readonly release: string
  readonly templates: readonly AccessibilityTemplateReport[]
}

export interface AccessibilityTemplateReport {
  readonly id: string
  readonly auditModes: number
  readonly contrastPairs: number
  readonly scannedFiles: number
}

export class AccessibilityGateFileError extends Data.TaggedError("AccessibilityGateFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class AccessibilityGateManifestError extends Data.TaggedError(
  "AccessibilityGateManifestError"
)<{
  readonly message: string
}> {}

export class AccessibilityGateEvidenceError extends Data.TaggedError(
  "AccessibilityGateEvidenceError"
)<{
  readonly template: string
  readonly message: string
}> {}

export type AccessibilityGateError =
  | AccessibilityGateFileError
  | AccessibilityGateManifestError
  | AccessibilityGateEvidenceError

interface AxeAudit {
  readonly url?: string
  readonly testEngine?: { readonly name?: string }
  readonly violations?: readonly unknown[]
  readonly incomplete?: readonly unknown[]
  readonly passes?: readonly unknown[]
}

interface Pa11yAudit {
  readonly url?: string
  readonly runner?: string
  readonly standard?: string
  readonly issues?: readonly unknown[]
}

interface ResolvedAccessibilityTemplate {
  readonly root: string
  readonly auditDir: string
  readonly sourceFiles: readonly string[]
  readonly i18nFiles: ReadonlySet<string>
  readonly auditModes: readonly ResolvedAccessibilityAuditMode[]
  readonly requiredTokens: readonly ResolvedAccessibilityRequiredToken[]
}

interface ResolvedAccessibilityAuditMode extends AccessibilityAuditMode {
  readonly axePath: string
  readonly pa11yPath: string
}

interface ResolvedAccessibilityRequiredToken extends AccessibilityRequiredToken {
  readonly filePath: string
}

const MANIFEST_PATH = "release/accessibility.json"
const SPEC_SOURCE = "engineering/SPEC.md §25.5"
const REQUIRED_AUDIT_MODES = new Map<
  string,
  { readonly direction: "ltr" | "rtl"; readonly colorScheme: "light" | "dark" }
>([
  ["light-ltr", { direction: "ltr", colorScheme: "light" }],
  ["dark-ltr", { direction: "ltr", colorScheme: "dark" }],
  ["light-rtl", { direction: "rtl", colorScheme: "light" }],
  ["dark-rtl", { direction: "rtl", colorScheme: "dark" }]
])
const USER_VISIBLE_TEXT_PATTERN =
  /(?:"([^"]*[A-Za-z][A-Za-z ]{3,}[^"]*)"|'([^']*[A-Za-z][A-Za-z ]{3,}[^']*)'|>([^<>{}]*[A-Za-z][A-Za-z ]{3,}[^<{}]*)<)/g
const StrictParseOptions = { errors: "all", onExcessProperty: "error" } as const

export const runAccessibilityGate = (
  options: AccessibilityGateOptions
): Effect.Effect<AccessibilityGateReport, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    const rawManifest = yield* readJson<unknown>(resolve(options.cwd, MANIFEST_PATH))
    const manifest = yield* decodeAccessibilityManifest(rawManifest)
    yield* validateManifest(manifest)

    const reports: AccessibilityTemplateReport[] = []
    for (const template of manifest.templates) {
      yield* validateTemplate(options.cwd, template)
      reports.push({
        id: template.id,
        auditModes: template.auditModes.length,
        contrastPairs: template.contrastPairs.length,
        scannedFiles: template.sourceFiles.length
      })
    }

    return {
      passed: true,
      release: manifest.release,
      templates: reports
    }
  })

export const formatAccessibilityGateReport = (report: AccessibilityGateReport): string =>
  [
    "ORIKA accessibility",
    "status            passed",
    `release           ${report.release}`,
    `templates         ${report.templates.length}`,
    ...report.templates.map(
      (template) =>
        `${template.id.padEnd(28)} ${template.auditModes} modes, ${template.contrastPairs} contrast pairs`
    ),
    ""
  ].join("\n")

export const formatAccessibilityGateError = (
  error: AccessibilityGateError
): { readonly tag: string; readonly message: string } => ({
  tag: error._tag,
  message: error.message
})

const validateManifest = (
  manifest: AccessibilityManifest
): Effect.Effect<void, AccessibilityGateManifestError, never> => {
  if (manifest.schemaVersion !== 1) {
    return Effect.fail(
      new AccessibilityGateManifestError({
        message: "accessibility manifest schemaVersion must be 1"
      })
    )
  }
  if (manifest.source !== SPEC_SOURCE) {
    return Effect.fail(
      new AccessibilityGateManifestError({
        message: `accessibility manifest source must be ${SPEC_SOURCE}`
      })
    )
  }
  if (manifest.release.length === 0) {
    return Effect.fail(
      new AccessibilityGateManifestError({ message: "accessibility manifest release is required" })
    )
  }
  const ids = new Set<string>()
  for (const template of manifest.templates) {
    if (template.id.length === 0 || template.root.length === 0 || template.auditDir.length === 0) {
      return Effect.fail(
        new AccessibilityGateManifestError({ message: "accessibility templates must be named" })
      )
    }
    if (ids.has(template.id)) {
      return Effect.fail(
        new AccessibilityGateManifestError({
          message: `duplicate accessibility template ${template.id}`
        })
      )
    }
    ids.add(template.id)
  }
  return Effect.void
}

export const decodeAccessibilityManifest = (
  value: unknown
): Effect.Effect<AccessibilityManifest, AccessibilityGateManifestError, never> =>
  Schema.decodeUnknownEffect(AccessibilityManifest)(value, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new AccessibilityGateManifestError({
          message: `accessibility manifest schema validation failed: ${error.message}`
        })
    )
  )

const resolveTemplatePaths = (
  cwd: string,
  template: AccessibilityTemplate
): Effect.Effect<ResolvedAccessibilityTemplate, AccessibilityGateEvidenceError, never> =>
  Effect.gen(function* () {
    const workspaceRoot = resolve(cwd)
    const root = yield* containedPath(workspaceRoot, workspaceRoot, template.root, template, "root")
    const auditDir = yield* containedPath(
      workspaceRoot,
      workspaceRoot,
      template.auditDir,
      template,
      "auditDir"
    )
    const sourceFiles = yield* Effect.all(
      template.sourceFiles.map((file) =>
        containedPath(workspaceRoot, root, file, template, "sourceFiles")
      )
    )
    const i18nFiles = yield* Effect.all(
      template.i18nFiles.map((file) =>
        containedPath(workspaceRoot, root, file, template, "i18nFiles")
      )
    )
    const auditModes = yield* Effect.all(
      template.auditModes.map((mode) =>
        Effect.gen(function* () {
          const axePath = yield* containedPath(workspaceRoot, auditDir, mode.axe, template, "axe")
          const pa11yPath = yield* containedPath(
            workspaceRoot,
            auditDir,
            mode.pa11y,
            template,
            "pa11y"
          )
          return Object.assign({}, mode, { axePath, pa11yPath })
        })
      )
    )
    const requiredTokens = yield* Effect.all(
      template.requiredTokens.map((required) =>
        containedPath(workspaceRoot, root, required.file, template, "requiredTokens.file").pipe(
          Effect.map((filePath) => Object.assign({}, required, { filePath }))
        )
      )
    )
    return {
      root,
      auditDir,
      sourceFiles,
      i18nFiles: new Set(i18nFiles),
      auditModes,
      requiredTokens
    }
  })

const containedPath = (
  workspaceRoot: string,
  allowedRoot: string,
  path: string,
  template: AccessibilityTemplate,
  field: string
): Effect.Effect<string, AccessibilityGateEvidenceError, never> => {
  const resolved = resolve(workspaceRoot, path)
  if (!isInsidePath(resolved, allowedRoot)) {
    return evidenceError(template, `${field} ${path} must stay inside ${allowedRoot}`)
  }
  return Effect.succeed(resolved)
}

const isInsidePath = (path: string, root: string): boolean => {
  const child = resolve(path)
  const parent = resolve(root)
  const difference = relative(parent, child)
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference))
}

const validateTemplate = (
  cwd: string,
  template: AccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    const paths = yield* resolveTemplatePaths(cwd, template)
    yield* validateAuditModes(template, paths)
    yield* validateManualAudit(template, paths)
    yield* validateExternalizedStrings(template, paths)
    yield* validateRequiredTokens(template, paths)
    yield* validateContrast(template)
  })

const validateAuditModes = (
  template: AccessibilityTemplate,
  paths: ResolvedAccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    const modeCounts = new Map<string, number>()
    for (const mode of template.auditModes) {
      modeCounts.set(mode.id, (modeCounts.get(mode.id) ?? 0) + 1)
    }
    for (const [required, expected] of REQUIRED_AUDIT_MODES) {
      if ((modeCounts.get(required) ?? 0) === 0) {
        return yield* Effect.fail(
          new AccessibilityGateEvidenceError({
            template: template.id,
            message: `template ${template.id} is missing audit mode ${required}`
          })
        )
      }
      if ((modeCounts.get(required) ?? 0) > 1) {
        return yield* evidenceError(
          template,
          `template ${template.id} duplicates audit mode ${required}`
        )
      }
      const mode = template.auditModes.find((candidate) => candidate.id === required)
      if (mode === undefined) {
        return yield* evidenceError(
          template,
          `template ${template.id} is missing audit mode ${required}`
        )
      }
      if (mode.direction !== expected.direction) {
        return yield* evidenceError(template, `${required} direction must be ${expected.direction}`)
      }
      if (mode.colorScheme !== expected.colorScheme) {
        return yield* evidenceError(
          template,
          `${required} colorScheme must be ${expected.colorScheme}`
        )
      }
    }

    for (const mode of paths.auditModes) {
      const axe = yield* readJson<AxeAudit>(mode.axePath)
      if (axe.testEngine?.name !== "axe-core") {
        return yield* evidenceError(template, `${mode.axe} must be an axe-core audit`)
      }
      if ((axe.violations ?? []).length > 0) {
        return yield* evidenceError(template, `${mode.axe} contains axe violations`)
      }
      if ((axe.incomplete ?? []).length > 0) {
        return yield* evidenceError(template, `${mode.axe} contains incomplete axe checks`)
      }
      if ((axe.passes ?? []).length === 0) {
        return yield* evidenceError(template, `${mode.axe} has no axe pass evidence`)
      }
      if (!auditUrlMatchesMode(axe.url, mode)) {
        return yield* evidenceError(
          template,
          `${mode.axe} must target ${mode.direction}/${mode.colorScheme} rendered template state`
        )
      }

      const pa11y = yield* readJson<Pa11yAudit>(mode.pa11yPath)
      if (pa11y.runner !== "pa11y") {
        return yield* evidenceError(template, `${mode.pa11y} must be a Pa11y audit`)
      }
      if (pa11y.standard !== "WCAG2AA") {
        return yield* evidenceError(template, `${mode.pa11y} must use WCAG2AA`)
      }
      if ((pa11y.issues ?? []).length > 0) {
        return yield* evidenceError(template, `${mode.pa11y} contains Pa11y issues`)
      }
      if (!auditUrlMatchesMode(pa11y.url, mode)) {
        return yield* evidenceError(
          template,
          `${mode.pa11y} must target ${mode.direction}/${mode.colorScheme} rendered template state`
        )
      }
    }
  })

const validateManualAudit = (
  template: AccessibilityTemplate,
  paths: ResolvedAccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    const auditFiles = yield* listDirectory(paths.auditDir)
    const body = yield* readText(resolve(paths.auditDir, "manual-keyboard.md"))
    const requiredTokens = [
      template.id,
      "Keyboard-only walkthrough",
      "Screencast:",
      "RTL example:",
      "Sign-off:"
    ]
    for (const token of requiredTokens) {
      if (!body.includes(token)) {
        return yield* evidenceError(template, `manual keyboard audit is missing ${token}`)
      }
    }
    const screencastFiles = auditFiles.filter(
      (file) => file.endsWith(".webm") || file.endsWith(".mp4")
    )
    const hasScreencastFile = yield* hasRegularFile(
      screencastFiles.map((file) => resolve(paths.auditDir, file))
    )
    if (!hasScreencastFile) {
      return yield* evidenceError(template, "manual keyboard audit is missing a screencast file")
    }
  })

const validateExternalizedStrings = (
  template: AccessibilityTemplate,
  paths: ResolvedAccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    for (const [index, file] of template.sourceFiles.entries()) {
      if (!file.endsWith(".tsx") && !file.endsWith(".jsx")) {
        continue
      }
      const sourcePath = paths.sourceFiles[index]
      if (sourcePath === undefined) {
        return yield* evidenceError(template, `${file} could not be resolved`)
      }
      const body = yield* readText(sourcePath)
      if (paths.i18nFiles.has(sourcePath)) {
        continue
      }
      const findings = [...body.matchAll(USER_VISIBLE_TEXT_PATTERN)]
        .map((match) => ({
          value: (match[1] ?? match[2] ?? match[3] ?? "").trim(),
          index: match.index ?? 0
        }))
        .filter((finding) => isUserVisibleEnglish(body, finding.index, finding.value))
      if (findings.length > 0) {
        return yield* evidenceError(
          template,
          `${file} has hardcoded user-visible English: ${findings[0]?.value ?? "unknown text"}`
        )
      }
    }
  })

const validateRequiredTokens = (
  template: AccessibilityTemplate,
  paths: ResolvedAccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    for (const required of paths.requiredTokens) {
      const body = yield* readText(required.filePath)
      if (!hasRequiredTokenEvidence(required, body)) {
        return yield* evidenceError(
          template,
          `${required.file} is missing required token ${required.token}`
        )
      }
    }
  })

const hasRequiredTokenEvidence = (required: AccessibilityRequiredToken, body: string): boolean => {
  const uncommented = stripSourceComments(body)
  if (required.token === "prefers-reduced-motion" || required.token === "prefers-color-scheme") {
    return new RegExp(`@media\\s*\\([^)]*\\b${escapeRegExp(required.token)}\\b`).test(uncommented)
  }
  return uncommented.includes(required.token)
}

const stripSourceComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const auditUrlMatchesMode = (url: string | undefined, mode: AccessibilityAuditMode): boolean => {
  if (url === undefined || url.length === 0) {
    return false
  }
  const parsed = parseAuditUrl(url)
  if (parsed === undefined) {
    return false
  }
  if (parsed.searchParams.get("dir") !== mode.direction) {
    return false
  }
  if (parsed.searchParams.get("color-scheme") !== mode.colorScheme) {
    return false
  }
  return mode.direction === "rtl" ? parsed.searchParams.get("lang") === "ar" : true
}

const parseAuditUrl = (url: string): URL | undefined => {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

const validateContrast = (
  template: AccessibilityTemplate
): Effect.Effect<void, AccessibilityGateEvidenceError, never> => {
  for (const pair of template.contrastPairs) {
    if (!Number.isFinite(pair.minimumRatio) || pair.minimumRatio <= 0 || pair.minimumRatio > 21) {
      return Effect.fail(
        new AccessibilityGateEvidenceError({
          template: template.id,
          message: `${pair.id} minimumRatio must be greater than 0 and no more than 21`
        })
      )
    }
    const foreground = parseHexColor(pair.foreground)
    if (foreground === undefined) {
      return invalidContrastColor(template, pair, "foreground")
    }
    const background = parseHexColor(pair.background)
    if (background === undefined) {
      return invalidContrastColor(template, pair, "background")
    }
    const ratio = contrastRatio(foreground, background)
    if (ratio < pair.minimumRatio) {
      return Effect.fail(
        new AccessibilityGateEvidenceError({
          template: template.id,
          message: `${pair.id} contrast ratio ${ratio.toFixed(2)} is below ${pair.minimumRatio}`
        })
      )
    }
  }
  return Effect.void
}

const invalidContrastColor = (
  template: AccessibilityTemplate,
  pair: AccessibilityContrastPair,
  field: "foreground" | "background"
): Effect.Effect<never, AccessibilityGateEvidenceError, never> =>
  Effect.fail(
    new AccessibilityGateEvidenceError({
      template: template.id,
      message: `${pair.id} ${field} must be a six-digit hex color`
    })
  )

const evidenceError = (
  template: AccessibilityTemplate,
  message: string
): Effect.Effect<never, AccessibilityGateEvidenceError, never> =>
  Effect.fail(new AccessibilityGateEvidenceError({ template: template.id, message }))

const isUserVisibleEnglish = (body: string, index: number, value: string): boolean => {
  if (value.length < 4) {
    return false
  }
  if (value.includes("\n")) {
    return false
  }
  const prefix = body.slice(Math.max(0, index - 24), index)
  if (/\bfrom\s*$|\bimport\s*$|\bclassName=\s*$/.test(prefix)) {
    return false
  }
  if (value.includes("/") || value.includes("@")) {
    return false
  }
  if (/^(Idle|Running|Succeeded|Failed|Unavailable|button|main|section|div|p|h1)$/.test(value)) {
    return false
  }
  return /[A-Za-z]{4,}/.test(value)
}

const contrastRatio = (
  foreground: readonly [number, number, number],
  background: readonly [number, number, number]
): number => {
  const left = relativeLuminance(foreground)
  const right = relativeLuminance(background)
  const lighter = Math.max(left, right)
  const darker = Math.min(left, right)
  return (lighter + 0.05) / (darker + 0.05)
}

const parseHexColor = (value: string): readonly [number, number, number] | undefined => {
  if (!/^#?[0-9A-Fa-f]{6}$/.test(value)) {
    return undefined
  }
  const normalized = value.startsWith("#") ? value.slice(1) : value
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return [red, green, blue]
}

const relativeLuminance = ([red, green, blue]: readonly [number, number, number]): number =>
  0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue)

const linearize = (channel: number): number => {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

const readJson = <A>(path: string): Effect.Effect<A, AccessibilityGateFileError, never> =>
  readText(path).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(body).pipe(
        Effect.map((value) => value as A),
        Effect.mapError(
          (cause) =>
            new AccessibilityGateFileError({
              operation: "parse-json",
              path,
              message: `failed to parse JSON at ${path}`,
              cause
            })
        )
      )
    )
  )

const readText = (path: string): Effect.Effect<string, AccessibilityGateFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new AccessibilityGateFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const listDirectory = (
  path: string
): Effect.Effect<readonly string[], AccessibilityGateFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new AccessibilityGateFileError({
        operation: "readdir",
        path,
        message: `failed to read directory ${path}`,
        cause
      })
  })

const hasRegularFile = (
  paths: readonly string[]
): Effect.Effect<boolean, AccessibilityGateFileError, never> =>
  Effect.gen(function* () {
    for (const path of paths) {
      const entry = yield* Effect.tryPromise({
        try: () => stat(path),
        catch: (cause) =>
          new AccessibilityGateFileError({
            operation: "stat",
            path,
            message: `failed to stat ${path}`,
            cause
          })
      })
      if (entry.isFile()) {
        return true
      }
    }
    return false
  })
