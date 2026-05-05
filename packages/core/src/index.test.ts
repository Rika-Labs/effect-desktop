import { expect, test } from "bun:test"

test("public barrel remains empty until the public API phase", async () => {
  const core = await import("./index.js")

  expect(core).toEqual({})
})
