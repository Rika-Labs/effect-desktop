import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { useDesktopAction } from "./desktop.js"

const desktopSourcePath = fileURLToPath(new URL("./desktop.ts", import.meta.url))
const desktopSource = await Bun.file(desktopSourcePath).text()

const renderActionHook = <Args extends readonly unknown[], A, E>(
  operation: (...args: Args) => Effect.Effect<A, E, never>,
  options?: Parameters<typeof useDesktopAction<Args, A, E>>[1]
): ReturnType<typeof useDesktopAction<Args, A, E>> => {
  let captured: ReturnType<typeof useDesktopAction<Args, A, E>> | undefined
  const Probe = () => {
    captured = useDesktopAction(operation, options)
    return createElement("span", null, "ready")
  }

  expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>ready</span>")
  if (captured === undefined) {
    throw new Error("useDesktopAction did not render")
  }
  return captured
}

const resetBody = (() => {
  const marker = "const reset = useCallback((): void => {"
  const start = desktopSource.indexOf(marker)
  if (start < 0) {
    throw new Error("useDesktopAction.reset implementation not found")
  }
  const end = desktopSource.indexOf("}, [", start)
  return desktopSource.slice(start, end < 0 ? undefined : end)
})()

test("useDesktopAction.reset clears state unconditionally instead of routing through the cancel guard", () => {
  expect(resetBody).not.toContain("cancelActiveAction()")
  expect(resetBody).toContain("setState(idle<A, E>())")
  expect(resetBody).toContain("actionOperation.reset()")
  expect(resetBody).toContain("runningRef.current = false")
  expect(resetBody).toContain("queueRef.current = []")
})

test("useDesktopAction.reset is callable on a freshly rendered idle action without throwing", () => {
  const action = renderActionHook(() => Effect.succeed(42))

  expect(action.status).toBe("idle")
  expect(() => {
    action.reset()
    action.reset()
  }).not.toThrow()
})
