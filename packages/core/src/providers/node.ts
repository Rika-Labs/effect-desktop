import { NodeServices } from "@effect/platform-node"
import type { Config, Layer } from "effect"

import type { DesktopRuntimeProviderServices } from "../runtime/desktop-app.js"

export const NodeRuntimeProviderLayer: Layer.Layer<
  DesktopRuntimeProviderServices,
  Config.ConfigError,
  never
> = NodeServices.layer
