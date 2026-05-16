import { BunServices } from "@effect/platform-bun"
import { Config, Layer } from "effect"

import type { DesktopRuntimeProviderServices } from "../runtime/desktop-app.js"

export const BunRuntimeProviderLayer = BunServices.layer as Layer.Layer<
  DesktopRuntimeProviderServices,
  Config.ConfigError,
  never
>
