import {
  type BridgeCallRegistry,
  type BridgeCallState,
  type BridgeStreamRegistry,
  type BridgeStreamRegistryEntry,
  PermissionRegistry,
  type PermissionDecision,
  Process,
  type ProcessExitStatus,
  type ProcessSnapshot,
  redact,
  ResourceRegistry,
  type ResourceEntry
} from "@effect-desktop/core"
import { Context, Effect, Layer, Match, Option, Stream } from "effect"

import { positiveFrameInterval, positiveRowLimit } from "./panel-options.js"

export interface BridgeCallPanelRow {
  readonly id: string
  readonly state: BridgeCallState["tag"]
  readonly traceId: Option.Option<string>
  readonly contractTag: Option.Option<string>
  readonly latencyMs: Option.Option<number>
  readonly errorTag: Option.Option<string>
}

export interface StreamPanelRow {
  readonly id: string
  readonly generation: number
  readonly state: BridgeStreamRegistryEntry["state"]
  readonly terminal: Option.Option<string>
  readonly queueDepth: Option.Option<number>
  readonly queueCapacity: Option.Option<number>
  readonly overflow: Option.Option<string>
}

export interface ResourcePanelRow {
  readonly id: string
  readonly kind: string
  readonly scope: string
  readonly state: string
  readonly ageMs: number
  readonly stale: boolean
  readonly owner: Option.Option<string>
}

export interface PermissionPanelRow {
  readonly capability: string
  readonly decision: PermissionDecision["outcome"]
  readonly reason: Option.Option<string>
  readonly remediation: Option.Option<string>
  readonly actor: string
  readonly traceId: string
}

export interface ProcessPanelRow {
  readonly pid: number
  readonly command: string
  readonly ownerScope: string
  readonly childPids: readonly number[]
  readonly lastExit: Option.Option<ProcessExitStatus>
  readonly state: ProcessSnapshot["state"]
}

export interface LiveRuntimePanelsSnapshot {
  readonly bridgeCalls: readonly BridgeCallPanelRow[]
  readonly streams: readonly StreamPanelRow[]
  readonly resources: readonly ResourcePanelRow[]
  readonly permissions: readonly PermissionPanelRow[]
  readonly processes: readonly ProcessPanelRow[]
}

export interface LiveRuntimePanelsApi {
  readonly list: () => Effect.Effect<LiveRuntimePanelsSnapshot, never, never>
  readonly observe: () => Stream.Stream<LiveRuntimePanelsSnapshot, never, never>
}

export interface LiveRuntimePanelSources {
  readonly bridgeCalls: BridgeCallRegistry
  readonly streams: BridgeStreamRegistry
}

export interface LiveRuntimePanelsOptions {
  readonly maxRows?: number
  readonly now?: () => number
  readonly frameInterval?: `${number} millis`
}

export class LiveRuntimePanels extends Context.Service<LiveRuntimePanels, LiveRuntimePanelsApi>()(
  "@effect-desktop/devtools/LiveRuntimePanels"
) {}

export const LiveRuntimePanelsLive = (
  sources: LiveRuntimePanelSources,
  options: LiveRuntimePanelsOptions = {}
): Layer.Layer<LiveRuntimePanels, never, PermissionRegistry | Process | ResourceRegistry> =>
  Layer.effect(LiveRuntimePanels)(makeLiveRuntimePanels(sources, options))

export const makeLiveRuntimePanels = (
  sources: LiveRuntimePanelSources,
  options: LiveRuntimePanelsOptions = {}
): Effect.Effect<LiveRuntimePanelsApi, never, PermissionRegistry | Process | ResourceRegistry> =>
  Effect.gen(function* () {
    const permissions = yield* PermissionRegistry
    const processes = yield* Process
    const resources = yield* ResourceRegistry
    const maxRows = positiveRowLimit(options.maxRows, 256)
    const now = options.now ?? Date.now
    const frameInterval = positiveFrameInterval(options.frameInterval, "16 millis")

    const list = (): Effect.Effect<LiveRuntimePanelsSnapshot, never, never> =>
      Effect.gen(function* () {
        const bridgeCalls = yield* sources.bridgeCalls.list()
        const streams = yield* sources.streams.snapshot()
        const resourceSnapshot = yield* resources.list()
        const permissionRows = yield* permissions.listDecisions()
        const processRows = yield* processes.list()

        return redact({
          bridgeCalls: toBridgeCallRows(bridgeCalls, maxRows),
          streams: streams.slice(-maxRows).map(toStreamRow),
          resources: resourceSnapshot.entries
            .slice(-maxRows)
            .map((entry) => toResourceRow(entry, now())),
          permissions: permissionRows.slice(-maxRows).map(toPermissionRow),
          processes: processRows.slice(-maxRows).map(toProcessRow)
        })
      })

    return Object.freeze({
      list,
      observe: () =>
        Stream.fromEffect(list()).pipe(
          Stream.concat(
            Stream.fromEffectRepeat(Effect.sleep(frameInterval).pipe(Effect.andThen(list())))
          )
        )
    } satisfies LiveRuntimePanelsApi)
  })

