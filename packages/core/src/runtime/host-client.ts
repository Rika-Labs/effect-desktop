import {
  decodeHostProtocolEnvelope,
  encodeHostProtocolEnvelope,
  makeHostProtocolBinaryDecodeError,
  makeHostProtocolFrameTooLargeError,
  makeHostProtocolHostUnavailableError,
  makeHostProtocolInvalidOutputError
} from "@effect-desktop/bridge"
import type {
  HostHandshakeExchange,
  HostProtocolError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope
} from "@effect-desktop/bridge"
import { Effect } from "effect"

import { FrameTooLargeError, FrameTruncatedError, type FramedTransport } from "./transport.js"

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
    catch: (error) => classifyTransportError(error, "FramedTransport.send")
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
    catch: (error) => classifyTransportError(error, "FramedTransport.recv")
  })

const decodeResponseFrame = (
  request: HostProtocolRequestEnvelope,
  frame: Uint8Array
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const envelope = yield* Effect.try({
      try: () => {
        const parsed: unknown = JSON.parse(new TextDecoderCtor().decode(frame))
        return decodeHostProtocolEnvelope(parsed)
      },
      catch: (error) => makeHostProtocolBinaryDecodeError(formatUnknownError(error), request.method)
    })

    if (envelope.kind !== "response") {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          request.method,
          `expected response envelope for ${request.method}; got ${envelope.kind}`
        )
      )
    }

    if (envelope.id !== request.id) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          request.method,
          `expected response id ${request.id} for ${request.method}; got ${envelope.id}`
        )
      )
    }

    return envelope
  })

const classifyTransportError = (error: unknown, operation: string): HostProtocolError => {
  if (error instanceof FrameTooLargeError) {
    return makeHostProtocolFrameTooLargeError(error.size, error.max, operation)
  }

  if (error instanceof FrameTruncatedError) {
    return makeHostProtocolBinaryDecodeError(error.message, operation)
  }

  return makeHostProtocolHostUnavailableError(operation)
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
