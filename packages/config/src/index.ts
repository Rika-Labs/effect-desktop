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

export class DesktopConfigDecodeError extends Data.TaggedError("DesktopConfigDecodeError")<{
  readonly operation: string
  readonly message: string
  readonly cause: unknown
}> {}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

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

type JsonValue = typeof Schema.Json.Type

export interface ProductionSecurityConfig {
  readonly security?: {
    readonly requireTypedBridge?: boolean
    readonly rendererNativeAccess?: boolean
    readonly requirePermissions?: boolean
    readonly externalNavigation?: string
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

interface DesktopSecurityConfig {
  readonly requireTypedBridge?: boolean
  readonly rendererNativeAccess?: boolean
  readonly requirePermissions?: boolean
  readonly externalNavigation?: "deny" | "ask"
  readonly devtoolsInProd?: boolean
  readonly csp?: CspConfig | undefined
  readonly redaction?: RedactionPolicy
  readonly permissions?: readonly JsonValue[]
}

export interface DesktopConfig extends Omit<ProductionSecurityConfig, "permissions" | "security"> {
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
  readonly web?: {
    readonly engine?: WebEngine
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
  readonly security?: DesktopSecurityConfig
  readonly permissions?: ProductionSecurityConfig["permissions"] | readonly JsonValue[]
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

export const WebEngine = Schema.Literals(["system", "chrome", "chromium"])
export type WebEngine = typeof WebEngine.Type

const JsonRecord = Schema.Record(Schema.String, Schema.Json)
const StringRecord = Schema.Record(Schema.String, Schema.String)
const NestedStringRecord = Schema.Record(Schema.String, StringRecord)

export class DesktopAppConfig extends Schema.Class<DesktopAppConfig>("DesktopAppConfig")({
  id: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String)
}) {}

export class DesktopRuntimeConfig extends Schema.Class<DesktopRuntimeConfig>(
  "DesktopRuntimeConfig"
)({
  engine: Schema.optionalKey(RuntimeEngine),
  entry: Schema.optionalKey(Schema.String)
}) {}

export class DesktopRendererConfig extends Schema.Class<DesktopRendererConfig>(
  "DesktopRendererConfig"
)({
  framework: Schema.optionalKey(Schema.Literal("react")),
  styling: Schema.optionalKey(Schema.Literal("tailwind")),
  entry: Schema.optionalKey(Schema.String),
  dist: Schema.optionalKey(Schema.String)
}) {}

export class DesktopWebConfig extends Schema.Class<DesktopWebConfig>("DesktopWebConfig")({
  engine: WebEngine.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed("system" as const)))
}) {}

export class DesktopNativeConfig extends Schema.Class<DesktopNativeConfig>("DesktopNativeConfig")({
  host: Schema.optionalKey(Schema.String),
  renderer: Schema.optionalKey(Schema.String)
}) {}

export class DesktopProtocolConfig extends Schema.Class<DesktopProtocolConfig>(
  "DesktopProtocolConfig"
)({
  scheme: Schema.String,
  handler: Schema.optionalKey(Schema.String)
}) {}

export class DesktopBuildConfig extends Schema.Class<DesktopBuildConfig>("DesktopBuildConfig")({
  targets: Schema.optionalKey(Schema.Array(Schema.String))
}) {}

export class DesktopProtocolLimitsConfig extends Schema.Class<DesktopProtocolLimitsConfig>(
  "DesktopProtocolLimitsConfig"
)({
  maxFrameBytes: Schema.optionalKey(Schema.Number),
  maxConcurrentRequestsPerWindow: Schema.optionalKey(Schema.Number),
  maxConcurrentStreamsPerWindow: Schema.optionalKey(Schema.Number),
  maxQueuedEventsPerSubscription: Schema.optionalKey(Schema.Number)
}) {}

export class DesktopProtocolRuntimeConfig extends Schema.Class<DesktopProtocolRuntimeConfig>(
  "DesktopProtocolRuntimeConfig"
)({
  limits: Schema.optionalKey(DesktopProtocolLimitsConfig)
}) {}

export class DesktopCspConfig extends Schema.Class<DesktopCspConfig>("DesktopCspConfig")({
  policy: Schema.optionalKey(Schema.String),
  disabled: Schema.optionalKey(Schema.Boolean),
  acknowledgeWeakening: Schema.optionalKey(Schema.Boolean),
  justification: Schema.optionalKey(Schema.String)
}) {}

export class DesktopRedactionPolicy extends Schema.Class<DesktopRedactionPolicy>(
  "DesktopRedactionPolicy"
)({
  defaultPatternEnabled: Schema.optionalKey(Schema.Boolean),
  additionalPatterns: Schema.optionalKey(Schema.Array(Schema.String)),
  allowlist: Schema.optionalKey(Schema.Array(Schema.String))
}) {}

export class DesktopSecurityConfigSchema extends Schema.Class<DesktopSecurityConfigSchema>(
  "DesktopSecurityConfig"
)({
  requireTypedBridge: Schema.optionalKey(Schema.Boolean),
  rendererNativeAccess: Schema.optionalKey(Schema.Boolean),
  requirePermissions: Schema.optionalKey(Schema.Boolean),
  externalNavigation: Schema.optionalKey(Schema.Literals(["deny", "ask"])),
  devtoolsInProd: Schema.optionalKey(Schema.Boolean),
  csp: Schema.optionalKey(Schema.Union([DesktopCspConfig, Schema.Undefined])),
  redaction: Schema.optionalKey(DesktopRedactionPolicy),
  permissions: Schema.optionalKey(Schema.Array(Schema.Json))
}) {}

export class DesktopFilesystemWritePolicy extends Schema.Class<DesktopFilesystemWritePolicy>(
  "DesktopFilesystemWritePolicy"
)({
  enabled: Schema.optionalKey(Schema.Boolean),
  roots: Schema.optionalKey(Schema.Array(Schema.String))
}) {}

export class DesktopProcessPermissionPolicy extends Schema.Class<DesktopProcessPermissionPolicy>(
  "DesktopProcessPermissionPolicy"
)({
  enabled: Schema.optionalKey(Schema.Boolean),
  allow: Schema.optionalKey(Schema.Array(Schema.String)),
  ask: Schema.optionalKey(Schema.Array(Schema.String)),
  deny: Schema.optionalKey(Schema.Array(Schema.String))
}) {}

export class DesktopSecretPermissionPolicy extends Schema.Class<DesktopSecretPermissionPolicy>(
  "DesktopSecretPermissionPolicy"
)({
  read: Schema.optionalKey(Schema.Array(Schema.String)),
  write: Schema.optionalKey(Schema.Array(Schema.String)),
  audit: Schema.optionalKey(Schema.Literals(["always", "never"]))
}) {}

export class DesktopPermissionsConfig extends Schema.Class<DesktopPermissionsConfig>(
  "DesktopPermissionsConfig"
)({
  filesystem: Schema.optionalKey(
    Schema.Struct({
      write: Schema.optionalKey(DesktopFilesystemWritePolicy)
    })
  ),
  process: Schema.optionalKey(
    Schema.Struct({
      spawn: Schema.optionalKey(DesktopProcessPermissionPolicy)
    })
  ),
  secrets: Schema.optionalKey(DesktopSecretPermissionPolicy)
}) {}

export class DesktopWorkspaceConfig extends Schema.Class<DesktopWorkspaceConfig>(
  "DesktopWorkspaceConfig"
)({
  sharedConfigPath: Schema.optionalKey(Schema.String)
}) {}

export class DesktopUpdateInstallPolicy extends Schema.Class<DesktopUpdateInstallPolicy>(
  "DesktopUpdateInstallPolicy"
)({
  enabled: Schema.optionalKey(Schema.Boolean),
  signatureVerification: Schema.optionalKey(Schema.Boolean)
}) {}

export class DesktopUpdateConfig extends Schema.Class<DesktopUpdateConfig>("DesktopUpdateConfig")({
  install: Schema.optionalKey(DesktopUpdateInstallPolicy),
  channel: Schema.optionalKey(Schema.Literals(["stable", "beta", "canary"])),
  publicKey: Schema.optionalKey(Schema.String),
  feedUrl: Schema.optionalKey(Schema.String),
  minVersion: Schema.optionalKey(Schema.String),
  maxVersion: Schema.optionalKey(Schema.Union([Schema.String, Schema.Undefined])),
  keyVersion: Schema.optionalKey(Schema.Number),
  rollback: Schema.optionalKey(Schema.Boolean)
}) {}

export class DesktopTelemetryConfig extends Schema.Class<DesktopTelemetryConfig>(
  "DesktopTelemetryConfig"
)({
  enabled: Schema.optionalKey(Schema.Boolean),
  redactSensitive: Schema.optionalKey(Schema.Boolean),
  endpoint: Schema.optionalKey(Schema.String)
}) {}

export const DesktopWindowsConfig = Schema.Union([Schema.Array(JsonRecord), JsonRecord])
export type DesktopWindowsConfig = typeof DesktopWindowsConfig.Type

export const DesktopSigningConfig = JsonRecord
export type DesktopSigningConfig = typeof DesktopSigningConfig.Type

export class DesktopAppProtocolConfig extends Schema.Class<DesktopAppProtocolConfig>(
  "DesktopAppProtocolConfig"
)({
  allowPathTraversal: Schema.optionalKey(Schema.Boolean)
}) {}

export class DesktopResourceConfig extends Schema.Class<DesktopResourceConfig>(
  "DesktopResourceConfig"
)({
  allowUnscoped: Schema.optionalKey(Schema.Boolean)
}) {}

export class DesktopContractCapabilityRequirement extends Schema.Class<DesktopContractCapabilityRequirement>(
  "DesktopContractCapabilityRequirement"
)({
  contract: Schema.String,
  capability: Schema.String,
  support: Schema.Literals(["supported", "partial", "unsupported"]),
  isSupportedGuard: Schema.optionalKey(Schema.Boolean)
}) {}

export class DesktopConfigSchema extends Schema.Class<DesktopConfigSchema>("DesktopConfig")({
  app: Schema.optionalKey(DesktopAppConfig),
  runtime: Schema.optionalKey(DesktopRuntimeConfig),
  renderer: Schema.optionalKey(DesktopRendererConfig),
  web: Schema.optionalKey(DesktopWebConfig),
  native: Schema.optionalKey(DesktopNativeConfig),
  windows: Schema.optionalKey(DesktopWindowsConfig),
  protocols: Schema.optionalKey(Schema.Array(DesktopProtocolConfig)),
  build: Schema.optionalKey(DesktopBuildConfig),
  signing: Schema.optionalKey(DesktopSigningConfig),
  update: Schema.optionalKey(DesktopUpdateConfig),
  telemetry: Schema.optionalKey(DesktopTelemetryConfig),
  protocol: Schema.optionalKey(DesktopProtocolRuntimeConfig),
  env: Schema.optionalKey(NestedStringRecord),
  workspace: Schema.optionalKey(DesktopWorkspaceConfig),
  security: Schema.optionalKey(DesktopSecurityConfigSchema),
  permissions: Schema.optionalKey(
    Schema.Union([DesktopPermissionsConfig, Schema.Array(Schema.Json)])
  ),
  appProtocol: Schema.optionalKey(DesktopAppProtocolConfig),
  resources: Schema.optionalKey(DesktopResourceConfig),
  contracts: Schema.optionalKey(Schema.Array(DesktopContractCapabilityRequirement))
}) {}

export const decodeDesktopConfig = (
  input: unknown,
  operation = "DesktopConfig.decode"
): Effect.Effect<DesktopConfig, DesktopConfigDecodeError, never> =>
  Schema.decodeUnknownEffect(DesktopConfigSchema)(input).pipe(
    Effect.map(normalizeDesktopConfig),
    Effect.mapError(
      (error) =>
        new DesktopConfigDecodeError({
          operation,
          message: formatUnknownError(error),
          cause: error
        })
    )
  )

export const mergeDesktopConfig = (shared: DesktopConfig, app: DesktopConfig): DesktopConfig => {
  const appMetadata = mergeObjects(shared.app, app.app)
  const runtime = mergeObjects(shared.runtime, app.runtime)
  const renderer = mergeObjects(shared.renderer, app.renderer)
  const web = mergeObjects(shared.web, app.web)
  const build = mergeObjects(shared.build, app.build)
  const security = mergeObjects(shared.security, app.security)
  const env = mergeRecordMap(shared.env, app.env)
  const limits = mergeObjects(shared.protocol?.limits, app.protocol?.limits)
  const protocols =
    app.protocols !== undefined && app.protocols.length > 0 ? app.protocols : shared.protocols
  const workspace = app.workspace ?? shared.workspace
  const windows = app.windows ?? shared.windows
  const signing = app.signing ?? shared.signing
  const permissions = app.permissions ?? shared.permissions
  const contracts = app.contracts ?? shared.contracts
  const native = mergeObjects(shared.native, app.native)
  const update = mergeObjects(shared.update, app.update)
  const telemetry = mergeObjects(shared.telemetry, app.telemetry)
  const appProtocol = mergeObjects(shared.appProtocol, app.appProtocol)
  const resources = mergeObjects(shared.resources, app.resources)

  return {
    ...(appMetadata === undefined ? {} : { app: appMetadata }),
    ...(runtime === undefined ? {} : { runtime }),
    ...(renderer === undefined ? {} : { renderer }),
    ...(web === undefined ? {} : { web: normalizeWebConfig(web) }),
    ...(build === undefined ? {} : { build }),
    ...(security === undefined ? {} : { security }),
    ...(env === undefined ? {} : { env }),
    ...(limits === undefined ? {} : { protocol: { limits } }),
    ...(protocols === undefined ? {} : { protocols }),
    ...(native === undefined ? {} : { native }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(update === undefined ? {} : { update }),
    ...(windows === undefined ? {} : { windows }),
    ...(signing === undefined ? {} : { signing }),
    ...(telemetry === undefined ? {} : { telemetry }),
    ...(permissions === undefined ? {} : { permissions }),
    ...(appProtocol === undefined ? {} : { appProtocol }),
    ...(resources === undefined ? {} : { resources }),
    ...(contracts === undefined ? {} : { contracts })
  }
}

const mergeObjects = <A extends object>(
  shared: A | undefined,
  app: A | undefined
): A | undefined => {
  if (shared === undefined && app === undefined) {
    return undefined
  }
  return { ...shared, ...app } as A
}

const mergeRecordMap = (
  shared: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined,
  local: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined
): Record<string, Record<string, string>> | undefined => {
  if (shared === undefined && local === undefined) {
    return undefined
  }
  const merged: Record<string, Record<string, string>> = {}
  for (const [profile, values] of Object.entries(shared ?? {})) {
    merged[profile] = { ...values }
  }
  for (const [profile, values] of Object.entries(local ?? {})) {
    merged[profile] = { ...merged[profile], ...values }
  }
  return merged
}

export interface ProductionCheckInput {
  readonly config: ProductionSecurityConfig
  readonly configPath?: string
  readonly rendererFiles?: readonly unknown[]
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

interface SourceGuardRange {
  readonly start: number
  readonly end: number
}

interface SourceCapabilityScanSource {
  readonly executableSource: string
}

interface ParsedCspPolicy {
  readonly directives: ReadonlyMap<string, readonly string[]>
  readonly duplicates: readonly string[]
}

type CspDirectiveKind = "source-list" | "no-value-hardening" | "value-hardening"

interface CspDirectiveSemantics {
  readonly kind: CspDirectiveKind
  readonly hardeningValues?: ReadonlySet<string>
}

export const defineDesktopConfig = <Config extends DesktopConfig>(config: Config): Config => config

const normalizeDesktopConfig = (config: DesktopConfig): DesktopConfig => ({
  ...config,
  ...(config.web === undefined ? {} : { web: normalizeWebConfig(config.web) })
})

const normalizeWebConfig = (
  web: NonNullable<DesktopConfig["web"]>
): NonNullable<DesktopConfig["web"]> =>
  web.engine === undefined
    ? { ...web }
    : {
        ...web,
        engine: web.engine === "chromium" ? "chrome" : web.engine
      }

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
      const rendererFileInputs = input.rendererFiles ?? []
      const rendererFiles: ProductionCheckFile[] = []
      for (const [index, file] of rendererFileInputs.entries()) {
        if (!isProductionCheckFile(file)) {
          throw new Error(`rendererFiles[${index}] must include string path and content`)
        }
        rendererFiles.push(file)
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
    scanLines(file, /from\s+["']@orika\/(core|native)["']|from\s+["']\.\.?\/.*runtime/u).map(
      (location) =>
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
    const source = sourceCapabilityScanSource(file.content)
    return APPENDIX_K_SOURCE_CAPABILITIES.flatMap((capability) =>
      scanSourceCapabilityUse(file, source, capability)
    )
  })

const scanSourceCapabilityUse = (
  file: ProductionCheckFile,
  source: SourceCapabilityScanSource,
  capability: SourceCapability
): readonly SourceCapabilityUse[] => {
  const uses: SourceCapabilityUse[] = []
  const guardRanges = supportGuardRanges(source.executableSource, supportGuardPattern(capability))
  const callPattern = methodCallPattern(capability)

  for (const match of source.executableSource.matchAll(callPattern)) {
    if (match.index === undefined) {
      continue
    }
    const offset = match.index
    uses.push({
      primitive: capability.primitive,
      method: capability.method,
      support: capability.support,
      location: offsetLocation(file, source.executableSource, offset),
      guarded: guardRanges.some((range) => range.start <= offset && offset < range.end)
    })
  }

  return uses
}

const supportGuardRanges = (source: string, pattern: RegExp): readonly SourceGuardRange[] =>
  Array.from(source.matchAll(pattern)).flatMap((match) =>
    match.index === undefined
      ? []
      : (blockRangeAfterGuard(source, match.index + match[0].length) ?? [])
  )

const blockRangeAfterGuard = (source: string, offset: number): SourceGuardRange | undefined => {
  let cursor = offset
  while (cursor < source.length && (/\s/u.test(source[cursor] ?? "") || source[cursor] === ")")) {
    cursor += 1
  }
  if (source[cursor] !== "{") {
    return undefined
  }

  let depth = 0
  for (let index = cursor; index < source.length; index += 1) {
    const char = source[index]
    if (char === "{") {
      depth += 1
      continue
    }
    if (char !== "}") {
      continue
    }
    depth -= 1
    if (depth === 0) {
      return { start: cursor + 1, end: index }
    }
  }

  return { start: cursor + 1, end: source.length }
}

const methodCallPattern = (capability: SourceCapability): RegExp =>
  new RegExp(
    `\\b${escapeRegExp(capability.primitive)}\\s*${propertyCallPattern(capability.method)}`,
    "gu"
  )

const supportGuardPattern = (capability: SourceCapability): RegExp =>
  new RegExp(
    `\\bif\\s*\\(\\s*${escapeRegExp(capability.primitive)}\\s*${propertyCallPattern("isSupported")}\\s*["']${escapeRegExp(capability.method)}["']\\s*\\)`,
    "gu"
  )

const propertyCallPattern = (method: string): string => {
  const escapedMethod = escapeRegExp(method)
  return `(?:(?:\\?\\.|\\.)\\s*${escapedMethod}|(?:\\?\\.)?\\[\\s*["']${escapedMethod}["']\\s*\\])\\s*(?:\\?\\.)?\\s*\\(`
}

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
  /import\s+(?:type\s+)?(?:(?:[^{}\n]+,\s*)?\{(?<names>[^}]*)\}|(?<namespace>\*\s+as\s+[A-Za-z_$][\w$]*))\s+from\s+["']@orika\/bridge["']/u

const scanForbiddenBridgeProtocolImports = (
  file: ProductionCheckFile
): readonly ProductionCheckLocation[] =>
  maskComments(file.content)
    .split("\n")
    .flatMap((line, index) => {
      if (/@orika\/bridge\/protocol/u.test(line)) {
        return [
          new ProductionCheckLocation({
            path: file.path,
            line: index + 1,
            column: Math.max(1, line.search(/@orika\/bridge\/protocol/u) + 1)
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
          column: Math.max(1, line.search(/@orika\/bridge/u) + 1)
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

const sourceCapabilityScanSource = (source: string): SourceCapabilityScanSource => ({
  executableSource: maskSourceCapabilityNonCode(source)
})

const maskSourceCapabilityNonCode = (source: string): string => {
  let result = ""
  let state:
    | "code"
    | "line-comment"
    | "block-comment"
    | "single"
    | "double"
    | "template"
    | "regex" = "code"
  let escaped = false
  let regexCharacterClass = false
  let preserveStringContent = false
  let templateExpressionDepth: number | undefined

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

    if (state === "regex") {
      result += char === "\n" ? char : " "
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "[") {
        regexCharacterClass = true
      } else if (char === "]") {
        regexCharacterClass = false
      } else if (char === "/" && !regexCharacterClass) {
        state = "code"
      }
      continue
    }

    if (state === "single" || state === "double" || state === "template") {
      if (state === "template" && !escaped && char === "$" && next === "{") {
        result += "  "
        index += 1
        state = "code"
        templateExpressionDepth = 0
        continue
      }

      result += preserveStringContent || char === "\n" ? char : " "
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
        preserveStringContent = false
      }
      continue
    }

    if (templateExpressionDepth !== undefined) {
      if (char === "}" && templateExpressionDepth === 0) {
        result += " "
        state = "template"
        templateExpressionDepth = undefined
        continue
      }
      if (char === "{") {
        templateExpressionDepth += 1
      } else if (char === "}") {
        templateExpressionDepth -= 1
      }
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

    if (char === "/" && canStartRegexLiteral(source, index)) {
      result += " "
      state = "regex"
      escaped = false
      regexCharacterClass = false
      continue
    }

    if (char === "'") {
      state = "single"
      preserveStringContent = shouldPreserveSourceStringContent(source, index)
    } else if (char === '"') {
      state = "double"
      preserveStringContent = shouldPreserveSourceStringContent(source, index)
    } else if (char === "`") {
      state = "template"
      preserveStringContent = false
    }

    result += char
  }

  return result
}

const shouldPreserveSourceStringContent = (source: string, quoteOffset: number): boolean =>
  isComputedCapabilityMemberString(source, quoteOffset) ||
  isSupportedArgumentString(source, quoteOffset)

const isComputedCapabilityMemberString = (source: string, quoteOffset: number): boolean => {
  const prefix = source.slice(0, quoteOffset)
  return APPENDIX_K_SOURCE_CAPABILITY_COMPUTED_MEMBER_PATTERNS.some((pattern) =>
    pattern.test(prefix)
  )
}

const isSupportedArgumentString = (source: string, quoteOffset: number): boolean => {
  const prefix = source.slice(0, quoteOffset)
  return (
    /(?:\?\.|\.)\s*isSupported\s*(?:\?\.)?\s*\($/u.test(prefix) ||
    /(?:\?\.)?\[\s*["']isSupported["']\s*\]\s*(?:\?\.)?\s*\($/u.test(prefix)
  )
}

const canStartRegexLiteral = (source: string, slashOffset: number): boolean => {
  const previous = previousNonWhitespace(source, slashOffset)
  if (previous === undefined) {
    return true
  }

  if (/[([{=,:;!&|?+\-*~^<>]/u.test(previous)) {
    return true
  }

  let cursor = slashOffset - 1
  while (cursor >= 0 && /\s/u.test(source[cursor] ?? "")) {
    cursor -= 1
  }
  const prefix = source.slice(0, cursor + 1)
  const keyword = prefix.match(/[A-Za-z_$][\w$]*$/u)?.[0]
  return (
    keyword === "return" ||
    keyword === "throw" ||
    keyword === "case" ||
    keyword === "delete" ||
    keyword === "void" ||
    keyword === "typeof" ||
    keyword === "instanceof" ||
    keyword === "in" ||
    keyword === "of" ||
    keyword === "yield" ||
    keyword === "await"
  )
}

const previousNonWhitespace = (source: string, offset: number): string | undefined => {
  let cursor = offset - 1
  while (cursor >= 0 && /\s/u.test(source[cursor] ?? "")) {
    cursor -= 1
  }
  return cursor < 0 ? undefined : source[cursor]
}

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

const isAdditionalCspTightening = (directive: string, values: readonly string[]): boolean => {
  const semantics = CSP_DIRECTIVE_SEMANTICS.get(directive)
  if (semantics === undefined) {
    return false
  }

  switch (semantics.kind) {
    case "no-value-hardening":
      return values.length === 0
    case "source-list":
    case "value-hardening":
      return isAllowedCspHardeningValueSet(values, semantics.hardeningValues)
  }
}

const isAllowedCspHardeningValueSet = (
  values: readonly string[],
  allowedValues: ReadonlySet<string> | undefined
): boolean =>
  allowedValues !== undefined &&
  values.length > 0 &&
  values.every((value) => allowedValues.has(normalizeCspValue(value)))

const SOURCE_LIST_HARDENING_VALUES = new Set(["'none'"])

const CSP_DIRECTIVE_SEMANTICS = new Map<string, CspDirectiveSemantics>([
  ...DEFAULT_CSP_DIRECTIVES.map(([directive]): [string, CspDirectiveSemantics] => [
    directive,
    { kind: "source-list", hardeningValues: SOURCE_LIST_HARDENING_VALUES }
  ]),
  ["frame-src", { kind: "source-list", hardeningValues: SOURCE_LIST_HARDENING_VALUES }],
  ["block-all-mixed-content", { kind: "no-value-hardening" }],
  ["upgrade-insecure-requests", { kind: "no-value-hardening" }],
  ["require-trusted-types-for", { kind: "value-hardening", hardeningValues: new Set(["'script'"]) }]
])

interface SourceCapability {
  readonly primitive: string
  readonly method: string
  readonly support: ContractCapabilityRequirement["support"]
}

const APPENDIX_K_SOURCE_CAPABILITIES: readonly SourceCapability[] = [
  { primitive: "Dock", method: "setBadgeCount", support: "partial" },
  { primitive: "Dock", method: "setBadgeText", support: "partial" },
  { primitive: "Dock", method: "setProgress", support: "unsupported" },
  { primitive: "Dock", method: "setMenu", support: "unsupported" },
  { primitive: "Dock", method: "setJumpList", support: "unsupported" },
  { primitive: "RealtimeMediaSession", method: "open", support: "partial" },
  { primitive: "RealtimeMediaSession", method: "close", support: "partial" },
  { primitive: "RealtimeMediaSession", method: "selectDevice", support: "partial" },
  { primitive: "RealtimeMediaSession", method: "interrupt", support: "partial" }
]

const APPENDIX_K_SOURCE_CAPABILITY_PRIMITIVES = [
  ...new Set(APPENDIX_K_SOURCE_CAPABILITIES.map((capability) => capability.primitive))
]

const APPENDIX_K_SOURCE_CAPABILITY_COMPUTED_MEMBER_PATTERNS =
  APPENDIX_K_SOURCE_CAPABILITY_PRIMITIVES.map(
    (primitive) => new RegExp(`\\b${escapeRegExp(primitive)}\\s*(?:\\?\\.)?\\[\\s*$`, "u")
  )

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
