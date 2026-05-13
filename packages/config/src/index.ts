import { Data, Effect, Schema } from "effect"

import defaultCspPolicySource from "./default-csp-policy.json" with { type: "json" }

const NonEmptyString = Schema.NonEmptyString

export const ProductionRuleId = Schema.Literals([
  "renderer-backend-import",
  "raw-bridge-call",
  "renderer-native-host-protocol",
  "filesystem-write-without-scope",
  "process-permission-without-policy",
  "secret-access-without-audit",
  "update-install-without-signature",
  "app-protocol-path-traversal",
  "weakened-csp",
  "unsafe-external-navigation",
  "devtools-in-prod",
  "unscoped-resource",
  "unsupported-capability-without-guard",
  "secret-pattern-not-redacted"
])
export type ProductionRuleId = typeof ProductionRuleId.Type

export const ProductionCheckSeverity = Schema.Literals(["fail", "acknowledged"])
export type ProductionCheckSeverity = typeof ProductionCheckSeverity.Type

export class ProductionCheckLocation extends Schema.Class<ProductionCheckLocation>(
  "ProductionCheckLocation"
)({
  path: NonEmptyString,
  line: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  column: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0)))
}) {}

export class ProductionCheckViolation extends Schema.Class<ProductionCheckViolation>(
  "ProductionCheckViolation"
)({
  rule: ProductionRuleId,
  severity: ProductionCheckSeverity,
  message: NonEmptyString,
  fix: NonEmptyString,
  location: ProductionCheckLocation,
  justification: Schema.optionalKey(NonEmptyString)
}) {}

export class ProductionCheckReport extends Schema.Class<ProductionCheckReport>(
  "ProductionCheckReport"
)({
  passed: Schema.Boolean,
  failures: Schema.Array(ProductionCheckViolation),
  acknowledgements: Schema.Array(ProductionCheckViolation)
}) {}

export class ProductionCheckInvalidInput extends Data.TaggedError("InvalidInput")<{
  readonly operation: string
  readonly message: string
  readonly cause: unknown
}> {}

export type ProductionCheckError = ProductionCheckInvalidInput

export interface ProductionCheckFile {
  readonly path: string
  readonly content: string
}

export interface FilesystemWritePolicy {
  readonly enabled?: boolean
  readonly roots?: readonly string[]
}

export interface ProcessPermissionPolicy {
  readonly enabled?: boolean
  readonly allow?: readonly string[]
  readonly ask?: readonly string[]
  readonly deny?: readonly string[]
}

export interface SecretPermissionPolicy {
  readonly read?: readonly string[]
  readonly write?: readonly string[]
  readonly audit?: "always" | "never"
}

export interface CspConfig {
  readonly policy?: string
  readonly disabled?: boolean
  readonly acknowledgeWeakening?: boolean
  readonly justification?: string
}

export interface CspWeakening {
  readonly directive: string
  readonly reason: string
}

export interface RedactionPolicy {
  readonly defaultPatternEnabled?: boolean
  readonly additionalPatterns?: readonly string[]
  readonly allowlist?: readonly string[]
}

export interface UpdateInstallPolicy {
  readonly enabled?: boolean
  readonly signatureVerification?: boolean
}

export interface AppProtocolPolicy {
  readonly allowPathTraversal?: boolean
}

export interface ResourcePolicy {
  readonly allowUnscoped?: boolean
}

export interface ContractCapabilityRequirement {
  readonly contract: string
  readonly capability: string
  readonly support: "supported" | "partial" | "unsupported"
  readonly isSupportedGuard?: boolean
}

export interface ProductionSecurityConfig {
  readonly security?: {
    readonly requireTypedBridge?: boolean
    readonly rendererNativeAccess?: boolean
    readonly requirePermissions?: boolean
    readonly externalNavigation?: "deny" | "ask"
    readonly devtoolsInProd?: boolean
    readonly csp?: CspConfig | undefined
    readonly redaction?: RedactionPolicy
  }
  readonly permissions?: {
    readonly filesystem?: {
      readonly write?: FilesystemWritePolicy
    }
    readonly process?: {
      readonly spawn?: ProcessPermissionPolicy
    }
    readonly secrets?: SecretPermissionPolicy
  }
  readonly update?: {
    readonly install?: UpdateInstallPolicy
  }
  readonly appProtocol?: AppProtocolPolicy
  readonly resources?: ResourcePolicy
  readonly contracts?: readonly ContractCapabilityRequirement[]
}

