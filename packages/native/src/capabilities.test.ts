import { expect, test } from "bun:test"
import type { RpcCapabilityMetadata, RpcSupportMetadata } from "@effect-desktop/bridge"
import { type DesktopNativeLayer, type DesktopRpcSchemaDoc } from "@effect-desktop/core"
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect"

import {
  NativeCapabilities,
  NativeCapabilitiesLive,
  NativeCapabilityLookupError,
  NativeCapabilityManifestError,
  UnsupportedCapability,
  makeNativeCapabilitiesLayer
} from "./capabilities.js"
import { Native } from "./native.js"

test("NativeCapabilities exposes support metadata from native surfaces", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const create = yield* capabilities.support("Window.create")
      return {
        create,
        hasWindowShow: capabilities.manifest.some((fact) => fact.tag === "Window.show")
      }
    }).pipe(Effect.provide(NativeCapabilitiesLive))
  )

  expect(result.create).toEqual({ status: "supported" })
  expect(result.hasWindowShow).toBe(false)
})

test("NativeCapabilities derives support metadata from selected native layers only", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const readText = yield* capabilities.support("Clipboard.readText")
      const missingWindow = yield* Effect.exit(capabilities.support("Window.create"))
      return {
        readText,
        missingWindow,
        tags: capabilities.manifest.map((fact) => fact.tag)
      }
    }).pipe(Effect.provide(makeNativeCapabilitiesLayer(Native.available(Native.Clipboard))))
  )

  expect(result.readText).toEqual({ status: "supported" })
  expect(result.tags).toContain("Clipboard.readText")
  expect(result.tags).not.toContain("Window.create")
  expect(Exit.isFailure(result.missingWindow)).toBe(true)
  if (Exit.isFailure(result.missingWindow)) {
    const failure = result.missingWindow.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(NativeCapabilityLookupError)
  }
})

test("NativeCapabilities require fails unsupported methods from explicit metadata", async () => {
  const unsupported = testSurface("Example.unsupported", {
    status: "unsupported",
    reason: "example unavailable"
  })
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      yield* capabilities.support("Example.unsupported")
      return yield* capabilities.require("Example.unsupported")
    }).pipe(Effect.provide(makeNativeCapabilitiesLayer(testNativeLayer(unsupported))))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(UnsupportedCapability)
    expect(failure?.error).toMatchObject({
      _tag: "UnsupportedCapability",
      tag: "Example.unsupported",
      reason: "example unavailable"
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
  const first = testSurface("Duplicate.method")
  const second = testSurface("Duplicate.method", {
    status: "unsupported",
    reason: "second declaration"
  })

  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(makeNativeCapabilitiesLayer(testNativeLayer(first, second))))
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

test("NativeCapabilities rejects missing capability metadata", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Layer.build(makeNativeCapabilitiesLayer(testNativeLayer(testSurfaceWithoutCapability())))
    )
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(NativeCapabilityManifestError)
    expect(failure?.error).toMatchObject({
      tag: "Example.missing",
      message: "missing native capability metadata: Example.missing"
    })
  }
})

const testSurface = (
  tag: string,
  support: RpcSupportMetadata = { status: "supported" },
  capability: RpcCapabilityMetadata | undefined = { kind: "none" }
) =>
  Object.freeze({
    schemaDocs: Object.freeze([
      Object.freeze({
        name: tag.slice(tag.lastIndexOf(".") + 1),
        tag,
        kind: "mutation",
        payload: Schema.Void,
        success: Schema.Void,
        error: Schema.Void,
        stream: Option.none(),
        capability: capability === undefined ? Option.none() : Option.some(capability),
        support
      } satisfies DesktopRpcSchemaDoc)
    ])
  })

const testSurfaceWithoutCapability = () =>
  Object.freeze({
    schemaDocs: Object.freeze([
      Object.freeze({
        name: "missing",
        tag: "Example.missing",
        kind: "mutation",
        payload: Schema.Void,
        success: Schema.Void,
        error: Schema.Void,
        stream: Option.none(),
        capability: Option.none(),
        support: { status: "supported" }
      } satisfies DesktopRpcSchemaDoc)
    ])
  })

const testNativeLayer = (
  ...surfaces: readonly { readonly schemaDocs: readonly DesktopRpcSchemaDoc[] }[]
): DesktopNativeLayer =>
  Object.freeze(
    surfaces.map((capabilitySurface, index) =>
      Object.freeze({
        tag: `TestSurface${index}`,
        serverLayer: Object.freeze([]),
        schemaDocs: capabilitySurface.schemaDocs,
        contractLaws: Object.freeze([])
      })
    )
  )
