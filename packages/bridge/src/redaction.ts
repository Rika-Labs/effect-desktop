const Redacted = "[REDACTED]"
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

export const RedactionFilter = Object.freeze({
  redact,
  redactedValue: Redacted,
  defaultPattern: DefaultSecretPattern
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
      ? Redacted
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
      ? Redacted
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
