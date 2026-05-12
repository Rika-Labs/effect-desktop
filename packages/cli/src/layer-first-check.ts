import { access, readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import {
  dirname as posixDirname,
  join as posixJoin,
  normalize as posixNormalize
} from "node:path/posix"

import { Data, Effect } from "effect"
import ts from "typescript"

export type LayerFirstViolationKind =
  | "forbidden-effect-run"
  | "forbidden-runtime-global"
  | "public-promise-api"
  | "public-boundary-without-schema"

export interface LayerFirstCheckOptions {
  readonly cwd: string
  readonly sourceRoots?: readonly string[]
  readonly allowedEdges?: readonly string[]
  readonly publicPromiseAllowlist?: readonly string[]
  readonly publicBoundaryAllowlist?: readonly string[]
}

export interface LayerFirstViolation {
  readonly kind: LayerFirstViolationKind
  readonly path: string
  readonly line: number
  readonly message: string
  readonly symbol?: string
}

export interface LayerFirstCheckReport {
  readonly passed: boolean
  readonly filesScanned: number
  readonly snapshotFilesScanned: number
  readonly violations: readonly LayerFirstViolation[]
}

export class LayerFirstFileError extends Data.TaggedError("LayerFirstFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class LayerFirstViolationError extends Data.TaggedError("LayerFirstViolationError")<{
  readonly report: LayerFirstCheckReport
}> {}

export type LayerFirstCheckError = LayerFirstFileError | LayerFirstViolationError

interface PublicApiSnapshotFile {
  readonly packageName?: unknown
  readonly symbols?: unknown
}

interface PackageJsonFile {
  readonly exports?: unknown
  readonly main?: unknown
  readonly types?: unknown
}

interface PublicApiSymbolSnapshot {
  readonly name: string
  readonly signature: string
}

const DEFAULT_SOURCE_ROOTS = ["packages", "apps", "templates", "scripts"] as const

const DEFAULT_ALLOWED_EDGES = [
  "apps/docs/alchemy.run.ts",
  "apps/examples/notes-common/src/index.ts",
  "packages/bridge/src/client.ts",
  "packages/bridge/src/events.ts",
  "packages/bridge/src/handlers.ts",
  "packages/bridge/src/handshake.ts",
  "packages/bridge/src/protocol.ts",
  "packages/bridge/src/streams.ts",
  "packages/bridge/src/window.ts",
  "packages/cli/src/accessibility-gate.ts",
  "packages/cli/src/bin.ts",
  "packages/cli/src/doctor.ts",
  "packages/cli/src/docs-release-gate.ts",
  "packages/cli/src/index.ts",
  "packages/cli/src/layer-first-check.ts",
  "packages/cli/src/notarization-pipeline.ts",
  "packages/cli/src/package-pipeline.ts",
  "packages/cli/src/public-api-snapshot.ts",
  "packages/cli/src/release-gate.ts",
  "packages/cli/src/reproducible-build-check.ts",
  "packages/cli/src/semver-guard.ts",
  "packages/cli/src/signing-pipeline.ts",
  "packages/cli/src/update-manifest.ts",
  "packages/core/src/runtime/approval-broker.ts",
  "packages/core/src/runtime/filesystem.ts",
  "packages/core/src/runtime/host-client.ts",
  "packages/core/src/runtime/main.ts",
  "packages/core/src/runtime/process.ts",
  "packages/core/src/runtime/pty.ts",
  "packages/core/src/runtime/renderer-rpc-client.ts",
  "packages/core/src/runtime/sqlite.ts",
  "packages/core/src/runtime/stdio-socket.ts",
  "packages/core/src/runtime/telemetry.ts",
  "packages/core/src/runtime/transport.ts",
  "packages/core/src/runtime/window-state.ts",
  "packages/core/src/runtime/worker.ts",
  "packages/core/src/runtime/workflows/backup.ts",
  "packages/devtools/src/reactivity-panel.ts",
  "packages/devtools/src/shell.ts",
  "packages/native/src/crash-reporter.ts",
  "packages/native/src/crash-report-workflow.ts",
  "packages/native/src/global-shortcut.ts",
  "packages/native/src/updater-workflow.ts",
  "packages/react/src/desktop.tsx",
  "packages/react/src/hooks/desktop.ts",
  "packages/react/src/hooks/stream.ts",
  "packages/react/src/mutation.ts",
  "packages/react/src/permission-approval.ts",
  "packages/solid/src/index.ts",
  "packages/test/src/index.ts",
  "packages/vite/src/child-process.ts",
  "packages/vite/src/virtual-module.ts",
  "packages/vue/src/index.ts",
  "templates/todo-sqlite/src/spine.ts"
] as const

const DEFAULT_PUBLIC_PROMISE_ALLOWLIST = [
  "@effect-desktop/core:createFramedTransport",
  "@effect-desktop/core:FilesystemAdapter",
  "@effect-desktop/core:FramedTransport",
  "@effect-desktop/core:ProcessChild",
  "@effect-desktop/core:PtyChild",
  "@effect-desktop/react:MutationResult",
  "@effect-desktop/react:MutationRunPromise",
  "@effect-desktop/solid:SolidMutation",
  "@effect-desktop/vue:VueMutation"
] as const

const DEFAULT_PUBLIC_BOUNDARY_ALLOWLIST = [
  "@effect-desktop/react:CurrentWindowSetTitleInput",
  "@effect-desktop/react:WindowCloseInput",
  "@effect-desktop/react:WindowSetTitleInput"
] as const

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const
const GENERATED_SEGMENTS = new Set(["dist", ".next", ".astro", ".source", "node_modules"])
const BOUNDARY_SUFFIX_PATTERN =
  /(Input|Output|Payload|Event|Result|Options|Config|Request|Response)$/u

export const runLayerFirstCheck = (
  options: LayerFirstCheckOptions
): Effect.Effect<LayerFirstCheckReport, LayerFirstCheckError, never> =>
  Effect.gen(function* () {
    const sourceRoots = options.sourceRoots ?? DEFAULT_SOURCE_ROOTS
    const allowedEdges = new Set(options.allowedEdges ?? DEFAULT_ALLOWED_EDGES)
    const promiseAllowlist = new Set(
      options.publicPromiseAllowlist ?? DEFAULT_PUBLIC_PROMISE_ALLOWLIST
    )
    const boundaryAllowlist = new Set(
      options.publicBoundaryAllowlist ?? DEFAULT_PUBLIC_BOUNDARY_ALLOWLIST
    )
    const files = yield* discoverSourceFiles(options.cwd, sourceRoots)
    const sourceTexts = new Map<string, string>()
    const violations: LayerFirstViolation[] = []

    for (const path of files) {
      const text = yield* readText(path)
      const relativePath = toRepoPath(options.cwd, path)
      sourceTexts.set(relativePath, text)
    }
    const publicEntrypoints = yield* discoverPublicEntrypoints(options.cwd, sourceTexts)

    for (const path of files) {
      const relativePath = toRepoPath(options.cwd, path)
      const text = sourceTexts.get(relativePath)
      if (text === undefined) {
        continue
      }
      const isAllowedEdge = allowedEdges.has(relativePath)
      violations.push(
        ...scanSourceFile(
          relativePath,
          text,
          sourceTexts,
          publicEntrypoints,
          isAllowedEdge,
          promiseAllowlist,
          boundaryAllowlist
        )
      )
    }

    const snapshotFiles = yield* discoverSnapshotFiles(options.cwd)
    for (const path of snapshotFiles) {
      const text = yield* readText(path)
      const relativePath = toRepoPath(options.cwd, path)
      violations.push(...(yield* scanPublicApiSnapshot(relativePath, text, promiseAllowlist)))
    }

    const report: LayerFirstCheckReport = {
      passed: violations.length === 0,
      filesScanned: files.length,
      snapshotFilesScanned: snapshotFiles.length,
      violations
    }

    return report.passed ? report : yield* Effect.fail(new LayerFirstViolationError({ report }))
  })

export const formatLayerFirstReport = (report: LayerFirstCheckReport): string => {
  const lines = [
    "Effect Desktop Layer-first check",
    `status            ${report.passed ? "passed" : "failed"}`,
    `files             ${report.filesScanned}`,
    `api snapshots     ${report.snapshotFilesScanned}`,
    `violations        ${report.violations.length}`
  ]

  if (report.violations.length > 0) {
    lines.push("", "Violations:")
    for (const violation of report.violations) {
      lines.push(formatViolation(violation))
    }
  }

  lines.push("")
  return lines.join("\n")
}

export const formatLayerFirstError = (
  error: LayerFirstCheckError
): {
  readonly tag: string
  readonly message: string
  readonly report?: LayerFirstCheckReport
} => {
  if (error instanceof LayerFirstViolationError) {
    return {
      tag: error._tag,
      message: `${error.report.violations.length} Layer-first violation(s) detected`,
      report: error.report
    }
  }
  return { tag: error._tag, message: error.message }
}

const scanSourceFile = (
  path: string,
  text: string,
  sourceTexts: ReadonlyMap<string, string>,
  publicEntrypoints: ReadonlySet<string>,
  isAllowedEdge: boolean,
  promiseAllowlist: ReadonlySet<string>,
  boundaryAllowlist: ReadonlySet<string>
): readonly LayerFirstViolation[] => {
  const violations: LayerFirstViolation[] = []
  if (!isAllowedEdge) {
    violations.push(...scanForbiddenPatterns(path, text))
  }
  if (publicEntrypoints.has(path)) {
    violations.push(...scanPublicBoundaryClasses(path, text, sourceTexts, boundaryAllowlist))
  }
  violations.push(
    ...scanPublicPromiseSource(path, text, sourceTexts, publicEntrypoints, promiseAllowlist)
  )
  return violations
}

const scanForbiddenPatterns = (path: string, text: string): readonly LayerFirstViolation[] => {
  const violations: LayerFirstViolation[] = []
  const sourceFile = parseSource(path, text)
  const pushEffectRun = (node: ts.Node): void => {
    violations.push({
      kind: "forbidden-effect-run",
      path,
      line: lineForOffset(text, node.getStart(sourceFile)),
      message: "Effect.run* belongs at composition edges, not library internals."
    })
  }
  const pushRuntimeGlobal = (node: ts.Node): void => {
    violations.push({
      kind: "forbidden-runtime-global",
      path,
      line: lineForOffset(text, node.getStart(sourceFile)),
      message: "Runtime globals and host adapters must enter through services or edge files."
    })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && importDeclarationUsesRuntimeFs(node)) {
      pushRuntimeGlobal(node)
    } else if (ts.isCallExpression(node)) {
      if (callExpressionImportsRuntimeFs(node)) {
        pushRuntimeGlobal(node)
      } else if (callExpressionUsesRuntimeGlobal(node)) {
        pushRuntimeGlobal(node)
      }
    } else if (isStaticAccessExpression(node)) {
      if (isEffectRunAccess(node)) {
        pushEffectRun(node)
      } else if (propertyAccessUsesRuntimeGlobal(node)) {
        pushRuntimeGlobal(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return violations
}

const importDeclarationUsesRuntimeFs = (node: ts.ImportDeclaration): boolean => {
  if (!isFsModuleSpecifier(node.moduleSpecifier)) {
    return false
  }
  const clause = node.importClause
  if (clause === undefined) {
    return true
  }
  if (clause.isTypeOnly) {
    return false
  }
  if (clause.name !== undefined) {
    return true
  }
  const bindings = clause.namedBindings
  if (bindings === undefined) {
    return false
  }
  if (ts.isNamespaceImport(bindings)) {
    return true
  }
  return bindings.elements.some((element) => !element.isTypeOnly)
}

const callExpressionImportsRuntimeFs = (node: ts.CallExpression): boolean => {
  const [firstArgument] = node.arguments
  if (!isFsModuleSpecifier(firstArgument)) {
    return false
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true
  }
  return ts.isIdentifier(node.expression) && node.expression.text === "require"
}

const callExpressionUsesRuntimeGlobal = (node: ts.CallExpression): boolean => {
  const expression = node.expression
  if (!isStaticAccessExpression(expression)) {
    return false
  }
  const name = staticAccessName(expression)
  if (
    isRuntimeObjectPropertyAccess(expression, "Date", "now") ||
    isRuntimeObjectPropertyAccess(expression, "Math", "random") ||
    isCryptoRandomUuidAccess(expression)
  ) {
    return true
  }
  return (
    (name === "file" || name === "write") && isRuntimeObjectExpression(expression.expression, "Bun")
  )
}

const propertyAccessUsesRuntimeGlobal = (node: StaticAccessExpression): boolean =>
  isRuntimeObjectPropertyAccess(node, "process", "env") ||
  isRuntimeObjectPropertyAccess(node, "Bun", "env")

type StaticAccessExpression = ts.PropertyAccessExpression | ts.ElementAccessExpression

const isStaticAccessExpression = (node: ts.Node): node is StaticAccessExpression =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)

const isEffectRunAccess = (node: StaticAccessExpression): boolean =>
  ts.isIdentifier(node.expression) &&
  node.expression.text === "Effect" &&
  (staticAccessName(node)?.startsWith("run") ?? false)

const isRuntimeObjectPropertyAccess = (
  node: StaticAccessExpression,
  objectName: string,
  propertyName: string
): boolean =>
  staticAccessName(node) === propertyName && isRuntimeObjectExpression(node.expression, objectName)

const isRuntimeObjectExpression = (node: ts.Expression, objectName: string): boolean => {
  if (ts.isIdentifier(node)) {
    return node.text === objectName
  }
  return (
    isStaticAccessExpression(node) &&
    staticAccessName(node) === objectName &&
    isGlobalThisExpression(node.expression)
  )
}

const isCryptoRandomUuidAccess = (node: StaticAccessExpression): boolean => {
  if (staticAccessName(node) !== "randomUUID") {
    return false
  }
  const expression = node.expression
  if (ts.isIdentifier(expression)) {
    return expression.text === "crypto"
  }
  return (
    isStaticAccessExpression(expression) &&
    staticAccessName(expression) === "crypto" &&
    isGlobalThisExpression(expression.expression)
  )
}

const staticAccessName = (node: StaticAccessExpression): string | undefined => {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text
  }
  const argument = node.argumentExpression
  return ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
    ? argument.text
    : undefined
}

const isGlobalThisExpression = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) && node.text === "globalThis"

const isFsModuleSpecifier = (node: ts.Node | undefined): node is ts.StringLiteral =>
  node !== undefined && ts.isStringLiteral(node) && /^(?:node:)?fs(?:\/promises)?$/u.test(node.text)

const scanPublicPromiseSource = (
  path: string,
  text: string,
  sourceTexts: ReadonlyMap<string, string>,
  publicEntrypoints: ReadonlySet<string>,
  allowlist: ReadonlySet<string>
): readonly LayerFirstViolation[] => {
  if (!publicEntrypoints.has(path)) {
    return []
  }
  const packageName = packageNameFromPath(path)
  if (packageName === undefined) {
    return []
  }
  const violations: LayerFirstViolation[] = []
  const reportedSymbols = new Set<string>()
  for (const symbol of collectPromiseExports(path, text, sourceTexts, new Set())) {
    const key = `${packageName}:${symbol.name}`
    if (isPromiseAllowlisted(key, allowlist) || reportedSymbols.has(key)) {
      continue
    }
    reportedSymbols.add(key)
    violations.push({
      kind: "public-promise-api",
      path: symbol.path,
      line: lineForOffset(sourceTexts.get(symbol.path) ?? text, symbol.offset),
      symbol: key,
      message: "Public effectful APIs should return Effect.Effect<A, E, R>, not Promise<A>."
    })
  }
  return violations
}

const isPromiseAllowlisted = (symbol: string, allowlist: ReadonlySet<string>): boolean => {
  if (allowlist.has(symbol)) {
    return true
  }
  const [packageName, publicName] = symbol.split(":", 2)
  if (packageName === undefined || publicName === undefined) {
    return false
  }
  const memberStart = publicName.indexOf(".")
  return memberStart === -1
    ? false
    : allowlist.has(`${packageName}:${publicName.slice(0, memberStart)}`)
}

const scanPublicBoundaryClasses = (
  path: string,
  text: string,
  sourceTexts: ReadonlyMap<string, string>,
  allowlist: ReadonlySet<string>
): readonly LayerFirstViolation[] => {
  const packageName = packageNameFromPath(path)
  if (packageName === undefined) {
    return []
  }
  const violations: LayerFirstViolation[] = []
  for (const boundary of collectBoundaryClassExports(path, text, sourceTexts, new Set())) {
    if (boundary.extendsTaggedError) {
      continue
    }
    if (!BOUNDARY_SUFFIX_PATTERN.test(boundary.name)) {
      continue
    }
    const symbol = `${packageName}:${boundary.name}`
    if (allowlist.has(symbol)) {
      continue
    }
    if (!boundary.extendsSchemaClass) {
      violations.push({
        kind: "public-boundary-without-schema",
        path: boundary.path,
        line: lineForOffset(sourceTexts.get(boundary.path) ?? text, boundary.offset),
        symbol,
        message: "Public boundary classes must extend Schema.Class."
      })
    }
  }
  return violations
}

const scanPublicApiSnapshot = (
  path: string,
  text: string,
  allowlist: ReadonlySet<string>
): Effect.Effect<readonly LayerFirstViolation[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const snapshot = yield* parseSnapshot(path, text)
    if (typeof snapshot.packageName !== "string") {
      return []
    }
    const symbols = Array.isArray(snapshot.symbols) ? snapshot.symbols : []
    const violations: LayerFirstViolation[] = []
    for (const symbol of symbols) {
      if (!isPublicApiSymbolSnapshot(symbol)) {
        continue
      }
      const key = `${snapshot.packageName}:${symbol.name}`
      if (allowlist.has(key)) {
        continue
      }
      if (symbol.signature.includes("Promise<")) {
        violations.push({
          kind: "public-promise-api",
          path,
          line: 1,
          symbol: key,
          message:
            "Public API snapshot exposes Promise; use Effect.Effect or add an explicit edge allowlist."
        })
      }
    }
    return violations
  })

