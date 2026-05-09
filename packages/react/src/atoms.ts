import { Option } from "effect"
import { Atom } from "effect/unstable/reactivity"
import { useSyncExternalStore } from "react"

import { useDesktopContext } from "./provider.js"

export const useAtomValue = <A>(atom: Atom.Atom<A>): A | undefined => {
  const ctx = useDesktopContext()

  const subscribe = (onStoreChange: () => void): (() => void) => {
    if (Option.isNone(ctx)) return () => {}
    return ctx.value.registry.subscribe(atom, onStoreChange)
  }

  const getSnapshot = (): A | undefined => {
    if (Option.isNone(ctx)) return undefined
    const registry = ctx.value.registry
    registry.mount(atom)
    return registry.get(atom)
  }

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const useAtomSet = <R, W>(atom: Atom.Writable<R, W>): ((value: W) => void) => {
  const ctx = useDesktopContext()
  return (value: W) => {
    if (Option.isSome(ctx)) {
      ctx.value.registry.set(atom, value)
    }
  }
}

export const useAtom = <R, W>(atom: Atom.Writable<R, W>): [R | undefined, (value: W) => void] => [
  useAtomValue(atom),
  useAtomSet(atom)
]
