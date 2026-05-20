import {
  type HostProtocolError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError
} from "@orika/bridge"
import { Effect, Schema } from "effect"

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
    Effect.mapError((error) =>
      isHostProtocolError(error)
        ? error
        : makeHostProtocolInternalError(`${surface} RPC client failed`, surface)
    ),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

export const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const isHostProtocolError = (error: unknown): error is HostProtocolError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error