const parseSnapshot = (
  path: string,
  text: string
): Effect.Effect<PublicApiSnapshotFile, LayerFirstFileError, never> => {
  try {
    return Effect.succeed(JSON.parse(text) as PublicApiSnapshotFile)
  } catch (cause) {
    return Effect.fail(
      new LayerFirstFileError({
        operation: "parseJson",
        path,
        message: `failed to parse JSON file ${path}`,
        cause
      })
    )
  }
}

interface ExportedPromiseSymbol {
  readonly name: string
  readonly path: string
  readonly offset: number
}

interface ImportedBinding {
  readonly targetPath: string
  readonly importedName: string
  readonly namespace: boolean
}

interface ExportedBoundaryClass {
  readonly name: string
  readonly path: string
  readonly offset: number
  readonly extendsSchemaClass: boolean
  readonly extendsTaggedError: boolean
}

const parseSource = (path: string, text: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

const promiseReturningExportedSymbols = (
  path: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  exports: LocalExportNames
): readonly ExportedPromiseSymbol[] => {
  if (ts.isFunctionDeclaration(statement)) {
    const name = statement.name?.text ?? "default"
    if (
      !hasAsyncModifier(statement) &&
      !typeIncludesPromise(statement.type) &&
      !bodyReturnsPromise(statement)
    ) {
      return []
    }
    return exportedPromiseNames(statement, name, exports).map((exportedName) => ({
      name: exportedName,
      path,
      offset: statement.getStart(sourceFile)
    }))
  }
  if (ts.isVariableStatement(statement)) {
    const symbols: ExportedPromiseSymbol[] = []
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue
      }
      if (
        typeIncludesPromise(declaration.type) ||
        initializerIsAsync(declaration.initializer) ||
        initializerReturnsPromise(declaration.initializer)
      ) {
        symbols.push(
          ...exportedPromiseNames(statement, declaration.name.text, exports).map(
            (exportedName) => ({
              name: exportedName,
              path,
              offset: declaration.getStart(sourceFile)
            })
          )
        )
      }
    }
    return symbols
  }
  if (ts.isClassDeclaration(statement)) {
    const className = statement.name?.text ?? "default"
    const exportedNames = exportedClassNames(statement, className, exports)
    if (exportedNames.length === 0) {
      return []
    }

    const symbols: ExportedPromiseSymbol[] = []
    for (const member of statement.members) {
      const memberName = publicMemberName(member)
      if (memberName === undefined) {
        continue
      }
      if (memberReturnsPromise(member)) {
        for (const exportedName of exportedNames) {
          symbols.push({
            name: `${exportedName}.${memberName}`,
            path,
            offset: member.getStart(sourceFile)
          })
        }
      }
    }
    return symbols
  }
  if (ts.isInterfaceDeclaration(statement)) {
    const exportedNames = exportedPromiseNames(statement, statement.name.text, exports)
    if (exportedNames.length === 0) {
      return []
    }

    const symbols: ExportedPromiseSymbol[] = []
    for (const member of statement.members) {
      if (!typeElementReturnsPromise(member)) {
        continue
      }
      const memberName = publicTypeMemberName(member)
      for (const exportedName of exportedNames) {
        symbols.push({
          name: memberName === undefined ? exportedName : `${exportedName}.${memberName}`,
          path,
          offset: member.getStart(sourceFile)
        })
      }
    }
    return symbols
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    if (!typeIncludesPromise(statement.type)) {
      return []
    }
    return exportedPromiseNames(statement, statement.name.text, exports).map((exportedName) => ({
      name: exportedName,
      path,
      offset: statement.getStart(sourceFile)
    }))
  }
  if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
    return promiseSymbolsFromDefaultExpression(path, statement, sourceFile)
  }
  return []
}

