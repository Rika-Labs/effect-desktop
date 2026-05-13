import { isDesktopStreamOptions } from "@effect-desktop/core/renderer"
import { Effect, Stream } from "effect"
import type { AsyncResult } from "effect/unstable/reactivity"
import { useMemo } from "react"

import {
  useDesktopStream,
  useEffectResult,
  type DesktopStreamOptions,
  type StreamState
} from "./hooks/stream.js"
import { useMutation, type MutationResult } from "./mutation.js"

export type QueryResult<A, E> = AsyncResult.AsyncResult<A, E>

export type QueryHook<I, A, E> = [I] extends [void]
  ? () => QueryResult<A, E>
  : undefined extends I
    ? (input?: I) => QueryResult<A, E>
    : (input: I) => QueryResult<A, E>

export type StreamHook<I, A, E> = [I] extends [void]
  ? (options?: DesktopStreamOptions<A>) => StreamState<A, E>
  : undefined extends I
    ? (input?: I, options?: DesktopStreamOptions<A>) => StreamState<A, E>
    : (input: I, options?: DesktopStreamOptions<A>) => StreamState<A, E>

export interface QueryEndpoint<I, A, E> {
  readonly useQuery: QueryHook<I, A, E>
}

export interface MutationEndpoint<I, A, E> {
  readonly useMutation: () => MutationResult<I, A, E>
}

export interface StreamEndpoint<I, A, E> {
  readonly useStream: StreamHook<I, A, E>
}

export type ReactEndpoint =
  | QueryEndpoint<unknown, unknown, unknown>
  | MutationEndpoint<unknown, unknown, unknown>
  | StreamEndpoint<unknown, unknown, unknown>

export const query = <I, A, E>(
  makeEffect: (input: I) => Effect.Effect<A, E, never>
): QueryEndpoint<I, A, E> =>
  Object.freeze({
    useQuery: ((input?: I) => {
      const effect = useMemo(() => makeEffect(input as I), [input, makeEffect])
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
  makeStream: (input: I) => Stream.Stream<A, E, never>,
  options: { readonly hasInput?: boolean | undefined } = {}
): StreamEndpoint<I, A, E> =>
  Object.freeze({
    useStream: ((
      inputOrOptions?: I | DesktopStreamOptions<A>,
      streamOptions?: DesktopStreamOptions<A>
    ) => {
      const hasInput = options.hasInput ?? true
      const input = hasInput ? inputOrOptions : undefined
      const resolvedOptions = hasInput
        ? streamOptions
        : isDesktopStreamOptions(inputOrOptions)
          ? inputOrOptions
          : streamOptions
      const effectStream = useMemo(() => makeStream(input as I), [input, makeStream])
      return useDesktopStream(effectStream, resolvedOptions)
    }) as StreamHook<I, A, E>
  })
