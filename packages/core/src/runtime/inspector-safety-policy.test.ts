import { expect, test } from "bun:test"
import { Effect, Option } from "effect"

import { makeInspectorSafetyPolicy } from "./inspector-safety-policy.js"

test("InspectorSafetyPolicy redacts secrets, omits risky payloads, and records evidence", async () => {
  const policy = await Effect.runPromise(makeInspectorSafetyPolicy())

  const decision = await Effect.runPromise(
    policy.sanitize({
      source: "inspector.test",
      payload: {
        headers: { authorization: "Bearer abc" },
        body: { text: "raw file contents" },
        message: "api_key=secret-key"
      }
    })
  )

  expect(Option.isSome(decision.value)).toBe(true)
  if (Option.isSome(decision.value)) {
    expect(JSON.stringify(decision.value.value)).not.toContain("Bearer abc")
    expect(JSON.stringify(decision.value.value)).not.toContain("raw file contents")
    expect(JSON.stringify(decision.value.value)).not.toContain("secret-key")
  }
  expect(decision.summary.redacted).toBeGreaterThan(0)
  expect(decision.summary.omitted).toBeGreaterThan(0)
  expect(JSON.stringify(decision.evidence)).not.toContain("secret-key")
})

test("InspectorSafetyPolicy deterministically samples out capture", async () => {
  const policy = await Effect.runPromise(
    makeInspectorSafetyPolicy({ sampleRate: 0.5, nextSample: () => 0.75 })
  )

  const decision = await Effect.runPromise(
    policy.sanitize({ source: "inspector.test", payload: { safe: "value" } })
  )

  expect(Option.isNone(decision.value)).toBe(true)
  expect(decision.summary.sampledOut).toBe(1)
})

test("InspectorSafetyPolicy rejects unsafe production capture", async () => {
  const policy = await Effect.runPromise(
    makeInspectorSafetyPolicy({ mode: "production", productionCapture: "disabled" })
  )

  const decision = await Effect.runPromise(
    policy.sanitize({ source: "inspector.test", payload: { safe: "value" } })
  )
  const error = await Effect.runPromise(Effect.flip(policy.assertProductionCapture()))

  expect(Option.isNone(decision.value)).toBe(true)
  expect(decision.summary.productionDisabled).toBe(1)
  expect(error.field).toBe("productionCapture")
})

test("InspectorSafetyPolicy caps long strings before storage", async () => {
  const policy = await Effect.runPromise(makeInspectorSafetyPolicy({ maxStringBytes: 4 }))

  const decision = await Effect.runPromise(
    policy.sanitize({ source: "inspector.test", payload: { message: "abcdef" } })
  )

  expect(Option.isSome(decision.value)).toBe(true)
  if (Option.isSome(decision.value)) {
    expect(decision.value.value).toEqual({ message: "abcd" })
  }
  expect(decision.summary.truncated).toBe(1)
})
