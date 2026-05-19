import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import { readCliStreamText } from "./cli-stream.js"

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

test("readCliStreamText decodes readable stream chunks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(bytes("hello "))
          controller.enqueue(bytes("world"))
          controller.close()
        }
      })

      const text = yield* readCliStreamText(stream, { operation: "test.stdout" })
      expect(text).toBe("hello world")
    })
  ))

test("readCliStreamText maps stream failures to typed values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cause = new Error("stream failed")
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.error(cause)
        }
      })

      const exit = yield* Effect.exit(readCliStreamText(stream, { operation: "test.stderr" }))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const json = exit.cause.toJSON() as {
          readonly failures?: readonly { readonly _tag: string; readonly error?: unknown }[]
        }
        const failure = json.failures?.find((item) => item._tag === "Fail")
        expect(failure?.error).toMatchObject({
          _tag: "CliStreamError",
          operation: "test.stderr"
        })
      }
    })
  ))

test("readCliStreamText applies an explicit output bound", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(bytes("abcdef"))
          controller.enqueue(bytes("ghijkl"))
          controller.close()
        }
      })

      const text = yield* readCliStreamText(stream, { operation: "test.large", maxChars: 8 })
      expect(text).toBe("abcdefgh\n[output truncated]")
    })
  ))
