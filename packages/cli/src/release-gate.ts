import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { Data, Effect, Schema } from "effect"

export interface ReleaseGateOptions {
  readonly cwd: string
}

export const ReleaseGateEvidenceKind = Schema.Literals([
  "workflow-step",
  "policy-document",
  "repository-setting"
])
export type ReleaseGateEvidenceKind = typeof ReleaseGateEvidenceKind.Type

export class ReleaseChecklistGate extends Schema.Class<ReleaseChecklistGate>(
  "ReleaseChecklistGate"
)({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  kind: ReleaseGateEvidenceKind,
  evidence: Schema.Array(Schema.NonEmptyString)
}) {}

export class ReleaseSubject extends Schema.Class<ReleaseSubject>("ReleaseSubject")({
  id: Schema.NonEmptyString,
  configPath: Schema.NonEmptyString,
  distDir: Schema.NonEmptyString,
  requiredCommands: Schema.Array(Schema.NonEmptyString)
}) {}

export class ReleaseChecklist extends Schema.Class<ReleaseChecklist>("ReleaseChecklist")({
  schemaVersion: Schema.Literal(1),
  source: Schema.NonEmptyString,
  subjects: Schema.Array(ReleaseSubject),
  gates: Schema.Array(ReleaseChecklistGate)
}) {}

export interface ReleaseGateReport {
  readonly passed: boolean
  readonly gates: readonly ReleaseGateCheckReport[]
}

export interface ReleaseGateCheckReport {
  readonly id: string
  readonly title: string
  readonly kind: ReleaseGateEvidenceKind
  readonly evidence: readonly string[]
}

export class ReleaseGateFileError extends Data.TaggedError("ReleaseGateFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class ReleaseGateManifestError extends Data.TaggedError("ReleaseGateManifestError")<{
  readonly message: string
}> {}

export class ReleaseGateEvidenceError extends Data.TaggedError("ReleaseGateEvidenceError")<{
  readonly gate: string
  readonly message: string
}> {}

export type ReleaseGateError =
  | ReleaseGateFileError
  | ReleaseGateManifestError
  | ReleaseGateEvidenceError

const CHECKLIST_PATH = "release/checklist.json"
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml"
const RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml"
const KEY_MANAGEMENT_PATH = "docs/security/key-management.md"
const RELEASE_SETTINGS_PATH = "docs/security/release-settings.md"
const EXEMPTIONS_PATH = "docs/security/exemptions"
const SPEC_SOURCE = "docs/SPEC.md §25.4"
const StrictParseOptions = { errors: "all", onExcessProperty: "error" } as const

const REQUIRED_GATES: ReadonlyMap<string, ReleaseGateEvidenceKind> = new Map([
  ["spdx-sbom", "workflow-step"],
  ["cvss-scan", "workflow-step"],
  ["reproducible-build", "workflow-step"],
  ["slsa-provenance", "workflow-step"],
  ["hsm-signing", "policy-document"],
  ["secret-scanning", "repository-setting"],
  ["ephemeral-runners", "repository-setting"],
  ["branch-protection", "repository-setting"]
])

const RELEASE_WORKFLOW_TOKENS: ReadonlyMap<string, readonly string[]> = new Map([
  ["spdx-sbom", ["anchore/sbom-action", "format: spdx-json", "sbom-artifacts", "sbom-path"]],
  ["cvss-scan", ["anchore/scan-action", "severity-cutoff: high", "docs/security/exemptions"]],
  ["reproducible-build", ["bun packages/cli/src/bin.ts check --repro"]],
  [
    "slsa-provenance",
    ["actions/attest", "subject-path", "dist/desktop", "attestations: write", "id-token: write"]
  ],
  ["hsm-signing", ["RELEASE_SIGNING_BACKEND", "hsm", "bun packages/cli/src/bin.ts sign"]]
])

const CI_WORKFLOW_TOKENS: ReadonlyMap<string, readonly string[]> = new Map([
  ["spdx-sbom", ["bun packages/cli/src/bin.ts check --release"]],
  ["cvss-scan", ["bun packages/cli/src/bin.ts check --release"]],
  ["reproducible-build", ["bun desktop check --repro regression tests"]],
  ["secret-scanning", ['branches: ["**"]']],
  ["ephemeral-runners", ["ubuntu-latest", "macos-latest", "windows-latest"]],
  ["branch-protection", ["bun packages/cli/src/bin.ts check --release"]]
])

