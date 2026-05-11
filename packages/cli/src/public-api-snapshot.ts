import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"

import { Data, Effect } from "effect"
import ts from "typescript"

export type PublicApiSymbolKind = "class" | "function" | "interface" | "type" | "value"

export interface PublicApiSnapshotOptions {
  readonly cwd: string
  readonly snapshotRoot?: string
  readonly updateSnapshots?: boolean
}

export interface PublicApiSymbolSnapshot {
  readonly name: string
  readonly kind: PublicApiSymbolKind
  readonly signature: string
}

export interface PublicApiPackageSnapshot {
  readonly packageName: string
  readonly entrypoint: string
  readonly symbols: readonly PublicApiSymbolSnapshot[]
}

export interface PublicApiSnapshotFile {
  readonly schemaVersion: 1
  readonly packageName: string
  readonly entrypoint: string
  readonly symbols: readonly PublicApiSymbolSnapshot[]
}

export type PublicApiChangeKind = "added" | "removed" | "kind-changed" | "signature-changed"

export interface PublicApiChange {
  readonly packageName: string
  readonly symbol: string
  readonly kind: PublicApiChangeKind
  readonly before?: PublicApiSymbolSnapshot
  readonly after?: PublicApiSymbolSnapshot
}

export interface PublicApiSnapshotReport {
  readonly passed: boolean
  readonly updated: boolean
  readonly packages: readonly PublicApiPackageSnapshot[]
  readonly changes: readonly PublicApiChange[]
}

export class PublicApiFileError extends Data.TaggedError("PublicApiFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class PublicApiPackageError extends Data.TaggedError("PublicApiPackageError")<{
  readonly packagePath: string
  readonly message: string
}> {}

export class PublicApiTypeScriptError extends Data.TaggedError("PublicApiTypeScriptError")<{
  readonly packageName: string
  readonly message: string
}> {}

export class PublicApiSnapshotMismatchError extends Data.TaggedError(
  "PublicApiSnapshotMismatchError"
)<{
  readonly changes: readonly PublicApiChange[]
  readonly report: PublicApiSnapshotReport
}> {}

export type PublicApiSnapshotError =
  | PublicApiFileError
  | PublicApiPackageError
  | PublicApiTypeScriptError
  | PublicApiSnapshotMismatchError

interface WorkspacePackage {
  readonly name: string
  readonly path: string
  readonly entrypoint: string
}

interface PackageJson {
  readonly name?: unknown
  readonly exports?: unknown
}

const SNAPSHOT_ROOT = "api/snapshots"
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

export const runPublicApiCheck = (
  options: PublicApiSnapshotOptions
): Effect.Effect<PublicApiSnapshotReport, PublicApiSnapshotError, never> =>
  Effect.gen(function* () {
    const packages = yield* discoverPublicPackages(options.cwd)
    const snapshots: PublicApiPackageSnapshot[] = []
    const changes: PublicApiChange[] = []
    const snapshotRoot = options.snapshotRoot ?? SNAPSHOT_ROOT

    for (const workspacePackage of packages) {
      const snapshot = yield* snapshotPackage(workspacePackage)
      snapshots.push(snapshot)
      const snapshotPath = snapshotFilePath(options.cwd, snapshotRoot, workspacePackage.name)

      if (options.updateSnapshots === true) {
        yield* writeSnapshot(snapshotPath, toSnapshotFile(snapshot))
      } else {
        const expected = yield* readSnapshot(snapshotPath)
        changes.push(...diffSnapshot(expected, snapshot))
      }
    }

    const report: PublicApiSnapshotReport = {
      passed: changes.length === 0,
      updated: options.updateSnapshots === true,
      packages: snapshots,
      changes
    }

    if (options.updateSnapshots === true || report.passed) {
      return report
    }

    return yield* Effect.fail(new PublicApiSnapshotMismatchError({ changes, report }))
  })

export const formatPublicApiReport = (report: PublicApiSnapshotReport): string => {
  const lines = [
    "Effect Desktop public API",
    `status            ${report.passed ? "passed" : "failed"}`,
    `mode              ${report.updated ? "write" : "check"}`,
    `packages          ${report.packages.length}`,
    `changes           ${report.changes.length}`
  ]

  for (const packageSnapshot of report.packages) {
    lines.push(
      `${packageSnapshot.packageName.padEnd(18)} ${packageSnapshot.symbols.length} symbols`
    )
  }

  if (report.changes.length > 0) {
    lines.push("", "Changes:")
    for (const change of report.changes) {
      lines.push(formatChange(change))
    }
  }

  lines.push("")
  return lines.join("\n")
}

export const formatPublicApiError = (
  error: PublicApiSnapshotError
): {
  readonly tag: string
  readonly message: string
  readonly report?: PublicApiSnapshotReport
} => {
  if (error instanceof PublicApiSnapshotMismatchError) {
    return {
      tag: error._tag,
      message: `${error.changes.length} public API snapshot change(s) detected`,
      report: error.report
    }
  }
  return { tag: error._tag, message: error.message }
}

