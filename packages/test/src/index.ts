import { afterEach, expect } from "bun:test"
import { Data, Effect } from "effect"

import {
  ResourceRegistry,
  type RegistrySnapshot,
  type ResourceEntry,
  type ResourceRegistryApi,
  type ScopeId
} from "@effect-desktop/core"

export interface LeakDetectionOptions {
  readonly allowedOwnerScopes?: readonly ScopeId[]
  readonly testName?: string
}

export class ResourceLeakError extends Data.TaggedError("ResourceLeakError")<{
  readonly leaks: readonly ResourceEntry[]
  readonly message: string
  readonly report: string
}> {}

export const assertNoOpenResources = (
  options: LeakDetectionOptions = {}
): Effect.Effect<void, ResourceLeakError, ResourceRegistry> =>
  Effect.gen(function* () {
    const registry = yield* Effect.service(ResourceRegistry)
    const snapshot = yield* registry.list()
    const leaks = leakedHandles(snapshot, options)

    if (leaks.length > 0) {
      const report = formatLeakedHandleReport(leaks, options.testName)

      return yield* Effect.fail(
        new ResourceLeakError({
          leaks,
          message: report,
          report
        })
      )
    }
  })

export const assertNoOpenResourcesIn = (
  registry: ResourceRegistryApi,
  options: LeakDetectionOptions = {}
): Effect.Effect<void, ResourceLeakError, never> =>
  Effect.gen(function* () {
    const snapshot = yield* registry.list()
    const leaks = leakedHandles(snapshot, options)

    if (leaks.length > 0) {
      const report = formatLeakedHandleReport(leaks, options.testName)

      return yield* Effect.fail(
        new ResourceLeakError({
          leaks,
          message: report,
          report
        })
      )
    }
  })

export const installResourceLeakDetection = (
  registry: ResourceRegistryApi,
  options: LeakDetectionOptions = {}
): void => {
  registerLeakMatchers()
  afterEach(async () => {
    await Effect.runPromise(assertNoOpenResourcesIn(registry, options))
  })
}

export const leakedHandles = (
  snapshot: RegistrySnapshot,
  options: LeakDetectionOptions = {}
): readonly ResourceEntry[] => {
  const allowedScopes = new Set<ScopeId>(options.allowedOwnerScopes ?? DEFAULT_ALLOWED_OWNER_SCOPES)

  return snapshot.entries.filter(
    (entry) => entry.handle.kind !== APP_HANDLE_KIND && !allowedScopes.has(entry.handle.ownerScope)
  )
}

export const formatLeakedHandleReport = (
  leaks: readonly ResourceEntry[],
  testName?: string
): string => {
  if (leaks.length === 0) {
    return "No leaked resource handles."
  }

  const header =
    testName === undefined
      ? `Leaked resource handles (${leaks.length})`
      : `Leaked resource handles (${leaks.length}) in ${testName}`
  const rows = leaks.map((entry) => {
    const { handle } = entry

    return [
      `- kind: ${handle.kind}`,
      `  id: ${handle.id}`,
      `  generation: ${handle.generation}`,
      `  ownerScope: ${handle.ownerScope}`,
      `  createdAt: ${entry.createdAt}`
    ].join("\n")
  })

  return [header, ...rows].join("\n")
}

export const registerLeakMatchers = (): void => {
  if (matchersRegistered) {
    return
  }

  expect.extend({
    toHaveNoLeakedHandles(actual: unknown, options?: LeakDetectionOptions) {
      if (!isRegistrySnapshot(actual)) {
        throw new TypeError("toHaveNoLeakedHandles expects a ResourceRegistry snapshot")
      }

      const leaks = leakedHandles(actual, options)
      const pass = leaks.length === 0

      return {
        pass,
        message: () =>
          pass
            ? "Expected resource snapshot to contain leaked handles."
            : formatLeakedHandleReport(leaks, options?.testName)
      }
    }
  })
  matchersRegistered = true
}

declare module "bun:test" {
  interface Matchers<T> {
    toHaveNoLeakedHandles(options?: LeakDetectionOptions): void
  }
}

let matchersRegistered = false

const APP_HANDLE_KIND = "app"
const DEFAULT_ALLOWED_OWNER_SCOPES = ["app"] as const satisfies readonly ScopeId[]

const isRegistrySnapshot = (value: unknown): value is RegistrySnapshot => {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries)
  )
}
