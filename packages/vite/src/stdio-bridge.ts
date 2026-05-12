import { encodeFrame, FrameDecoder } from "@effect-desktop/core/runtime/transport"
import type { RuntimeChild } from "./child-process.js"

export interface StdioBridge {
  readonly send: (payload: Uint8Array) => void
  readonly onFrame: (handler: (frame: Uint8Array) => void) => void
  readonly dispose: () => void
}

export const makeStdioBridge = (child: RuntimeChild): StdioBridge => {
  const decoder = new FrameDecoder()
  const handlers: Array<(frame: Uint8Array) => void> = []

  child.stdout.on("data", (chunk: Buffer | Uint8Array) => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    const frames = decoder.push(bytes)
    for (const frame of frames) {
      for (const handler of handlers) {
        handler(frame)
      }
    }
  })

  return {
    send: (payload) => {
      const frame = encodeFrame(payload)
      child.stdin.write(frame)
    },
    onFrame: (handler) => {
      handlers.push(handler)
    },
    dispose: () => {
      handlers.length = 0
      child.kill()
    }
  }
}
