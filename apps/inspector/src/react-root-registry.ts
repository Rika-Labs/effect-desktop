import { createRoot, type Root } from "react-dom/client"

declare global {
  var orikaInspectorReactRoots: WeakMap<Element, Root> | undefined
}

export const getOrCreateInspectorRoot = (
  container: Element,
  createRootForContainer: (container: Element) => Root = createRoot
): Root => {
  globalThis.orikaInspectorReactRoots ??= new WeakMap<Element, Root>()
  const existingRoot = globalThis.orikaInspectorReactRoots.get(container)
  if (existingRoot !== undefined) {
    return existingRoot
  }
  const root = createRootForContainer(container)
  globalThis.orikaInspectorReactRoots.set(container, root)
  return root
}
