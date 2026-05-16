import {
  type BridgeClientExchange,
  type HostProtocolError,
  type HostProtocolEventEnvelope,
  makeHostProtocolInvalidOutputError
} from "@effect-desktop/bridge"
import { Effect, Schema, type SchemaAST, Stream } from "effect"

const SubscriptionUnsupportedMessage = "event exchange does not support subscriptions"

export const subscribeNativeEvent = <A>(
  exchange: BridgeClientExchange | undefined,
  method: string,
  schema: Schema.Codec<A, unknown, never, never>,
  parseOptions?: SchemaAST.ParseOptions
): Stream.Stream<A, HostProtocolError, never> => {
  if (exchange?.subscribe === undefined) {
    return Stream.fail(makeHostProtocolInvalidOutputError(method, SubscriptionUnsupportedMessage))
  }

  return exchange
    .subscribe(method)
    .pipe(
      Stream.mapEffect((envelope) =>
        decodeNativeEventEnvelope(method, schema, envelope, parseOptions)
      )
    )
}

const decodeNativeEventEnvelope = <A>(
  operation: string,
  schema: Schema.Codec<A, unknown, never, never>,
  envelope: HostProtocolEventEnvelope,
  parseOptions?: SchemaAST.ParseOptions
): Effect.Effect<A, HostProtocolError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Schema.decodeUnknownEffect(schema)(envelope.payload, parseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
