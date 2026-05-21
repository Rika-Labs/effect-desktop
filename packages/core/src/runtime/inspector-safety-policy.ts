import {
  redactForJsonWithEvidence,
  type RedactionFilterOptions,
  type RedactionResult
} from "@orika/bridge"
import { Context, Data, Effect, Layer, Option, Schema, Stream } from "effect"

export type InspectorSafetyMode = "development" | "production"
export type InspectorProductionCapture = "disabled" | "safe"
export type InspectorSafetyAction =
  | "redacted"
  | "omitted"
  | "truncated"
  | "sampled-out"
  | "production-disabled"

export class InspectorSafetyEvidence extends Schema.Class<InspectorSafetyEvidence>(
  "InspectorSafetyEvidence"
)({
  path: Schema.String,
  action: Schema.Literals([
    "redacted",
    "omitted",
    "truncated",
    "sampled-out",
    "production-disabled"
  ]),
  reason: Schema.String,
  originalBytes: Schema.optionalKey(Schema.Number),
  keptBytes: Schema.optionalKey(Schema.Number)
}) {}

export class InspectorSafetySummary extends Schema.Class<InspectorSafetySummary>(
  "InspectorSafetySummary"
)({
  evidence: Schema.Array(InspectorSafetyEvidence),
  redacted: Schema.Number,
  omitted: Schema.Number,
  truncated: Schema.Number,
  sampledOut: Schema.Number,
  productionDisabled: Schema.Number
}) {}

export interface InspectorSafetyDecision<A> {
  readonly value: Option.Option<A>
  readonly evidence: readonly InspectorSafetyEvidence[]
  readonly summary: InspectorSafetySummary
}

export interface InspectorSafetyPolicyOptions {
  readonly mode?: InspectorSafetyMode
  readonly productionCapture?: InspectorProductionCapture
  readonly redaction?: RedactionFilterOptions
  readonly maxPayloadBytes?: number
  readonly maxStringBytes?: number
  readonly maxEvidenceEntries?: number
  readonly sampleRate?: number
  readonly nextSample?: () => number
}

export interface InspectorSafetyPolicyApi {
  readonly sanitize: <A>(input: {
    readonly source: string
    readonly payload: A
  }) => Effect.Effect<InspectorSafetyDecision<A>, never, never>
  readonly sanitizeSync: <A>(input: {
    readonly source: string
    readonly payload: A
  }) => InspectorSafetyDecision<A>
  readonly summarize: (evidence: readonly InspectorSafetyEvidence[]) => InspectorSafetySummary
  readonly snapshot: () => Effect.Effect<InspectorSafetySummary, never, never>
  readonly observe: () => Stream.Stream<InspectorSafetySummary, never, never>
  readonly assertProductionCapture: () => Effect.Effect<
    void,
    InspectorSafetyPolicyInvalidArgumentError,
    never
  >
}

export class InspectorSafetyPolicyInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
}> {}

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024
const DEFAULT_MAX_STRING_BYTES = 4 * 1024
const DEFAULT_MAX_EVIDENCE_ENTRIES = 64
const DEFAULT_SAMPLE_RATE = 1
const HighRiskKeyPattern =
  /^(payload|body|stdin|stdout|stderr|env|environment|file|filecontents|filecontent|contents|terminaloutput|terminalchunk|rpcrequest|rpcresponse|requestpayload|responsepayload|usercontent|userinput|inputtext)$/i
const SecretAssignmentPattern =
  /\b([A-Za-z0-9_.-]*(?:api[_-]?key|token|password|secret|authorization|cookie|session[_-]?id)[A-Za-z0-9_.-]*\s*[:=]\s*)(["']?)[^\s'",}]+/gi
const BearerPattern = /\b(bearer\s+)[A-Za-z0-9._~+/-]+/gi

export const emptyInspectorSafetySummary = new InspectorSafetySummary({
  evidence: [],
  redacted: 0,
  omitted: 0,
  truncated: 0,
  sampledOut: 0,
  productionDisabled: 0
})

export const summarizeInspectorSafety = (
  evidence: readonly InspectorSafetyEvidence[],
  maxEvidenceEntries = DEFAULT_MAX_EVIDENCE_ENTRIES
): InspectorSafetySummary => {
  const visibleEvidence = evidence.slice(0, maxEvidenceEntries)
  return new InspectorSafetySummary({
    evidence: visibleEvidence,
    redacted: countAction(evidence, "redacted"),
    omitted: countAction(evidence, "omitted"),
    truncated: countAction(evidence, "truncated"),
    sampledOut: countAction(evidence, "sampled-out"),
    productionDisabled: countAction(evidence, "production-disabled")
  })
}

