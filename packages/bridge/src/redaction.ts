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

interface ResolvedRedactionFilterOptions {
  readonly patterns: readonly RegExp[]
  readonly allowlist: ReadonlySet<string>
}

export const redact = <A>(record: A, options: RedactionFilterOptions = {}): A =>
  redactValue(record, [], resolveOptions(options), new WeakMap<object, unknown>()) as A

export const redactForJson = <A>(record: A, options: RedactionFilterOptions = {}): A =>
  materializeRedacted(redact(record, options), new WeakMap<object, unknown>()) as A

export const RedactionFilter = Object.freeze({
  redact,
  redactForJson,
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
  seen: WeakMap<object, unknown>
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
    return redactArray(value, path, options, seen)
  }
  if (value instanceof Map) {
    return redactMap(value, path, options, seen)
  }
  if (value instanceof Uint8Array) {
    return value
  }
  return redactRecord(value as Readonly<Record<string, unknown>>, path, options, seen)
}

const materializeRedacted = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
  if (Redacted.isRedacted(value)) {
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
      const materialized = materializeRedacted(item, seen)
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
      const materialized = materializeRedacted(child, seen)
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
    const materialized = materializeRedacted(child, seen)
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
  seen: WeakMap<object, unknown>
): unknown => {
  let changed = false
  const next: unknown[] = []
  seen.set(value, next)
  for (const [index, item] of value.entries()) {
    const redacted = redactValue(item, [...path, String(index)], options, seen)
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
  seen: WeakMap<object, unknown>
): unknown => {
  let changed = false
  const next = new Map<unknown, unknown>()
  seen.set(value, next)

  for (const [key, child] of value.entries()) {
    const mapKey = String(key)
    const childPath = [...path, mapKey]
    const redacted = shouldRedact(mapKey, childPath, options)
      ? RedactedValue
      : redactValue(child, childPath, options, seen)

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
  seen: WeakMap<object, unknown>
): unknown => {
  let changed = false
  const next: Record<string, unknown> = {}
  seen.set(value, next)

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key]
    const redacted = shouldRedact(key, childPath, options)
      ? RedactedValue
      : redactValue(child, childPath, options, seen)
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