const RELEASE_GATE_EVIDENCE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["spdx-sbom", new Set([".github/workflows/release.yml#Generate SPDX SBOM"])],
  [
    "cvss-scan",
    new Set([
      ".github/workflows/release.yml#Scan release SBOM for high vulnerabilities",
      "docs/security/release-settings.md#docs/security/exemptions"
    ])
  ],
  ["reproducible-build", new Set([".github/workflows/release.yml#Reproducible build gate"])],
  ["slsa-provenance", new Set([".github/workflows/release.yml#Attest release provenance"])],
  [
    "hsm-signing",
    new Set([
      "docs/security/key-management.md#HSM-backed",
      "docs/security/key-management.md#runner-local keys are forbidden"
    ])
  ],
  [
    "secret-scanning",
    new Set(["docs/security/release-settings.md#Secret scanning is enabled for every branch"])
  ],
  [
    "ephemeral-runners",
    new Set([
      "docs/security/release-settings.md#GitHub-hosted runners",
      "docs/security/release-settings.md#persistent self-hosted runners are forbidden"
    ])
  ],
  [
    "branch-protection",
    new Set([
      "docs/security/release-settings.md#main requires at least one review",
      "docs/security/release-settings.md#release branches require at least two reviews"
    ])
  ]
])

const RELEASE_EVIDENCE_SOURCES = [
  {
    prefix: `${RELEASE_WORKFLOW_PATH}#`,
    name: "release workflow",
    read: (files: ReleaseEvidenceFiles): string => files.releaseWorkflow
  },
  {
    prefix: `${CI_WORKFLOW_PATH}#`,
    name: "CI workflow",
    read: (files: ReleaseEvidenceFiles): string => files.ciWorkflow
  },
  {
    prefix: `${KEY_MANAGEMENT_PATH}#`,
    name: "key-management",
    read: (files: ReleaseEvidenceFiles): string => files.keyManagement
  },
  {
    prefix: `${RELEASE_SETTINGS_PATH}#`,
    name: "release-settings",
    read: (files: ReleaseEvidenceFiles): string => files.releaseSettings
  }
] as const

interface ReleaseEvidenceFiles {
  readonly ciWorkflow: string
  readonly releaseWorkflow: string
  readonly keyManagement: string
  readonly releaseSettings: string
}

export const runReleaseGate = (
  options: ReleaseGateOptions
): Effect.Effect<ReleaseGateReport, ReleaseGateError, never> =>
  Effect.gen(function* () {
    const rawChecklist = yield* readJson<unknown>(join(options.cwd, CHECKLIST_PATH))
    const checklist = yield* decodeReleaseChecklist(rawChecklist)
    yield* validateChecklist(checklist)

    const ciWorkflow = yield* readText(join(options.cwd, CI_WORKFLOW_PATH))
    const releaseWorkflow = yield* readText(join(options.cwd, RELEASE_WORKFLOW_PATH))
    const keyManagement = yield* readText(join(options.cwd, KEY_MANAGEMENT_PATH))
    const releaseSettings = yield* readText(join(options.cwd, RELEASE_SETTINGS_PATH))

    yield* validateWorkflowActionPins(RELEASE_WORKFLOW_PATH, releaseWorkflow)
    yield* validateWorkflowActionPins(CI_WORKFLOW_PATH, ciWorkflow)
    yield* validateReleaseRunnerPosture(releaseWorkflow)
    yield* validateReleaseSubjectWorkflow(checklist.subjects, releaseWorkflow)
    yield* validatePolicyDocuments({ keyManagement, releaseSettings })
    yield* validateExemptions(join(options.cwd, EXEMPTIONS_PATH))

    for (const gate of checklist.gates) {
      yield* validateGateEvidence(gate, {
        ciWorkflow,
        releaseWorkflow,
        keyManagement,
        releaseSettings
      })
    }

    return {
      passed: true,
      gates: checklist.gates.map((gate) => ({
        id: gate.id,
        title: gate.title,
        kind: gate.kind,
        evidence: gate.evidence
      }))
    }
  })

export const formatReleaseGateReport = (report: ReleaseGateReport): string =>
  [
    "Effect Desktop release gates",
    `status            ${report.passed ? "passed" : "failed"}`,
    `gates             ${report.gates.length}`,
    ...report.gates.map((gate) => `${gate.id.padEnd(22)} ${gate.kind}`),
    ""
  ].join("\n")

export const formatReleaseGateError = (
  error: ReleaseGateError
): { readonly tag: string; readonly message: string } => ({
  tag: error._tag,
  message: error.message
})

const validateChecklist = (
  checklist: ReleaseChecklist
): Effect.Effect<void, ReleaseGateManifestError, never> => {
  if (checklist.schemaVersion !== 1) {
    return Effect.fail(
      new ReleaseGateManifestError({ message: "release checklist schemaVersion must be 1" })
    )
  }
  if (checklist.source !== SPEC_SOURCE) {
    return Effect.fail(
      new ReleaseGateManifestError({ message: `release checklist source must be ${SPEC_SOURCE}` })
    )
  }
  if (checklist.subjects.length === 0) {
    return Effect.fail(
      new ReleaseGateManifestError({
        message: "release checklist must declare at least one release subject"
      })
    )
  }
  if (checklist.gates.length !== REQUIRED_GATES.size) {
    return Effect.fail(
      new ReleaseGateManifestError({
        message: `release checklist must declare exactly ${REQUIRED_GATES.size} §25.4 gates`
      })
    )
  }

  const ids = new Set<string>()
  for (const gate of checklist.gates) {
    if (gate.id.length === 0 || gate.title.length === 0 || gate.evidence.length === 0) {
      return Effect.fail(new ReleaseGateManifestError({ message: "release gates must be named" }))
    }
    if (ids.has(gate.id)) {
      return Effect.fail(
        new ReleaseGateManifestError({ message: `duplicate release gate ${gate.id}` })
      )
    }
    const requiredKind = REQUIRED_GATES.get(gate.id)
    if (requiredKind === undefined) {
      return Effect.fail(
        new ReleaseGateManifestError({ message: `unknown §25.4 release gate ${gate.id}` })
      )
    }
    if (gate.kind !== requiredKind) {
      return Effect.fail(
        new ReleaseGateManifestError({
          message: `release gate ${gate.id} must use evidence kind ${requiredKind}`
        })
      )
    }
    ids.add(gate.id)
  }

  const subjectIds = new Set<string>()
  for (const subject of checklist.subjects) {
    if (subject.requiredCommands.length === 0) {
      return Effect.fail(
        new ReleaseGateManifestError({
          message: `release subject ${subject.id} must declare required commands`
        })
      )
    }
    if (subjectIds.has(subject.id)) {
      return Effect.fail(
        new ReleaseGateManifestError({ message: `duplicate release subject ${subject.id}` })
      )
    }
    subjectIds.add(subject.id)
  }

  for (const id of REQUIRED_GATES.keys()) {
    if (!ids.has(id)) {
      return Effect.fail(
        new ReleaseGateManifestError({ message: `release checklist is missing §25.4 gate ${id}` })
      )
    }
  }
  return Effect.void
}

const decodeReleaseChecklist = (
  value: unknown
): Effect.Effect<ReleaseChecklist, ReleaseGateManifestError, never> =>
  Schema.decodeUnknownEffect(ReleaseChecklist)(value, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new ReleaseGateManifestError({
          message: `release checklist schema validation failed: ${error.message}`
        })
    )
  )

const releaseEvidenceError = (
  gate: ReleaseChecklistGate,
  message: string
): { readonly _tag: "Left"; readonly error: ReleaseGateEvidenceError } => ({
  _tag: "Left",
  error: new ReleaseGateEvidenceError({ gate: gate.id, message })
})