export interface DesktopConfig extends ProductionSecurityConfig {
  readonly app?: {
    readonly id?: string
    readonly name?: string
    readonly version?: string
  }
  readonly runtime?: {
    readonly engine?: RuntimeEngine
    readonly entry?: string
  }
  readonly renderer?: {
    readonly framework?: "react"
    readonly styling?: "tailwind"
    readonly entry?: string
    readonly dist?: string
  }
  readonly native?: {
    readonly host?: string
    readonly renderer?: string
  }
  readonly windows?: unknown
  readonly protocols?: readonly {
    readonly scheme: string
    readonly handler?: string
  }[]
  readonly build?: {
    readonly targets?: readonly string[]
  }
  readonly signing?: unknown
  readonly update?: ProductionSecurityConfig["update"] & {
    readonly channel?: "stable" | "beta" | "canary"
    readonly publicKey?: string
    readonly feedUrl?: string
    readonly minVersion?: string
    readonly maxVersion?: string | undefined
    readonly keyVersion?: number
    readonly rollback?: boolean
  }
  readonly telemetry?: {
    readonly enabled?: boolean
    readonly redactSensitive?: boolean
    readonly endpoint?: string
  }
  readonly protocol?: {
    readonly limits?: {
      readonly maxFrameBytes?: number
      readonly maxConcurrentRequestsPerWindow?: number
      readonly maxConcurrentStreamsPerWindow?: number
    }
  }
  readonly env?: Record<string, Record<string, string>>
  readonly workspace?: {
    readonly sharedConfigPath?: string
  }
}

export const RuntimeEngine = Schema.Literals(["bun", "node"])
export type RuntimeEngine = typeof RuntimeEngine.Type

export interface ProductionCheckInput {
  readonly config: ProductionSecurityConfig
  readonly configPath?: string
  readonly rendererFiles?: readonly ProductionCheckFile[]
}

interface RuleContext {
  readonly config: ProductionSecurityConfig
  readonly configPath: string
  readonly rendererFiles: readonly ProductionCheckFile[]
}

type Rule = (context: RuleContext) => readonly ProductionCheckViolation[]

interface SourceCapabilityUse {
  readonly primitive: string
  readonly method: string
  readonly support: ContractCapabilityRequirement["support"]
  readonly location: ProductionCheckLocation
  readonly guarded: boolean
}

interface ParsedCspPolicy {
  readonly directives: ReadonlyMap<string, readonly string[]>
  readonly duplicates: readonly string[]
}

export const defineDesktopConfig = <Config extends DesktopConfig>(config: Config): Config => config

export const DEFAULT_CSP_NONCE_PLACEHOLDER = "{N}"

export class CspDirective extends Schema.Class<CspDirective>("CspDirective")({
  name: NonEmptyString,
  values: Schema.Array(NonEmptyString)
}) {}

export class CspPolicy extends Schema.Class<CspPolicy>("CspPolicy")({
  directives: Schema.Array(CspDirective)
}) {}

export class CspNonce extends Schema.Class<CspNonce>("CspNonce")({
  value: NonEmptyString
}) {}

export const DEFAULT_CSP_POLICY: CspPolicy =
  Schema.decodeUnknownSync(CspPolicy)(defaultCspPolicySource)

export const DEFAULT_CSP_DIRECTIVES: readonly [directive: string, values: readonly string[]][] =
  DEFAULT_CSP_POLICY.directives.map((directive) => [directive.name, directive.values] as const)

export const makeCspNonce = (value: string): CspNonce =>
  new CspNonce({ value: validateCspNonce(value) })

export const mintCspNonce: Effect.Effect<CspNonce> = Effect.sync(() => {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return makeCspNonce([...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""))
})

export const renderDefaultCsp = (nonce: string = DEFAULT_CSP_NONCE_PLACEHOLDER): string =>
  renderCspPolicy(DEFAULT_CSP_POLICY, nonce)