const collectPromiseExports = (
  path: string,
  text: string,
  sourceTexts: ReadonlyMap<string, string>,
  visited: Set<string>
): readonly ExportedPromiseSymbol[] => {
  if (visited.has(path)) {
    return []
  }
  visited.add(path)

  const sourceFile = parseSource(path, text)
  const exports = localExportNames(sourceFile)
  const imports = localImportBindings(path, sourceFile, sourceTexts)
  const symbols: ExportedPromiseSymbol[] = []

  for (const statement of sourceFile.statements) {
    symbols.push(...promiseReturningExportedSymbols(path, statement, sourceFile, exports))
    symbols.push(
      ...promiseExportsFromReExportDeclaration(path, statement, sourceFile, sourceTexts, visited)
    )
    symbols.push(
      ...promiseExportsFromImportedLocalExportDeclaration(
        path,
        statement,
        sourceFile,
        sourceTexts,
        visited,
        imports
      )
    )
    symbols.push(
      ...promiseSymbolsFromImportedDefaultExportAssignment(
        path,
        statement,
        sourceFile,
        sourceTexts,
        visited,
        imports
      )
    )
  }

  visited.delete(path)
  return symbols
}

const collectBoundaryClassExports = (
  path: string,
  text: string,
  sourceTexts: ReadonlyMap<string, string>,
  visited: Set<string>
): readonly ExportedBoundaryClass[] => {
  if (visited.has(path)) {
    return []
  }
  visited.add(path)

  const sourceFile = parseSource(path, text)
  const exports = localExportNames(sourceFile)
  const imports = localImportBindings(path, sourceFile, sourceTexts)
  const symbols: ExportedBoundaryClass[] = []

  for (const statement of sourceFile.statements) {
    symbols.push(...boundaryClassesFromLocalDeclaration(path, statement, sourceFile, exports))
    symbols.push(
      ...boundaryClassesFromReExportDeclaration(path, statement, sourceFile, sourceTexts, visited)
    )
    symbols.push(
      ...boundaryClassesFromImportedLocalExportDeclaration(
        path,
        statement,
        sourceFile,
        sourceTexts,
        visited,
        imports
      )
    )
  }

  visited.delete(path)
  return symbols
}

