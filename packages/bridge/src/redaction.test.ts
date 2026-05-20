import { expect, test } from "bun:test"

import {
  RedactionFilter,
  makeSecretBytesFromUtf8,
  makeSecretString,
  redact,
  redactForJson,
  redactForJsonWithEvidence,
  unsafeSecretString
} from "./redaction.js"

const redacted = RedactionFilter.redactedValue
const expectRedactedShape = (actual: unknown, expected: unknown): void => {
  expect(actual).toEqual(expected)
}

const expectMap: (value: unknown) => asserts value is Map<unknown, unknown> = (value) => {
  expect(value).toBeInstanceOf(Map)
  if (!(value instanceof Map)) {
    throw new Error("expected Map")
  }
}

test("redact replaces nested secret-shaped fields while preserving shape", () => {
  const input = {
    headers: { authorization: "Bearer abc", cookie: "sid=1" },
    body: { api_key: "x", profile: { name: "Ada" } }
  }

  expectRedactedShape(redact(input), {
    headers: { authorization: redacted, cookie: redacted },
    body: { api_key: redacted, profile: { name: "Ada" } }
  })
  expect(JSON.stringify(redact(input))).not.toContain("Bearer abc")
})

test("redact returns the original object when no fields match", () => {
  const input = { headers: { accept: "application/json" }, body: { name: "Ada" } }

  expect(redact(input)).toBe(input)
  expect(redact(input).headers).toBe(input.headers)
})

test("redact supports additional patterns and allowlisted paths", () => {
  const input = {
    payload: {
      customField: "hidden",
      token: "known-safe",
      nested: { token: "hidden" }
    }
  }

  expectRedactedShape(
    redact(input, {
      additionalPatterns: ["customField"],
      allowlist: ["payload.token"]
    }),
    {
      payload: {
        customField: redacted,
        token: "known-safe",
        nested: { token: redacted }
      }
    }
  )
})

test("redact can disable the default pattern while keeping additional patterns", () => {
  expectRedactedShape(
    redact(
      { token: "visible", customerSsn: "123-45-6789" },
      { defaultPatternEnabled: false, additionalPatterns: ["customerSsn"] }
    ),
    { token: "visible", customerSsn: redacted }
  )
})

test("redact handles arrays and cycles", () => {
  const input: { readonly items: unknown[]; self?: unknown } = {
    items: [{ refresh_token: "abc" }]
  }
  input.self = input

  const output = redact(input)

  expect(output.items).toEqual([{ refresh_token: redacted }])
  expect(output.self).toBe(output)
})

test("redact handles nested maps and redacts map keys", () => {
  const input = new Map<string, string | Map<string, string>>([
    ["api_key", "secret"],
    [
      "payload",
      new Map<string, string>([
        ["token", "nested"],
        ["user", "ada"]
      ])
    ]
  ])

  const output: unknown = redact(input)
  expectMap(output)

  expect(output).toBeInstanceOf(Map)
  expect(output).not.toBe(input)
  expectRedactedShape(output.get("api_key"), redacted)
  const payload: unknown = output.get("payload")
  expectMap(payload)
  expectRedactedShape(payload.get("token"), redacted)
  expect(payload.get("user")).toBe("ada")
})

test("redact returns original map when no entries match", () => {
  const input = new Map<string, string | Map<string, string>>([
    ["name", "Ada"],
    ["session", new Map<string, string>([["safe", "ok"]])]
  ])

  const output = redact(input)

  expect(output).toBe(input)
  expect(output.get("session")).toBe(input.get("session"))
})

test("redact handles map cycles safely", () => {
  const input = new Map<string, unknown>([["token", "secret"]])
  input.set("self", input)

  const output = redact(input)

  expect(output).not.toBe(input)
  expect(output.get("token")).toBe(redacted)
  expect(output.get("self")).toBe(output)
})

test("redact leaves byte arrays intact unless the containing field matches", () => {
  const bytes = new Uint8Array([1, 2, 3])

  expect(redact({ payload: bytes })).toEqual({ payload: bytes })
  expectRedactedShape(redact({ private_key: bytes }), { private_key: redacted })
})

test("redact preserves existing Effect redacted values", () => {
  const secret = makeSecretBytesFromUtf8("refresh-token")
  const input = { payload: secret }
  const output = redact(input)

  expect(output).toBe(input)
  expect(output.payload).toBe(secret)
  expect(JSON.stringify(output)).not.toContain("refresh-token")
})

test("SecretString hides credential display while retaining explicit unsafe access", () => {
  const secret = makeSecretString("real-password", { label: "Credential" })

  expect(JSON.stringify(secret)).toBe('"<redacted:Credential>"')
  expect(secret.pipe(unsafeSecretString)).toBe("real-password")
})

test("redactForJson materializes Effect redacted values to JSON-safe strings", () => {
  const secret = makeSecretBytesFromUtf8("refresh-token")

  expectRedactedShape(
    redactForJson({
      token: "secret-token",
      nested: { payload: secret },
      safe: "visible"
    }),
    {
      token: "<redacted:redacted>",
      nested: { payload: "<redacted:SecretBytes>" },
      safe: "visible"
    }
  )
})

test("redactForJsonWithEvidence reports redacted paths without raw values", () => {
  const result = redactForJsonWithEvidence({
    token: "secret-token",
    nested: { apiKey: "secret-key", safe: "visible" }
  })

  expect(result.value).toEqual({
    token: "<redacted:redacted>",
    nested: { apiKey: "<redacted:redacted>", safe: "visible" }
  })
  expect(result.evidence.map((item) => item.path)).toContain("<redacted-key>")
  expect(result.evidence.map((item) => item.path)).toContain("nested.<redacted-key>")
  expect(JSON.stringify(result.evidence)).not.toContain("secret-token")
  expect(JSON.stringify(result.evidence)).not.toContain("secret-key")
})
