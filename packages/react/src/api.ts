import { Effect, Stream } from "effect"
import type { AsyncResult } from "effect/unstable/reactivity"
import { useMemo } from "react"

import { useStream as useEffectStream, useEffectResult, type StreamState } from "./hooks/stream.js"
import { useMutation, type MutationResult } from "./mutation.js"

export type QueryResult<A, E> = AsyncResult.AsyncResult<A, E>

export type QueryHook<I, A, E> = [I] extends [void]
  ? () => QueryResult<A, E>
  : undefined extends I
    ? (input?: I) => QueryResult<A, E>
    : (input: I) => QueryResult<A, E>

export type StreamHook<I, A, E> = [I] extends [void]
  ? () => StreamState<A, E>
  : undefined extends I
    ? (input?: I) => StreamState<A, E>
    : (input: I) => StreamState<A, E>

export interface QueryEndpoint<I, A, E> {
  readonly useQuery: QueryHook<I, A, E>
}

export interface MutationEndpoint<I, A, E> {
  readonly useMutation: () => MutationResult<I, A, E>
}

export interface StreamEndpoint<I, A, E> {
  readonly useStream: StreamHook<I, A, E>
}

export type ReactApiEndpoint =
  | QueryEndpoint<unknown, unknown, unknown>
  | MutationEndpoint<unknown, unknown, unknown>
  | StreamEndpoint<unknown, unknown, unknown>

export const defineApi = <const Api extends Readonly<Record<string, unknown>>>(api: Api): Api =>
  Object.freeze({ ...api }) as Api

export const query = <I, A, E>(
  makeEffect: (input: I) => Effect.Effect<A, E, never>
): QueryEndpoint<I, A, E> =>
  Object.freeze({
    useQuery: ((input?: I) => {
      const effect = useMemo(() => makeEffect(input as I), [input])
      return useEffectResult(effect)
    }) as QueryHook<I, A, E>
  })

export const mutation = <I, A, E>(
  makeEffect: (input: I) => Effect.Effect<A, E, never>
): MutationEndpoint<I, A, E> =>
  Object.freeze({
    useMutation: () => useMutation(makeEffect)
  })

export const stream = <I, A, E>(
  makeStream: (input: I) => Stream.Stream<A, E, never>
): StreamEndpoint<I, A, E> =>
  Object.freeze({
    useStream: ((input?: I) => {
      const effectStream = useMemo(() => makeStream(input as I), [input])
      return useEffectStream(effectStream)
    }) as StreamHook<I, A, E>
  })