export const renderCspPolicy = (
  policy: CspPolicy,
  nonce: string | CspNonce = DEFAULT_CSP_NONCE_PLACEHOLDER
): string => {
  const nonceValue = validateCspNonce(typeof nonce === "string" ? nonce : nonce.value)
  return renderCspDirectives(
    policy.directives.map((directive) => [directive.name, directive.values] as const),
    nonceValue
  )
}

export const effectiveCspPolicy = (csp: CspConfig | undefined): CspPolicy => {
  if (csp?.disabled === true) {
    return new CspPolicy({ directives: [] })
  }

  const overrides = parseCspPolicy(csp?.policy)
  const defaultDirectives = new Set(
    DEFAULT_CSP_POLICY.directives.map((directive) => directive.name)
  )
  const directives = DEFAULT_CSP_POLICY.directives.map(
    (directive) =>
      new CspDirective({
        name: directive.name,
        values: [...(overrides.directives.get(directive.name) ?? directive.values)]
      })
  )
  const extraDirectives = [...overrides.directives.entries()]
    .filter(([directive]) => !defaultDirectives.has(directive))
    .map(([name, values]) => new CspDirective({ name, values: [...values] }))

  return new CspPolicy({ directives: [...directives, ...extraDirectives] })
}

export const renderEffectiveCsp = (
  csp: CspConfig | undefined,
  nonce: string = DEFAULT_CSP_NONCE_PLACEHOLDER
): string => {
  if (csp?.disabled === true) {
    return ""
  }

  return renderCspPolicy(effectiveCspPolicy(csp), nonce)
}

export const cspWeakenings = (csp: CspConfig): readonly CspWeakening[] => {
  const weakenings: CspWeakening[] = []
  if (csp.disabled === true) {
    return [
      {
        directive: "security.csp.disabled",
        reason: "content security policy is disabled"
      }
    ]
  }

  const overrides = parseCspPolicy(csp.policy)
  for (const directive of overrides.duplicates) {
    weakenings.push({
      directive,
      reason: `${directive} appears more than once`
    })
  }
  for (const [directive, overrideValues] of overrides.directives) {
    const defaultValues = defaultCspDirectiveValues(directive)
    const forbidden = overrideValues.find(
      (value) =>
        (value === "'unsafe-inline'" || value === "'unsafe-eval'") &&
        !isPermittedDefaultSource(value, defaultValues)
    )
    if (forbidden !== undefined) {
      weakenings.push({
        directive,
        reason: `${directive} includes forbidden source ${forbidden}`
      })
      continue
    }

    if (defaultValues === undefined) {
      if (isAdditionalCspTightening(directive, overrideValues)) {
        continue
      }
      weakenings.push({
        directive,
        reason: `${directive} is not part of the default production CSP`
      })
      continue
    }

    if (isAdditionalCspTightening(directive, overrideValues)) {
      continue
    }

    const added = overrideValues.find((value) => !defaultValues.has(normalizeCspValue(value)))
    if (added !== undefined) {
      weakenings.push({
        directive,
        reason: `${directive} adds source ${added}`
      })
    }
  }

  return weakenings
}

export const runProductionCheck = (
  input: ProductionCheckInput
): Effect.Effect<ProductionCheckReport, ProductionCheckError, never> =>
  Effect.gen(function* () {
    const context = yield* decodeProductionCheckInput(input)
    const violations = PRODUCTION_RULES.flatMap((rule) => rule(context))
    const failures = violations.filter((violation) => violation.severity === "fail")
    const acknowledgements = violations.filter((violation) => violation.severity === "acknowledged")

    return new ProductionCheckReport({
      passed: failures.length === 0,
      failures,
      acknowledgements
    })
  })

