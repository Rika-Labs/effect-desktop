import { Effect } from "effect"
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react"

export interface PendingApproval {
  readonly token: string
  readonly traceId: string
  readonly capability: unknown
  readonly actor: unknown
  readonly resource?: string
}

export type ApprovalDecision = "approved" | "denied"

export interface ApprovalResolver {
  readonly resolve: (token: string, approved: boolean) => Effect.Effect<void, never, never>
}

export interface PermissionApprovalState {
  readonly pending: readonly PendingApproval[]
  readonly push: (approval: PendingApproval) => void
  readonly resolve: (token: string, approved: boolean) => void
}

export const usePermissionApproval = (resolver: ApprovalResolver): PermissionApprovalState => {
  const [pending, setPending] = useState<readonly PendingApproval[]>([])
  const resolverRef = useRef(resolver)
  resolverRef.current = resolver

  const push = useCallback((approval: PendingApproval) => {
    setPending((current) => {
      if (current.some((p) => p.token === approval.token)) {
        return current
      }
      return [...current, approval]
    })
  }, [])

  const resolve = useCallback((token: string, approved: boolean) => {
    setPending((current) => current.filter((p) => p.token !== token))
    void Effect.runPromise(resolverRef.current.resolve(token, approved))
  }, [])

  return { pending, push, resolve }
}

export interface PermissionApprovalPromptProps {
  readonly approval: PendingApproval
  readonly onApprove: (token: string) => void
  readonly onDeny: (token: string) => void
}

export interface PermissionApprovalQueueProps {
  readonly state: PermissionApprovalState
  readonly renderPrompt?: (props: PermissionApprovalPromptProps) => ReactNode
}

const DefaultPrompt = ({ approval, onApprove, onDeny }: PermissionApprovalPromptProps) =>
  createElement(
    "div",
    { "data-permission-approval": approval.token },
    createElement("p", null, `Permission request: ${approval.traceId}`),
    createElement(
      "button",
      {
        onClick: () => {
          onApprove(approval.token)
        }
      },
      "Approve"
    ),
    createElement(
      "button",
      {
        onClick: () => {
          onDeny(approval.token)
        }
      },
      "Deny"
    )
  )

export const PermissionApprovalQueue = ({ state, renderPrompt }: PermissionApprovalQueueProps) => {
  const onApprove = useCallback(
    (token: string) => {
      state.resolve(token, true)
    },
    [state]
  )

  const onDeny = useCallback(
    (token: string) => {
      state.resolve(token, false)
    },
    [state]
  )

  if (state.pending.length === 0) {
    return null
  }

  return createElement(
    "div",
    { "data-permission-approval-queue": true },
    state.pending.map((approval) => {
      const props: PermissionApprovalPromptProps = { approval, onApprove, onDeny }
      return createElement(
        "div",
        { key: approval.token },
        renderPrompt !== undefined ? renderPrompt(props) : createElement(DefaultPrompt, props)
      )
    })
  )
}

export const useApprovalNotifications = (
  push: (approval: PendingApproval) => void,
  subscribe: (handler: (approval: PendingApproval) => void) => () => void
): void => {
  const pushRef = useRef(push)
  pushRef.current = push

  useEffect(() => {
    const unsubscribe = subscribe((approval) => {
      pushRef.current(approval)
    })
    return unsubscribe
  }, [subscribe])
}
