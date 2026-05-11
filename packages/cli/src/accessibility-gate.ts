import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { Data, Effect } from "effect"

export interface AccessibilityGateOptions {
  readonly cwd: string
}

export interface AccessibilityManifest {
  readonly schemaVersion: 1
  readonly source: string
  readonly release: string
  readonly templates: readonly AccessibilityTemplate[]
}

export interface AccessibilityTemplate {
  readonly id: string
  readonly root: string
  readonly sourceFiles: readonly string[]
  readonly i18nFiles: readonly string[]
  readonly auditDir: string
  readonly auditModes: readonly AccessibilityAuditMode[]
  readonly contrastPairs: readonly AccessibilityContrastPair[]
  readonly requiredTokens: readonly AccessibilityRequiredToken[]
}

export interface AccessibilityAuditMode {
  readonly id: string
  readonly direction: "ltr" | "rtl"
  readonly colorScheme: "light" | "dark"
  readonly axe: string
  readonly pa11y: string
}

export interface AccessibilityContrastPair {
  readonly id: string
  readonly foreground: string
  readonly background: string
  readonly minimumRatio: number
}

export interface AccessibilityRequiredToken {
  readonly file: string
  readonly token: string
}

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
  readonly runner?: string
  readonly standard?: string
  readonly issues?: readonly unknown[]
}

const MANIFEST_PATH = "release/accessibility.json"
const SPEC_SOURCE = "docs/SPEC.md §25.5"
const REQUIRED_TEMPLATE_ID = "basic-react-tailwind"
const REQUIRED_AUDIT_MODES = new Set(["light-ltr", "dark-ltr", "light-rtl", "dark-rtl"])
const USER_VISIBLE_TEXT_PATTERN =
  /(?:"([^"]*[A-Za-z][A-Za-z ]{3,}[^"]*)"|'([^']*[A-Za-z][A-Za-z ]{3,}[^']*)'|>([^<>{}]*[A-Za-z][A-Za-z ]{3,}[^<{}]*)<)/g

export const runAccessibilityGate = (
  options: AccessibilityGateOptions
): Effect.Effect<AccessibilityGateReport, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    const manifest = yield* readJson<AccessibilityManifest>(join(options.cwd, MANIFEST_PATH))
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
    "Effect Desktop accessibility",
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
  if (!ids.has(REQUIRED_TEMPLATE_ID)) {
    return Effect.fail(
      new AccessibilityGateManifestError({
        message: `accessibility manifest is missing required template ${REQUIRED_TEMPLATE_ID}`
      })
    )
  }
  return Effect.void
}

const validateTemplate = (
  cwd: string,
  template: AccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    yield* validateAuditModes(cwd, template)
    yield* validateManualAudit(cwd, template)
    yield* validateExternalizedStrings(cwd, template)
    yield* validateRequiredTokens(cwd, template)
    yield* validateContrast(template)
  })

const validateAuditModes = (
  cwd: string,
  template: AccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    const modeIds = new Set(template.auditModes.map((mode) => mode.id))
    for (const required of REQUIRED_AUDIT_MODES) {
      if (!modeIds.has(required)) {
        return yield* Effect.fail(
          new AccessibilityGateEvidenceError({
            template: template.id,
            message: `template ${template.id} is missing audit mode ${required}`
          })
        )
      }
    }

    for (const mode of template.auditModes) {
      const axe = yield* readJson<AxeAudit>(join(cwd, mode.axe))
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

      const pa11y = yield* readJson<Pa11yAudit>(join(cwd, mode.pa11y))
      if (pa11y.runner !== "pa11y") {
        return yield* evidenceError(template, `${mode.pa11y} must be a Pa11y audit`)
      }
      if (pa11y.standard !== "WCAG2AA") {
        return yield* evidenceError(template, `${mode.pa11y} must use WCAG2AA`)
      }
      if ((pa11y.issues ?? []).length > 0) {
        return yield* evidenceError(template, `${mode.pa11y} contains Pa11y issues`)
      }
    }
  })

const validateManualAudit = (
  cwd: string,
  template: AccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    const auditFiles = yield* listDirectory(join(cwd, template.auditDir))
    const body = yield* readText(join(cwd, template.auditDir, "manual-keyboard.md"))
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
    if (!auditFiles.some((file) => file.endsWith(".webm") || file.endsWith(".mp4"))) {
      return yield* evidenceError(template, "manual keyboard audit is missing a screencast file")
    }
  })

const validateExternalizedStrings = (
  cwd: string,
  template: AccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    const i18nFiles = new Set(template.i18nFiles)
    for (const file of template.sourceFiles) {
      if (!file.endsWith(".tsx") && !file.endsWith(".jsx")) {
        continue
      }
      const body = yield* readText(join(cwd, file))
      if (i18nFiles.has(file)) {
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
  cwd: string,
  template: AccessibilityTemplate
): Effect.Effect<void, AccessibilityGateError, never> =>
  Effect.gen(function* () {
    for (const required of template.requiredTokens) {
      const body = yield* readText(join(cwd, required.file))
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
  if (!url.includes(`dir=${mode.direction}`)) {
    return false
  }
  if (!url.includes(`color-scheme=${mode.colorScheme}`)) {
    return false
  }
  return mode.direction === "rtl" ? url.includes("lang=ar") : true
}

const validateContrast = (
  template: AccessibilityTemplate
): Effect.Effect<void, AccessibilityGateEvidenceError, never> => {
  for (const pair of template.contrastPairs) {
    const ratio = contrastRatio(pair.foreground, pair.background)
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
  if (/^[A-Z][A-Za-z]+$/.test(value)) {
    return false
  }
  return /[A-Za-z]{4,}/.test(value)
}

const contrastRatio = (foreground: string, background: string): number => {
  const left = relativeLuminance(parseHexColor(foreground))
  const right = relativeLuminance(parseHexColor(background))
  const lighter = Math.max(left, right)
  const darker = Math.min(left, right)
  return (lighter + 0.05) / (darker + 0.05)
}

const parseHexColor = (value: string): readonly [number, number, number] => {
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
      Effect.try({
        try: () => JSON.parse(body) as A,
        catch: (cause) =>
          new AccessibilityGateFileError({
            operation: "parse-json",
            path,
            message: `failed to parse JSON at ${path}`,
            cause
          })
      })
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
