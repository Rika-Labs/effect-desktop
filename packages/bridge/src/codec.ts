import { Effect, Schema } from "effect"

import {
  HostProtocolEnvelope as HostProtocolEnvelopeSchema,
  decodeHostProtocolEnvelope,
  makeHostProtocolBinaryDecodeError,
  makeHostProtocolInvalidOutputError,
  type HostProtocolEnvelope,
  type HostProtocolError
} from "./protocol.js"

const TextEncoderUtf8 = new TextEncoder()
const TextDecoderUtf8 = new TextDecoder("utf-8", { fatal: true })
const HostProtocolEnvelopeJson = Schema.fromJsonString(HostProtocolEnvelopeSchema)
const encodeHostProtocolJson = Schema.encodeUnknownEffect(HostProtocolEnvelopeJson)
const decodeHostProtocolJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)

export const encodeHostProtocolFrame = (
  envelope: HostProtocolEnvelope,
  operation: string
): Effect.Effect<Uint8Array, HostProtocolError, never> =>
  Effect.gen(function* () {
    const decoded = yield* decodeHostProtocolFrameJson(envelope, operation)
    yield* validateHostProtocolJsonPayloads(decoded, operation)

    const encoded = yield* encodeHostProtocolJson(decoded).pipe(
      Effect.mapError((error) =>
        makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
      )
    )

    return TextEncoderUtf8.encode(encoded)
  })

export const parseHostProtocolFrameJson = (
  frame: Uint8Array,
  operation: string
): Effect.Effect<unknown, HostProtocolError, never> =>
  Effect.gen(function* () {
    const text = yield* Effect.try({
      try: () => TextDecoderUtf8.decode(frame),
      catch: (error) => makeHostProtocolBinaryDecodeError(formatUnknownError(error), operation)
    })

    return yield* decodeHostProtocolJson(text).pipe(
      Effect.mapError((error) =>
        makeHostProtocolBinaryDecodeError(formatUnknownError(error), operation)
      )
    )
  })

export const decodeHostProtocolFrameJson = (
  value: unknown,
  operation: string
): Effect.Effect<HostProtocolEnvelope, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeHostProtocolEnvelope(value),
    catch: (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  })

export const decodeHostProtocolFrame = (
  frame: Uint8Array,
  operation: string
): Effect.Effect<HostProtocolEnvelope, HostProtocolError, never> =>
  parseHostProtocolFrameJson(frame, operation).pipe(
    Effect.flatMap((value) => decodeHostProtocolFrameJson(value, operation))
  )

const validateHostProtocolJsonPayloads = (
  envelope: HostProtocolEnvelope,
  operation: string
): Effect.Effect<void, HostProtocolError, never> => {
  if (!("payload" in envelope) || !Object.hasOwn(envelope, "payload")) {
    return Effect.void
  }

  return isJsonValue(envelope.payload)
    ? Effect.void
    : Effect.fail(
        makeHostProtocolInvalidOutputError(
          operation,
          `${operation} payload is not JSON-serializable`
        )
      )
}

const isJsonValue = (value: unknown, seen = new Set<object>(), allowUndefined = false): boolean => {
  if (value === undefined) {
    return allowUndefined
  }
  if (value === null) {
    return true
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return true
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
  }
  if (typeof value !== "object") {
    return false
  }
  if (seen.has(value)) {
    return false
  }

  if (Array.isArray(value)) {
    seen.add(value)
    const serializable = value.every((item) => isJsonValue(item, seen))
    seen.delete(value)
    return serializable
  }

  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false
  }
  if ("toJSON" in value && typeof value.toJSON === "function") {
    return false
  }

  seen.add(value)
  const serializable = Object.values(value).every((item) => isJsonValue(item, seen, true))
  seen.delete(value)
  return serializable
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