export const makeInspectorSafetyPolicy = (
  options: InspectorSafetyPolicyOptions = {}
): Effect.Effect<InspectorSafetyPolicyApi, InspectorSafetyPolicyInvalidArgumentError, never> =>
  Effect.gen(function* () {
    const mode = options.mode ?? "development"
    const productionCapture =
      options.productionCapture ?? (mode === "production" ? "disabled" : "safe")
    const maxPayloadBytes = yield* positiveIntegerOption(
      options.maxPayloadBytes,
      DEFAULT_MAX_PAYLOAD_BYTES,
      "maxPayloadBytes"
    )
    const maxStringBytes = yield* positiveIntegerOption(
      options.maxStringBytes,
      DEFAULT_MAX_STRING_BYTES,
      "maxStringBytes"
    )
    const maxEvidenceEntries = yield* positiveIntegerOption(
      options.maxEvidenceEntries,
      DEFAULT_MAX_EVIDENCE_ENTRIES,
      "maxEvidenceEntries"
    )
    const sampleRate = yield* sampleRateOption(options.sampleRate ?? DEFAULT_SAMPLE_RATE)
    const nextSample = options.nextSample ?? Math.random
    let aggregateEvidence: readonly InspectorSafetyEvidence[] = []

    const summarize = (evidence: readonly InspectorSafetyEvidence[]): InspectorSafetySummary =>
      summarizeInspectorSafety(evidence, maxEvidenceEntries)

    const record = (evidence: readonly InspectorSafetyEvidence[]): void => {
      if (evidence.length === 0) {
        return
      }
      aggregateEvidence = [...aggregateEvidence, ...evidence].slice(-maxEvidenceEntries)
    }

    const sanitizeSync = <A>(input: {
      readonly source: string
      readonly payload: A
    }): InspectorSafetyDecision<A> => {
      const evidence: InspectorSafetyEvidence[] = []

      if (mode === "production" && productionCapture !== "safe") {
        evidence.push(
          evidenceEntry({
            path: input.source,
            action: "production-disabled",
            reason: "production-capture-disabled"
          })
        )
        record(evidence)
        return {
          value: Option.none(),
          evidence,
          summary: summarize(evidence)
        }
      }

      if (sampleRate < 1 && nextSample() >= sampleRate) {
        evidence.push(
          evidenceEntry({
            path: input.source,
            action: "sampled-out",
            reason: "sample-rate"
          })
        )
        record(evidence)
        return {
          value: Option.none(),
          evidence,
          summary: summarize(evidence)
        }
      }

      const omitted = omitHighRisk(input.payload, [input.source], evidence)
      const redacted = redactForJsonWithEvidence(omitted, options.redaction) as RedactionResult<A>
      const redactionEvidence = redacted.evidence.map((item) =>
        evidenceEntry({
          path: qualifyPath(input.source, item.path),
          action: item.action,
          reason: item.reason
        })
      )
      evidence.push(...redactionEvidence)
      const jsonCompatible = normalizeJsonContainers(redacted.value, [input.source], evidence)
      const textCapped = capStrings(jsonCompatible, [input.source], maxStringBytes, evidence)
      const payloadBytes = encodedJsonBytes(textCapped)
      if (payloadBytes === undefined || payloadBytes > maxPayloadBytes) {
        evidence.push(
          evidenceEntry({
            path: input.source,
            action: "omitted",
            reason: payloadBytes === undefined ? "payload-not-json" : "payload-budget-exceeded",
            originalBytes: payloadBytes
          })
        )
        record(evidence)
        return {
          value: Option.none(),
          evidence,
          summary: summarize(evidence)
        }
      }

      record(evidence)
      return {
        value: Option.some(textCapped as A),
        evidence,
        summary: summarize(evidence)
      }
    }

    return Object.freeze({
      sanitize: (input) => Effect.sync(() => sanitizeSync(input)),
      sanitizeSync,
      summarize,
      snapshot: () => Effect.sync(() => summarize(aggregateEvidence)),
      observe: () => Stream.fromEffect(Effect.sync(() => summarize(aggregateEvidence))),
      assertProductionCapture: () =>
        mode === "production" && productionCapture !== "safe"
          ? Effect.fail(
              new InspectorSafetyPolicyInvalidArgumentError({
                operation: "InspectorSafetyPolicy.assertProductionCapture",
                field: "productionCapture",
                message: "production capture requires a safe inspector policy"
              })
            )
          : Effect.void
    } satisfies InspectorSafetyPolicyApi)
  })

export class InspectorSafetyPolicy extends Context.Service<
  InspectorSafetyPolicy,
  InspectorSafetyPolicyApi
>()("@orika/core/runtime/inspector-safety-policy/InspectorSafetyPolicy", {
  make: makeInspectorSafetyPolicy()
}) {}

