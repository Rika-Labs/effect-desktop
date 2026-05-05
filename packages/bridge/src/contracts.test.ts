import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Option, Schema } from "effect"

import {
  Api,
  ApiContractRegistryFrozen,
  DuplicateApiContractTag,
  InvalidApiContractSpec,
  type ApiContractSpec
} from "./index.js"

test("Api.Tag registers a frozen contract and exposes a stable snapshot", async () => {
  const ProjectApi = await Effect.runPromise(
    Api.Tag("Test.ProjectApi")<unknown>()({
      open: {
        input: Schema.Struct({ path: Schema.String }),
        output: Schema.Struct({ id: Schema.String }),
        error: Schema.Never,
        permission: "project:open",
        timeoutMs: 30_000,
        idempotent: true,
        cancellable: true,
        backpressure: { strategy: "buffer", size: 128, overflow: "dropOldest" }
      }
    })
  )

  expect(ProjectApi.tag).toBe("Test.ProjectApi")
  expect(Object.isFrozen(ProjectApi.spec)).toBe(true)
  expect(
    Option.match(await Effect.runPromise(Api.get("Test.ProjectApi")), {
      onNone: () => false,
      onSome: (contract) => Object.isFrozen(contract)
    })
  ).toBe(true)
  expect((await Effect.runPromise(Api.entries())).map((entry) => entry.tag)).toContain(
    "Test.ProjectApi"
  )
})

test("Api.Tag rejects duplicate tags as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const FirstDuplicate = yield* Api.Tag("Test.Duplicate")<unknown>()({
        call: validMethodSpec()
      })

      expect(FirstDuplicate.tag).toBe("Test.Duplicate")

      return yield* Api.Tag("Test.Duplicate")<unknown>()({
        call: validMethodSpec()
      })
    })
  )

  expectFailure(exit, DuplicateApiContractTag)
})

test("Api.Tag rejects missing required schemas as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.Invalid")<unknown>()({
      call: {
        input: Schema.String,
        output: Schema.String
      }
    } as unknown as ApiContractSpec)
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("Api.Tag rejects invalid timeout values as a typed Effect failure", async () => {
  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.InvalidTimeout")<unknown>()({
      call: {
        ...validMethodSpec(),
        timeoutMs: -1
      }
    })
  )

  expectFailure(exit, InvalidApiContractSpec)
})

test("contract classes expose frozen layer descriptors", async () => {
  const LayeredApi = await Effect.runPromise(
    Api.Tag("Test.Layered")<unknown>()({
      call: validMethodSpec()
    })
  )

  const layer = LayeredApi.layer({
    call: (input) => Effect.succeed(input.toUpperCase())
  })

  expect(layer.contract).toBe(LayeredApi)
  expect(await Effect.runPromise(layer.handlers.call("request"))).toBe("REQUEST")
  expect(Object.isFrozen(layer)).toBe(true)
  expect(Object.isFrozen(layer.handlers)).toBe(true)
})

test("zz Api.freeze rejects later registrations as a typed Effect failure", async () => {
  await Effect.runPromise(Api.freeze())

  const exit = await Effect.runPromiseExit(
    Api.Tag("Test.AfterFreeze")<unknown>()({
      call: validMethodSpec()
    })
  )

  expectFailure(exit, ApiContractRegistryFrozen)
})

const validMethodSpec = () => ({
  input: Schema.String,
  output: Schema.String,
  error: Schema.Never
})

const expectFailure = (
  exit: Exit.Exit<unknown, unknown>,
  expected: abstract new (...args: ReadonlyArray<never>) => unknown
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)

    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(fail.error).toBeInstanceOf(expected)
    }
  }
}
