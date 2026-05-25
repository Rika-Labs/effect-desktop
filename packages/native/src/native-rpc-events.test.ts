import { expect, test } from "bun:test"

test("empty native event side objects are not public API", async () => {
  const [dialogModule, pathModule, shellModule, rootModule] = await Promise.all([
    import("./dialog.js"),
    import("./path.js"),
    import("./shell.js"),
    import("./index.js")
  ])

  for (const removedName of ["DialogRpcEvents", "PathRpcEvents", "ShellRpcEvents"]) {
    expect(removedName in dialogModule).toBe(false)
    expect(removedName in pathModule).toBe(false)
    expect(removedName in shellModule).toBe(false)
    expect(removedName in rootModule).toBe(false)
  }
})
