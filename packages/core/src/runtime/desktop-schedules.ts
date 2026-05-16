import { Effect, Schedule } from "effect"

export const DesktopScheduleLimits = {
  releaseToolProbeRetries: 2,
  crashReportSubmissionRetries: 10,
  updateBundleDownloadRetries: 5
} as const

export const DesktopSchedules = {
  hostReconnect: Schedule.exponential("100 millis").pipe(Schedule.jittered),
  releaseToolProbe: Schedule.recurs(DesktopScheduleLimits.releaseToolProbeRetries).pipe(
    Schedule.addDelay(() => Effect.succeed("500 millis"))
  ),
  crashReportSubmission: Schedule.exponential("1 second").pipe(
    Schedule.jittered,
    Schedule.both(Schedule.recurs(DesktopScheduleLimits.crashReportSubmissionRetries))
  ),
  updateBundleDownload: Schedule.exponential("500 millis").pipe(
    Schedule.jittered,
    Schedule.both(Schedule.recurs(DesktopScheduleLimits.updateBundleDownloadRetries))
  )
} as const

export const DesktopDurations = {
  updateCheckPoll: "7 days"
} as const

export const DesktopTimeouts = {
  docsExampleMillis: 10_000
} as const
