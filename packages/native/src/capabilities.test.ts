import { expect, test } from "bun:test"
import { RpcSupport } from "@effect-desktop/bridge"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import {
  NativeCapabilities,
  NativeCapabilitiesLive,
  NativeCapabilityLookupError,
  NativeCapabilityManifestError,
  UnsupportedCapability,
  makeNativeCapabilitiesLayer
} from "./capabilities.js"

test("NativeCapabilities exposes support metadata from native RpcGroups", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const create = yield* capabilities.support("Window.create")
      const show = yield* capabilities.support("Window.show")
      return {
        create,
        show,
        hasWindowShow: capabilities.manifest.some((fact) => fact.tag === "Window.show")
      }
    }).pipe(Effect.provide(NativeCapabilitiesLive))
  )

  expect(result.create).toEqual({ status: "supported" })
  expect(result.show).toEqual({
    status: "unsupported",
    reason: "host Window adapter does not implement this method yet"
  })
  expect(result.hasWindowShow).toBe(true)
})

test("NativeCapabilities require fails unsupported methods only when explicitly required", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      yield* capabilities.support("Window.show")
      return yield* capabilities.require("Window.show")
    }).pipe(Effect.provide(NativeCapabilitiesLive))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(UnsupportedCapability)
    expect(failure?.error).toMatchObject({
      _tag: "UnsupportedCapability",
      tag: "Window.show",
      reason: "host Window adapter does not implement this method yet"
    })
  }
})

test("NativeCapabilities require succeeds for supported methods", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      return yield* capabilities.require("Window.create")
    }).pipe(Effect.provide(NativeCapabilitiesLive))
  )

  expect(result).toBeUndefined()
})

test("NativeCapabilities reports unknown method tags as typed lookup errors", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      return yield* capabilities.support("Window.missing")
    }).pipe(Effect.provide(NativeCapabilitiesLive))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(NativeCapabilityLookupError)
    expect(failure?.error).toMatchObject({
      tag: "Window.missing",
      message: "unknown native capability tag: Window.missing"
    })
  }
})

test("NativeCapabilities rejects duplicate method tags in manifests", async () => {
  const First = RpcGroup.make(Rpc.make("Duplicate.method", { success: Schema.Void }))
  const Second = RpcGroup.make(
    Rpc.make("Duplicate.method", { success: Schema.Void }).pipe(
      RpcSupport.unsupported("second declaration")
    )
  )

  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(makeNativeCapabilitiesLayer([First, Second])))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(NativeCapabilityManifestError)
    expect(failure?.error).toMatchObject({
      tag: "Duplicate.method",
      message: "duplicate native capability tag: Duplicate.method"
    })
  }
})
