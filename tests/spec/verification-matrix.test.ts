import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Exit, Schema } from "effect"

const REPO_ROOT = join(import.meta.dir, "..", "..")
const SPEC_PATH = join(REPO_ROOT, "engineering", "SPEC.md")
const MATRIX_PATH = join(REPO_ROOT, "engineering", "verification-matrix.json")
const CI_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml")

const REQUIRED_CELLS = ["macos-arm64", "macos-x64", "windows-x64", "linux-x64"] as const
const OPTIONAL_CELLS = ["windows-arm64", "linux-arm64"] as const

const githubHostedCiRunners = new Set(["ubuntu-latest", "macos-latest", "windows-latest"])

const MatrixCiCell = Schema.Struct({
  cell: Schema.String,
  runner: Schema.String,
  headless: Schema.Boolean
})

const MatrixManualGateCell = Schema.Struct({
  cell: Schema.String,
  reason: Schema.String,
  path: Schema.String
})

const MatrixRowDefaults = Schema.Struct({
  cells: Schema.Array(Schema.String),
  headless: Schema.Boolean,
  requiresHardware: Schema.Boolean
})

const MatrixRowOverride = Schema.Struct({
  cells: Schema.optionalKey(Schema.Array(Schema.String)),
  headless: Schema.optionalKey(Schema.Boolean),
  requiresHardware: Schema.optionalKey(Schema.Boolean),
  manualGates: Schema.optionalKey(Schema.Array(Schema.String))
})

const VerificationMatrix = Schema.Struct({
  schemaVersion: Schema.Number,
  requiredCells: Schema.Array(Schema.String),
  optionalCells: Schema.Array(Schema.String),
  ciCells: Schema.Array(MatrixCiCell),
  manualGateCells: Schema.Array(MatrixManualGateCell),
  defaults: MatrixRowDefaults,
  rows: Schema.Record(Schema.String, MatrixRowOverride)
})

const VerificationMatrixJson = Schema.fromJsonString(VerificationMatrix)

type VerificationMatrix = typeof VerificationMatrix.Type

interface ResolvedRow {
  id: string
  cells: readonly string[]
  headless: boolean
  requiresHardware: boolean
  manualGates: readonly string[]
}

type Result<A, E> =
  | { readonly _tag: "Ok"; readonly value: A }
  | { readonly _tag: "Err"; readonly error: E }

interface MatrixFileError {
  readonly _tag: "MatrixFileError"
  readonly path: string
  readonly cause: unknown
}

interface MatrixJsonError {
  readonly _tag: "MatrixJsonError"
  readonly path: string
  readonly cause: unknown
}

const ok = <A>(value: A): Result<A, never> => ({ _tag: "Ok", value })
const err = <E>(error: E): Result<never, E> => ({ _tag: "Err", error })

const readText = (path: string): Result<string, MatrixFileError> => {
  try {
    return ok(readFileSync(path, "utf8"))
  } catch (cause) {
    return err({ _tag: "MatrixFileError", path, cause })
  }
}

const parseVerificationMatrix = (
  path: string,
  body: string
): Result<VerificationMatrix, MatrixJsonError> => {
  const exit = Schema.decodeUnknownExit(VerificationMatrixJson)(body)
  if (Exit.isSuccess(exit)) {
    return ok(exit.value)
  }
  return err({ _tag: "MatrixJsonError", path, cause: exit.cause })
}

const unwrap = <
  A,
  E extends { readonly _tag: string; readonly path?: string; readonly cause?: unknown }
>(
  result: Result<A, E>
): A => {
  if (result._tag === "Ok") {
    return result.value
  }
  const error = result.error
  const path = error.path === undefined ? "" : ` at ${error.path}`
  throw new Error(`${error._tag}${path}`, { cause: error.cause })
}

