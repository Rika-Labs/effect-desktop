import { expect, test } from "bun:test"
import type { Root } from "react-dom/client"

import { getOrCreateInspectorRoot } from "./react-root-registry.js"

const makeRoot = (): Root => ({
  render: () => undefined,
  unmount: () => undefined
})

test("getOrCreateInspectorRoot reuses the React root for the same container", () => {
  const container = {} as Element
  let created = 0

  const first = getOrCreateInspectorRoot(container, () => {
    created += 1
    return makeRoot()
  })
  const second = getOrCreateInspectorRoot(container, () => {
    created += 1
    return makeRoot()
  })

  expect(first).toBe(second)
  expect(created).toBe(1)
})
