import { expect, test } from "bun:test"
import { Schema } from "effect"

import {
  Api,
  DuplicateApiContractTag,
  InvalidApiContractSpec,
  type ApiContractSpec
} from "./index.js"

test("Api.Tag registers a frozen contract and exposes a stable snapshot", () => {
  class ProjectApi extends Api.Tag("Test.ProjectApi")<ProjectApi>()({
    open: {
      input: Schema.Struct({ path: Schema.String }),
      output: Schema.Struct({ id: Schema.String }),
      error: Schema.Never,
      permission: "project:open",
      timeoutMs: 30_000,
      idempotent: true,
      cancellable: true
    }
  }) {}

  expect(ProjectApi.tag).toBe("Test.ProjectApi")
  expect(Object.isFrozen(ProjectApi.spec)).toBe(true)
  expect(Object.isFrozen(Api.get("Test.ProjectApi"))).toBe(true)
  expect(Api.entries().map((entry) => entry.tag)).toContain("Test.ProjectApi")
})

test("Api.Tag rejects duplicate tags", () => {
  class FirstDuplicate extends Api.Tag("Test.Duplicate")<FirstDuplicate>()({
    call: validMethodSpec()
  }) {}

  expect(FirstDuplicate.tag).toBe("Test.Duplicate")
  expect(() => {
    class SecondDuplicate extends Api.Tag("Test.Duplicate")<SecondDuplicate>()({
      call: validMethodSpec()
    }) {}

    return SecondDuplicate
  }).toThrow(DuplicateApiContractTag)
})

test("Api.Tag rejects missing required schemas", () => {
  expect(() =>
    Api.Tag("Test.Invalid")<unknown>()({
      call: {
        input: Schema.String,
        output: Schema.String
      }
    } as unknown as ApiContractSpec)
  ).toThrow(InvalidApiContractSpec)
})

test("Api.Tag rejects invalid timeout values", () => {
  expect(() =>
    Api.Tag("Test.InvalidTimeout")<unknown>()({
      call: {
        ...validMethodSpec(),
        timeoutMs: -1
      }
    })
  ).toThrow(InvalidApiContractSpec)
})

test("contract classes expose frozen layer descriptors", () => {
  class LayeredApi extends Api.Tag("Test.Layered")<LayeredApi>()({
    call: validMethodSpec()
  }) {}

  const layer = LayeredApi.layer({
    call: "handler"
  })

  expect(layer.contract).toBe(LayeredApi)
  expect(layer.handlers.call).toBe("handler")
  expect(Object.isFrozen(layer)).toBe(true)
})

test("zz Api.freeze rejects later registrations", () => {
  Api.freeze()

  expect(() =>
    Api.Tag("Test.AfterFreeze")<unknown>()({
      call: validMethodSpec()
    })
  ).toThrow("API contract registry is frozen")
})

const validMethodSpec = () => ({
  input: Schema.String,
  output: Schema.String,
  error: Schema.Never
})