interface BridgeCallProjection {
  readonly id: string
  readonly state: BridgeCallState["tag"]
  readonly traceId: Option.Option<string>
  readonly contractTag: Option.Option<string>
  readonly startedAt: Option.Option<number>
  readonly completedAt: Option.Option<number>
  readonly errorTag: Option.Option<string>
}

const toBridgeCallRows = (
  states: readonly BridgeCallState[],
  maxRows: number
): readonly BridgeCallPanelRow[] => {
  const projections = new Map<string, BridgeCallProjection>()

  for (const state of states) {
    const current = projections.get(state.id) ?? emptyBridgeProjection(state.id, state.tag)
    projections.set(state.id, applyBridgeState(current, state))
  }

  return Array.from(projections.values())
    .slice(-maxRows)
    .map((projection) => ({
      id: projection.id,
      state: projection.state,
      traceId: projection.traceId,
      contractTag: projection.contractTag,
      latencyMs: bridgeLatency(projection),
      errorTag: projection.errorTag
    }))
}

const applyBridgeState = (
  current: BridgeCallProjection,
  state: BridgeCallState
): BridgeCallProjection =>
  Match.value(state).pipe(
    Match.when({ tag: "Pending" }, (s) => ({
      ...current,
      state: s.tag,
      traceId: Option.some(s.traceId),
      startedAt: Option.some(s.startedAt)
    })),
    Match.when({ tag: "Authorized" }, (s) => ({ ...current, state: s.tag })),
    Match.when({ tag: "Running" }, (s) => ({
      ...current,
      state: s.tag,
      contractTag: Option.some(contractTagFromMethod(s.handler))
    })),
    Match.when({ tag: "Completed" }, (s) => ({
      ...current,
      state: s.tag,
      completedAt: Option.some(s.completedAt)
    })),
    Match.when({ tag: "Failed" }, (s) => ({
      ...current,
      state: s.tag,
      errorTag: Option.some(errorTag(s.error))
    })),
    Match.when({ tag: "Canceled" }, (s) => ({ ...current, state: s.tag })),
    Match.when({ tag: "TimedOut" }, (s) => ({ ...current, state: s.tag })),
    Match.when({ tag: "RejectedLateFrame" }, (s) => ({
      ...current,
      state: s.tag,
      contractTag: Option.some(contractTagFromMethod(s.method))
    })),
    Match.exhaustive
  )

const emptyBridgeProjection = (
  id: string,
  state: BridgeCallState["tag"]
): BridgeCallProjection => ({
  id,
  state,
  traceId: Option.none(),
  contractTag: Option.none(),
  startedAt: Option.none(),
  completedAt: Option.none(),
  errorTag: Option.none()
})

const bridgeLatency = (projection: BridgeCallProjection): Option.Option<number> => {
  if (Option.isNone(projection.startedAt) || Option.isNone(projection.completedAt)) {
    return Option.none()
  }

  return Option.some(Math.max(0, projection.completedAt.value - projection.startedAt.value))
}

const toStreamRow = (entry: BridgeStreamRegistryEntry): StreamPanelRow => ({
  id: entry.streamId,
  generation: entry.generation,
  state: entry.state,
  terminal: entry.terminal === undefined ? Option.none() : Option.some(entry.terminal),
  queueDepth:
    entry.backpressure === undefined ? Option.none() : Option.some(entry.backpressure.queueDepth),
  queueCapacity:
    entry.backpressure === undefined
      ? Option.none()
      : Option.some(entry.backpressure.queueCapacity),
  overflow:
    entry.backpressure === undefined ? Option.none() : Option.some(entry.backpressure.overflow)
})

const toResourceRow = (entry: ResourceEntry, now: number): ResourcePanelRow => ({
  id: entry.handle.id,
  kind: entry.handle.kind,
  scope: entry.handle.ownerScope,
  state: entry.handle.state,
  ageMs: Math.max(0, now - entry.createdAt),
  stale: false,
  owner: Option.some(entry.handle.ownerScope)
})

const toPermissionRow = (decision: PermissionDecision): PermissionPanelRow => ({
  capability: decision.capability.kind,
  decision: decision.outcome,
  reason: decision.reason === undefined ? Option.none() : Option.some(decision.reason),
  remediation:
    decision.outcome === "denied" ? Option.some(remediationFor(decision)) : Option.none(),
  actor: `${decision.actor.kind}:${decision.actor.id}`,
  traceId: decision.traceId
})

const toProcessRow = (snapshot: ProcessSnapshot): ProcessPanelRow => ({
  pid: snapshot.pid,
  command: snapshot.command,
  ownerScope: snapshot.ownerScope,
  childPids: snapshot.childPids,
  lastExit: snapshot.lastExit,
  state: snapshot.state
})

const contractTagFromMethod = (method: string): string => method.split(".")[0] ?? method

const errorTag = (error: unknown): string =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : "Unknown"

const remediationFor = (decision: PermissionDecision): string =>
  `Declare or approve ${decision.capability.kind} for ${decision.actor.kind}:${decision.actor.id}.`