export const formatProductionCheckReport = (report: ProductionCheckReport): string => {
  if (report.failures.length === 0 && report.acknowledgements.length === 0) {
    return "Production security check passed.\n"
  }

  const lines = [
    report.failures.length === 0
      ? "Production security check passed with acknowledged weakenings."
      : "Production security check failed."
  ]

  for (const violation of [...report.failures, ...report.acknowledgements]) {
    lines.push(
      "",
      `${violation.severity === "fail" ? "FAIL" : "ACK"} ${violation.rule}`,
      `Location: ${formatLocation(violation.location)}`,
      `Reason: ${violation.message}`,
      `Fix: ${violation.fix}`
    )
    if (violation.justification !== undefined) {
      lines.push(`Justification: ${violation.justification}`)
    }
  }

  return `${lines.join("\n")}\n`
}

const decodeProductionCheckInput = (
  input: ProductionCheckInput
): Effect.Effect<RuleContext, ProductionCheckInvalidInput, never> =>
  Effect.try({
    try: () => {
      const configPath = input.configPath ?? "desktop.config.ts"
      if (configPath.trim() === "") {
        throw new Error("configPath must be a non-empty string")
      }
      const rendererFiles = input.rendererFiles ?? []
      for (const [index, file] of rendererFiles.entries()) {
        if (!isProductionCheckFile(file)) {
          throw new Error(`rendererFiles[${index}] must include string path and content`)
        }
      }
      return {
        config: input.config,
        configPath,
        rendererFiles
      }
    },
    catch: (cause) =>
      new ProductionCheckInvalidInput({
        operation: "ProductionChecker.input",
        message: "invalid production check input",
        cause
      })
  })

const isProductionCheckFile = (value: unknown): value is ProductionCheckFile =>
  typeof value === "object" &&
  value !== null &&
  "path" in value &&
  "content" in value &&
  typeof value.path === "string" &&
  typeof value.content === "string"

const rendererBackendImportRule: Rule = ({ rendererFiles }) =>
  rendererFiles.flatMap((file) =>
    scanLines(
      file,
      /from\s+["']@effect-desktop\/(core|native)["']|from\s+["']\.\.?\/.*runtime/u
    ).map((location) =>
      violation({
        rule: "renderer-backend-import",
        location,
        message: "renderer code imports backend-only modules",
        fix: "Use generated renderer clients instead of importing runtime or native modules."
      })
    )
  )

const rawBridgeCallRule: Rule = ({ config, configPath, rendererFiles }) => [
  ...(config.security?.requireTypedBridge === false
    ? [
        violation({
          rule: "raw-bridge-call",
          location: configLocation(configPath, "security.requireTypedBridge"),
          message: "typed bridge enforcement is disabled",
          fix: "Set security.requireTypedBridge to true and use generated bridge clients."
        })
      ]
    : []),
  ...rendererFiles.flatMap((file) =>
    scanLines(file, /\b(rawBridge|sendRaw|invokeRaw|HostProtocol\.send)\b/u).map((location) =>
      violation({
        rule: "raw-bridge-call",
        location,
        message: "renderer code uses a raw bridge call",
        fix: "Route privileged work through generated bridge clients and schemas."
      })
    )
  )
]

const rendererNativeHostProtocolRule: Rule = ({ config, configPath, rendererFiles }) => [
  ...(config.security?.rendererNativeAccess === true
    ? [
        violation({
          rule: "renderer-native-host-protocol",
          location: configLocation(configPath, "security.rendererNativeAccess"),
          message: "renderer native host protocol access is enabled",
          fix: "Set security.rendererNativeAccess to false and use typed runtime APIs."
        })
      ]
    : []),
  ...rendererFiles.flatMap((file) =>
    scanForbiddenBridgeProtocolImports(file).map((location) =>
      violation({
        rule: "renderer-native-host-protocol",
        location,
        message: "renderer code references the native host protocol surface",
        fix: "Keep host protocol access inside runtime or host adapters."
      })
    )
  )
]

const filesystemWriteScopeRule: Rule = ({ config, configPath }) => {
  if (config.security?.requirePermissions === false) {
    return [
      violation({
        rule: "filesystem-write-without-scope",
        location: configLocation(configPath, "security.requirePermissions"),
        message: "permission checks are disabled in production config",
        fix: "Set security.requirePermissions to true and declare scoped capability policies."
      })
    ]
  }

  const write = config.permissions?.filesystem?.write
  if (write?.enabled !== true) {
    return []
  }
  if (hasScopedList(write.roots)) {
    return []
  }
  return [
    violation({
      rule: "filesystem-write-without-scope",
      location: configLocation(configPath, "permissions.filesystem.write.roots"),
      message: "filesystem write permission is enabled without scoped roots",
      fix: "Declare explicit filesystem.write roots or remove write permission."
    })
  ]
}

