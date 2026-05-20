import { expect, test } from "bun:test"
import { Effect, type Layer, ManagedRuntime } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  Download,
  DownloadCapabilityFacts,
  DownloadRpcs,
  DownloadSurface,
  makeDownloadMemoryClient,
  makeDownloadServiceLayer,
  makeDownloadUnsupportedClient
} from "./download.js"

const UnsupportedMethods = ["start", "pause", "resume", "cancel", "list"] as const

test("Download exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(DownloadRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["Download.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`Download.${method}`)
  }
})

test("Download isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeDownloadMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const downloads = yield* Download
          return yield* downloads.isSupported()
        }),
        makeDownloadServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("Download unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeDownloadUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const downloads = yield* Download
          return yield* downloads.isSupported()
        }),
        makeDownloadServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-download-unavailable")
    })
  ))

test("Download declares the 5 unsupported methods as non-callable capability facts", () => {
  const factTags = DownloadCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `Download.${method}`).toSorted())
  for (const fact of DownloadCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("Download capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: DownloadSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`Download.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableFactTags = DownloadSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["Download.isSupported"])

      const nonCallableTags = DownloadSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `Download.${method}`).toSorted()
      )
    })
  ))

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })
