import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { Data, Effect } from "effect"

export interface ReleaseGateOptions {
  readonly cwd: string
}

export interface ReleaseChecklist {
  readonly schemaVersion: 1
  readonly source: string
  readonly gates: readonly ReleaseChecklistGate[]
}

export type ReleaseGateEvidenceKind = "workflow-step" | "policy-document" | "repository-setting"

export interface ReleaseChecklistGate {
  readonly id: string
  readonly title: string
  readonly kind: ReleaseGateEvidenceKind
  readonly evidence: readonly string[]
}

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
const PLAYGROUND_BUILD_COMMAND =
  "bun packages/cli/src/bin.ts build --config apps/playground/desktop.config.ts"
const PLAYGROUND_PACKAGE_COMMAND =
  "bun packages/cli/src/bin.ts package --config apps/playground/desktop.config.ts"

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
  [
    "reproducible-build",
    [
      PLAYGROUND_BUILD_COMMAND,
      PLAYGROUND_PACKAGE_COMMAND,
      "bun packages/cli/src/bin.ts check --repro"
    ]
  ],
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

export const runReleaseGate = (
  options: ReleaseGateOptions
): Effect.Effect<ReleaseGateReport, ReleaseGateError, never> =>
  Effect.gen(function* () {
    const checklist = yield* readJson<ReleaseChecklist>(join(options.cwd, CHECKLIST_PATH))
    yield* validateChecklist(checklist)

    const ciWorkflow = yield* readText(join(options.cwd, CI_WORKFLOW_PATH))
    const releaseWorkflow = yield* readText(join(options.cwd, RELEASE_WORKFLOW_PATH))
    const keyManagement = yield* readText(join(options.cwd, KEY_MANAGEMENT_PATH))
    const releaseSettings = yield* readText(join(options.cwd, RELEASE_SETTINGS_PATH))

    yield* validateWorkflowActionPins(RELEASE_WORKFLOW_PATH, releaseWorkflow)
    yield* validateWorkflowActionPins(CI_WORKFLOW_PATH, ciWorkflow)
    yield* validateReleaseRunnerPosture(releaseWorkflow)
    yield* validatePlaygroundBuildBeforePackage(releaseWorkflow)
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

  for (const id of REQUIRED_GATES.keys()) {
    if (!ids.has(id)) {
      return Effect.fail(
        new ReleaseGateManifestError({ message: `release checklist is missing §25.4 gate ${id}` })
      )
    }
  }
  return Effect.void
}

const validateGateEvidence = (
  gate: ReleaseChecklistGate,
  files: {
    readonly ciWorkflow: string
    readonly releaseWorkflow: string
    readonly keyManagement: string
    readonly releaseSettings: string
  }
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
    if (evidence.startsWith(".github/workflows/release.yml#")) {
      if (
        !files.releaseWorkflow.includes(evidence.slice(".github/workflows/release.yml#".length))
      ) {
        return Effect.fail(
          new ReleaseGateEvidenceError({
            gate: gate.id,
            message: `release gate ${gate.id} is missing release workflow evidence ${evidence}`
          })
        )
      }
    }
    if (evidence.startsWith(".github/workflows/ci.yml#")) {
      if (!files.ciWorkflow.includes(evidence.slice(".github/workflows/ci.yml#".length))) {
        return Effect.fail(
          new ReleaseGateEvidenceError({
            gate: gate.id,
            message: `release gate ${gate.id} is missing CI workflow evidence ${evidence}`
          })
        )
      }
    }
    if (evidence.startsWith("docs/security/key-management.md#")) {
      if (
        !files.keyManagement.includes(evidence.slice("docs/security/key-management.md#".length))
      ) {
        return Effect.fail(
          new ReleaseGateEvidenceError({
            gate: gate.id,
            message: `release gate ${gate.id} is missing key-management evidence ${evidence}`
          })
        )
      }
    }
    if (evidence.startsWith("docs/security/release-settings.md#")) {
      if (
        !files.releaseSettings.includes(evidence.slice("docs/security/release-settings.md#".length))
      ) {
        return Effect.fail(
          new ReleaseGateEvidenceError({
            gate: gate.id,
            message: `release gate ${gate.id} is missing release-settings evidence ${evidence}`
          })
        )
      }
    }
  }
  return Effect.void
}

const validateWorkflowActionPins = (
  path: string,
  body: string
): Effect.Effect<void, ReleaseGateEvidenceError, never> => {
  for (const line of body.split("\n")) {
    const match = line.match(/uses:\s+([^@\s]+)@([a-f0-9]{40})(?:\s+#\s+(.+))?/)
    if (!line.includes("uses:")) {
      continue
    }
    if (match === null || match[3] === undefined || match[3].trim().length === 0) {
      return Effect.fail(
        new ReleaseGateEvidenceError({
          gate: "workflow-action-pins",
          message: `${path} contains an unpinned or uncommented action reference: ${line.trim()}`
        })
      )
    }
  }
  return Effect.void
}

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

const validatePlaygroundBuildBeforePackage = (
  body: string
): Effect.Effect<void, ReleaseGateEvidenceError, never> => {
  const packageIndex = body.indexOf(PLAYGROUND_PACKAGE_COMMAND)
  if (packageIndex === -1) {
    return Effect.void
  }

  const buildIndex = body.indexOf(PLAYGROUND_BUILD_COMMAND)
  if (buildIndex !== -1 && buildIndex < packageIndex) {
    return Effect.void
  }

  return Effect.fail(
    new ReleaseGateEvidenceError({
      gate: "reproducible-build",
      message: "release workflow must run desktop build for apps/playground before desktop package"
    })
  )
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
