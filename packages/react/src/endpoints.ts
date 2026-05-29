import { isDesktopStreamOptions, type FrameworkRuntime } from "@orika/core/runtime/renderer-stream"
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

const ENDPOINT_INPUT_UNKEYABLE = "@orika/react/endpoints/unkeyable-input"

const endpointInputReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Map) {
    return { __orikaMap: Array.from(value.entries()) }
  }
  if (value instanceof Set) {
    return { __orikaSet: Array.from(value.values()) }
  }
  if (typeof value === "bigint") {
    return { __orikaBigInt: value.toString() }
  }
  return value
}

export const stableEndpointInputDependency = (input: unknown): unknown => {
  if (input === null || typeof input !== "object") {
    return input
  }

  try {
    return JSON.stringify(input, endpointInputReplacer)
  } catch {
    return ENDPOINT_INPUT_UNKEYABLE
  }
}

export const query = <R, ER, I, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  makeEffect: (input: I) => Effect.Effect<A, E, R>
): QueryEndpoint<I, A, E | ER> =>
  Object.freeze({
    useQuery: ((input?: I) => {
      const inputDependency = stableEndpointInputDependency(input)
      const effect = useMemo(() => makeEffect(input as I), [inputDependency, makeEffect])
      return useEffectResult(effect, undefined, runtime)
    }) as QueryHook<I, A, E>
  })

export const mutation = <R, ER, I, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  makeEffect: (input: I) => Effect.Effect<A, E, R>
): MutationEndpoint<I, A, E | ER> =>
  Object.freeze({
    useMutation: () => useMutation<I, A, E, R, ER>(makeEffect, runtime)
  })

export const stream = <R, ER, I, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  makeStream: (input: I) => Stream.Stream<A, E, R>,
  options: { readonly hasInput?: boolean | undefined } = {}
): StreamEndpoint<I, A, E | ER> =>
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
      const inputDependency = stableEndpointInputDependency(input)
      const effectStream = useMemo(() => makeStream(input as I), [inputDependency, makeStream])
      return useDesktopStream(effectStream, resolvedOptions, runtime)
    }) as StreamHook<I, A, E>
  })
