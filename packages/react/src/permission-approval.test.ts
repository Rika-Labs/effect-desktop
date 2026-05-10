import { expect, test } from "bun:test"
import { Effect } from "effect"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  PermissionApprovalQueue,
  usePermissionApproval,
  type ApprovalResolver,
  type PendingApproval
} from "./permission-approval.js"

const noopResolver: ApprovalResolver = {
  resolve: (_token: string, _approved: boolean) => Effect.void
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
  const approval: PendingApproval = {
    token: "tok-1",
    traceId: "trace-1",
    capability: { kind: "filesystem.read" },
    actor: { kind: "app", id: "test-app" }
  }

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
  const approval: PendingApproval = {
    token: "tok-custom",
    traceId: "trace-custom",
    capability: {},
    actor: {}
  }

  const customRender = () => createElement("span", { "data-custom": true }, "custom-prompt")

  const html = renderToStaticMarkup(
    createElement(PermissionApprovalQueue, {
      state: {
        pending: [approval],
        push: () => undefined,
        resolve: () => undefined
      },
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
      state: {
        pending: approvals,
        push: () => undefined,
        resolve: () => undefined
      }
    })
  )

  expect(html).toContain(`data-permission-approval="tok-a"`)
  expect(html).toContain(`data-permission-approval="tok-b"`)
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