const boundaryClassesFromLocalDeclaration = (
  path: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  exports: LocalExportNames
): readonly ExportedBoundaryClass[] => {
  if (!ts.isClassDeclaration(statement)) {
    return []
  }
  const name = statement.name?.text ?? "default"
  const exportedNames = exportedClassNames(statement, name, exports)
  const boundaryNames = uniqueStrings([
    ...exportedNames,
    ...(hasModifier(statement, ts.SyntaxKind.DefaultKeyword) && statement.name !== undefined
      ? [statement.name.text]
      : [])
  ])
  if (boundaryNames.length === 0) {
    return []
  }
  const heritage = classBoundaryHeritage(statement)
  return boundaryNames.map((exportedName) => ({
    name: exportedName,
    path,
    offset: statement.getStart(sourceFile),
    extendsSchemaClass: heritage.extendsSchemaClass,
    extendsTaggedError: heritage.extendsTaggedError
  }))
}

const classBoundaryHeritage = (
  statement: ts.ClassDeclaration
): Pick<ExportedBoundaryClass, "extendsSchemaClass" | "extendsTaggedError"> => {
  let extendsSchemaClass = false
  let extendsTaggedError = false
  for (const clause of statement.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue
    }
    for (const type of clause.types) {
      extendsSchemaClass ||= heritageExpressionCalls(type.expression, "Schema", "Class")
      extendsTaggedError ||= heritageExpressionCalls(type.expression, "Data", "TaggedError")
    }
  }
  return { extendsSchemaClass, extendsTaggedError }
}

const heritageExpressionCalls = (
  node: ts.LeftHandSideExpression,
  objectName: string,
  propertyName: string
): boolean => {
  if (ts.isCallExpression(node)) {
    return heritageExpressionCalls(node.expression, objectName, propertyName)
  }
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === propertyName &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === objectName
  )
}