const processPermissionPolicyRule: Rule = ({ config, configPath }) => {
  const spawn = config.permissions?.process?.spawn
  if (spawn?.enabled !== true) {
    return []
  }
  if (hasScopedList(spawn.allow) || hasScopedList(spawn.ask) || hasScopedList(spawn.deny)) {
    return []
  }
  return [
    violation({
      rule: "process-permission-without-policy",
      location: configLocation(configPath, "permissions.process.spawn"),
      message: "process spawn permission is enabled without allow, ask, or deny policy",
      fix: "Declare process spawn allow/ask/deny entries or disable process spawning."
    })
  ]
}

const secretAuditRule: Rule = ({ config, configPath }) => {
  const secrets = config.permissions?.secrets
  const hasSecretAccess = hasAnyList(secrets?.read) || hasAnyList(secrets?.write)
  if (!hasSecretAccess || secrets?.audit === "always") {
    return []
  }
  return [
    violation({
      rule: "secret-access-without-audit",
      location: configLocation(configPath, "permissions.secrets.audit"),
      message: "secret access is declared without an always-on audit policy",
      fix: 'Set permissions.secrets.audit to "always" for production secret access.'
    })
  ]
}

const updateSignatureRule: Rule = ({ config, configPath }) =>
  config.update?.install?.enabled === true && config.update.install.signatureVerification !== true
    ? [
        violation({
          rule: "update-install-without-signature",
          location: configLocation(configPath, "update.install.signatureVerification"),
          message: "update installation is enabled without signature verification",
          fix: "Enable update.install.signatureVerification and configure signing metadata."
        })
      ]
    : []

const appProtocolTraversalRule: Rule = ({ config, configPath }) =>
  config.appProtocol?.allowPathTraversal === true
    ? [
        violation({
          rule: "app-protocol-path-traversal",
          location: configLocation(configPath, "appProtocol.allowPathTraversal"),
          message: "app protocol traversal bypass is enabled",
          fix: "Disable traversal and serve only canonical embedded app assets."
        })
      ]
    : []

const weakenedCspRule: Rule = ({ config, configPath }) => {
  const csp = config.security?.csp
  if (csp === undefined) {
    return []
  }
  const weakenings = cspWeakenings(csp)
  if (weakenings.length === 0) {
    return []
  }
  const reasons = weakenings.map((weakening) => weakening.reason).join("; ")
  const location = configLocation(configPath, "security.csp")
  if (csp.acknowledgeWeakening === true && isNonEmpty(csp.justification)) {
    return [
      violation({
        rule: "weakened-csp",
        severity: "acknowledged",
        location,
        message: `content security policy is weakened but explicitly acknowledged: ${reasons}`,
        fix: "Track this exception in the build report and remove the weakening before release.",
        justification: csp.justification
      })
    ]
  }
  return [
    violation({
      rule: "weakened-csp",
      location,
      message: `content security policy weakens the production default: ${reasons}`,
      fix: "Tighten the policy, or set acknowledgeWeakening with a non-empty justification."
    })
  ]
}

const externalNavigationRule: Rule = ({ config, configPath }) =>
  config.security?.externalNavigation === undefined ||
  config.security?.externalNavigation === "ask" ||
  config.security?.externalNavigation === "deny"
    ? []
    : [
        violation({
          rule: "unsafe-external-navigation",
          location: configLocation(configPath, "security.externalNavigation"),
          message: 'external navigation must be either "deny" or "ask"',
          fix: 'Set security.externalNavigation to "deny" or "ask".'
        })
      ]

