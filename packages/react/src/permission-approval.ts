import { Effect, Exit } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react"

export interface PendingApproval {
  readonly token: string
  readonly traceId: string
  readonly capability: unknown
  readonly actor: unknown
  readonly resource?: string
}

export type ApprovalResolver<E = unknown> = (
  token: string,
  approved: boolean,
  approval: PendingApproval
) => Effect.Effect<void, E, never>

export type ApprovalResolution<E = unknown> = AsyncResult.AsyncResult<void, E>

export interface PermissionApprovalState<E = unknown> {
  readonly pending: readonly PendingApproval[]
  readonly resolutions: ReadonlyMap<string, ApprovalResolution<E>>
  readonly push: (approval: PendingApproval) => void
  readonly resolve: (token: string, approved: boolean) => void
  readonly resolvePromise: (token: string, approved: boolean) => Promise<Exit.Exit<void, E>>
  readonly clearResolution: (token: string) => void
}

export interface PermissionApprovalSnapshot<E = unknown> {
  readonly pending: readonly PendingApproval[]
  readonly resolutions: ReadonlyMap<string, ApprovalResolution<E>>
}

export const resolveApprovalDecision = <E>(
  resolver: ApprovalResolver<E>,
  approval: PendingApproval,
  approved: boolean
): Promise<Exit.Exit<void, E>> =>
  Effect.runPromiseExit(Effect.suspend(() => resolver(approval.token, approved, approval)))

export const initialPermissionApprovalSnapshot = <
  E = unknown
>(): PermissionApprovalSnapshot<E> => ({
  pending: [],
  resolutions: new Map()
})

export const pushPendingApproval = <E>(
  snapshot: PermissionApprovalSnapshot<E>,
  approval: PendingApproval
): PermissionApprovalSnapshot<E> => {
  if (snapshot.pending.some((p) => p.token === approval.token)) {
    return snapshot
  }
  if (!snapshot.resolutions.has(approval.token)) {
    return {
      pending: [...snapshot.pending, approval],
      resolutions: snapshot.resolutions
    }
  }
  const resolutions = new Map(snapshot.resolutions)
  resolutions.delete(approval.token)
  return {
    pending: [...snapshot.pending, approval],
    resolutions
  }
}

export const markApprovalResolving = <E>(
  snapshot: PermissionApprovalSnapshot<E>,
  token: string
): PermissionApprovalSnapshot<E> => {
  const resolutions = new Map(snapshot.resolutions)
  resolutions.set(token, AsyncResult.initial<void, E>(true))
  return { ...snapshot, resolutions }
}

export const completeApprovalResolution = <E>(
  snapshot: PermissionApprovalSnapshot<E>,
  token: string,
  exit: Exit.Exit<void, E>
): PermissionApprovalSnapshot<E> => {
  const resolutions = new Map(snapshot.resolutions)
  resolutions.set(token, AsyncResult.fromExit(exit))
  return {
    pending: Exit.isSuccess(exit)
      ? snapshot.pending.filter((p) => p.token !== token)
      : snapshot.pending,
    resolutions
  }
}

export const clearApprovalResolution = <E>(
  snapshot: PermissionApprovalSnapshot<E>,
  token: string
): PermissionApprovalSnapshot<E> => {
  if (!snapshot.resolutions.has(token)) {
    return snapshot
  }
  const resolutions = new Map(snapshot.resolutions)
  resolutions.delete(token)
  return { ...snapshot, resolutions }
}

export const usePermissionApproval = <E = unknown>(
  resolver: ApprovalResolver<E>
): PermissionApprovalState<E> => {
  const [snapshot, setSnapshot] = useState<PermissionApprovalSnapshot<E>>(
    initialPermissionApprovalSnapshot
  )
  const resolverRef = useRef(resolver)
  const inFlightRef = useRef(new Map<string, Promise<Exit.Exit<void, E>>>())
  const mountedRef = useRef(true)
  resolverRef.current = resolver

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const push = useCallback((approval: PendingApproval) => {
    setSnapshot((current) => pushPendingApproval(current, approval))
  }, [])

  const resolvePromise = useCallback(
    (token: string, approved: boolean): Promise<Exit.Exit<void, E>> => {
      const existing = inFlightRef.current.get(token)
      if (existing !== undefined) {
        return existing
      }

      const approval = snapshot.pending.find((p) => p.token === token)
      if (approval === undefined) {
        return Promise.resolve(Exit.void)
      }

      setSnapshot((current) => markApprovalResolving(current, token))

      const run = resolveApprovalDecision(resolverRef.current, approval, approved)
        .then((exit) => {
          if (!mountedRef.current) {
            return exit
          }
          setSnapshot((current) => completeApprovalResolution(current, token, exit))
          return exit
        })
        .finally(() => {
          inFlightRef.current.delete(token)
        })

      inFlightRef.current.set(token, run)
      return run
    },
    [snapshot.pending]
  )

  const resolve = useCallback(
    (token: string, approved: boolean): void => {
      void resolvePromise(token, approved)
    },
    [resolvePromise]
  )

  const clearResolution = useCallback((token: string): void => {
    setSnapshot((current) => clearApprovalResolution(current, token))
  }, [])

  return {
    pending: snapshot.pending,
    resolutions: snapshot.resolutions,
    push,
    resolve,
    resolvePromise,
    clearResolution
  }
}

export interface PermissionApprovalPromptProps<E = unknown> {
  readonly approval: PendingApproval
  readonly resolution: ApprovalResolution<E>
  readonly onApprove: (token: string) => void
  readonly onDeny: (token: string) => void
}

export interface PermissionApprovalQueueProps<E = unknown> {
  readonly state: PermissionApprovalState<E>
  readonly renderPrompt?: (props: PermissionApprovalPromptProps<E>) => ReactNode
}

const DefaultPrompt = <E>({
  approval,
  resolution,
  onApprove,
  onDeny
}: PermissionApprovalPromptProps<E>) => {
  const disabled = resolution.waiting
  return createElement(
    "div",
    { "data-permission-approval": approval.token },
    createElement("p", null, `Permission request: ${approval.traceId}`),
    createElement(
      "button",
      {
        disabled,
        onClick: () => {
          onApprove(approval.token)
        }
      },
      "Approve"
    ),
    createElement(
      "button",
      {
        disabled,
        onClick: () => {
          onDeny(approval.token)
        }
      },
      "Deny"
    )
  )
}

export const PermissionApprovalQueue = <E>({
  state,
  renderPrompt
}: PermissionApprovalQueueProps<E>) => {
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
      const resolution = state.resolutions.get(approval.token) ?? AsyncResult.initial<void, E>()
      const props: PermissionApprovalPromptProps<E> = {
        approval,
        resolution,
        onApprove,
        onDeny
      }
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