const loadFixture = (): {
  readonly ci: string
  readonly matrix: VerificationMatrix
  readonly spec: string
} => {
  const matrixBody = unwrap(readText(MATRIX_PATH))
  const matrix = unwrap(parseVerificationMatrix(MATRIX_PATH, matrixBody))
  const spec = unwrap(readText(SPEC_PATH))
  const ci = unwrap(readText(CI_PATH))

  return { ci, matrix, spec }
}

const { ci, matrix, spec } = loadFixture()

const appendixCIds = Array.from(spec.matchAll(/^## (C\.\d+)\b/gm)).flatMap((match) =>
  match[1] === undefined ? [] : [match[1]]
)

const allKnownCells = new Set([...matrix.requiredCells, ...matrix.optionalCells])

const resolveRow = (id: string): ResolvedRow => {
  const row = matrix.rows[id] ?? {}
  return {
    id,
    cells: row.cells ?? matrix.defaults.cells,
    headless: row.headless ?? matrix.defaults.headless,
    requiresHardware: row.requiresHardware ?? matrix.defaults.requiresHardware,
    manualGates: row.manualGates ?? []
  }
}

describe("verification matrix", () => {
  test("declares the required and optional cells from engineering/SPEC.md §20.10", () => {
    expect(matrix.requiredCells).toEqual(REQUIRED_CELLS)
    expect(matrix.optionalCells).toEqual(OPTIONAL_CELLS)
  })

  test("covers every Appendix C verification row with resolved cells", () => {
    expect(appendixCIds.length).toBeGreaterThan(0)
    for (const id of appendixCIds) {
      const row = resolveRow(id)
      expect(row.cells.length).toBeGreaterThan(0)
      for (const cell of row.cells) {
        expect(allKnownCells.has(cell)).toBe(true)
      }
    }

    for (const id of Object.keys(matrix.rows)) {
      expect(appendixCIds).toContain(id)
    }
  })

  test("routes every required cell through CI or an explicit manual gate", () => {
    const ciCells = new Set(matrix.ciCells.map((cell) => cell.cell))
    const manualCells = new Set(matrix.manualGateCells.map((cell) => cell.cell))
    for (const required of matrix.requiredCells) {
      expect(ciCells.has(required) || manualCells.has(required)).toBe(true)
    }
  })

  test("CI workflow exposes required headless cells as named GitHub-hosted matrix cells", () => {
    for (const cell of matrix.ciCells) {
      expect(matrix.requiredCells).toContain(cell.cell)
      expect(ci).toContain(`cell: ${cell.cell}`)
      expect(ci).toContain(`os: ${cell.runner}`)
      expect(githubHostedCiRunners.has(cell.runner)).toBe(true)
      expect(cell.headless).toBe(true)
    }
    expect(ci).toContain("EFFECT_DESKTOP_MATRIX_CELL")
    expect(ci).toContain("bun test tests/spec/verification-matrix.test.ts")
  })

  test("manual gates have tracking files and each hardware row names its gate", () => {
    for (const manualCell of matrix.manualGateCells) {
      const body = unwrap(readText(join(REPO_ROOT, manualCell.path)))
      expect(body).toContain(manualCell.cell)
      expect(body).toContain("pending release sign-off")
      expect(manualCell.reason.length).toBeGreaterThan(0)
    }

    for (const id of appendixCIds) {
      const row = resolveRow(id)
      if (row.requiresHardware) {
        expect(row.headless).toBe(false)
        expect(row.manualGates.length).toBeGreaterThan(0)
        for (const manualGate of row.manualGates) {
          const body = unwrap(readText(join(REPO_ROOT, manualGate)))
          expect(body).toContain(id)
        }
      }
    }
  })

  test("current CI cell is declared when the workflow provides one", () => {
    const currentCell = process.env["EFFECT_DESKTOP_MATRIX_CELL"]
    if (currentCell === undefined || currentCell.length === 0) {
      return
    }
    expect(matrix.ciCells.map((cell) => cell.cell)).toContain(currentCell)
  })
})
