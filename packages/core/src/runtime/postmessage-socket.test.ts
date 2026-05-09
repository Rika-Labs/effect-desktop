import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Socket } from "effect/unstable/socket"
import { layerPostMessageSocket } from "./postmessage-socket.js"

test("layerPostMessageSocket provides a Socket.Socket service", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const socket = yield* Socket.Socket.asEffect()
      return typeof socket.run
    }).pipe(Effect.provide(layerPostMessageSocket))
  )

  expect(result).toBe("function")
})

test("layerPostMessageSocket socket writer is scoped", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const socket = yield* Socket.Socket.asEffect()
      const write = yield* socket.writer
      return typeof write
    }).pipe(Effect.scoped, Effect.provide(layerPostMessageSocket))
  )

  expect(result).toBe("function")
})

test("layerPostMessageSocket write emits nothing when window is absent", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const socket = yield* Socket.Socket.asEffect()
      const write = yield* socket.writer
      yield* write(new Uint8Array([0x68, 0x69]))
      return "ok"
    }).pipe(Effect.scoped, Effect.provide(layerPostMessageSocket))
  )

  expect(result).toBe("ok")
})