const devtoolsInProdRule: Rule = ({ config, configPath }) =>
  config.security?.devtoolsInProd === true
    ? [
        violation({
          rule: "devtools-in-prod",
          severity: "acknowledged",
          location: configLocation(configPath, "security.devtoolsInProd"),
          message:
            "production devtools is enabled in config and still requires an explicit --devtools launch flag",
          fix: "Keep security.devtoolsInProd false unless a production diagnostic session is explicitly approved.",
          justification:
            "Devtools listener remains disabled unless the process is also launched with --devtools."
        })
      ]
    : []

const unscopedResourceRule: Rule = ({ config, configPath }) =>
  config.resources?.allowUnscoped === true
    ? [
        violation({
          rule: "unscoped-resource",
          location: configLocation(configPath, "resources.allowUnscoped"),
          message: "unscoped resource creation is enabled",
          fix: "Require every resource to declare an owner scope."
        })
      ]
    : []

const unsupportedCapabilityRule: Rule = ({ config, configPath }) =>
  (config.contracts ?? []).flatMap((contract, index) =>
    contract.support !== "supported" && contract.isSupportedGuard !== true
      ? [
          violation({
            rule: "unsupported-capability-without-guard",
            location: configLocation(configPath, `contracts.${index}`),
            message: `contract ${contract.contract} requires ${contract.capability} without an isSupported guard`,
            fix: "Add an isSupported guard or remove the unsupported capability requirement."
          })
        ]
      : []
  )

const sourceUnsupportedCapabilityRule: Rule = ({ rendererFiles }) =>
  sourceCapabilityUses(rendererFiles).flatMap((use) =>
    use.support !== "supported" && !use.guarded
      ? [
          violation({
            rule: "unsupported-capability-without-guard",
            location: use.location,
            message: `${use.primitive}.${use.method} requires an isSupported guard`,
            fix: `Call ${use.primitive}.isSupported("${use.method}") before invoking ${use.primitive}.${use.method}.`
          })
        ]
      : []
  )

const redactionDefaultRule: Rule = ({ config, configPath }) =>
  config.security?.redaction?.defaultPatternEnabled === false
    ? [
        violation({
          rule: "secret-pattern-not-redacted",
          location: configLocation(configPath, "security.redaction.defaultPatternEnabled"),
          message: "default secret redaction pattern is disabled",
          fix: "Keep the default secret redaction pattern enabled and append custom patterns if needed."
        })
      ]
    : []

const sourceCapabilityUses = (
  files: readonly ProductionCheckFile[]
): readonly SourceCapabilityUse[] =>
  files.flatMap((file) => {
    const masked = maskComments(file.content)
    return APPENDIX_K_SOURCE_CAPABILITIES.flatMap((capability) =>
      scanSourceCapabilityUse(file, masked, capability)
    )
  })

const scanSourceCapabilityUse = (
  file: ProductionCheckFile,
  masked: string,
  capability: SourceCapability
): readonly SourceCapabilityUse[] => {
  const uses: SourceCapabilityUse[] = []
  const guardOffsets = matchOffsets(masked, supportGuardPattern(capability))
  const callPattern = methodCallPattern(capability)

  for (const match of masked.matchAll(callPattern)) {
    if (match.index === undefined) {
      continue
    }
    const offset = match.index
    uses.push({
      primitive: capability.primitive,
      method: capability.method,
      support: capability.support,
      location: offsetLocation(file, masked, offset),
      guarded: guardOffsets.some((guardOffset) => guardOffset < offset)
    })
  }

  return uses
}

const matchOffsets = (source: string, pattern: RegExp): readonly number[] =>
  Array.from(source.matchAll(pattern))
    .map((match) => match.index)
    .filter((index): index is number => index !== undefined)

const methodCallPattern = (capability: SourceCapability): RegExp =>
  new RegExp(
    `\\b${escapeRegExp(capability.primitive)}\\s*\\.\\s*${escapeRegExp(capability.method)}\\s*\\(`,
    "gu"
  )

const supportGuardPattern = (capability: SourceCapability): RegExp =>
  new RegExp(
    `\\b${escapeRegExp(capability.primitive)}\\s*\\.\\s*isSupported\\s*\\(\\s*["']${escapeRegExp(capability.method)}["']\\s*\\)`,
    "gu"
  )

