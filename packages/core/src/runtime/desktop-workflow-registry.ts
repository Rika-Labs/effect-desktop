import { Context, Effect, Layer } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"

export type DesktopWorkflowRegistration<E = unknown, R = unknown> = Layer.Layer<
  never,
  E,
  R | WorkflowEngine.WorkflowEngine
>

export type AnyDesktopWorkflowRegistration = DesktopWorkflowRegistration<unknown, unknown>

export interface DesktopWorkflowRegistryApi {
  readonly register: (workflow: AnyDesktopWorkflowRegistration) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<ReadonlyArray<AnyDesktopWorkflowRegistration>>
}

export class DesktopWorkflowRegistry extends Context.Service<
  DesktopWorkflowRegistry,
  DesktopWorkflowRegistryApi
>()("@effect-desktop/core/DesktopWorkflowRegistry") {}

export const makeDesktopWorkflowRegistry = (): DesktopWorkflowRegistryApi => {
  const entries: AnyDesktopWorkflowRegistration[] = []
  return {
    register: (workflow) =>
      Effect.sync(() => {
        entries.push(workflow)
      }),
    snapshot: Effect.sync(() => Object.freeze([...entries]))
  }
}

export const DesktopWorkflowRegistryLive: Layer.Layer<DesktopWorkflowRegistry> = Layer.effect(
  DesktopWorkflowRegistry,
  Effect.sync(makeDesktopWorkflowRegistry)
)
