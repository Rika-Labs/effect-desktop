import { expect, test } from "bun:test"

import {
  DesktopDurations,
  DesktopScheduleLimits,
  DesktopSchedules,
  DesktopTimeouts
} from "./desktop-schedules.js"

test("DesktopSchedules exposes named retry policies", () => {
  expect(DesktopSchedules.hostReconnect).toBeDefined()
  expect(DesktopSchedules.releaseToolProbe).toBeDefined()
  expect(DesktopSchedules.crashReportSubmission).toBeDefined()
  expect(DesktopSchedules.updateBundleDownload).toBeDefined()
})

test("DesktopScheduleLimits names retry caps used by schedules", () => {
  expect(DesktopScheduleLimits.releaseToolProbeRetries).toBe(2)
  expect(DesktopScheduleLimits.crashReportSubmissionRetries).toBe(10)
  expect(DesktopScheduleLimits.updateBundleDownloadRetries).toBe(5)
})

test("DesktopDurations names durable polling intervals", () => {
  expect(DesktopDurations.updateCheckPoll).toBe("7 days")
})

test("DesktopTimeouts names timeout defaults", () => {
  expect(DesktopTimeouts.docsExampleMillis).toBe(10_000)
})