const promiseExportsFromReExportDeclaration = (
  path: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  sourceTexts: ReadonlyMap<string, string>,
  visited: Set<string>
): readonly ExportedPromiseSymbol[] => {
  if (
    !ts.isExportDeclaration(statement) ||
    statement.moduleSpecifier === undefined ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return []
  }

  const targetPath = resolveLocalModulePath(path, statement.moduleSpecifier.text, sourceTexts)
  if (targetPath === undefined) {
    return []
  }
  const targetText = sourceTexts.get(targetPath)
  if (targetText === undefined) {
    return []
  }

  const targetSymbols = collectPromiseExports(targetPath, targetText, sourceTexts, visited)
  if (statement.exportClause === undefined) {
    return targetSymbols
      .filter((symbol) => symbol.name !== "default")
      .map((symbol) => ({
        ...symbol,
        path,
        offset: statement.getStart(sourceFile)
      }))
  }
  if (ts.isNamespaceExport(statement.exportClause)) {
    const namespace = statement.exportClause.name.text
    return targetSymbols.map((symbol) => ({
      name: `${namespace}.${symbol.name}`,
      path,
      offset: statement.getStart(sourceFile)
    }))
  }
  if (!ts.isNamedExports(statement.exportClause)) {
    return []
  }

  const symbols: ExportedPromiseSymbol[] = []
  for (const element of statement.exportClause.elements) {
    const importedName = element.propertyName?.text ?? element.name.text
    const exportedName = element.name.text
    for (const targetSymbol of targetSymbols) {
      if (targetSymbol.name === importedName) {
        symbols.push({
          name: exportedName,
          path,
          offset: statement.getStart(sourceFile)
        })
        continue
      }
      const memberPrefix = `${importedName}.`
      if (targetSymbol.name.startsWith(memberPrefix)) {
        symbols.push({
          name: `${exportedName}.${targetSymbol.name.slice(memberPrefix.length)}`,
          path,
          offset: statement.getStart(sourceFile)
        })
      }
    }
  }
  return symbols
}

const promiseExportsFromImportedLocalExportDeclaration = (
  path: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  sourceTexts: ReadonlyMap<string, string>,
  visited: Set<string>,
  imports: ReadonlyMap<string, ImportedBinding>
): readonly ExportedPromiseSymbol[] => {
  if (
    !ts.isExportDeclaration(statement) ||
    statement.moduleSpecifier !== undefined ||
    statement.exportClause === undefined ||
    !ts.isNamedExports(statement.exportClause)
  ) {
    return []
  }

  const symbols: ExportedPromiseSymbol[] = []
  for (const element of statement.exportClause.elements) {
    const localName = element.propertyName?.text ?? element.name.text
    const binding = imports.get(localName)
    if (binding === undefined) {
      continue
    }
    const targetText = sourceTexts.get(binding.targetPath)
    if (targetText === undefined) {
      continue
    }
    const targetSymbols = collectPromiseExports(
      binding.targetPath,
      targetText,
      sourceTexts,
      visited
    )
    const exportedName = element.name.text
    symbols.push(
      ...mapImportedPromiseSymbols(
        targetSymbols,
        binding,
        exportedName,
        path,
        statement.getStart(sourceFile)
      )
    )
  }
  return symbols
}

const mapImportedPromiseSymbols = (
  targetSymbols: readonly ExportedPromiseSymbol[],
  binding: ImportedBinding,
  exportedName: string,
  path: string,
  offset: number
): readonly ExportedPromiseSymbol[] => {
  if (binding.namespace) {
    return targetSymbols.map((symbol) => ({
      name: `${exportedName}.${symbol.name}`,
      path,
      offset
    }))
  }
  const symbols: ExportedPromiseSymbol[] = []
  for (const targetSymbol of targetSymbols) {
    if (targetSymbol.name === binding.importedName) {
      symbols.push({ name: exportedName, path, offset })
      continue
    }
    const memberPrefix = `${binding.importedName}.`
    if (targetSymbol.name.startsWith(memberPrefix)) {
      symbols.push({
        name: `${exportedName}.${targetSymbol.name.slice(memberPrefix.length)}`,
        path,
        offset
      })
    }
  }
  return symbols
}

const promiseSymbolsFromImportedDefaultExportAssignment = (
  path: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  sourceTexts: ReadonlyMap<string, string>,
  visited: Set<string>,
  imports: ReadonlyMap<string, ImportedBinding>
): readonly ExportedPromiseSymbol[] => {
  if (!ts.isExportAssignment(statement) || statement.isExportEquals === true) {
    return []
  }
  const expression = unwrapExpression(statement.expression)
  if (!ts.isIdentifier(expression)) {
    return []
  }
  const binding = imports.get(expression.text)
  if (binding === undefined || binding.namespace) {
    return []
  }
  const targetText = sourceTexts.get(binding.targetPath)
  if (targetText === undefined) {
    return []
  }
  return mapImportedPromiseSymbols(
    collectPromiseExports(binding.targetPath, targetText, sourceTexts, visited),
    binding,
    "default",
    path,
    statement.getStart(sourceFile)
  )
}

const boundaryClassesFromReExportDeclaration = (
  path: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  sourceTexts: ReadonlyMap<string, string>,
  visited: Set<string>
): readonly ExportedBoundaryClass[] => {
  if (
    !ts.isExportDeclaration(statement) ||
    statement.moduleSpecifier === undefined ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return []
  }

  const targetPath = resolveLocalModulePath(path, statement.moduleSpecifier.text, sourceTexts)
  if (targetPath === undefined) {
    return []
  }
  const targetText = sourceTexts.get(targetPath)
  if (targetText === undefined) {
    return []
  }

  const targetSymbols = collectBoundaryClassExports(targetPath, targetText, sourceTexts, visited)
  if (statement.exportClause === undefined) {
    return targetSymbols
      .filter((symbol) => symbol.name !== "default")
      .map((symbol) => ({
        ...symbol,
        path,
        offset: statement.getStart(sourceFile)
      }))
  }
  if (ts.isNamespaceExport(statement.exportClause)) {
    const namespace = statement.exportClause.name.text
    return targetSymbols.map((symbol) => ({
      ...symbol,
      name: `${namespace}.${symbol.name}`,
      path,
      offset: statement.getStart(sourceFile)
    }))
  }
  if (!ts.isNamedExports(statement.exportClause)) {
    return []
  }

  const symbols: ExportedBoundaryClass[] = []
  for (const element of statement.exportClause.elements) {
    const importedName = element.propertyName?.text ?? element.name.text
    const exportedName = element.name.text
    for (const targetSymbol of targetSymbols) {
      if (targetSymbol.name === importedName) {
        symbols.push({
          ...targetSymbol,
          name: exportedName,
          path,
          offset: statement.getStart(sourceFile)
        })
      }
    }
  }
  return symbols
}

