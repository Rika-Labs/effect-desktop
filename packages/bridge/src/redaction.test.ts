import { expect, test } from "bun:test"

import {
  RedactionFilter,
  makeSecretBytesFromUtf8,
  redact,
  redactForJson,
  redactForJsonWithEvidence
} from "./redaction.js"

const redacted = RedactionFilter.redactedValue

test("redact replaces nested secret-shaped fields while preserving shape", () => {
  const input = {
    headers: { authorization: "Bearer abc", cookie: "sid=1" },
    body: { api_key: "x", profile: { name: "Ada" } }
  }

  expect(redact(input) as unknown).toEqual({
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

  expect(
    redact(input, {
      additionalPatterns: ["customField"],
      allowlist: ["payload.token"]
    }) as unknown
  ).toEqual({
    payload: {
      customField: redacted,
      token: "known-safe",
      nested: { token: redacted }
    }
  })
})

test("redact can disable the default pattern while keeping additional patterns", () => {
  expect(
    redact(
      { token: "visible", customerSsn: "123-45-6789" },
      { defaultPatternEnabled: false, additionalPatterns: ["customerSsn"] }
    ) as unknown
  ).toEqual({ token: "visible", customerSsn: redacted })
})

test("redact handles arrays and cycles", () => {
  const input: { readonly items: unknown[]; self?: unknown } = {
    items: [{ refresh_token: "abc" }]
  }
  input.self = input

  const output = redact(input) as { readonly items: readonly unknown[]; readonly self: unknown }

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

  const output = redact(input) as Map<string, unknown>

  expect(output).toBeInstanceOf(Map)
  expect(output).not.toBe(input)
  expect(output.get("api_key")).toBe(redacted)
  expect(output.get("payload")).toBeInstanceOf(Map)
  expect((output.get("payload") as Map<string, unknown>).get("token")).toBe(redacted)
  expect((output.get("payload") as Map<string, unknown>).get("user")).toBe("ada")
})

test("redact returns original map when no entries match", () => {
  const input = new Map<string, string | Map<string, string>>([
    ["name", "Ada"],
    ["session", new Map<string, string>([["safe", "ok"]])]
  ])

  const output = redact(input) as Map<string, string | Map<string, string>>

  expect(output).toBe(input)
  expect(output.get("session")).toBe(input.get("session"))
})

test("redact handles map cycles safely", () => {
  const input = new Map<string, unknown>([["token", "secret"]])
  input.set("self", input)

  const output = redact(input) as Map<string, unknown>

  expect(output).not.toBe(input)
  expect(output.get("token")).toBe(redacted)
  expect(output.get("self")).toBe(output)
})

test("redact leaves byte arrays intact unless the containing field matches", () => {
  const bytes = new Uint8Array([1, 2, 3])

  expect(redact({ payload: bytes })).toEqual({ payload: bytes })
  expect(redact({ private_key: bytes }) as unknown).toEqual({ private_key: redacted })
})

test("redact preserves existing Effect redacted values", () => {
  const secret = makeSecretBytesFromUtf8("refresh-token")
  const input = { payload: secret }
  const output = redact(input)

  expect(output).toBe(input)
  expect(output.payload).toBe(secret)
  expect(JSON.stringify(output)).not.toContain("refresh-token")
})

test("redactForJson materializes Effect redacted values to JSON-safe strings", () => {
  const secret = makeSecretBytesFromUtf8("refresh-token")

  expect(
    redactForJson({
      token: "secret-token",
      nested: { payload: secret },
      safe: "visible"
    }) as unknown
  ).toEqual({
    token: "<redacted:redacted>",
    nested: { payload: "<redacted:SecretBytes>" },
    safe: "visible"
  })
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
