import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { type BridgeClientExchange } from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { TransientWindowRoleEvent } from "./contracts/transient-window-role.js"
import {
  makeTransientWindowRoleMemoryClient,
  makeTransientWindowRoleUnsupportedClient,
  TransientWindowRole,
  TransientWindowRoleCapabilityFacts,
  type TransientWindowRoleClientApi,
  TransientWindowRoleRpcs,
  TransientWindowRoleSurface
} from "./transient-window-role.js"

const UnsupportedMethods = ["open", "reposition", "dismiss"] as const

test("TransientWindowRole public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("transient-window-role.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "TransientWindowRoleServiceApi",
        "class TransientWindowRoleClient",
        "TransientWindowRoleLive",
        "makeTransientWindowRoleClientLayer",
        "makeTransientWindowRoleServiceLayer",
        "makeTransientWindowRoleBridgeClientLayer",
        "makeTransientWindowRoleService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("TransientWindowRole exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(TransientWindowRoleRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["TransientWindowRole.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`TransientWindowRole.${method}`)
  }
})

test("TransientWindowRole declares open/reposition/dismiss as non-callable capability facts", () => {
  const factTags = TransientWindowRoleCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `TransientWindowRole.${method}`).toSorted()
  )
  for (const fact of TransientWindowRoleCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("TransientWindowRole.open stays unsupported until a role adapter owns rendered content", () => {
  const openFact = TransientWindowRoleCapabilityFacts.find(
    (fact) => fact.tag === "TransientWindowRole.open"
  )

  expect(openFact).toBeDefined()
  expect(openFact?.support).toEqual({
    status: "unsupported",
    reason: "host-adapter-unimplemented",
    platforms: [
      { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
      { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
      { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
    ]
  })
})

test("TransientWindowRole.reposition stays unsupported until a role adapter owns placement", () => {
  const repositionFact = TransientWindowRoleCapabilityFacts.find(
    (fact) => fact.tag === "TransientWindowRole.reposition"
  )

  expect(repositionFact).toBeDefined()
  expect(repositionFact?.support).toEqual({
    status: "unsupported",
    reason: "host-adapter-unimplemented",
    platforms: [
      { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
      { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
      { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
    ]
  })
})

test("TransientWindowRole.dismiss stays unsupported until an open role adapter owns handles", () => {
  const dismissFact = TransientWindowRoleCapabilityFacts.find(
    (fact) => fact.tag === "TransientWindowRole.dismiss"
  )

  expect(dismissFact).toBeDefined()
  expect(dismissFact?.support).toEqual({
    status: "unsupported",
    reason: "host-adapter-unimplemented",
    platforms: [
      { platform: "macos", status: "unsupported", reason: "host-adapter-unimplemented" },
      { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
      { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
    ]
  })
})

test("TransientWindowRole capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: TransientWindowRoleSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`TransientWindowRole.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = TransientWindowRoleSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableTags).toEqual(["TransientWindowRole.isSupported"])

      const nonCallableTags = TransientWindowRoleSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `TransientWindowRole.${method}`).toSorted()
      )
    })
  ))

test("TransientWindowRole isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeTransientWindowRoleMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* TransientWindowRole
          return yield* service.isSupported()
        }),
        transientWindowRoleLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("TransientWindowRole unsupported client reports the host-adapter-unimplemented reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeTransientWindowRoleUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* TransientWindowRole
          return yield* service.isSupported()
        }),
        transientWindowRoleLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
    })
  ))

test("TransientWindowRole events reject inconsistent phase payloads", () => {
  for (const payload of [
    {
      ...eventBase(),
      phase: "opened"
    },
    {
      ...eventBase(),
      phase: "opened",
      roleId: "role-1",
      reason: "host failed"
    },
    {
      ...eventBase(),
      phase: "repositioned"
    },
    {
      ...eventBase(),
      phase: "dismissed",
      roleId: "role-1",
      message: "dismissed"
    },
    {
      ...eventBase(),
      phase: "failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(TransientWindowRoleEvent)(payload))
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const payload of [
    {
      ...eventBase(),
      phase: "opened",
      roleId: "role-1"
    },
    {
      ...eventBase(),
      phase: "repositioned",
      roleId: "role-1"
    },
    {
      ...eventBase(),
      phase: "dismissed",
      roleId: "role-1"
    },
    {
      ...eventBase(),
      phase: "failed",
      reason: "host failed"
    },
    {
      ...eventBase(),
      phase: "failed",
      roleId: "role-1",
      reason: "host failed",
      message: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(TransientWindowRoleEvent)(payload))
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("TransientWindowRole unsupported client fails the event stream as unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeTransientWindowRoleUnsupportedClient()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* TransientWindowRole
          return yield* Effect.exit(service.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        transientWindowRoleLayer(client)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "TransientWindowRole.Event"
        })
      })
    })
  ))

test("TransientWindowRole bridge client fails event stream as unsupported before subscribing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* TransientWindowRole
          return yield* Effect.exit(service.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        TransientWindowRoleSurface.bridgeClientLayer(exchange)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "TransientWindowRole.Event"
        })
      })
      expect(subscriptions).toEqual([])
    })
  ))

const eventBase = () => ({
  type: "transient-window-role-event",
  timestamp: 1_710_000_000_001
})

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

const transientWindowRoleLayer = (
  client: TransientWindowRoleClientApi
): Layer.Layer<TransientWindowRole> => Layer.succeed(TransientWindowRole)(client)

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
