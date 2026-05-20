import { expect, test } from "bun:test"
import { Effect, Option, Schema, Stream } from "effect"
import { Rpc } from "effect/unstable/rpc"

import { MissingDesktopRpcClientError } from "./desktop-errors.js"
import {
  bindRendererEndpoints,
  type DesktopEndpointSupport,
  type RendererEndpointBinders
} from "./renderer-endpoint-binder.js"
import type { DesktopRendererRpcClient } from "./renderer-rpc-client.js"
import type { RpcEndpointDescriptor } from "./rpc-descriptors.js"

class EndpointFailure extends Schema.TaggedErrorClass<EndpointFailure>()("EndpointFailure", {
  cause: Schema.Defect
}) {}

class ExpectedEndpointKindMissing extends Schema.TaggedErrorClass<ExpectedEndpointKindMissing>()(
  "ExpectedEndpointKindMissing",
  {}
) {}

class MissingEndpointFound extends Schema.TaggedErrorClass<MissingEndpointFound>()(
  "MissingEndpointFound",
  {}
) {}

type BoundEndpoint =
  | {
      readonly kind: "query"
      readonly run: (input: unknown) => Effect.Effect<unknown, EndpointFailure, never>
    }
  | {
      readonly kind: "mutation"
      readonly run: (input: unknown) => Effect.Effect<unknown, EndpointFailure, never>
    }
  | {
      readonly kind: "stream"
      readonly run: (input: unknown) => Stream.Stream<unknown, EndpointFailure, never>
    }

const wrapEffectRun =
  <E>(run: (input: unknown) => Effect.Effect<unknown, E, never>) =>
  (input: unknown): Effect.Effect<unknown, EndpointFailure, never> =>
    Effect.mapError(run(input), (cause: E) => new EndpointFailure({ cause }))

const wrapStreamRun =
  <E>(run: (input: unknown) => Stream.Stream<unknown, E, never>) =>
  (input: unknown): Stream.Stream<unknown, EndpointFailure, never> =>
    Stream.mapError(run(input), (cause: E) => new EndpointFailure({ cause }))

const binders: RendererEndpointBinders<BoundEndpoint> = {
  query: (run) => ({ kind: "query", run: wrapEffectRun(run) }),
  mutation: (run) => ({ kind: "mutation", run: wrapEffectRun(run) }),
  stream: (run) => ({ kind: "stream", run: wrapStreamRun(run) })
}

const requireEndpoint = (
  endpoints: Readonly<Record<string, BoundEndpoint & DesktopEndpointSupport>>,
  name: string
): Effect.Effect<BoundEndpoint & DesktopEndpointSupport, MissingEndpointFound, never> =>
  Effect.gen(function* () {
    const endpoint = endpoints[name]
    if (endpoint === undefined) {
      return yield* new MissingEndpointFound()
    }
    return endpoint
  })

test("bindRendererEndpoints binds descriptors, preserves reserved names, and attaches support", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const descriptors = [
        descriptor("__proto__", "Notes.List", "query", { status: "supported" }),
        descriptor("create", "Notes.Create", "mutation", {
          status: "unsupported",
          reason: "host method is unavailable"
        }),
        descriptor("share", "Notes.Share", "mutation", {
          status: "partial",
          reason: "platform implementations differ",
          platforms: [{ platform: "linux", status: "unsupported", reason: "portal missing" }]
        }),
        descriptor("watch", "Notes.Watch", "stream", { status: "supported" })
      ] satisfies readonly RpcEndpointDescriptor[]
      const client: DesktopRendererRpcClient = {
        "Notes.List": () => Effect.succeed("list"),
        "Notes.Create": (input) => Effect.succeed(input),
        "Notes.Share": (input) => Effect.succeed(input),
        "Notes.Watch": () => Stream.make("one", "two")
      }

      const endpoints = bindRendererEndpoints(descriptors, client, "react", binders)
      const listEndpoint = yield* requireEndpoint(endpoints, "__proto__")
      const createEndpoint = yield* requireEndpoint(endpoints, "create")
      const shareEndpoint = yield* requireEndpoint(endpoints, "share")
      const watchEndpoint = yield* requireEndpoint(endpoints, "watch")

      expect(Object.getPrototypeOf(endpoints)).toBe(null)
      expect(Object.prototype.hasOwnProperty.call(endpoints, "__proto__")).toBe(true)
      expect(listEndpoint.isSupported).toBe(true)
      expect(createEndpoint.isSupported).toBe(false)
      expect(shareEndpoint.isSupported).toBe(true)
      expect(shareEndpoint.support).toEqual({
        status: "partial",
        reason: "platform implementations differ",
        platforms: [{ platform: "linux", status: "unsupported", reason: "portal missing" }]
      })
      expect(createEndpoint.support).toEqual({
        status: "unsupported",
        reason: "host method is unavailable"
      })
      if (listEndpoint.kind !== "query") {
        return yield* new ExpectedEndpointKindMissing()
      }
      if (createEndpoint.kind !== "mutation") {
        return yield* new ExpectedEndpointKindMissing()
      }
      if (watchEndpoint.kind !== "stream") {
        return yield* new ExpectedEndpointKindMissing()
      }
      expect(yield* listEndpoint.run(undefined)).toBe("list")
      expect(yield* createEndpoint.run("draft")).toBe("draft")
      expect(Array.from(yield* Stream.runCollect(watchEndpoint.run(undefined)))).toEqual([
        "one",
        "two"
      ])
    })
  ))

test("bindRendererEndpoints fails loudly when a client method is missing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const endpoints = bindRendererEndpoints(
        [descriptor("list", "Notes.List", "query", { status: "supported" })],
        {},
        "vue",
        binders
      )

      const listEndpoint = yield* requireEndpoint(endpoints, "list")
      if (listEndpoint.kind !== "query") {
        return yield* new ExpectedEndpointKindMissing()
      }
      expect(() => listEndpoint.run(undefined)).toThrow(MissingDesktopRpcClientError)
    })
  ))

test("bindRendererEndpoints rejects stream results for effect endpoints", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const endpoints = bindRendererEndpoints(
        [descriptor("list", "Notes.List", "query", { status: "supported" })],
        { "Notes.List": () => Stream.make("wrong") },
        "solid",
        binders
      )

      const listEndpoint = yield* requireEndpoint(endpoints, "list")
      if (listEndpoint.kind !== "query") {
        return yield* new ExpectedEndpointKindMissing()
      }
      expect(() => listEndpoint.run(undefined)).toThrow(MissingDesktopRpcClientError)
    })
  ))

test("bindRendererEndpoints rejects effect results for stream endpoints", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const endpoints = bindRendererEndpoints(
        [descriptor("watch", "Notes.Watch", "stream", { status: "supported" })],
        { "Notes.Watch": () => Effect.succeed("wrong") },
        "solid",
        binders
      )

      const watchEndpoint = yield* requireEndpoint(endpoints, "watch")
      if (watchEndpoint.kind !== "stream") {
        return yield* new ExpectedEndpointKindMissing()
      }
      expect(() => watchEndpoint.run(undefined)).toThrow(MissingDesktopRpcClientError)
    })
  ))

const descriptor = (
  name: string,
  tag: string,
  kind: RpcEndpointDescriptor["kind"],
  support: RpcEndpointDescriptor["support"]
): RpcEndpointDescriptor =>
  Object.freeze({
    name,
    tag,
    kind,
    hasPayload: false,
    rpc: Rpc.make(tag, { success: Schema.String }),
    capability: Option.none(),
    support
  })
