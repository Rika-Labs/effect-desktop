import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError
} from "@orika/bridge"
import { makeResourceId, P } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { NetworkAuthEvent } from "./contracts/network-auth.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  makeNetworkAuthMemoryClient,
  makeNetworkAuthUnsupportedClient,
  NetworkAuth,
  NetworkAuthCapabilityFacts,
  type NetworkAuthClientApi,
  NetworkAuthRpcs,
  NetworkAuthSurface
} from "./network-auth.js"

const UnsupportedMethods = ["handleAuth", "handleCertificate"] as const
const SupportedMethods = ["setProxy"] as const
const UnsupportedSupport = {
  status: "unsupported",
  reason: "host-network-auth-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-network-auth-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-network-auth-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-network-auth-unavailable" }
  ]
} as const
const Profile = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-1"),
  generation: 0,
  ownerScope: "workspace:1",
  state: "open"
} satisfies SessionProfileHandle
const OtherProfile = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-2"),
  generation: 0,
  ownerScope: "workspace:2",
  state: "open"
} satisfies SessionProfileHandle

test("NetworkAuth public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("network-auth.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "NetworkAuthServiceApi",
        "class NetworkAuthClient",
        "NetworkAuthLive",
        "makeNetworkAuthClientLayer",
        "makeNetworkAuthServiceLayer",
        "makeNetworkAuthBridgeClientLayer",
        "makeNetworkAuthService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("NetworkAuth exposes isSupported and setProxy as callable RPCs", () => {
  const callableTags = Array.from(NetworkAuthRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["NetworkAuth.isSupported", "NetworkAuth.setProxy"])
  for (const method of SupportedMethods) {
    expect(callableTags).toContain(`NetworkAuth.${method}`)
  }
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`NetworkAuth.${method}`)
  }
})

test("NetworkAuth isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeNetworkAuthMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* networkAuth.isSupported()
        }),
        networkAuthLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("NetworkAuth unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeNetworkAuthUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* networkAuth.isSupported()
        }),
        networkAuthLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-network-auth-unavailable")
    })
  ))

test("NetworkAuth setProxy returns the stored proxy policy through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeNetworkAuthMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* networkAuth.setProxy({
            profile: Profile,
            mode: "fixed",
            server: "http://proxy.example.test:8080"
          })
        }),
        networkAuthLayer(client)
      )
      expect(result).toEqual({
        profile: Profile,
        mode: "fixed",
        server: "http://proxy.example.test:8080",
        bypass: []
      })
    })
  ))

test("NetworkAuth contracts reject inconsistent event phase payloads", () => {
  const invalidPayloads = [
    {
      type: "network-auth-event",
      timestamp: 1_710_000_000_000,
      phase: "proxy-updated",
      profile: Profile,
      requestId: "request-1",
      decision: "allow"
    },
    {
      type: "network-auth-event",
      timestamp: 1_710_000_000_000,
      phase: "auth-decided",
      profile: Profile,
      message: "missing decision"
    },
    {
      type: "network-auth-event",
      timestamp: 1_710_000_000_000,
      phase: "certificate-decided",
      profile: Profile,
      requestId: "request-1",
      origin: "https://example.test",
      decision: "allow",
      message: "extra failure"
    },
    {
      type: "network-auth-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      profile: Profile,
      requestId: "request-1",
      origin: "https://example.test",
      decision: "deny",
      message: "host failed"
    }
  ] as const

  for (const payload of invalidPayloads) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(NetworkAuthEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      type: "network-auth-event",
      timestamp: 1_710_000_000_000,
      phase: "proxy-updated",
      profile: Profile
    },
    {
      type: "network-auth-event",
      timestamp: 1_710_000_000_000,
      phase: "auth-decided",
      profile: Profile,
      requestId: "request-1",
      origin: "https://example.test",
      decision: "allow"
    },
    {
      type: "network-auth-event",
      timestamp: 1_710_000_000_000,
      phase: "certificate-decided",
      profile: Profile,
      requestId: "request-1",
      origin: "https://example.test",
      decision: "deny"
    },
    {
      type: "network-auth-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      profile: Profile,
      message: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(NetworkAuthEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("NetworkAuth bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("NetworkAuth event test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "network-auth-event-trace",
              payload: {
                type: "network-auth-event",
                timestamp: 1_710_000_000_000,
                phase: "auth-decided",
                profile: Profile,
                message: "missing decision"
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* Effect.exit(
            networkAuth.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        NetworkAuthSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
    })
  ))

test("NetworkAuth bridge client filters event streams by session profile", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("NetworkAuth event filter test does not issue bridge requests"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "network-auth-other-profile",
              payload: {
                type: "network-auth-event",
                timestamp: 1_710_000_000_000,
                phase: "proxy-updated",
                profile: OtherProfile
              }
            }),
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_001,
              traceId: "network-auth-target-profile",
              payload: {
                type: "network-auth-event",
                timestamp: 1_710_000_000_001,
                phase: "proxy-updated",
                profile: Profile
              }
            })
          )
        }
      }
      const events = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* networkAuth.events(Profile).pipe(Stream.take(1), Stream.runCollect)
        }),
        NetworkAuthSurface.bridgeClientLayer(exchange)
      )

      expect(Array.from(events)).toEqual([
        new NetworkAuthEvent({
          type: "network-auth-event",
          timestamp: 1_710_000_000_001,
          phase: "proxy-updated",
          profile: Profile
        })
      ])
      expect(subscriptions).toEqual(["NetworkAuth.Event"])
    })
  ))

test("NetworkAuth declares the 2 unsupported methods as non-callable capability facts", () => {
  const factTags = NetworkAuthCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `NetworkAuth.${method}`).toSorted())
  for (const fact of NetworkAuthCapabilityFacts) {
    expect(fact.support).toEqual(UnsupportedSupport)
  }
})

test("NetworkAuth exposes setProxy as the selected permission and keeps isSupported unprivileged", () => {
  expect(NetworkAuthSurface.permissions.setProxy).toEqual(
    P.nativeInvoke({ primitive: "NetworkAuth", methods: ["setProxy"] })
  )
  expect("isSupported" in NetworkAuthSurface.permissions).toBe(false)
  expect(NetworkAuthSurface.permissions.all).toContainEqual(
    P.nativeInvoke({ primitive: "NetworkAuth", methods: ["setProxy"] })
  )
})

test("NetworkAuth capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: NetworkAuthSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`NetworkAuth.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support).toEqual(UnsupportedSupport)
      }

      const callableFactTags = NetworkAuthSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["NetworkAuth.isSupported", "NetworkAuth.setProxy"])

      const nonCallableTags = NetworkAuthSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `NetworkAuth.${method}`).toSorted()
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

const networkAuthLayer = (client: NetworkAuthClientApi): Layer.Layer<NetworkAuth> =>
  Layer.succeed(NetworkAuth)(client)

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
