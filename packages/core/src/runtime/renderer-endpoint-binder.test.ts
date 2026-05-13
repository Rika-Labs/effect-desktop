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

type BoundEndpoint =
  | {
      readonly kind: "query"
      readonly run: (input: unknown) => Effect.Effect<unknown, unknown, never>
    }
  | {
      readonly kind: "mutation"
      readonly run: (input: unknown) => Effect.Effect<unknown, unknown, never>
    }
  | {
      readonly kind: "stream"
      readonly run: (input: unknown) => Stream.Stream<unknown, unknown, never>
    }

const binders: RendererEndpointBinders<BoundEndpoint> = {
  query: (run) => ({ kind: "query", run }),
  mutation: (run) => ({ kind: "mutation", run }),
  stream: (run) => ({ kind: "stream", run })
}

test("bindRendererEndpoints binds descriptors, preserves reserved names, and attaches support", async () => {
  const descriptors = [
    descriptor("__proto__", "Notes.List", "query", { status: "supported" }),
    descriptor("create", "Notes.Create", "mutation", {
      status: "unsupported",
      reason: "host method is unavailable"
    }),
    descriptor("watch", "Notes.Watch", "stream", { status: "supported" })
  ] satisfies readonly RpcEndpointDescriptor[]
  const client: DesktopRendererRpcClient = {
    "Notes.List": () => Effect.succeed("list"),
    "Notes.Create": (input) => Effect.succeed(input),
    "Notes.Watch": () => Stream.make("one", "two")
  }

  const endpoints = bindRendererEndpoints(descriptors, client, "react", binders)
  const listEndpoint = requireEndpoint(endpoints, "__proto__")
  const createEndpoint = requireEndpoint(endpoints, "create")
  const watchEndpoint = requireEndpoint(endpoints, "watch")

  expect(Object.getPrototypeOf(endpoints)).toBe(null)
  expect(Object.prototype.hasOwnProperty.call(endpoints, "__proto__")).toBe(true)
  expect(listEndpoint.isSupported).toBe(true)
  expect(createEndpoint.isSupported).toBe(false)
  expect(createEndpoint.support).toEqual({
    status: "unsupported",
    reason: "host method is unavailable"
  })
  if (listEndpoint.kind !== "query") {
    throw new Error("expected query endpoint")
  }
  if (createEndpoint.kind !== "mutation") {
    throw new Error("expected mutation endpoint")
  }
  if (watchEndpoint.kind !== "stream") {
    throw new Error("expected stream endpoint")
  }
  expect(await Effect.runPromise(listEndpoint.run(undefined))).toBe("list")
  expect(await Effect.runPromise(createEndpoint.run("draft"))).toBe("draft")
  expect(
    Array.from(await Effect.runPromise(Stream.runCollect(watchEndpoint.run(undefined))))
  ).toEqual(["one", "two"])
})

test("bindRendererEndpoints fails loudly when a client method is missing", () => {
  const endpoints = bindRendererEndpoints(
    [descriptor("list", "Notes.List", "query", { status: "supported" })],
    {},
    "vue",
    binders
  )

  const listEndpoint = requireEndpoint(endpoints, "list")
  if (listEndpoint.kind !== "query") {
    throw new Error("expected query endpoint")
  }
  expect(() => listEndpoint.run(undefined)).toThrow(MissingDesktopRpcClientError)
})

test("bindRendererEndpoints rejects stream results for effect endpoints", () => {
  const endpoints = bindRendererEndpoints(
    [descriptor("list", "Notes.List", "query", { status: "supported" })],
    { "Notes.List": () => Stream.make("wrong") },
    "solid",
    binders
  )

  const listEndpoint = requireEndpoint(endpoints, "list")
  if (listEndpoint.kind !== "query") {
    throw new Error("expected query endpoint")
  }
  expect(() => listEndpoint.run(undefined)).toThrow(MissingDesktopRpcClientError)
})

test("bindRendererEndpoints rejects effect results for stream endpoints", () => {
  const endpoints = bindRendererEndpoints(
    [descriptor("watch", "Notes.Watch", "stream", { status: "supported" })],
    { "Notes.Watch": () => Effect.succeed("wrong") },
    "solid",
    binders
  )

  const watchEndpoint = requireEndpoint(endpoints, "watch")
  if (watchEndpoint.kind !== "stream") {
    throw new Error("expected stream endpoint")
  }
  expect(() => watchEndpoint.run(undefined)).toThrow(MissingDesktopRpcClientError)
})

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
    rpc: Rpc.make(tag, { success: Schema.String }),
    capability: Option.none(),
    support
  })

const requireEndpoint = (
  endpoints: Readonly<Record<string, BoundEndpoint & DesktopEndpointSupport>>,
  name: string
): BoundEndpoint & DesktopEndpointSupport => {
  const endpoint = endpoints[name]
  if (endpoint === undefined) {
    throw new Error(`missing endpoint ${name}`)
  }
  return endpoint
}
