import { BunServices } from "@effect/platform-bun"
import type { Config, Layer } from "effect"

import type { DesktopRuntimeProviderServices } from "../runtime/desktop-app.js"

export const BunRuntimeProviderLayer: Layer.Layer<
  DesktopRuntimeProviderServices,
  Config.ConfigError,
  never
> = BunServices.layer