const offsetLocation = (
  file: ProductionCheckFile,
  source: string,
  offset: number
): ProductionCheckLocation => {
  const before = source.slice(0, offset)
  const lines = before.split("\n")
  const line = lines.length
  const lastLine = lines[lines.length - 1] ?? ""
  return new ProductionCheckLocation({
    path: file.path,
    line,
    column: lastLine.length + 1
  })
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const scanLines = (
  file: ProductionCheckFile,
  pattern: RegExp
): readonly ProductionCheckLocation[] =>
  maskComments(file.content)
    .split("\n")
    .flatMap((line, index) =>
      pattern.test(line)
        ? [
            new ProductionCheckLocation({
              path: file.path,
              line: index + 1,
              column: Math.max(1, line.search(pattern) + 1)
            })
          ]
        : []
    )

const BRIDGE_BARREL_IMPORT_PATTERN =
  /import\s+(?:type\s+)?(?:(?:[^{}\n]+,\s*)?\{(?<names>[^}]*)\}|(?<namespace>\*\s+as\s+[A-Za-z_$][\w$]*))\s+from\s+["']@effect-desktop\/bridge["']/u

const scanForbiddenBridgeProtocolImports = (
  file: ProductionCheckFile
): readonly ProductionCheckLocation[] =>
  maskComments(file.content)
    .split("\n")
    .flatMap((line, index) => {
      if (/@effect-desktop\/bridge\/protocol/u.test(line)) {
        return [
          new ProductionCheckLocation({
            path: file.path,
            line: index + 1,
            column: Math.max(1, line.search(/@effect-desktop\/bridge\/protocol/u) + 1)
          })
        ]
      }

      const match = BRIDGE_BARREL_IMPORT_PATTERN.exec(line)
      const names = match?.groups?.["names"]
      if (
        match?.groups?.["namespace"] === undefined &&
        (names === undefined || !hasForbiddenBridgeProtocolImport(names))
      ) {
        return []
      }

      return [
        new ProductionCheckLocation({
          path: file.path,
          line: index + 1,
          column: Math.max(1, line.search(/@effect-desktop\/bridge/u) + 1)
        })
      ]
    })

const hasForbiddenBridgeProtocolImport = (names: string): boolean =>
  names
    .split(",")
    .map((name) =>
      name
        .trim()
        .replace(/^type\s+/u, "")
        .split(/\s+as\s+/iu)[0]
        ?.trim()
    )
    .some((name) => name !== undefined && /(^HOST_PROTOCOL_|HostProtocol)/u.test(name))

const maskComments = (source: string): string => {
  let result = ""
  let state: "code" | "line-comment" | "block-comment" | "single" | "double" | "template" = "code"
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? ""
    const next = source[index + 1]

    if (state === "line-comment") {
      if (char === "\n") {
        state = "code"
        result += char
      } else {
        result += " "
      }
      continue
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        result += "  "
        index += 1
        state = "code"
      } else {
        result += char === "\n" ? char : " "
      }
      continue
    }

    if (state === "single" || state === "double" || state === "template") {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code"
      }
      continue
    }

    if (char === "/" && next === "/") {
      result += "  "
      index += 1
      state = "line-comment"
      continue
    }

    if (char === "/" && next === "*") {
      result += "  "
      index += 1
      state = "block-comment"
      continue
    }

    if (char === "'") {
      state = "single"
    } else if (char === '"') {
      state = "double"
    } else if (char === "`") {
      state = "template"
    }

    result += char
  }

  return result
}

const violation = (input: {
  readonly rule: ProductionRuleId
  readonly severity?: ProductionCheckSeverity
  readonly location: ProductionCheckLocation
  readonly message: string
  readonly fix: string
  readonly justification?: string
}): ProductionCheckViolation =>
  new ProductionCheckViolation({
    rule: input.rule,
    severity: input.severity ?? "fail",
    message: input.message,
    fix: input.fix,
    location: input.location,
    ...(input.justification === undefined ? {} : { justification: input.justification })
  })

const configLocation = (path: string, configPath: string): ProductionCheckLocation =>
  new ProductionCheckLocation({ path: `${path}#${configPath}`, line: 1, column: 1 })