const boundaryClassesFromImportedLocalExportDeclaration = (
  path: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  sourceTexts: ReadonlyMap<string, string>,
  visited: Set<string>,
  imports: ReadonlyMap<string, ImportedBinding>
): readonly ExportedBoundaryClass[] => {
  if (
    !ts.isExportDeclaration(statement) ||
    statement.moduleSpecifier !== undefined ||
    statement.exportClause === undefined ||
    !ts.isNamedExports(statement.exportClause)
  ) {
    return []
  }

  const symbols: ExportedBoundaryClass[] = []
  for (const element of statement.exportClause.elements) {
    const localName = element.propertyName?.text ?? element.name.text
    const binding = imports.get(localName)
    if (binding === undefined) {
      continue
    }
    const targetText = sourceTexts.get(binding.targetPath)
    if (targetText === undefined) {
      continue
    }
    const targetSymbols = collectBoundaryClassExports(
      binding.targetPath,
      targetText,
      sourceTexts,
      visited
    )
    const exportedName = element.name.text
    symbols.push(
      ...mapImportedBoundaryClasses(
        targetSymbols,
        binding,
        exportedName,
        path,
        statement.getStart(sourceFile)
      )
    )
  }
  return symbols
}

const mapImportedBoundaryClasses = (
  targetSymbols: readonly ExportedBoundaryClass[],
  binding: ImportedBinding,
  exportedName: string,
  path: string,
  offset: number
): readonly ExportedBoundaryClass[] => {
  if (binding.namespace) {
    return targetSymbols.map((symbol) => ({
      ...symbol,
      name: `${exportedName}.${symbol.name}`,
      path,
      offset
    }))
  }
  return targetSymbols
    .filter((symbol) => symbol.name === binding.importedName)
    .map((symbol) => ({ ...symbol, name: exportedName, path, offset }))
}

interface LocalExportNames {
  readonly byLocalName: ReadonlyMap<string, readonly string[]>
  readonly defaultLocalName?: string
}

const localImportBindings = (
  path: string,
  sourceFile: ts.SourceFile,
  sourceTexts: ReadonlyMap<string, string>
): ReadonlyMap<string, ImportedBinding> => {
  const imports = new Map<string, ImportedBinding>()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue
    }
    const targetPath = resolveLocalModulePath(path, statement.moduleSpecifier.text, sourceTexts)
    if (targetPath === undefined) {
      continue
    }
    if (statement.importClause.name !== undefined) {
      imports.set(statement.importClause.name.text, {
        targetPath,
        importedName: "default",
        namespace: false
      })
    }
    const namedBindings = statement.importClause.namedBindings
    if (namedBindings === undefined) {
      continue
    }
    if (ts.isNamespaceImport(namedBindings)) {
      imports.set(namedBindings.name.text, { targetPath, importedName: "*", namespace: true })
      continue
    }
    for (const element of namedBindings.elements) {
      imports.set(element.name.text, {
        targetPath,
        importedName: element.propertyName?.text ?? element.name.text,
        namespace: false
      })
    }
  }
  return imports
}

const resolveLocalModulePath = (
  fromPath: string,
  moduleSpecifier: string,
  sourceTexts: ReadonlyMap<string, string>
): string | undefined => {
  if (!moduleSpecifier.startsWith(".")) {
    return undefined
  }

  const base = posixNormalize(posixJoin(posixDirname(fromPath), moduleSpecifier))
  const sourceBase = base.replace(/\.(?:cjs|js|jsx|mjs)$/u, "")
  const candidates =
    sourceBase === base
      ? SOURCE_EXTENSIONS.flatMap((extension) => [
          `${base}${extension}`,
          posixJoin(base, `index${extension}`)
        ])
      : SOURCE_EXTENSIONS.map((extension) => `${sourceBase}${extension}`)
  return candidates.find((candidate) => sourceTexts.has(candidate))
}

const localExportNames = (sourceFile: ts.SourceFile): LocalExportNames => {
  const names = new Map<string, string[]>()
  let defaultLocalName: string | undefined
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        addExportedName(names, element.propertyName?.text ?? element.name.text, element.name.text)
      }
    } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      defaultLocalName = statement.expression.text
      addExportedName(names, statement.expression.text, "default")
    }
  }
  return defaultLocalName === undefined
    ? { byLocalName: names }
    : { byLocalName: names, defaultLocalName }
}

const addExportedName = (
  names: Map<string, string[]>,
  localName: string,
  exportedName: string
): void => {
  const existing = names.get(localName)
  if (existing === undefined) {
    names.set(localName, [exportedName])
  } else {
    existing.push(exportedName)
  }
}

const exportedPromiseNames = (
  node: ts.Node,
  localName: string,
  exports: LocalExportNames
): readonly string[] => {
  const names = [...(exports.byLocalName.get(localName) ?? [])]
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    names.push("default")
  } else if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
    names.push(localName)
  }
  return uniqueStrings(names)
}

const exportedClassNames = (
  node: ts.Node,
  localName: string,
  exports: LocalExportNames
): readonly string[] => {
  const names = [...(exports.byLocalName.get(localName) ?? [])]
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    names.push("default")
  } else if (isExported(node) && localName !== "default") {
    names.push(localName)
  }
  return uniqueStrings(names)
}

const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)]

const initializerIsAsync = (initializer: ts.Expression | undefined): boolean => {
  if (initializer === undefined) {
    return false
  }
  const expression = unwrapExpression(initializer)
  return (
    (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) &&
    hasAsyncModifier(expression)
  )
}

const initializerReturnsPromise = (initializer: ts.Expression | undefined): boolean => {
  if (initializer === undefined) {
    return false
  }
  const expression = unwrapExpression(initializer)
  return (
    (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) &&
    (typeIncludesPromise(expression.type) || bodyReturnsPromise(expression))
  )
}

