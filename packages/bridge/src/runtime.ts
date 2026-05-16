import { Effect, Stream, SubscriptionRef } from "effect"

import type { BridgeClientResponse } from "./client.js"
import type { BridgeInspector } from "./inspector.js"
import type {
  HostProtocolCancelByRequestEnvelope,
  HostProtocolError,
  HostProtocolRequestEnvelope
} from "./protocol.js"
import { makeHostProtocolOriginInvalidError } from "./protocol.js"
import type { RedactionFilterOptions } from "./redaction.js"

const DEFAULT_CALL_REGISTRY_ENTRIES = 1_024

export interface BridgeHandlerRuntime<Env = never> {
  readonly dispatch: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<BridgeClientResponse, HostProtocolError, Env>
  readonly cancel: (
    request: HostProtocolCancelByRequestEnvelope
  ) => Effect.Effect<void, HostProtocolError, never>
}

export type BridgeCallTerminalState = "Completed" | "Failed" | "Canceled" | "TimedOut"

export type BridgeCallState =
  | {
      readonly tag: "Pending"
      readonly id: string
      readonly traceId: string
      readonly startedAt: number
    }
  | { readonly tag: "Authorized"; readonly id: string; readonly capability: string }
  | { readonly tag: "Running"; readonly id: string; readonly handler: string }
  | { readonly tag: "Completed"; readonly id: string; readonly completedAt: number }
  | { readonly tag: "Failed"; readonly id: string; readonly error: unknown }
  | {
      readonly tag: "Canceled"
      readonly id: string
      readonly canceledBy: "renderer" | "runtime" | "host"
    }
  | { readonly tag: "TimedOut"; readonly id: string; readonly timeoutMs: number }
  | {
      readonly tag: "RejectedLateFrame"
      readonly id: string
      readonly method: string
      readonly terminalState: BridgeCallTerminalState
    }

export interface BridgeCallRegistry {
  readonly record: (state: BridgeCallState) => Effect.Effect<void, never, never>
  readonly list: () => Effect.Effect<readonly BridgeCallState[], never, never>
  readonly observe: () => Stream.Stream<readonly BridgeCallState[], never, never>
}

export const makeBridgeCallRegistry = (
  maxEntries = DEFAULT_CALL_REGISTRY_ENTRIES
): Effect.Effect<BridgeCallRegistry, never, never> =>
  Effect.gen(function* () {
    const states = yield* SubscriptionRef.make<readonly BridgeCallState[]>([])

    return Object.freeze({
      record: (state) =>
        SubscriptionRef.update(states, (current) => [...current, state].slice(-maxEntries)),
      list: () => SubscriptionRef.get(states),
      observe: () => SubscriptionRef.changes(states)
    } satisfies BridgeCallRegistry)
  })

export interface BridgeHandlerRuntimeOptions {
  readonly now?: () => number
  readonly onState?: (state: BridgeCallState) => Effect.Effect<void, never, never>
  readonly originAuth?: RendererOriginAuth
  readonly redaction?: RedactionFilterOptions
  readonly terminalStateTtlMs?: number
  readonly inspector?: BridgeInspector
}

export interface RendererOriginAuth {
  readonly verify: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<void, HostProtocolError, never>
}

export const RendererOriginAuth = {
  fromCurrentTokens: (tokens: ReadonlyMap<string, string>): RendererOriginAuth =>
    Object.freeze({
      verify: (request: HostProtocolRequestEnvelope) => verifyRendererOrigin(tokens, request)
    }),
  unsafeDisabledForTests: Object.freeze({
    verify: () => Effect.void
  }) satisfies RendererOriginAuth
} as const

const verifyRendererOrigin = (
  tokens: ReadonlyMap<string, string>,
  request: HostProtocolRequestEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    if (request.windowId === undefined || request.originToken === undefined) {
      return yield* Effect.fail(
        makeHostProtocolOriginInvalidError(
          request.method,
          "renderer request is missing windowId or originToken"
        )
      )
    }

    const expected = tokens.get(request.windowId)
    if (expected === undefined || expected !== request.originToken) {
      return yield* Effect.fail(
        makeHostProtocolOriginInvalidError(request.method, "renderer origin token did not match")
      )
    }
  })
