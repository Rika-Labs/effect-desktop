import { expect, test } from "bun:test"

import type { RendererResumePayload, ResumeTicket } from "@effect-desktop/bridge"

import { evaluateRendererResume } from "./reconnect.js"

const ticket = {
  windowId: "window-1",
  originTokenHash: "sha256:origin",
  resumeNonce: "resume-1",
  expiresAt: 1_000,
  lastStreamCursors: {
    "stream-1": "42"
  }
} satisfies ResumeTicket

const resume = {
  windowId: "window-1",
  resumeNonce: "resume-1",
  cursors: {
    "stream-1": "42"
  }
} satisfies RendererResumePayload

test("accepts a renderer resume inside the reconnect window", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume,
      now: 999,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: {
        "stream-1": 1
      }
    })
  ).toEqual({
    _tag: "Accepted",
    windowId: "window-1",
    replayedStreamIds: ["stream-1"]
  })
})

test("denies an expired renderer resume", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume,
      now: 1_001,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: {
        "stream-1": 1
      }
    })
  ).toEqual({
    _tag: "Denied",
    windowId: "window-1",
    reason: "expired",
    errorTag: "RendererDisconnected",
    message: "resume ticket expired"
  })
})

test("denies a resume for another window", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume: {
        ...resume,
        windowId: "window-2"
      },
      now: 999,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: {
        "stream-1": 1
      }
    })
  ).toEqual({
    _tag: "Denied",
    windowId: "window-2",
    reason: "windowMismatch",
    errorTag: "RendererDisconnected",
    message: "resume ticket belongs to another window"
  })
})

test("denies a resume with mismatched origin identity", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume,
      now: 999,
      originTokenHash: "sha256:other",
      availableBackfillEventsByStream: {
        "stream-1": 1
      }
    })
  ).toEqual({
    _tag: "Denied",
    windowId: "window-1",
    reason: "originInvalid",
    errorTag: "OriginInvalid",
    message: "resume ticket did not match origin"
  })
})

test("denies a resume with mismatched nonce", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume: {
        ...resume,
        resumeNonce: "resume-2"
      },
      now: 999,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: {
        "stream-1": 1
      }
    })
  ).toEqual({
    _tag: "Denied",
    windowId: "window-1",
    reason: "originInvalid",
    errorTag: "OriginInvalid",
    message: "resume ticket did not match origin"
  })
})

test("denies a resume when stream backfill is exhausted", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume,
      now: 999,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: {
        "stream-1": 1_025
      },
      maxBackfillEvents: 1_024
    })
  ).toEqual({
    _tag: "Denied",
    windowId: "window-1",
    reason: "backfillExhausted",
    errorTag: "ReconnectBackfillExhausted",
    message: "reconnect backfill exhausted"
  })
})

test("denies a resume when a cursor does not match the ticket snapshot", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume: {
        ...resume,
        cursors: {
          "stream-1": "41"
        }
      },
      now: 999,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: {
        "stream-1": 1
      }
    })
  ).toEqual({
    _tag: "Denied",
    windowId: "window-1",
    reason: "backfillExhausted",
    errorTag: "ReconnectBackfillExhausted",
    message: "reconnect cursor was not resumable"
  })
})

test("denies a resume when a requested stream was not in the ticket snapshot", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume: {
        ...resume,
        cursors: {
          "stream-2": "1"
        }
      },
      now: 999,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: {
        "stream-2": 1
      }
    })
  ).toEqual({
    _tag: "Denied",
    windowId: "window-1",
    reason: "backfillExhausted",
    errorTag: "ReconnectBackfillExhausted",
    message: "reconnect cursor was not resumable"
  })
})

test("denies a resume when a requested stream cursor is no longer buffered", () => {
  expect(
    evaluateRendererResume({
      ticket,
      resume,
      now: 999,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: {}
    })
  ).toEqual({
    _tag: "Denied",
    windowId: "window-1",
    reason: "backfillExhausted",
    errorTag: "ReconnectBackfillExhausted",
    message: "reconnect backfill exhausted"
  })
})

test("denies renderer resume decisions with non-finite clocks", () => {
  const shouldDeny = (now: number, expiresAt: number) =>
    evaluateRendererResume({
      ticket: { ...ticket, expiresAt },
      resume,
      now,
      originTokenHash: "sha256:origin",
      availableBackfillEventsByStream: { "stream-1": 1 }
    })

  expect(shouldDeny(Number.NaN, 1_000)._tag).toBe("Denied")
  expect(shouldDeny(Number.POSITIVE_INFINITY, 1_000)._tag).toBe("Denied")
  expect(shouldDeny(1_000, Number.NaN)._tag).toBe("Denied")
  expect(shouldDeny(1_000, Number.POSITIVE_INFINITY)._tag).toBe("Denied")
  expect(shouldDeny(999, 1_000)._tag).toBe("Accepted")
})
