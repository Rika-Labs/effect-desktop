import { Effect, Redacted } from "effect"

export type SecretBytes = Redacted.Redacted<Uint8Array>

const RedactedValue = Redacted.make("redacted", { label: "redacted" })
const DefaultSecretPattern =
  /api[_-]?key|token|password|secret|bearer|authorization|cookie|session[_-]?id|refresh[_-]?token|client[_-]?secret|private[_-]?key/i

export interface RedactionFilterOptions {
  readonly defaultPatternEnabled?: boolean
  readonly additionalPatterns?: readonly (RegExp | string)[]
  readonly allowlist?: readonly string[]
}

export interface RedactionEvidence {
  readonly path: string
  readonly action: "redacted"
  readonly reason: "secret-pattern" | "redacted-value"
}

export interface RedactionResult<A> {
  readonly value: A
  readonly evidence: readonly RedactionEvidence[]
}

interface ResolvedRedactionFilterOptions {
  readonly patterns: readonly RegExp[]
  readonly allowlist: ReadonlySet<string>
}

export const redact = <A>(record: A, options: RedactionFilterOptions = {}): A =>
  redactValue(record, [], resolveOptions(options), new WeakMap<object, unknown>()) as A

export const redactForJson = <A>(record: A, options: RedactionFilterOptions = {}): A =>
  materializeRedacted(redact(record, options), [], new WeakMap<object, unknown>()) as A

export const redactWithEvidence = <A>(
  record: A,
  options: RedactionFilterOptions = {}
): RedactionResult<A> => {
  const evidence: RedactionEvidence[] = []
  const value = redactValue(
    record,
    [],
    resolveOptions(options),
    new WeakMap<object, unknown>(),
    evidence
  ) as A
  return { value, evidence }
}

export const redactForJsonWithEvidence = <A>(
  record: A,
  options: RedactionFilterOptions = {}
): RedactionResult<A> => {
  const redacted = redactWithEvidence(record, options)
  const materializedEvidence: RedactionEvidence[] = [...redacted.evidence]
  const value = materializeRedacted(
    redacted.value,
    [],
    new WeakMap<object, unknown>(),
    materializedEvidence
  ) as A
  return { value, evidence: materializedEvidence }
}

export const RedactionFilter = Object.freeze({
  redact,
  redactForJson,
  redactWithEvidence,
  redactForJsonWithEvidence,
  redactedValue: RedactedValue,
  defaultPattern: DefaultSecretPattern
})

export const makeSecretBytes = (bytes: Uint8Array): SecretBytes => {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("makeSecretBytes requires a Uint8Array")
  }
  return Redacted.make(new Uint8Array(bytes), { label: "SecretBytes" })
}

export const makeSecretBytesFromUtf8 = (value: string): SecretBytes =>
  makeSecretBytes(new TextEncoder().encode(value))

export const unsafeSecretBytes = (secret: SecretBytes): Uint8Array =>
  new Uint8Array(Redacted.value(secret))

export const wipeSecretBytes = (secret: SecretBytes): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    Redacted.value(secret).fill(0)
    Redacted.wipeUnsafe(secret)
  })

const redactValue = (
  value: unknown,
  path: readonly string[],
  options: ResolvedRedactionFilterOptions,
  seen: WeakMap<object, unknown>,
  evidence?: RedactionEvidence[]
): unknown => {
  if (value === null || typeof value !== "object") {
    return value
  }
  if (Redacted.isRedacted(value)) {
    return value
  }
  const cached = seen.get(value)
  if (cached !== undefined) {
    return cached
  }
  if (Array.isArray(value)) {
    return redactArray(value, path, options, seen, evidence)
  }
  if (value instanceof Map) {
    return redactMap(value, path, options, seen, evidence)
  }
  if (value instanceof Uint8Array) {
    return value
  }
  return redactRecord(value as Readonly<Record<string, unknown>>, path, options, seen, evidence)
}

