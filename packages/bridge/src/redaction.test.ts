import { expect, test } from "bun:test"

import { redact } from "./redaction.js"

test("redact replaces nested secret-shaped fields while preserving shape", () => {
  const input = {
    headers: { authorization: "Bearer abc", cookie: "sid=1" },
    body: { api_key: "x", profile: { name: "Ada" } }
  }

  expect(redact(input)).toEqual({
    headers: { authorization: "[REDACTED]", cookie: "[REDACTED]" },
    body: { api_key: "[REDACTED]", profile: { name: "Ada" } }
  })
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
    })
  ).toEqual({
    payload: {
      customField: "[REDACTED]",
      token: "known-safe",
      nested: { token: "[REDACTED]" }
    }
  })
})

test("redact handles arrays and cycles", () => {
  const input: { readonly items: unknown[]; self?: unknown } = {
    items: [{ refresh_token: "abc" }]
  }
  input.self = input

  const output = redact(input) as { readonly items: readonly unknown[]; readonly self: unknown }

  expect(output.items).toEqual([{ refresh_token: "[REDACTED]" }])
  expect(output.self).toBe(output)
})

test("redact leaves byte arrays intact unless the containing field matches", () => {
  const bytes = new Uint8Array([1, 2, 3])

  expect(redact({ payload: bytes })).toEqual({ payload: bytes })
  expect(redact({ private_key: bytes }) as unknown).toEqual({ private_key: "[REDACTED]" })
})
