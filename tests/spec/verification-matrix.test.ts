import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..", "..")
const SPEC_PATH = join(REPO_ROOT, "docs", "SPEC.md")
const MATRIX_PATH = join(REPO_ROOT, "docs", "verification-matrix.json")
const CI_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml")

const REQUIRED_CELLS = ["macos-arm64", "macos-x64", "windows-x64", "linux-x64"] as const
const OPTIONAL_CELLS = ["windows-arm64", "linux-arm64"] as const

interface VerificationMatrix {
  schemaVersion: number
  requiredCells: readonly string[]
  optionalCells: readonly string[]
  ciCells: readonly MatrixCiCell[]
  manualGateCells: readonly MatrixManualGateCell[]
  defaults: MatrixRowDefaults
  rows: Record<string, MatrixRowOverride>
}

interface MatrixCiCell {
  cell: string
  runner: string
  headless: boolean
}

interface MatrixManualGateCell {
  cell: string
  reason: string
  path: string
}

interface MatrixRowDefaults {
  cells: readonly string[]
  headless: boolean
  requiresHardware: boolean
}

interface MatrixRowOverride {
  cells?: readonly string[]
  headless?: boolean
  requiresHardware?: boolean
  manualGates?: readonly string[]
}

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

const parseJson = <A>(path: string, body: string): Result<A, MatrixJsonError> => {
  try {
    return ok(JSON.parse(body) as A)
  } catch (cause) {
    return err({ _tag: "MatrixJsonError", path, cause })
  }
}

const unwrap = <A, E>(result: Result<A, E>): A => {
  expect(result._tag).toBe("Ok")
  if (result._tag === "Err") {
    return undefined as never
  }
  return result.value
}

const loadFixture = (): {
  readonly ci: string
  readonly matrix: VerificationMatrix
  readonly spec: string
} => {
  const matrixBody = unwrap(readText(MATRIX_PATH))
  const matrix = unwrap(parseJson<VerificationMatrix>(MATRIX_PATH, matrixBody))
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
  test("declares the required and optional cells from docs/SPEC.md §20.10", () => {
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

  test("CI workflow exposes required headless cells as named Blacksmith matrix cells", () => {
    for (const cell of matrix.ciCells) {
      expect(matrix.requiredCells).toContain(cell.cell)
      expect(ci).toContain(`cell: ${cell.cell}`)
      expect(ci).toContain(`os: ${cell.runner}`)
      expect(cell.runner.startsWith("blacksmith-")).toBe(true)
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