export const InspectorSafetyPolicyLive = (
  options: InspectorSafetyPolicyOptions = {}
): Layer.Layer<InspectorSafetyPolicy, InspectorSafetyPolicyInvalidArgumentError, never> =>
  Layer.effect(InspectorSafetyPolicy)(makeInspectorSafetyPolicy(options))

const positiveIntegerOption = (
  value: number | undefined,
  fallback: number,
  field: string
): Effect.Effect<number, InspectorSafetyPolicyInvalidArgumentError, never> => {
  const resolved = value ?? fallback
  return Number.isInteger(resolved) && resolved > 0
    ? Effect.succeed(resolved)
    : Effect.fail(
        new InspectorSafetyPolicyInvalidArgumentError({
          operation: "InspectorSafetyPolicy.make",
          field,
          message: "must be a positive integer"
        })
      )
}

const sampleRateOption = (
  value: number
): Effect.Effect<number, InspectorSafetyPolicyInvalidArgumentError, never> =>
  Number.isFinite(value) && value >= 0 && value <= 1
    ? Effect.succeed(value)
    : Effect.fail(
        new InspectorSafetyPolicyInvalidArgumentError({
          operation: "InspectorSafetyPolicy.make",
          field: "sampleRate",
          message: "must be a finite number between 0 and 1"
        })
      )

const omitHighRisk = (
  value: unknown,
  path: readonly string[],
  evidence: InspectorSafetyEvidence[],
  seen: WeakMap<object, unknown> = new WeakMap<object, unknown>()
): unknown => {
  if (value === null || typeof value !== "object") {
    return value
  }
  const cached = seen.get(value)
  if (cached !== undefined) {
    return cached
  }
  if (Array.isArray(value)) {
    let changed = false
    const next: unknown[] = []
    seen.set(value, next)
    for (const [index, item] of value.entries()) {
      const child = omitHighRisk(item, [...path, String(index)], evidence, seen)
      next.push(child)
      changed ||= child !== item
    }
    if (!changed) {
      seen.set(value, value)
      return value
    }
    return next
  }
  if (value instanceof Map) {
    let changed = false
    const next = new Map<unknown, unknown>()
    seen.set(value, next)
    for (const [key, child] of value.entries()) {
      const keyText = String(key)
      const childPath = [...path, keyText]
      if (isHighRiskKey(keyText)) {
        evidence.push(
          evidenceEntry({
            path: formatPath(childPath),
            action: "omitted",
            reason: "high-risk-key",
            originalBytes: encodedJsonBytes(child)
          })
        )
        changed = true
        continue
      }
      const safeChild = omitHighRisk(child, childPath, evidence, seen)
      next.set(key, safeChild)
      changed ||= safeChild !== child
    }
    if (!changed) {
      seen.set(value, value)
      return value
    }
    return next
  }
  if (value instanceof Uint8Array) {
    return value
  }
  if (!isPlainRecord(value)) {
    return value
  }

  let changed = false
  const next: Record<string, unknown> = {}
  seen.set(value, next)
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key]
    if (isHighRiskKey(key)) {
      evidence.push(
        evidenceEntry({
          path: formatPath(childPath),
          action: "omitted",
          reason: "high-risk-key",
          originalBytes: encodedJsonBytes(child)
        })
      )
      changed = true
      continue
    }
    const safeChild = omitHighRisk(child, childPath, evidence, seen)
    next[key] = safeChild
    changed ||= safeChild !== child
  }
  if (!changed) {
    seen.set(value, value)
    return value
  }
  return next
}

const capStrings = (
  value: unknown,
  path: readonly string[],
  maxStringBytes: number,
  evidence: InspectorSafetyEvidence[],
  seen: WeakMap<object, unknown> = new WeakMap<object, unknown>()
): unknown => {
  if (typeof value === "string") {
    const scrubbed = scrubSecretText(value)
    if (scrubbed !== value) {
      evidence.push(
        evidenceEntry({
          path: formatPath(path),
          action: "redacted",
          reason: "secret-text-pattern",
          originalBytes: encodedTextBytes(value),
          keptBytes: encodedTextBytes(scrubbed)
        })
      )
    }
    const size = encodedTextBytes(scrubbed)
    if (size <= maxStringBytes) {
      return scrubbed
    }
    const truncated = truncateUtf8(scrubbed, maxStringBytes)
    evidence.push(
      evidenceEntry({
        path: formatPath(path),
        action: "truncated",
        reason: "string-budget-exceeded",
        originalBytes: size,
        keptBytes: encodedTextBytes(truncated)
      })
    )
    return truncated
  }
  if (value === null || typeof value !== "object") {
    return value
  }
  const cached = seen.get(value)
  if (cached !== undefined) {
    return cached
  }
  if (Array.isArray(value)) {
    let changed = false
    const next: unknown[] = []
    seen.set(value, next)
    for (const [index, item] of value.entries()) {
      const capped = capStrings(item, [...path, String(index)], maxStringBytes, evidence, seen)
      next.push(capped)
      changed ||= capped !== item
    }
    if (!changed) {
      seen.set(value, value)
      return value
    }
    return next
  }
  if (value instanceof Map) {
    let changed = false
    const next = new Map<unknown, unknown>()
    seen.set(value, next)
    for (const [key, child] of value.entries()) {
      const capped = capStrings(child, [...path, String(key)], maxStringBytes, evidence, seen)
      next.set(key, capped)
      changed ||= capped !== child
    }
    if (!changed) {
      seen.set(value, value)
      return value
    }
    return next
  }
  if (value instanceof Uint8Array) {
    return value
  }
  if (!isPlainRecord(value)) {
    return value
  }

  let changed = false
  const next: Record<string, unknown> = {}
  seen.set(value, next)
  for (const [key, child] of Object.entries(value)) {
    const capped = capStrings(child, [...path, key], maxStringBytes, evidence, seen)
    next[key] = capped
    changed ||= capped !== child
  }
  if (!changed) {
    seen.set(value, value)
    return value
  }
  return next
}

