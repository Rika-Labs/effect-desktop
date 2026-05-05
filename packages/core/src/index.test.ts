import { expect, test } from "bun:test"

test("public barrel exports the ResourceRegistry factory", async () => {
  const core = await import("./index.js")

  expect(core.makeResourceRegistry).toBeFunction()
})

test("public Desktop facade exposes the API contract registry", async () => {
  const core = await import("./index.js")

  expect(core.Client).toBeFunction()
  expect(core.Desktop.Api.Tag).toBeFunction()
  expect(core.Desktop.Client).toBeFunction()
})
