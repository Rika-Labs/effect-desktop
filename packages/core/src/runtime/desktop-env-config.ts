import { Config, type LogLevel, Option } from "effect"

export interface DesktopEnvConfig {
  readonly logLevel: Option.Option<LogLevel.LogLevel>
  readonly telemetryEndpoint: Option.Option<string>
}

export const DesktopEnvConfig: Config.Config<DesktopEnvConfig> = Config.all({
  logLevel: Config.option(Config.logLevel("EFFECT_DESKTOP_LOG_LEVEL")),
  telemetryEndpoint: Config.option(Config.string("EFFECT_DESKTOP_TELEMETRY_ENDPOINT"))
})