const normalizeJsonContainers = (
  value: unknown,
  path: readonly string[],
  evidence: InspectorSafetyEvidence[],
  seen: WeakMap<object, unknown> = new WeakMap<object, unknown>()
): unknown => {
  if (value === null || typeof value !== "object") {
    return value
  }
  const cached = seen.get(value)
  if (cached !== undefined) {
    return cached
  }
  if (Array.isArray(value)) {
    const next: unknown[] = []
    seen.set(value, next)
    for (const [index, item] of value.entries()) {
      next.push(normalizeJsonContainers(item, [...path, String(index)], evidence, seen))
    }
    return next
  }
  if (value instanceof Map) {
    const next: Record<string, unknown> = {}
    seen.set(value, next)
    for (const [key, child] of value.entries()) {
      const keyText = safeEvidencePathSegment(String(key))
      next[keyText] = normalizeJsonContainers(child, [...path, keyText], evidence, seen)
    }
    return next
  }
  if (value instanceof Uint8Array) {
    evidence.push(
      evidenceEntry({
        path: formatPath(path),
        action: "omitted",
        reason: "binary-payload",
        originalBytes: value.byteLength,
        keptBytes: encodedTextBytes("<omitted:binary>")
      })
    )
    return "<omitted:binary>"
  }
  if (!isPlainRecord(value)) {
    return value
  }

  const next: Record<string, unknown> = {}
  seen.set(value, next)
  for (const [key, child] of Object.entries(value)) {
    next[key] = normalizeJsonContainers(child, [...path, key], evidence, seen)
  }
  return next
}

const scrubSecretText = (value: string): string =>
  value.replace(SecretAssignmentPattern, "$1$2<redacted>").replace(BearerPattern, "$1<redacted>")

const truncateUtf8 = (value: string, maxBytes: number): string => {
  let output = ""
  for (const character of value) {
    const next = output + character
    if (encodedTextBytes(next) > maxBytes) {
      return output
    }
    output = next
  }
  return output
}

const encodedJsonBytes = (value: unknown): number | undefined => {
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? undefined : encodedTextBytes(encoded)
  } catch {
    return undefined
  }
}

const encodedTextBytes = (value: string): number => new TextEncoder().encode(value).byteLength

const evidenceEntry = (input: {
  readonly path: string
  readonly action: InspectorSafetyAction
  readonly reason: string
  readonly originalBytes?: number | undefined
  readonly keptBytes?: number | undefined
}): InspectorSafetyEvidence =>
  new InspectorSafetyEvidence({
    path: input.path,
    action: input.action,
    reason: input.reason,
    ...(input.originalBytes === undefined ? {} : { originalBytes: input.originalBytes }),
    ...(input.keptBytes === undefined ? {} : { keptBytes: input.keptBytes })
  })

const isHighRiskKey = (key: string): boolean => HighRiskKeyPattern.test(key.replaceAll(/[-_]/g, ""))

const isPlainRecord = (value: object): value is Record<string, unknown> =>
  Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null

const countAction = (
  evidence: readonly InspectorSafetyEvidence[],
  action: InspectorSafetyAction
): number => evidence.filter((item) => item.action === action).length

const qualifyPath = (source: string, path: string): string =>
  path === "$" ? source : `${source}.${path}`

const formatPath = (path: readonly string[]): string => path.map(safeEvidencePathSegment).join(".")

const safeEvidencePathSegment = (segment: string): string =>
  /api[_-]?key|token|password|secret|bearer|authorization|cookie|session[_-]?id|refresh[_-]?token|client[_-]?secret|private[_-]?key/i.test(
    segment
  ) || /bearer\s+\S+/i.test(segment)
    ? "<redacted-key>"
    : segment.replaceAll(/[\r\n\t]/g, " ")
