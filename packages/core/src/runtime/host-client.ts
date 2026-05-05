import {
  decodeHostProtocolEnvelope,
  encodeHostProtocolEnvelope,
  makeHostProtocolHostUnavailableError,
  makeHostProtocolInvalidOutputError
} from "@effect-desktop/bridge"
import type {
  HostHandshakeExchange,
  HostProtocolEnvelope,
  HostProtocolError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope
} from "@effect-desktop/bridge"
import { Effect } from "effect"

import type { FramedTransport } from "./transport.js"

const TextEncoderCtor = globalThis.TextEncoder
const TextDecoderCtor = globalThis.TextDecoder

export const createHostProtocolExchange = (transport: FramedTransport): HostHandshakeExchange => ({
  request: (request) =>
    Effect.gen(function* () {
      yield* sendRequest(transport, request)
      const frame = yield* receiveResponseFrame(transport)
      return yield* decodeResponseFrame(request, frame)
    })
})

const sendRequest = (
  transport: FramedTransport,
  request: HostProtocolRequestEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.tryPromise({
    try: async () => {
      const encoded = encodeHostProtocolEnvelope(request)
      await transport.send(new TextEncoderCtor().encode(JSON.stringify(encoded)))
    },
    catch: () => makeHostProtocolHostUnavailableError("FramedTransport.send")
  })

const receiveResponseFrame = (
  transport: FramedTransport
): Effect.Effect<Uint8Array, HostProtocolError, never> =>
  Effect.tryPromise({
    try: async () => {
      const frame = await transport.recv()
      if (frame === null) {
        throw new Error("host closed framed transport")
      }

      return frame
    },
    catch: () => makeHostProtocolHostUnavailableError("FramedTransport.recv")
  })

const decodeResponseFrame = (
  request: HostProtocolRequestEnvelope,
  frame: Uint8Array
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> =>
  Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(new TextDecoderCtor().decode(frame))
      const envelope: HostProtocolEnvelope = decodeHostProtocolEnvelope(parsed)
      if (envelope.kind !== "response") {
        throw new Error(`expected response envelope for ${request.method}; got ${envelope.kind}`)
      }

      if (envelope.id !== request.id) {
        throw new Error(
          `expected response id ${request.id} for ${request.method}; got ${envelope.id}`
        )
      }

      return envelope
    },
    catch: (error) => makeHostProtocolInvalidOutputError(request.method, formatUnknownError(error))
  })

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