const discoverPublicPackages = (
  cwd: string
): Effect.Effect<readonly WorkspacePackage[], PublicApiFileError | PublicApiPackageError, never> =>
  Effect.gen(function* () {
    const packagesRoot = join(cwd, "packages")
    const entries = yield* readDirectory(packagesRoot)
    const packages: WorkspacePackage[] = []

    for (const entry of entries) {
      const packagePath = join(packagesRoot, entry)
      const packageJsonPath = join(packagePath, "package.json")
      if (!(yield* fileExists(packageJsonPath))) {
        continue
      }
      const packageJson = yield* readJson<PackageJson>(packageJsonPath)
      const packageName = yield* readPackageName(packageJson, packageJsonPath)
      const entrypoint = readRootExportEntrypoint(packageJson)
      if (entrypoint !== undefined) {
        packages.push({
          name: packageName,
          path: packagePath,
          entrypoint
        })
      }
    }

    return packages.sort((left, right) => left.name.localeCompare(right.name))
  })

const readPackageName = (
  packageJson: PackageJson,
  path: string
): Effect.Effect<string, PublicApiPackageError, never> =>
  typeof packageJson.name !== "string" || packageJson.name.length === 0
    ? Effect.fail(new PublicApiPackageError({ packagePath: path, message: "missing package name" }))
    : PACKAGE_NAME_PATTERN.test(packageJson.name)
      ? Effect.succeed(packageJson.name)
      : Effect.fail(
          new PublicApiPackageError({
            packagePath: path,
            message: `invalid package name: ${packageJson.name}`
          })
        )

const readRootExportEntrypoint = (packageJson: PackageJson): string | undefined => {
  if (!isRecord(packageJson.exports)) {
    return undefined
  }
  const rootExport = packageJson.exports["."]
  if (!isRecord(rootExport)) {
    return undefined
  }
  const types = rootExport["types"]
  return typeof types === "string" ? types : undefined
}

const fileExists = (path: string): Effect.Effect<boolean, never, never> =>
  Effect.tryPromise({
    try: () => access(path),
    catch: () => undefined
  }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false))
  )

const snapshotPackage = (
  workspacePackage: WorkspacePackage
): Effect.Effect<PublicApiPackageSnapshot, PublicApiTypeScriptError, never> =>
  Effect.gen(function* () {
    const entrypoint = join(workspacePackage.path, workspacePackage.entrypoint)
    const configPath = join(workspacePackage.path, "tsconfig.json")
    const config = yield* readTsConfig(workspacePackage.name, configPath)
    const program = ts.createProgram([entrypoint], config.options)
    const diagnostics = ts.getPreEmitDiagnostics(program)
    if (diagnostics.length > 0) {
      return yield* Effect.fail(
        new PublicApiTypeScriptError({
          packageName: workspacePackage.name,
          message: ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost)
        })
      )
    }

    const sourceFile = program.getSourceFile(entrypoint)
    if (sourceFile === undefined) {
      return yield* Effect.fail(
        new PublicApiTypeScriptError({
          packageName: workspacePackage.name,
          message: `entrypoint ${entrypoint} was not part of the TypeScript program`
        })
      )
    }

    const checker = program.getTypeChecker()
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (moduleSymbol === undefined) {
      return {
        packageName: workspacePackage.name,
        entrypoint: relative(workspacePackage.path, entrypoint),
        symbols: []
      }
    }

    const symbols = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => snapshotSymbol(checker, symbol))
      .sort((left, right) => left.name.localeCompare(right.name))

    return {
      packageName: workspacePackage.name,
      entrypoint: relative(workspacePackage.path, entrypoint),
      symbols
    }
  })

const readTsConfig = (
  packageName: string,
  configPath: string
): Effect.Effect<ts.ParsedCommandLine, PublicApiTypeScriptError, never> =>
  Effect.sync(() => {
    const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path))
    if (config.error !== undefined) {
      return new PublicApiTypeScriptError({
        packageName,
        message: ts.formatDiagnostic(config.error, formatHost)
      })
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath))
    if (parsed.errors.length > 0) {
      return new PublicApiTypeScriptError({
        packageName,
        message: ts.formatDiagnosticsWithColorAndContext(parsed.errors, formatHost)
      })
    }
    return parsed
  }).pipe(
    Effect.flatMap((value) =>
      value instanceof PublicApiTypeScriptError ? Effect.fail(value) : Effect.succeed(value)
    )
  )

const snapshotSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol): PublicApiSymbolSnapshot => {
  const aliased =
    (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol)
  const declaration = aliased.declarations?.[0] ?? symbol.declarations?.[0]
  return {
    name: symbol.getName(),
    kind: classifySymbol(aliased, declaration),
    signature: signatureForSymbol(checker, aliased, declaration)
  }
}

