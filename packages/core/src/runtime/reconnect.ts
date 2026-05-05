import {
  DEFAULT_MAX_BACKFILL_EVENTS,
  type HostProtocolErrorTag,
  type RendererResumeDeniedReason,
  type RendererResumePayload,
  type ResumeTicket
} from "@effect-desktop/bridge"

export interface RendererResumePolicyInput {
  readonly ticket: ResumeTicket
  readonly resume: RendererResumePayload
  readonly now: number
  readonly originTokenHash: string
  readonly availableBackfillEventsByStream: Readonly<Record<string, number>>
  readonly maxBackfillEvents?: number
}

export interface RendererResumeAccepted {
  readonly _tag: "Accepted"
  readonly windowId: string
  readonly replayedStreamIds: readonly string[]
}

export interface RendererResumeDenied {
  readonly _tag: "Denied"
  readonly windowId: string
  readonly reason: RendererResumeDeniedReason
  readonly errorTag: HostProtocolErrorTag
  readonly message: string
}

export type RendererResumeDecision = RendererResumeAccepted | RendererResumeDenied

export const evaluateRendererResume = (
  input: RendererResumePolicyInput
): RendererResumeDecision => {
  const maxBackfillEvents = input.maxBackfillEvents ?? DEFAULT_MAX_BACKFILL_EVENTS

  if (input.ticket.windowId !== input.resume.windowId) {
    return deny(input.resume.windowId, "windowMismatch", "resume ticket belongs to another window")
  }

  if (input.now > input.ticket.expiresAt) {
    return deny(input.resume.windowId, "expired", "resume ticket expired")
  }

  if (
    input.ticket.originTokenHash !== input.originTokenHash ||
    input.ticket.resumeNonce !== input.resume.resumeNonce
  ) {
    return deny(input.resume.windowId, "originInvalid", "resume ticket did not match origin")
  }

  const replayedStreamIds = Object.keys(input.resume.cursors)
  for (const streamId of replayedStreamIds) {
    if (input.ticket.lastStreamCursors[streamId] !== input.resume.cursors[streamId]) {
      return deny(input.resume.windowId, "backfillExhausted", "reconnect cursor was not resumable")
    }

    const availableBackfillEvents = input.availableBackfillEventsByStream[streamId]
    if (
      availableBackfillEvents === undefined ||
      availableBackfillEvents < 0 ||
      availableBackfillEvents > maxBackfillEvents
    ) {
      return deny(input.resume.windowId, "backfillExhausted", "reconnect backfill exhausted")
    }
  }

  return {
    _tag: "Accepted",
    windowId: input.resume.windowId,
    replayedStreamIds
  }
}

const deny = (
  windowId: string,
  reason: RendererResumeDeniedReason,
  message: string
): RendererResumeDenied => ({
  _tag: "Denied",
  windowId,
  reason,
  errorTag: errorTagForReason(reason),
  message
})

const errorTagForReason = (reason: RendererResumeDeniedReason): HostProtocolErrorTag => {
  switch (reason) {
    case "expired":
    case "windowMismatch":
      return "RendererDisconnected"
    case "originInvalid":
      return "OriginInvalid"
    case "backfillExhausted":
      return "ReconnectBackfillExhausted"
  }
}