const materializeRedacted = (
  value: unknown,
  path: readonly string[],
  seen: WeakMap<object, unknown>,
  evidence?: RedactionEvidence[]
): unknown => {
  if (Redacted.isRedacted(value)) {
    evidence?.push({
      path: formatEvidencePath(path),
      action: "redacted",
      reason: "redacted-value"
    })
    return redactedJsonString(value)
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
    for (const item of value) {
      const materialized = materializeRedacted(item, [...path, String(next.length)], seen, evidence)
      next.push(materialized)
      changed ||= materialized !== item
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
      const materialized = materializeRedacted(child, [...path, String(key)], seen, evidence)
      next.set(key, materialized)
      changed ||= materialized !== child
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

  let changed = false
  const next: Record<string, unknown> = {}
  seen.set(value, next)
  for (const [key, child] of Object.entries(value)) {
    const materialized = materializeRedacted(child, [...path, key], seen, evidence)
    next[key] = materialized
    changed ||= materialized !== child
  }
  if (!changed) {
    seen.set(value, value)
    return value
  }
  return next
}

const redactedJsonString = (value: Redacted.Redacted<unknown>): string => {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) {
    return "<redacted>"
  }
  const decoded: unknown = JSON.parse(encoded)
  return typeof decoded === "string" ? decoded : "<redacted>"
}

const redactArray = (
  value: readonly unknown[],
  path: readonly string[],
  options: ResolvedRedactionFilterOptions,
  seen: WeakMap<object, unknown>,
  evidence?: RedactionEvidence[]
): unknown => {
  let changed = false
  const next: unknown[] = []
  seen.set(value, next)
  for (const [index, item] of value.entries()) {
    const redacted = redactValue(item, [...path, String(index)], options, seen, evidence)
    next.push(redacted)
    changed ||= redacted !== item
  }

  if (!changed) {
    seen.set(value, value)
    return value
  }
  return next
}

const redactMap = (
  value: ReadonlyMap<unknown, unknown>,
  path: readonly string[],
  options: ResolvedRedactionFilterOptions,
  seen: WeakMap<object, unknown>,
  evidence?: RedactionEvidence[]
): unknown => {
  let changed = false
  const next = new Map<unknown, unknown>()
  seen.set(value, next)

  for (const [key, child] of value.entries()) {
    const mapKey = String(key)
    const childPath = [...path, mapKey]
    const redacted = shouldRedact(mapKey, childPath, options)
      ? redactedByPattern(childPath, evidence)
      : redactValue(child, childPath, options, seen, evidence)

    next.set(key, redacted)
    changed ||= redacted !== child
  }

  if (!changed) {
    seen.set(value, value)
    return value
  }
  return next
}

const redactRecord = (
  value: Readonly<Record<string, unknown>>,
  path: readonly string[],
  options: ResolvedRedactionFilterOptions,
  seen: WeakMap<object, unknown>,
  evidence?: RedactionEvidence[]
): unknown => {
  let changed = false
  const next: Record<string, unknown> = {}
  seen.set(value, next)

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key]
    const redacted = shouldRedact(key, childPath, options)
      ? redactedByPattern(childPath, evidence)
      : redactValue(child, childPath, options, seen, evidence)
    next[key] = redacted
    changed ||= redacted !== child
  }

  if (!changed) {
    seen.set(value, value)
    return value
  }
  return next
}

const shouldRedact = (
  key: string,
  path: readonly string[],
  options: ResolvedRedactionFilterOptions
): boolean => {
  const dotted = path.join(".")
  if (options.allowlist.has(key) || options.allowlist.has(dotted)) {
    return false
  }
  return options.patterns.some((pattern) => pattern.test(key))
}

const resolveOptions = (options: RedactionFilterOptions): ResolvedRedactionFilterOptions =>
  Object.freeze({
    patterns: [
      ...(options.defaultPatternEnabled === false ? [] : [DefaultSecretPattern]),
      ...(options.additionalPatterns ?? []).map(toRegExp)
    ],
    allowlist: new Set(options.allowlist ?? [])
  })

const toRegExp = (pattern: RegExp | string): RegExp =>
  typeof pattern === "string" ? new RegExp(pattern, "i") : pattern

const redactedByPattern = (
  path: readonly string[],
  evidence: RedactionEvidence[] | undefined
): Redacted.Redacted<string> => {
  evidence?.push({
    path: formatEvidencePath(path),
    action: "redacted",
    reason: "secret-pattern"
  })
  return RedactedValue
}

const formatEvidencePath = (path: readonly string[]): string =>
  path.length === 0 ? "$" : path.map(safeEvidencePathSegment).join(".")

const safeEvidencePathSegment = (segment: string): string =>
  DefaultSecretPattern.test(segment) || /bearer\s+\S+/i.test(segment)
    ? "<redacted-key>"
    : segment.replaceAll(/[\r\n\t]/g, " ")