const hasScopedList = (values: readonly string[] | undefined): boolean =>
  values !== undefined &&
  values.length > 0 &&
  values.every((value) => {
    const normalized = value.trim()
    return normalized.length > 0 && normalized !== "*"
  })

const hasAnyList = (values: readonly string[] | undefined): boolean =>
  values !== undefined && values.length > 0

const isNonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0

const renderCspDirectives = (
  directives: readonly [directive: string, values: readonly string[]][],
  nonce: string
): string =>
  directives
    .map(([directive, values]) =>
      [
        directive,
        ...values.map((value) => value.replace(DEFAULT_CSP_NONCE_PLACEHOLDER, nonce))
      ].join(" ")
    )
    .join("; ")

const validateCspNonce = (nonce: string): string => {
  if (nonce === DEFAULT_CSP_NONCE_PLACEHOLDER || /^[A-Za-z0-9+/_=-]+$/u.test(nonce)) {
    return nonce
  }

  throw new TypeError("CSP nonce must be a non-empty header-safe token")
}

const parseCspPolicy = (policy: string | undefined): ParsedCspPolicy => {
  if (policy === undefined) {
    return { directives: new Map(), duplicates: [] }
  }

  const directives = new Map<string, readonly string[]>()
  const duplicates: string[] = []
  for (const rawDirective of policy.split(";")) {
    const parts = rawDirective.trim().split(/\s+/u).filter(isNonEmpty)
    const [rawName, ...values] = parts
    const directive = rawName?.toLowerCase()
    if (directive !== undefined) {
      if (directives.has(directive) && !duplicates.includes(directive)) {
        duplicates.push(directive)
      }
      directives.set(directive, values)
    }
  }

  return { directives, duplicates }
}

const defaultCspDirectiveValues = (directive: string): ReadonlySet<string> | undefined => {
  const entry = DEFAULT_CSP_DIRECTIVES.find(([defaultDirective]) => defaultDirective === directive)
  if (entry === undefined) {
    return undefined
  }

  return new Set(entry[1].map(normalizeCspValue))
}

const normalizeCspValue = (value: string): string =>
  value === "'nonce-{N}'" ? "'nonce-{N}'" : value

const isPermittedDefaultSource = (
  source: string,
  defaults: ReadonlySet<string> | undefined
): boolean => defaults?.has(normalizeCspValue(source)) === true

const isAdditionalCspTightening = (directive: string, values: readonly string[]): boolean =>
  (values.length === 0 && NO_VALUE_HARDENING_CSP_DIRECTIVES.has(directive)) ||
  (values.length > 0 && values.every((value) => value === "'none'"))

const NO_VALUE_HARDENING_CSP_DIRECTIVES = new Set([
  "block-all-mixed-content",
  "upgrade-insecure-requests"
])

interface SourceCapability {
  readonly primitive: string
  readonly method: string
  readonly support: ContractCapabilityRequirement["support"]
}

const APPENDIX_K_SOURCE_CAPABILITIES: readonly SourceCapability[] = [
  { primitive: "Dock", method: "setBadgeText", support: "unsupported" },
  { primitive: "Dock", method: "setProgress", support: "partial" },
  { primitive: "Dock", method: "setMenu", support: "unsupported" },
  { primitive: "Dock", method: "setJumpList", support: "unsupported" },
  { primitive: "Dock", method: "requestAttention", support: "partial" }
]

const formatLocation = (location: ProductionCheckLocation): string => {
  const line = location.line === undefined ? "" : `:${location.line}`
  const column = location.column === undefined ? "" : `:${location.column}`
  return `${location.path}${line}${column}`
}

const PRODUCTION_RULES: readonly Rule[] = [
  rendererBackendImportRule,
  rawBridgeCallRule,
  rendererNativeHostProtocolRule,
  filesystemWriteScopeRule,
  processPermissionPolicyRule,
  secretAuditRule,
  updateSignatureRule,
  appProtocolTraversalRule,
  weakenedCspRule,
  externalNavigationRule,
  devtoolsInProdRule,
  unscopedResourceRule,
  sourceUnsupportedCapabilityRule,
  unsupportedCapabilityRule,
  redactionDefaultRule
]
