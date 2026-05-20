import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"

import {
  ResourceOwner,
  ResourceOwnerInvalidArgumentError,
  makeResourceOwner,
  type ResourceOwnerApi
} from "./resource-owner.js"
import { PermissionActor } from "./permission-registry.js"

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const collectOwner = (
  layer: Layer.Layer<ResourceOwner, ResourceOwnerInvalidArgumentError, never>
): Effect.Effect<ResourceOwnerApi, ResourceOwnerInvalidArgumentError, never> =>
  runScoped(
    Effect.gen(function* () {
      const owner = yield* ResourceOwner
      return owner
    }),
    layer
  )

test("ResourceOwner constructors derive scope ids, permission actors, and attributes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const owners = yield* Effect.all([
        collectOwner(ResourceOwner.app("dev.example.notes")),
        collectOwner(
          ResourceOwner.window({
            registrationId: "compose",
            hostWindowId: "window-42"
          })
        ),
        collectOwner(ResourceOwner.job("background-indexer")),
        collectOwner(ResourceOwner.test("scope-main"))
      ])

      expect(owners).toEqual([
        {
          kind: "app",
          scopeId: "dev.example.notes",
          actor: new PermissionActor({ kind: "app", id: "dev.example.notes" }),
          attributes: { appId: "dev.example.notes" }
        },
        {
          kind: "window",
          scopeId: "window:window-42",
          actor: new PermissionActor({ kind: "window", id: "window:window-42" }),
          attributes: { registrationId: "compose", hostWindowId: "window-42" }
        },
        {
          kind: "job",
          scopeId: "job:background-indexer",
          actor: new PermissionActor({ kind: "resource", id: "job:background-indexer" }),
          attributes: { jobId: "background-indexer" }
        },
        {
          kind: "test",
          scopeId: "scope-main",
          actor: new PermissionActor({ kind: "resource", id: "scope-main" }),
          attributes: { scopeId: "scope-main" }
        }
      ])
    })
  ))

test("ResourceOwner constructors reject empty and control-byte owner ids", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exits = yield* Effect.all([
        Effect.exit(collectOwner(ResourceOwner.app(""))),
        Effect.exit(
          collectOwner(
            ResourceOwner.window({ registrationId: "main", hostWindowId: "bad\nwindow" })
          )
        ),
        Effect.exit(collectOwner(ResourceOwner.job(""))),
        Effect.exit(collectOwner(ResourceOwner.test("bad\u0000scope"))),
        Effect.exit(
          makeResourceOwner(
            {
              kind: "test",
              scopeId: "scope-main",
              actor: new PermissionActor({ kind: "resource", id: "scope-main" }),
              attributes: { source: "bad\tattribute" }
            },
            "ResourceOwner.test"
          )
        )
      ])

      expectInvalidOwner(exits[0], "appId")
      expectInvalidOwner(exits[1], "hostWindowId")
      expectInvalidOwner(exits[2], "jobId")
      expectInvalidOwner(exits[3], "scopeId")
      expectInvalidOwner(exits[4], "attributes.source")
    })
  ))

const expectInvalidOwner = (
  exit: Exit.Exit<unknown, ResourceOwnerInvalidArgumentError>,
  field: string
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(ResourceOwnerInvalidArgumentError)
    expect(failure?.error).toMatchObject({ field })
  }
}
