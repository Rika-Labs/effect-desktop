import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import { readCliStreamText } from "./cli-stream.js"

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

test("readCliStreamText decodes readable stream chunks", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes("hello "))
      controller.enqueue(bytes("world"))
      controller.close()
    }
  })

  await expect(
    Effect.runPromise(readCliStreamText(stream, { operation: "test.stdout" }))
  ).resolves.toBe("hello world")
})

test("readCliStreamText maps stream failures to typed values", async () => {
  const cause = new Error("stream failed")
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.error(cause)
    }
  })

  const exit = await Effect.runPromiseExit(readCliStreamText(stream, { operation: "test.stderr" }))

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

test("readCliStreamText applies an explicit output bound", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes("abcdef"))
      controller.enqueue(bytes("ghijkl"))
      controller.close()
    }
  })

  await expect(
    Effect.runPromise(readCliStreamText(stream, { operation: "test.large", maxChars: 8 }))
  ).resolves.toBe("abcdefgh\n[output truncated]")
})
