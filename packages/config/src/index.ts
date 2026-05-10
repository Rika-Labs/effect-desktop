import { Data, Effect, Schema } from "effect"

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

export interface CspPolicy {
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
    readonly externalNavigation?: "deny" | "ask" | "allow"
    readonly devtoolsInProd?: boolean
    readonly csp?: CspPolicy
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

interface ParsedCspPolicy {
  readonly directives: ReadonlyMap<string, readonly string[]>
  readonly duplicates: readonly string[]
}

export const defineDesktopConfig = <Config extends ProductionSecurityConfig>(
  config: Config
): Config => config

export const DEFAULT_CSP_NONCE_PLACEHOLDER = "{N}"

export const DEFAULT_CSP_DIRECTIVES: readonly [directive: string, values: readonly string[]][] = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'", "'nonce-{N}'"]],
  ["style-src", ["'self'", "'nonce-{N}'"]],
  ["style-src-attr", ["'unsafe-inline'"]],
  ["connect-src", ["'self'", "app:"]],
  ["img-src", ["'self'", "app:", "data:", "https:"]],
  ["font-src", ["'self'", "app:", "data:"]],
  ["media-src", ["'self'", "app:"]],
  ["object-src", ["'none'"]],
  ["frame-ancestors", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["form-action", ["'self'"]],
  ["worker-src", ["'self'"]]
]

export const renderDefaultCsp = (nonce: string = DEFAULT_CSP_NONCE_PLACEHOLDER): string =>
  renderCspDirectives(DEFAULT_CSP_DIRECTIVES, nonce)

export const renderEffectiveCsp = (
  csp: CspPolicy | undefined,
  nonce: string = DEFAULT_CSP_NONCE_PLACEHOLDER
): string => {
  if (csp?.disabled === true) {
    return ""
  }

  const overrides = parseCspPolicy(csp?.policy)
  const defaultDirectives = new Set(DEFAULT_CSP_DIRECTIVES.map(([directive]) => directive))
  const directives = DEFAULT_CSP_DIRECTIVES.map(
    ([directive, defaultValues]): [string, readonly string[]] => [
      directive,
      overrides.directives.get(directive) ?? defaultValues
    ]
  )
  const extraDirectives = [...overrides.directives.entries()].filter(
    ([directive]) => !defaultDirectives.has(directive)
  )

  return renderCspDirectives([...directives, ...extraDirectives], nonce)
}

export const cspWeakenings = (csp: CspPolicy): readonly CspWeakening[] => {
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
      return {
        config: input.config,
        configPath,
        rendererFiles: input.rendererFiles ?? []
      }
    },
    catch: (cause) =>
      new ProductionCheckInvalidInput({
        operation: "ProductionChecker.input",
        message: "invalid production check input",
        cause
      })
  })

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
    scanLines(file, /\bHostProtocol\b|@effect-desktop\/bridge\/protocol/u).map((location) =>
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
  config.security?.externalNavigation === "allow"
    ? [
        violation({
          rule: "unsafe-external-navigation",
          location: configLocation(configPath, "security.externalNavigation"),
          message: "external navigation is allowed without Shell approval flow",
          fix: 'Use "deny" or "ask" so external navigation goes through policy.'
        })
      ]
    : []

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

const scanLines = (
  file: ProductionCheckFile,
  pattern: RegExp
): readonly ProductionCheckLocation[] =>
  file.content.split("\n").flatMap((line, index) =>
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
  values !== undefined && values.length > 0 && !values.includes("*")

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

const parseCspPolicy = (policy: string | undefined): ParsedCspPolicy => {
  if (policy === undefined) {
    return { directives: new Map(), duplicates: [] }
  }

  const directives = new Map<string, readonly string[]>()
  const duplicates: string[] = []
  for (const rawDirective of policy.split(";")) {
    const parts = rawDirective.trim().split(/\s+/u).filter(isNonEmpty)
    const [directive, ...values] = parts
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
  unsupportedCapabilityRule,
  redactionDefaultRule
]