const validateGateEvidence = (
  gate: ReleaseChecklistGate,
  files: ReleaseEvidenceFiles
): Effect.Effect<void, ReleaseGateEvidenceError, never> => {
  const workflowTokens = [
    ...(RELEASE_WORKFLOW_TOKENS.get(gate.id) ?? []),
    ...(CI_WORKFLOW_TOKENS.get(gate.id) ?? [])
  ]
  for (const token of workflowTokens) {
    if (!files.releaseWorkflow.includes(token) && !files.ciWorkflow.includes(token)) {
      return Effect.fail(
        new ReleaseGateEvidenceError({
          gate: gate.id,
          message: `release gate ${gate.id} is missing workflow evidence token ${token}`
        })
      )
    }
  }
  for (const evidence of gate.evidence) {
    const parsed = parseReleaseEvidence(gate, evidence)
    if (parsed._tag === "Left") {
      return Effect.fail(parsed.error)
    }
    const allowed = RELEASE_GATE_EVIDENCE.get(gate.id)
    if (allowed === undefined || !allowed.has(evidence)) {
      return Effect.fail(
        new ReleaseGateEvidenceError({
          gate: gate.id,
          message: `release gate ${gate.id} does not accept evidence ${evidence}`
        })
      )
    }
    if (!parsed.source.read(files).includes(parsed.anchor)) {
      return Effect.fail(
        new ReleaseGateEvidenceError({
          gate: gate.id,
          message: `release gate ${gate.id} is missing ${parsed.source.name} evidence ${evidence}`
        })
      )
    }
  }
  return Effect.void
}

const parseReleaseEvidence = (
  gate: ReleaseChecklistGate,
  evidence: string
):
  | {
      readonly _tag: "Right"
      readonly source: (typeof RELEASE_EVIDENCE_SOURCES)[number]
      readonly anchor: string
    }
  | { readonly _tag: "Left"; readonly error: ReleaseGateEvidenceError } => {
  for (const source of RELEASE_EVIDENCE_SOURCES) {
    if (evidence.startsWith(source.prefix)) {
      const anchor = evidence.slice(source.prefix.length)
      if (anchor.trim().length === 0) {
        return releaseEvidenceError(
          gate,
          `release gate ${gate.id} has empty evidence anchor ${evidence}`
        )
      }
      return { _tag: "Right", source, anchor }
    }
  }
  return releaseEvidenceError(gate, `release gate ${gate.id} uses unsupported evidence ${evidence}`)
}

