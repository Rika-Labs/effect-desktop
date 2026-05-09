import { Config, Effect, Layer, Logger, Option, References } from "effect"

import { DesktopEnvConfig } from "./desktop-env-config.js"

const logLevelLayer: Layer.Layer<never, Config.ConfigError, never> = Layer.effect(
  References.MinimumLogLevel
)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvConfig
    return Option.getOrElse(env.logLevel, () => "Info" as const)
  })
)

export const DesktopLoggerLayer: Layer.Layer<never, Config.ConfigError, never> = Layer.merge(
  Logger.layer([Logger.consolePretty()]),
  logLevelLayer
)
