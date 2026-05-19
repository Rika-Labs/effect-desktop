import { expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"

import { makeInspectorSafetyPolicy } from "./inspector-safety-policy.js"

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

test("InspectorSafetyPolicy redacts secrets, omits risky payloads, and records evidence", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* makeInspectorSafetyPolicy()

      const decision = yield* policy.sanitize({
        source: "inspector.test",
        payload: {
          headers: { authorization: "Bearer abc" },
          body: { text: "raw file contents" },
          message: "api_key=secret-key"
        }
      })

      expect(Option.isSome(decision.value)).toBe(true)
      if (Option.isSome(decision.value)) {
        const encoded = encodeJson(decision.value.value)
        expect(encoded).not.toContain("Bearer abc")
        expect(encoded).not.toContain("raw file contents")
        expect(encoded).not.toContain("secret-key")
      }
      expect(decision.summary.redacted).toBeGreaterThan(0)
      expect(decision.summary.omitted).toBeGreaterThan(0)
      expect(encodeJson(decision.evidence)).not.toContain("secret-key")
    })
  ))

test("InspectorSafetyPolicy deterministically samples out capture", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* makeInspectorSafetyPolicy({
        sampleRate: 0.5,
        nextSample: () => 0.75
      })

      const decision = yield* policy.sanitize({
        source: "inspector.test",
        payload: { safe: "value" }
      })

      expect(Option.isNone(decision.value)).toBe(true)
      expect(decision.summary.sampledOut).toBe(1)
    })
  ))

test("InspectorSafetyPolicy rejects unsafe production capture", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* makeInspectorSafetyPolicy({
        mode: "production",
        productionCapture: "disabled"
      })

      const decision = yield* policy.sanitize({
        source: "inspector.test",
        payload: { safe: "value" }
      })
      const error = yield* Effect.flip(policy.assertProductionCapture())

      expect(Option.isNone(decision.value)).toBe(true)
      expect(decision.summary.productionDisabled).toBe(1)
      expect(error.field).toBe("productionCapture")
    })
  ))

test("InspectorSafetyPolicy caps long strings before storage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* makeInspectorSafetyPolicy({ maxStringBytes: 4 })

      const decision = yield* policy.sanitize({
        source: "inspector.test",
        payload: { message: "abcdef" }
      })

      expect(Option.isSome(decision.value)).toBe(true)
      if (Option.isSome(decision.value)) {
        expect(decision.value.value).toEqual({ message: "abcd" })
      }
      expect(decision.summary.truncated).toBe(1)
    })
  ))