const validateWorkflowActionPins = (
  path: string,
  body: string
): Effect.Effect<void, ReleaseGateEvidenceError, never> => {
  for (const reference of workflowActionReferences(body)) {
    const match = reference.match(/^([^@\s]+)@([a-f0-9]{40})(?:\s+#\s+(.+))?$/)
    if (match === null || match[3] === undefined || match[3].trim().length === 0) {
      return Effect.fail(
        new ReleaseGateEvidenceError({
          gate: "workflow-action-pins",
          message: `${path} contains an unpinned or uncommented action reference: uses: ${reference}`
        })
      )
    }
  }
  return Effect.void
}

const workflowActionReferences = (body: string): readonly string[] => {
  const references: string[] = []
  let scalarIndent: number | undefined
  for (const line of body.split("\n")) {
    const indent = leadingSpaces(line)
    const trimmed = line.trim()
    if (scalarIndent !== undefined) {
      if (trimmed.length === 0 || indent > scalarIndent) {
        continue
      }
      scalarIndent = undefined
    }
    if (/^-?\s*run:\s*[>|]/.test(trimmed)) {
      scalarIndent = indent
      continue
    }
    const match = trimmed.match(/^-?\s*uses:\s+(.+)$/)
    if (match?.[1] !== undefined) {
      references.push(match[1])
    }
  }
  return references
}

const leadingSpaces = (line: string): number => line.length - line.trimStart().length

const validateReleaseRunnerPosture = (
  body: string
): Effect.Effect<void, ReleaseGateEvidenceError, never> => {
  if (!body.includes("runs-on: ubuntu-latest")) {
    return Effect.fail(
      new ReleaseGateEvidenceError({
        gate: "ephemeral-runners",
        message: "release workflow must run on GitHub-hosted runners"
      })
    )
  }
  if (body.includes("self-hosted")) {
    return Effect.fail(
      new ReleaseGateEvidenceError({
        gate: "ephemeral-runners",
        message: "release workflow must not use persistent self-hosted runners"
      })
    )
  }
  return Effect.void
}

const validateReleaseSubjectWorkflow = (
  subjects: readonly ReleaseSubject[],
  releaseWorkflow: string
): Effect.Effect<void, ReleaseGateEvidenceError, never> => {
  for (const subject of subjects) {
    for (const command of subject.requiredCommands) {
      if (!releaseWorkflow.includes(command)) {
        return Effect.fail(
          new ReleaseGateEvidenceError({
            gate: "release-workflow",
            message: `release subject ${subject.id} is missing workflow command ${command}`
          })
        )
      }
    }

    const packageCommand = `bun packages/cli/src/bin.ts package --config ${subject.configPath}`
    const packageIndex = releaseWorkflow.indexOf(packageCommand)
    if (packageIndex === -1) {
      continue
    }

    const buildCommand = `bun packages/cli/src/bin.ts build --config ${subject.configPath}`
    const buildIndex = releaseWorkflow.indexOf(buildCommand)
    if (buildIndex === -1 || buildIndex > packageIndex) {
      return Effect.fail(
        new ReleaseGateEvidenceError({
          gate: "reproducible-build",
          message: `release subject ${subject.id} must run ${buildCommand} before ${packageCommand}`
        })
      )
    }
  }
  return Effect.void
}

const validatePolicyDocuments = (files: {
  readonly keyManagement: string
  readonly releaseSettings: string
}): Effect.Effect<void, ReleaseGateEvidenceError, never> => {
  const required = [
    ["hsm-signing", files.keyManagement, "HSM-backed"],
    ["hsm-signing", files.keyManagement, "runner-local keys are forbidden"],
    ["hsm-signing", files.keyManagement, "rotation"],
    ["secret-scanning", files.releaseSettings, "Secret scanning is enabled for every branch"],
    ["branch-protection", files.releaseSettings, "main requires at least one review"],
    ["branch-protection", files.releaseSettings, "release branches require at least two reviews"],
    ["ephemeral-runners", files.releaseSettings, "GitHub-hosted runners"],
    ["ephemeral-runners", files.releaseSettings, "persistent self-hosted runners are forbidden"]
  ] as const
  for (const [gate, body, token] of required) {
    if (!body.includes(token)) {
      return Effect.fail(
        new ReleaseGateEvidenceError({
          gate,
          message: `release policy is missing required evidence token ${token}`
        })
      )
    }
  }
  return Effect.void
}

const validateExemptions = (path: string): Effect.Effect<void, ReleaseGateError, never> =>
  Effect.gen(function* () {
    const entries = yield* readDirectory(path).pipe(
      Effect.catchTag("ReleaseGateFileError", (error) =>
        error.operation === "readdir" ? Effect.succeed<readonly string[]>([]) : Effect.fail(error)
      )
    )
    for (const entry of entries.filter((value) => value.endsWith(".md"))) {
      const file = join(path, entry)
      const body = yield* readText(file)
      if (
        sectionBody(body, "Justification").length === 0 ||
        sectionBody(body, "Re-review").length === 0
      ) {
        return yield* Effect.fail(
          new ReleaseGateEvidenceError({
            gate: "cvss-scan",
            message: `CVSS exemption ${entry} must include non-empty Justification and Re-review sections`
          })
        )
      }
    }
  })

const sectionBody = (body: string, section: string): string => {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "im")
  const match = pattern.exec(body)
  if (match?.index === undefined) {
    return ""
  }
  const start = match.index + match[0].length
  const rest = body.slice(start)
  const nextHeading = /^##\s+/im.exec(rest)
  return rest.slice(0, nextHeading?.index ?? rest.length).trim()
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const readJson = <A>(path: string): Effect.Effect<A, ReleaseGateFileError, never> =>
  Effect.gen(function* () {
    const body = yield* readText(path)
    return yield* Effect.try({
      try: () => JSON.parse(body) as A,
      catch: (cause) =>
        new ReleaseGateFileError({
          operation: "parse",
          path,
          message: `failed to parse ${path}`,
          cause
        })
    })
  })

const readText = (path: string): Effect.Effect<string, ReleaseGateFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new ReleaseGateFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const readDirectory = (
  path: string
): Effect.Effect<readonly string[], ReleaseGateFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new ReleaseGateFileError({
        operation: "readdir",
        path,
        message: `failed to read directory ${path}`,
        cause
      })
  })
