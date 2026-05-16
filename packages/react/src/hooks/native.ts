import type { ScreenError, SystemAppearanceError, PowerMonitorError } from "@effect-desktop/native"
import type {
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSuspendEvent,
  ScreenDisplay,
  SystemAppearanceChangedEvent,
  SystemAppearanceMode
} from "@effect-desktop/native/contracts"
import { Effect, Stream } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"

import { type StreamState, useDesktopStream, useEffectResult } from "./stream.js"

export type ThemeState = StreamState<SystemAppearanceChangedEvent, SystemAppearanceError>

export const useTheme = (
  onAppearanceChanged: () => Stream.Stream<
    SystemAppearanceChangedEvent,
    SystemAppearanceError,
    never
  >
): ThemeState => useDesktopStream(onAppearanceChanged())

export type PowerEvent =
  | PowerMonitorSuspendEvent
  | PowerMonitorResumeEvent
  | PowerMonitorShutdownEvent
  | PowerMonitorSourceChangedEvent

export type PowerState = StreamState<PowerEvent, PowerMonitorError>

export const usePower = (streams: {
  readonly onSuspend: () => Stream.Stream<PowerMonitorSuspendEvent, PowerMonitorError, never>
  readonly onResume: () => Stream.Stream<PowerMonitorResumeEvent, PowerMonitorError, never>
  readonly onShutdown: () => Stream.Stream<PowerMonitorShutdownEvent, PowerMonitorError, never>
  readonly onPowerSourceChanged: () => Stream.Stream<
    PowerMonitorSourceChangedEvent,
    PowerMonitorError,
    never
  >
}): PowerState => {
  const asEvent = <T extends PowerEvent>(
    s: Stream.Stream<T, PowerMonitorError, never>
  ): Stream.Stream<PowerEvent, PowerMonitorError, never> =>
    s as Stream.Stream<PowerEvent, PowerMonitorError, never>
  return useDesktopStream(
    Stream.mergeAll(
      [
        asEvent(streams.onSuspend()),
        asEvent(streams.onResume()),
        asEvent(streams.onShutdown()),
        asEvent(streams.onPowerSourceChanged())
      ],
      { concurrency: 4 }
    )
  )
}

export const useDisplays = (
  getDisplays: () => Effect.Effect<ReadonlyArray<ScreenDisplay>, ScreenError, never>
): AsyncResult.AsyncResult<ReadonlyArray<ScreenDisplay>, ScreenError> =>
  useEffectResult(getDisplays())

export type DisplaysResult = AsyncResult.AsyncResult<ReadonlyArray<ScreenDisplay>, ScreenError>

export interface ThemeMode {
  readonly mode: SystemAppearanceMode
}

export const useThemeMode = (
  getAppearance: () => Effect.Effect<SystemAppearanceMode, SystemAppearanceError, never>
): AsyncResult.AsyncResult<SystemAppearanceMode, SystemAppearanceError> =>
  useEffectResult(getAppearance())