const signatureForSymbol = (
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  declaration: ts.Declaration | undefined
): string => {
  if (declaration === undefined) {
    return checker.symbolToString(symbol, declaration, ts.SymbolFlags.All)
  }
  if (ts.isVariableDeclaration(declaration)) {
    return normalizeSignature(
      `const ${symbol.getName()}: ${checker.typeToString(
        checker.getTypeOfSymbolAtLocation(symbol, declaration),
        declaration,
        ts.TypeFormatFlags.NoTruncation
      )}`
    )
  }
  if (ts.isFunctionDeclaration(declaration)) {
    const signature = checker.getSignatureFromDeclaration(declaration)
    return signature === undefined
      ? normalizeSignature(declaration.getText())
      : normalizeSignature(`function ${symbol.getName()}${checker.signatureToString(signature)}`)
  }
  return normalizeSignature(declaration.getText())
}

const normalizeSignature = (signature: string): string => signature.replaceAll(/\s+/g, " ").trim()

const classifySymbol = (
  symbol: ts.Symbol,
  declaration: ts.Declaration | undefined
): PublicApiSymbolKind => {
  if ((symbol.flags & ts.SymbolFlags.Class) !== 0) {
    return "class"
  }
  if ((symbol.flags & ts.SymbolFlags.Interface) !== 0) {
    return "interface"
  }
  if ((symbol.flags & ts.SymbolFlags.TypeAlias) !== 0) {
    return "type"
  }
  if (declaration !== undefined && ts.isFunctionDeclaration(declaration)) {
    return "function"
  }
  if ((symbol.flags & ts.SymbolFlags.Function) !== 0) {
    return "function"
  }
  return "value"
}

const diffSnapshot = (
  expected: PublicApiSnapshotFile,
  actual: PublicApiPackageSnapshot
): readonly PublicApiChange[] => {
  const expectedSymbols = new Map(expected.symbols.map((symbol) => [symbol.name, symbol]))
  const actualSymbols = new Map(actual.symbols.map((symbol) => [symbol.name, symbol]))
  const changes: PublicApiChange[] = []

  for (const [name, before] of expectedSymbols) {
    const after = actualSymbols.get(name)
    if (after === undefined) {
      changes.push({ packageName: actual.packageName, symbol: name, kind: "removed", before })
    } else if (before.kind !== after.kind) {
      changes.push({
        packageName: actual.packageName,
        symbol: name,
        kind: "kind-changed",
        before,
        after
      })
    } else if (before.signature !== after.signature) {
      changes.push({
        packageName: actual.packageName,
        symbol: name,
        kind: "signature-changed",
        before,
        after
      })
    }
  }

  for (const [name, after] of actualSymbols) {
    if (!expectedSymbols.has(name)) {
      changes.push({ packageName: actual.packageName, symbol: name, kind: "added", after })
    }
  }

  return changes.sort((left, right) =>
    `${left.packageName}:${left.symbol}:${left.kind}`.localeCompare(
      `${right.packageName}:${right.symbol}:${right.kind}`
    )
  )
}

const toSnapshotFile = (snapshot: PublicApiPackageSnapshot): PublicApiSnapshotFile => ({
  schemaVersion: 1,
  packageName: snapshot.packageName,
  entrypoint: snapshot.entrypoint,
  symbols: snapshot.symbols
})

const readSnapshot = (
  path: string
): Effect.Effect<PublicApiSnapshotFile, PublicApiFileError, never> => readJson(path)

const writeSnapshot = (
  path: string,
  snapshot: PublicApiSnapshotFile
): Effect.Effect<void, PublicApiFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(path))
    yield* Effect.tryPromise({
      try: () => writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`),
      catch: (cause) =>
        new PublicApiFileError({
          operation: "write",
          path,
          message: `failed to write ${path}`,
          cause
        })
    })
  })

const readJson = <A>(path: string): Effect.Effect<A, PublicApiFileError, never> =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) =>
        new PublicApiFileError({
          operation: "read",
          path,
          message: `failed to read ${path}`,
          cause
        })
    })
    return yield* Effect.try({
      try: () => JSON.parse(body) as A,
      catch: (cause) =>
        new PublicApiFileError({
          operation: "parse",
          path,
          message: `failed to parse ${path}`,
          cause
        })
    })
  })

const readDirectory = (path: string): Effect.Effect<readonly string[], PublicApiFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new PublicApiFileError({
        operation: "readdir",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const makeDirectory = (path: string): Effect.Effect<void, PublicApiFileError, never> =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      new PublicApiFileError({
        operation: "mkdir",
        path,
        message: `failed to create ${path}`,
        cause
      })
  }).pipe(Effect.asVoid)

const snapshotFilePath = (cwd: string, snapshotRoot: string, packageName: string): string =>
  join(cwd, snapshotRoot, `${packageName.replaceAll("/", "__")}.snapshot.json`)

const formatChange = (change: PublicApiChange): string => {
  if (change.kind === "added") {
    return `ADD ${change.packageName} ${change.symbol}: ${change.after?.signature ?? ""}`
  }
  if (change.kind === "removed") {
    return `REMOVE ${change.packageName} ${change.symbol}: ${change.before?.signature ?? ""}`
  }
  return `${change.kind.toUpperCase()} ${change.packageName} ${change.symbol}: ${
    change.before?.signature ?? ""
  } -> ${change.after?.signature ?? ""}`
}

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => resolve("."),
  getNewLine: () => "\n"
}

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null
