import { Layer } from "effect"
import {
  Activity,
  DurableClock,
  DurableDeferred,
  Workflow,
  WorkflowEngine
} from "effect/unstable/workflow"

export { Activity, DurableClock, DurableDeferred, Workflow, WorkflowEngine }

export type WorkflowLayer<RIn = never, E = never> = Layer.Layer<
  never,
  E,
  RIn | WorkflowEngine.WorkflowEngine
>

export const WorkflowEngineLive: Layer.Layer<WorkflowEngine.WorkflowEngine, never, never> =
  WorkflowEngine.layerMemory
