import { Layer } from "effect"
import {
  Activity,
  DurableClock,
  DurableDeferred,
  Workflow,
  WorkflowEngine
} from "effect/unstable/workflow"

export { Activity, DurableClock, DurableDeferred, Workflow, WorkflowEngine }

export type WorkflowLayer = Layer.Layer<never, never, WorkflowEngine.WorkflowEngine>

export const WorkflowEngineLive: Layer.Layer<WorkflowEngine.WorkflowEngine, never, never> =
  WorkflowEngine.layerMemory
