import {
  type HostProtocolError,
  hostProtocolErrorFromRpcClientError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError
} from "@orika/bridge"
import { Effect, Schema, Stream } from "effect"

export const StrictNativeParseOptions = { onExcessProperty: "error" } as const

export const decodeNativeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictNativeParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

export const runNativeRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string,
  surface: string
): Effect.Effect<A, HostProtocolError, never> =>
  effect.pipe(
    Effect.mapError((error) => mapNativeRpcClientError(error, surface)),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

export const runNativeRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  _operation: string,
  surface: string
): Stream.Stream<A, HostProtocolError, never> =>
  stream.pipe(Stream.mapError((error) => mapNativeRpcClientError(error, surface)))

export const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const mapNativeRpcClientError = (error: unknown, surface: string): HostProtocolError =>
  isHostProtocolError(error)
    ? error
    : (hostProtocolErrorFromRpcClientError(error) ??
      makeHostProtocolInternalError(`${surface} RPC client failed`, surface))

const isHostProtocolError = (error: unknown): error is HostProtocolError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error