const typeIncludesPromise = (node: ts.Node | undefined): boolean => {
  if (node === undefined) {
    return false
  }
  let includesPromise = false
  const visit = (child: ts.Node): void => {
    if (includesPromise) {
      return
    }
    if (ts.isTypeReferenceNode(child) && entityNameText(child.typeName) === "Promise") {
      includesPromise = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return includesPromise
}

const entityNameText = (node: ts.EntityName): string =>
  ts.isIdentifier(node) ? node.text : `${entityNameText(node.left)}.${node.right.text}`

const memberReturnsPromise = (
  member: ts.ClassElement
): member is ts.MethodDeclaration | ts.PropertyDeclaration | ts.GetAccessorDeclaration => {
  if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
    return false
  }
  if (hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) {
    return false
  }
  if (ts.isMethodDeclaration(member)) {
    return (
      hasAsyncModifier(member) || typeIncludesPromise(member.type) || bodyReturnsPromise(member)
    )
  }
  if (ts.isPropertyDeclaration(member)) {
    return typeIncludesPromise(member.type) || initializerReturnsPromise(member.initializer)
  }
  return (
    ts.isGetAccessorDeclaration(member) &&
    (typeIncludesPromise(member.type) || bodyReturnsPromise(member))
  )
}

const promiseSymbolsFromDefaultExpression = (
  path: string,
  statement: ts.ExportAssignment,
  sourceFile: ts.SourceFile
): readonly ExportedPromiseSymbol[] => {
  const expression = unwrapExpression(statement.expression)
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    if (
      hasAsyncModifier(expression) ||
      typeIncludesPromise(expression.type) ||
      bodyReturnsPromise(expression)
    ) {
      return [{ name: "default", path, offset: statement.getStart(sourceFile) }]
    }
    return []
  }
  if (ts.isClassExpression(expression)) {
    const symbols: ExportedPromiseSymbol[] = []
    for (const member of expression.members) {
      const memberName = publicMemberName(member)
      if (memberName !== undefined && memberReturnsPromise(member)) {
        symbols.push({
          name: `default.${memberName}`,
          path,
          offset: member.getStart(sourceFile)
        })
      }
    }
    return symbols
  }
  return expressionReturnsPromise(expression)
    ? [{ name: "default", path, offset: statement.getStart(sourceFile) }]
    : []
}

const typeElementReturnsPromise = (member: ts.TypeElement): boolean => {
  if (
    ts.isMethodSignature(member) ||
    ts.isPropertySignature(member) ||
    ts.isCallSignatureDeclaration(member) ||
    ts.isConstructSignatureDeclaration(member) ||
    ts.isIndexSignatureDeclaration(member)
  ) {
    return typeIncludesPromise(member.type)
  }
  return false
}

const publicTypeMemberName = (member: ts.TypeElement): string | undefined => {
  if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) {
    return undefined
  }
  if (member.name === undefined || ts.isPrivateIdentifier(member.name)) {
    return undefined
  }
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
    return member.name.text
  }
  return undefined
}

const bodyReturnsPromise = (node: ts.FunctionLikeDeclaration): boolean => {
  if (ts.isArrowFunction(node) && node.body !== undefined && !ts.isBlock(node.body)) {
    return expressionReturnsPromise(node.body)
  }
  const body = node.body
  if (body === undefined || !ts.isBlock(body)) {
    return false
  }
  let returnsPromise = false
  const visit = (child: ts.Node): void => {
    if (returnsPromise) {
      return
    }
    if (
      child !== body &&
      (ts.isFunctionDeclaration(child) ||
        ts.isFunctionExpression(child) ||
        ts.isArrowFunction(child) ||
        ts.isMethodDeclaration(child))
    ) {
      return
    }
    if (
      ts.isReturnStatement(child) &&
      child.expression !== undefined &&
      expressionReturnsPromise(child.expression)
    ) {
      returnsPromise = true
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(body, visit)
  return returnsPromise
}

const expressionReturnsPromise = (expression: ts.Expression): boolean => {
  const unwrapped = unwrapExpression(expression)
  if (ts.isNewExpression(unwrapped) && isPromiseExpression(unwrapped.expression)) {
    return true
  }
  if (!ts.isCallExpression(unwrapped)) {
    return false
  }
  return isPromiseCallExpression(unwrapped.expression)
}

const isPromiseCallExpression = (node: ts.Expression): boolean =>
  isPromiseExpression(node) ||
  (isStaticAccessExpression(node) && isPromiseExpression(node.expression))

const isPromiseExpression = (node: ts.Expression): boolean => {
  if (ts.isIdentifier(node)) {
    return node.text === "Promise"
  }
  return (
    isStaticAccessExpression(node) &&
    staticAccessName(node) === "Promise" &&
    isGlobalThisExpression(node.expression)
  )
}

const unwrapExpression = (expression: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(expression) ? unwrapExpression(expression.expression) : expression

const publicMemberName = (member: ts.ClassElement): string | undefined => {
  if (
    !ts.isMethodDeclaration(member) &&
    !ts.isPropertyDeclaration(member) &&
    !ts.isGetAccessorDeclaration(member)
  ) {
    return undefined
  }
  if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
    return undefined
  }
  if (hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) {
    return undefined
  }
  if (member.name === undefined) {
    return undefined
  }
  if (ts.isPrivateIdentifier(member.name)) {
    return undefined
  }
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
    return member.name.text
  }
  return undefined
}

const isExported = (node: ts.Node): boolean =>
  hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword)

const hasAsyncModifier = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.AsyncKeyword)

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)

const isPublicApiSymbolSnapshot = (value: unknown): value is PublicApiSymbolSnapshot =>
  isRecord(value) && typeof value["name"] === "string" && typeof value["signature"] === "string"

const discoverSourceFiles = (
  cwd: string,
  roots: readonly string[]
): Effect.Effect<readonly string[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const files: string[] = []
    for (const root of roots) {
      const absoluteRoot = join(cwd, root)
      if (yield* fileExists(absoluteRoot)) {
        files.push(...(yield* walkSourceFiles(absoluteRoot)))
      }
    }
    return files.sort()
  })

const discoverSnapshotFiles = (
  cwd: string
): Effect.Effect<readonly string[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const root = join(cwd, "api", "snapshots")
    return (yield* fileExists(root)) ? yield* walkSnapshotFiles(root) : []
  })

const discoverPublicEntrypoints = (
  cwd: string,
  sourceTexts: ReadonlyMap<string, string>
): Effect.Effect<ReadonlySet<string>, LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const entrypoints = new Set<string>()
    for (const root of packageRoots(sourceTexts.keys())) {
      const beforeCount = entrypoints.size
      const packageJsonPath = join(cwd, root, "package.json")
      if (yield* fileExists(packageJsonPath)) {
        const text = yield* readText(packageJsonPath)
        const packageJson = yield* parsePackageJson(toRepoPath(cwd, packageJsonPath), text)
        addPackageEntrypoints(root, packageJson, sourceTexts, entrypoints)
      }
      if (entrypoints.size === beforeCount) {
        addFallbackEntrypoints(root, sourceTexts, entrypoints)
      }
    }
    return entrypoints
  })

