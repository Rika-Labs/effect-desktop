import { expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  PermissionApprovalQueue,
  completeApprovalResolution,
  initialPermissionApprovalSnapshot,
  markApprovalResolving,
  pushPendingApproval,
  resolveApprovalDecision,
  usePermissionApproval,
  type ApprovalResolution,
  type ApprovalResolver,
  type PendingApproval,
  type PermissionApprovalState
} from "./permission-approval.js"

const noopResolver: ApprovalResolver = () => Effect.void

const noopState = (
  pending: readonly PendingApproval[],
  resolutions: ReadonlyMap<string, ApprovalResolution> = new Map()
): PermissionApprovalState => ({
  pending,
  resolutions,
  push: () => undefined,
  resolve: () => undefined,
  resolvePromise: () => Promise.resolve(Exit.void),
  clearResolution: () => undefined
})

const approval: PendingApproval = {
  token: "tok-1",
  traceId: "trace-1",
  capability: { kind: "filesystem.read" },
  actor: { kind: "app", id: "test-app" }
}

test("PermissionApprovalQueue renders nothing when no pending approvals", () => {
  const Probe = () => {
    const state = usePermissionApproval(noopResolver)
    return createElement(PermissionApprovalQueue, { state })
  }

  const html = renderToStaticMarkup(createElement(Probe))
  expect(html).toBe("")
})

test("PermissionApprovalQueue renders a prompt for each pending approval", () => {
  const Probe = () => {
    const state = usePermissionApproval(noopResolver)
    return createElement(PermissionApprovalQueue, {
      state: {
        ...state,
        pending: [approval]
      }
    })
  }

  const html = renderToStaticMarkup(createElement(Probe))
  expect(html).toContain("data-permission-approval-queue")
  expect(html).toContain(`data-permission-approval="${approval.token}"`)
})

test("PermissionApprovalQueue uses custom renderPrompt when provided", () => {
  const customRender = () => createElement("span", { "data-custom": true }, "custom-prompt")

  const html = renderToStaticMarkup(
    createElement(PermissionApprovalQueue, {
      state: noopState([approval]),
      renderPrompt: customRender
    })
  )

  expect(html).toContain("data-custom")
  expect(html).toContain("custom-prompt")
})

test("PermissionApprovalQueue renders multiple pending approvals", () => {
  const approvals: PendingApproval[] = [
    { token: "tok-a", traceId: "trace-a", capability: {}, actor: {} },
    { token: "tok-b", traceId: "trace-b", capability: {}, actor: {} }
  ]

  const html = renderToStaticMarkup(
    createElement(PermissionApprovalQueue, {
      state: noopState(approvals)
    })
  )

  expect(html).toContain(`data-permission-approval="tok-a"`)
  expect(html).toContain(`data-permission-approval="tok-b"`)
})

test("PermissionApprovalQueue disables default actions while resolution is waiting", () => {
  const html = renderToStaticMarkup(
    createElement(PermissionApprovalQueue, {
      state: noopState(
        [approval],
        new Map([[approval.token, AsyncResult.initial<void, unknown>(true)]])
      )
    })
  )

  expect(html).toContain("disabled")
})

test("usePermissionApproval exposes push and resolve as functions", () => {
  let capturedPush: unknown
  let capturedResolve: unknown

  const Probe = () => {
    const state = usePermissionApproval(noopResolver)
    capturedPush = state.push
    capturedResolve = state.resolve
    return null
  }

  renderToStaticMarkup(createElement(Probe))

  expect(typeof capturedPush).toBe("function")
  expect(typeof capturedResolve).toBe("function")
})

test("permission approval state transitions preserve duplicate failure state", () => {
  const failed = completeApprovalResolution(
    pushPendingApproval(initialPermissionApprovalSnapshot(), approval),
    approval.token,
    Exit.fail("boom")
  )
  const duplicated = pushPendingApproval(failed, approval)

  expect(duplicated).toBe(failed)
  expect(AsyncResult.isFailure(duplicated.resolutions.get(approval.token)!)).toBe(true)
  expect(duplicated.pending).toEqual([approval])
})

test("permission approval state transitions keep pending approvals on failure", () => {
  const snapshot = completeApprovalResolution(
    pushPendingApproval(initialPermissionApprovalSnapshot(), approval),
    approval.token,
    Exit.fail("denied")
  )

  expect(snapshot.pending).toEqual([approval])
  const resolution = snapshot.resolutions.get(approval.token)
  expect(resolution !== undefined && AsyncResult.isFailure(resolution)).toBe(true)
})

test("permission approval state transitions remove approvals on success", () => {
  const snapshot = completeApprovalResolution(
    pushPendingApproval(initialPermissionApprovalSnapshot(), approval),
    approval.token,
    Exit.void
  )

  expect(snapshot.pending).toEqual([])
  const resolution = snapshot.resolutions.get(approval.token)
  expect(resolution !== undefined && AsyncResult.isSuccess(resolution)).toBe(true)
})

test("permission approval state transitions mark resolving tokens as waiting", () => {
  const snapshot = markApprovalResolving(
    pushPendingApproval(initialPermissionApprovalSnapshot(), approval),
    approval.token
  )

  const resolution = snapshot.resolutions.get(approval.token)
  expect(resolution?.waiting).toBe(true)
})

test("resolveApprovalDecision captures failed resolver effects as Exit data", () =>
  resolveApprovalDecision(
    () => Effect.fail({ _tag: "ApprovalFailed", message: "denied" } as const),
    approval,
    false
  ).then((exit) => {
    const failure = { _tag: "ApprovalFailed", message: "denied" } as const
    expect(Exit.isFailure(exit)).toBe(true)
    const result = AsyncResult.fromExit(exit)
    expect(AsyncResult.isFailure(result)).toBe(true)
    if (AsyncResult.isFailure(result)) {
      const fail = result.cause.reasons.find((reason) => reason._tag === "Fail")
      expect(fail?.error).toEqual(failure)
    }
  }))

test("resolveApprovalDecision captures synchronous resolver throws as Exit defects", () => {
  const defect = new Error("resolver exploded")
  return resolveApprovalDecision(
    () => {
      throw defect
    },
    approval,
    true
  ).then((exit) => {
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const die = exit.cause.reasons.find((reason) => reason._tag === "Die")
      expect(die?.defect).toBe(defect)
    }
  })
})

test("PermissionApprovalQueue passes resolution state to custom prompts", () => {
  const resolution = AsyncResult.failure<void, string>(Cause.fail("approval failed"))
  let captured: ApprovalResolution | undefined

  renderToStaticMarkup(
    createElement(PermissionApprovalQueue, {
      state: noopState([approval], new Map([[approval.token, resolution]])),
      renderPrompt: (props) => {
        captured = props.resolution
        return createElement("span", null, "prompt")
      }
    })
  )

  expect(captured).toBe(resolution)
})
