import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"

import {
  ResourceOwner,
  ResourceOwnerInvalidArgumentError,
  makeResourceOwner,
  type ResourceOwnerApi
} from "./resource-owner.js"
import { PermissionActor } from "./permission-registry.js"

test("ResourceOwner constructors derive scope ids, permission actors, and attributes", async () => {
  const owners = await Promise.all([
    buildOwner(ResourceOwner.app("dev.example.notes")),
    buildOwner(
      ResourceOwner.window({
        registrationId: "compose",
        hostWindowId: "window-42"
      })
    ),
    buildOwner(ResourceOwner.job("background-indexer")),
    buildOwner(ResourceOwner.test("scope-main"))
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

test("ResourceOwner constructors reject empty and control-byte owner ids", async () => {
  const exits = await Promise.all([
    ownerExit(ResourceOwner.app("")),
    ownerExit(ResourceOwner.window({ registrationId: "main", hostWindowId: "bad\nwindow" })),
    ownerExit(ResourceOwner.job("")),
    ownerExit(ResourceOwner.test("bad\u0000scope")),
    Effect.runPromiseExit(
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

const buildOwner = (
  layer: Layer.Layer<ResourceOwner, ResourceOwnerInvalidArgumentError, never>
): Promise<ResourceOwnerApi> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* ResourceOwner
      }).pipe(Effect.provide(layer))
    )
  )

const ownerExit = (
  layer: Layer.Layer<ResourceOwner, ResourceOwnerInvalidArgumentError, never>
): Promise<Exit.Exit<ResourceOwnerApi, ResourceOwnerInvalidArgumentError>> =>
  Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* ResourceOwner
      }).pipe(Effect.provide(layer))
    )
  )

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
