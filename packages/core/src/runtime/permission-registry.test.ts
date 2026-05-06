import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Stream } from "effect"

import { type EventLogStore } from "./event-log.js"
import {
  makePermissionRegistry,
  type NormalizedCapability,
  PermissionActor,
  PermissionDeniedError,
  PermissionInvalidArgumentError
} from "./permission-registry.js"

test("PermissionRegistry denies undeclared capabilities by default and audits the normalized request", async () => {
  const rows: unknown[] = []
  const registry = await Effect.runPromise(
    makePermissionRegistry({ audit: memoryAudit(rows), traceId: () => "trace-1" })
  )
  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app/file.txt"]), context("window-main"))
  )

  expectDenied(exit, (error) => {
    expect(error.reason).toBe("default-deny")
    expect(error.traceId).toBe("trace-1")
  })
  expect(rows).toEqual([
    {
      type: "permission decision",
      payload: {
        outcome: "denied",
        reason: "default-deny",
        source: "default-deny",
        capability: filesystemWrite(["/tmp/app/file.txt"]),
        actor: actor("window-main"),
        traceId: "trace-1"
      },
      source: "PermissionRegistry"
    }
  ])
})

test("PermissionRegistry allows filesystem writes inside declared roots and denies outside", async () => {
  const registry = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => "trace-1", nextToken: () => "grant-1" })
  )

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))
  const granted = await Effect.runPromise(
    registry.check(filesystemWrite(["/tmp/app/config.json"]), context("window-main"))
  )
  const denied = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/other/config.json"]), context("window-main"))
  )

  expect(granted.token).toBe("grant-1")
  expect(granted.source).toBe("manifest")
  expectDenied(denied, (error) => {
    expect(error.reason).toBe("default-deny")
  })
})

test("PermissionRegistry explicit deny overrides a matching allow", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))
  await Effect.runPromise(
    registry.declare(filesystemWrite(["/tmp/app/blocked"]), {
      effect: "deny",
      source: "policy"
    })
  )
  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app/blocked/secret.json"]), context("window-main"))
  )

  expectDenied(exit, (error) => {
    expect(error.reason).toBe("explicit-deny")
  })
})

test("PermissionRegistry revoked rules deny even when an allow also matches", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "manifest" }))
  await Effect.runPromise(
    registry.declare(filesystemWrite(["/tmp/app"]), {
      effect: "revoked",
      source: "revocation"
    })
  )
  await Effect.runPromise(
    registry.declare(filesystemWrite(["/tmp/app"]), { source: "later-manifest" })
  )
  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app/config.json"]), context("window-main"))
  )

  expectDenied(exit, (error) => {
    expect(error.reason).toBe("revoked")
  })
})

test("PermissionRegistry query returns global and actor-scoped declarations", async () => {
  const registry = await Effect.runPromise(makePermissionRegistry())

  await Effect.runPromise(registry.declare(filesystemWrite(["/tmp/app"]), { source: "global" }))
  await Effect.runPromise(
    registry.declare(networkConnect(["api.example.com"]), {
      actor: actor("window-main"),
      source: "window"
    })
  )
  await Effect.runPromise(
    registry.declare(networkConnect(["other.example.com"]), {
      actor: actor("other-window"),
      source: "other"
    })
  )

  const filesystemRules = await Effect.runPromise(
    registry.query("filesystem.write", actor("window-main"))
  )
  const networkRules = await Effect.runPromise(
    registry.query("network.connect", actor("window-main"))
  )

  expect(filesystemRules.map((rule) => rule.source)).toEqual(["global"])
  expect(networkRules.map((rule) => rule.source)).toEqual(["window"])
})

test("PermissionRegistry validates inputs before audit side effects", async () => {
  const rows: unknown[] = []
  const registry = await Effect.runPromise(makePermissionRegistry({ audit: memoryAudit(rows) }))
  const invalidContext = { actor: { kind: "window", id: "" } }
  const exit = await Effect.runPromiseExit(
    registry.check(filesystemWrite(["/tmp/app"]), invalidContext as never)
  )

  expectInvalid(exit)
  expect(rows).toEqual([])
})

const actor = (id: string): PermissionActor => new PermissionActor({ kind: "window", id })

const context = (id: string) => ({ actor: actor(id) })

const filesystemWrite = (roots: readonly string[]): NormalizedCapability => ({
  kind: "filesystem.write",
  roots,
  audit: "always"
})

const networkConnect = (hosts: readonly string[]): NormalizedCapability => ({
  kind: "network.connect",
  hosts,
  askUnknownHosts: false,
  audit: "always"
})

const memoryAudit = (rows: unknown[]): EventLogStore => ({
  append: (event, options) =>
    Effect.sync(() => {
      rows.push({
        type: event.type,
        ...(event.payload === undefined ? {} : { payload: event.payload }),
        ...(options?.source === undefined ? {} : { source: options.source })
      })
      return rows.length - 1
    }),
  query: () => Effect.succeed([]),
  subscribe: () => Stream.die("unused"),
  close: () => Effect.void
})

const expectDenied = (
  exit: Exit.Exit<unknown, unknown>,
  inspect?: (error: PermissionDeniedError) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(PermissionDeniedError)
    if (failure?.error instanceof PermissionDeniedError) {
      inspect?.(failure.error)
    }
  }
}

const expectInvalid = (exit: Exit.Exit<unknown, unknown>): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(PermissionInvalidArgumentError)
  }
}
