import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Socket } from "effect/unstable/socket"
import { layerStdioSocket, writeStdout } from "./stdio-socket.js"

test("layerStdioSocket provides a Socket.Socket service", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const socket = yield* Socket.Socket.asEffect()
      return typeof socket.run
    }).pipe(Effect.provide(layerStdioSocket))
  )

  expect(result).toBe("function")
})

test("layerStdioSocket socket writer is scoped", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const socket = yield* Socket.Socket.asEffect()
      const write = yield* socket.writer
      return typeof write
    }).pipe(Effect.scoped, Effect.provide(layerStdioSocket))
  )

  expect(result).toBe("function")
})

test("writeStdout completes through the callback boundary", async () => {
  const exit = await Effect.runPromiseExit(writeStdout(""))

  expect(exit._tag).toBe("Success")
})
