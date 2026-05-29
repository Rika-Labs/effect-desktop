import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import { encodeHostProtocolFrame } from "./codec.js"
import { HostProtocolInvalidOutputError } from "./protocol.js"

const requestEnvelope = (payload: unknown) =>
  ({
    kind: "request",
    id: "request-codec",
    method: "Test.codec",
    timestamp: 1710000000005,
    traceId: "trace-codec",
    payload
  }) as const

const decodePayload = (frame: Uint8Array): unknown =>
  (JSON.parse(new TextDecoder().decode(frame)) as { readonly payload: unknown }).payload

test("host protocol codec accepts payloads that share a non-cyclic object across keys", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const shared = { value: 1 }
      const frame = yield* encodeHostProtocolFrame(
        requestEnvelope({ left: shared, right: shared }),
        "Test.codec"
      )

      expect(decodePayload(frame)).toEqual({ left: { value: 1 }, right: { value: 1 } })
    })
  ))

test("host protocol codec accepts arrays that reuse the same non-cyclic element", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const shared = { value: "x" }
      const frame = yield* encodeHostProtocolFrame(
        requestEnvelope({ items: [shared, shared, shared] }),
        "Test.codec"
      )

      expect(decodePayload(frame)).toEqual({
        items: [{ value: "x" }, { value: "x" }, { value: "x" }]
      })
    })
  ))

test("host protocol codec rejects payloads with a genuine circular reference", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cyclic: Record<string, unknown> = { name: "loop" }
      cyclic["self"] = cyclic

      const exit = yield* Effect.exit(
        encodeHostProtocolFrame(requestEnvelope(cyclic), "Test.codec")
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error
        expect(error).toBeInstanceOf(HostProtocolInvalidOutputError)
      }
    })
  ))
