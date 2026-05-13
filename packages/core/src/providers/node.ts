import { NodeServices } from "@effect/platform-node"
import { Config, Layer } from "effect"

import type { DesktopRuntimeProviderServices } from "../runtime/desktop-app.js"

export const NodeRuntimeProviderLayer = NodeServices.layer as Layer.Layer<
  DesktopRuntimeProviderServices,
  Config.ConfigError,
  never
>