const parsePackageJson = (
  path: string,
  text: string
): Effect.Effect<PackageJsonFile, LayerFirstFileError, never> => {
  try {
    return Effect.succeed(JSON.parse(text) as PackageJsonFile)
  } catch (cause) {
    return Effect.fail(
      new LayerFirstFileError({
        operation: "parseJson",
        path,
        message: `failed to parse JSON file ${path}`,
        cause
      })
    )
  }
}

const packageRoots = (paths: Iterable<string>): readonly string[] => {
  const roots = new Set<string>()
  for (const path of paths) {
    const root = packageRootFromPath(path)
    if (root !== undefined) {
      roots.add(root)
    }
  }
  return [...roots].sort()
}

const packageRootFromPath = (path: string): string | undefined => {
  const parts = path.split("/")
  const packageIndex = parts.indexOf("packages")
  if (packageIndex >= 0) {
    const name = parts[packageIndex + 1]
    return name === undefined ? undefined : `packages/${name}`
  }
  const templateIndex = parts.indexOf("templates")
  if (templateIndex >= 0) {
    const name = parts[templateIndex + 1]
    return name === undefined ? undefined : `templates/${name}`
  }
  return undefined
}

const addPackageEntrypoints = (
  root: string,
  packageJson: PackageJsonFile,
  sourceTexts: ReadonlyMap<string, string>,
  entrypoints: Set<string>
): void => {
  for (const target of collectPackageTargets(packageJson.exports)) {
    addPackageEntrypoint(root, target, sourceTexts, entrypoints)
  }
  if (typeof packageJson.main === "string") {
    addPackageEntrypoint(root, packageJson.main, sourceTexts, entrypoints)
  }
  if (typeof packageJson.types === "string") {
    addPackageEntrypoint(root, packageJson.types, sourceTexts, entrypoints)
  }
}

const collectPackageTargets = (value: unknown): readonly string[] => {
  if (typeof value === "string") {
    return [value]
  }
  if (!isRecord(value)) {
    return []
  }
  return Object.values(value).flatMap(collectPackageTargets)
}

const addPackageEntrypoint = (
  root: string,
  target: string,
  sourceTexts: ReadonlyMap<string, string>,
  entrypoints: Set<string>
): void => {
  const normalizedTarget = target.startsWith("./") ? target.slice(2) : target
  const entrypoint = posixNormalize(posixJoin(root, normalizedTarget))
  if (isSourceFile(entrypoint) && !entrypoint.endsWith(".d.ts") && sourceTexts.has(entrypoint)) {
    entrypoints.add(entrypoint)
  }
}

const addFallbackEntrypoints = (
  root: string,
  sourceTexts: ReadonlyMap<string, string>,
  entrypoints: Set<string>
): void => {
  for (const extension of SOURCE_EXTENSIONS) {
    const entrypoint = posixJoin(root, `src/index${extension}`)
    if (sourceTexts.has(entrypoint)) {
      entrypoints.add(entrypoint)
    }
  }
}

const walkSourceFiles = (
  root: string
): Effect.Effect<readonly string[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const files: string[] = []
    const entries = yield* readDirectory(root)
    for (const entry of entries) {
      const path = join(root, entry.name)
      if (entry.isDirectory()) {
        if (!GENERATED_SEGMENTS.has(entry.name)) {
          files.push(...(yield* walkSourceFiles(path)))
        }
      } else if (isSourceFile(path) && !isTestFile(path) && !path.endsWith(".d.ts")) {
        files.push(path)
      }
    }
    return files
  })

const walkSnapshotFiles = (
  root: string
): Effect.Effect<readonly string[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const files: string[] = []
    const entries = yield* readDirectory(root)
    for (const entry of entries) {
      const path = join(root, entry.name)
      if (entry.isDirectory()) {
        files.push(...(yield* walkSnapshotFiles(path)))
      } else if (path.endsWith(".snapshot.json")) {
        files.push(path)
      }
    }
    return files.sort()
  })

const readDirectory = (
  path: string
): Effect.Effect<
  readonly { readonly name: string; readonly isDirectory: () => boolean }[],
  LayerFirstFileError,
  never
> =>
  Effect.tryPromise({
    try: () => readdir(path, { withFileTypes: true }),
    catch: (cause) =>
      new LayerFirstFileError({
        operation: "readdir",
        path,
        message: `failed to read directory ${path}`,
        cause
      })
  })

const readText = (path: string): Effect.Effect<string, LayerFirstFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new LayerFirstFileError({
        operation: "readFile",
        path,
        message: `failed to read file ${path}`,
        cause
      })
  })

const fileExists = (path: string): Effect.Effect<boolean, LayerFirstFileError, never> =>
  Effect.tryPromise({
    try: () => access(path),
    catch: (cause) => cause
  }).pipe(
    Effect.as(true),
    Effect.catch((cause) =>
      isMissingPathError(cause)
        ? Effect.succeed(false)
        : Effect.fail(
            new LayerFirstFileError({
              operation: "access",
              path,
              message: `failed to access path ${path}`,
              cause
            })
          )
    )
  )

const isSourceFile = (path: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))

const isTestFile = (path: string): boolean =>
  path.endsWith(".test.ts") || path.endsWith(".test.tsx") || path.includes(`${sep}__tests__${sep}`)

const toRepoPath = (cwd: string, path: string): string => relative(cwd, path).replaceAll("\\", "/")

const lineForOffset = (text: string, offset: number): number =>
  text.slice(0, offset).split(/\r?\n/u).length

const packageNameFromPath = (path: string): string | undefined => {
  const parts = path.split("/")
  const packageIndex = parts.indexOf("packages")
  if (packageIndex >= 0) {
    const name = parts[packageIndex + 1]
    return name === undefined ? undefined : `@effect-desktop/${name}`
  }
  const templateIndex = parts.indexOf("templates")
  if (templateIndex >= 0) {
    const name = parts[templateIndex + 1]
    return name === undefined ? undefined : `@effect-desktop/template-${name}`
  }
  return undefined
}

const formatViolation = (violation: LayerFirstViolation): string => {
  const symbol = violation.symbol === undefined ? "" : ` ${violation.symbol}`
  return `- ${violation.kind}${symbol} at ${violation.path}:${violation.line}: ${violation.message}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isMissingPathError = (value: unknown): boolean =>
  isRecord(value) && (value["code"] === "ENOENT" || value["code"] === "ENOTDIR")
