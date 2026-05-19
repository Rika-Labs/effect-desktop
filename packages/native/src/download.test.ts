import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import {
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Stream } from "effect"

import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  Download,
  makeDownloadMemoryClient,
  makeDownloadServiceLayer,
  makeDownloadUnsupportedClient,
  type DownloadClientApi
} from "./download.js"

test("Download starts, controls, emits terminal cancellation, and disposes once", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeDownloadMemoryClient())
  let cancels = 0
  const client: DownloadClientApi = {
    ...baseClient,
    cancel: (input) =>
      Effect.sync(() => {
        cancels += 1
      }).pipe(Effect.andThen(baseClient.cancel(input)))
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const downloads = yield* Download
      const started = yield* downloads.start(profileA, "https://example.test/file.zip", {
        ownerScope: "workspace:a"
      })
      const paused = yield* downloads.pause(started.download)
      const resumed = yield* downloads.resume(started.download)
      const canceled = yield* downloads.cancel(started.download)
      const list = yield* downloads.list({ profile: profileA })
      const events = yield* downloads
        .events(started.download)
        .pipe(Stream.take(4), Stream.runCollect)
      yield* resources.closeScope("workspace:a")
      return { canceled, events: Array.from(events), list, paused, resumed, started }
    }).pipe(Effect.provide(makeDownloadServiceLayer(client, { permissions, resources })))
  )

  expect(result.started.download.kind).toBe("download")
  expect(result.paused.state).toBe("paused")
  expect(result.resumed.state).toBe("running")
  expect(result.canceled.state).toBe("canceled")
  expect(result.list.downloads.map((snapshot) => snapshot.download.id)).toEqual([
    result.started.download.id
  ])
  expect(result.events.map((event) => event.phase)).toEqual([
    "started",
    "paused",
    "resumed",
    "canceled"
  ])
  expect(cancels).toBe(1)
})

test("Download denies before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeDownloadMemoryClient())
  let calls = 0
  const client: DownloadClientApi = {
    ...baseClient,
    start: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.start(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const downloads = yield* Download
      return yield* Effect.exit(downloads.start(profileA, "https://example.test/file.zip"))
    }).pipe(Effect.provide(makeDownloadServiceLayer(client, { permissions, resources })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "Download.start" })
  })
})

test("Download surfaces unsupported and host failures as typed failures", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const unsupported = makeDownloadUnsupportedClient()
  const failing = await Effect.runPromise(
    makeDownloadMemoryClient({
      failure: { list: makeHostProtocolInternalError("host failed", "Download.list") }
    })
  )

  const unsupportedExit = await Effect.runPromise(
    Effect.gen(function* () {
      const downloads = yield* Download
      return yield* Effect.exit(downloads.start(profileA, "https://example.test/file.zip"))
    }).pipe(Effect.provide(makeDownloadServiceLayer(unsupported, { permissions, resources })))
  )
  const failureExit = await Effect.runPromise(
    Effect.gen(function* () {
      const downloads = yield* Download
      return yield* Effect.exit(downloads.list({ profile: profileA }))
    }).pipe(Effect.provide(makeDownloadServiceLayer(failing, { permissions, resources })))
  )

  expectExitFailure(unsupportedExit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "Download.start" })
  })
  expectExitFailure(failureExit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "Download.list" })
  })
})

test("Download rejects malformed input before client work", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeDownloadMemoryClient())
  let calls = 0
  const client: DownloadClientApi = {
    ...baseClient,
    start: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.start(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const downloads = yield* Download
      return yield* Effect.exit(downloads.start(profileA, "file:///tmp/file.zip"))
    }).pipe(Effect.provide(makeDownloadServiceLayer(client, { permissions, resources })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "Download.start" })
  })
})

const profileA: SessionProfileHandle = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-a"),
  generation: 0,
  ownerScope: "workspace:a",
  state: "open"
}

const configuredPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "Download", methods: ["start"] })),
      permissions.declare(P.nativeInvoke({ primitive: "Download", methods: ["pause"] })),
      permissions.declare(P.nativeInvoke({ primitive: "Download", methods: ["resume"] })),
      permissions.declare(P.nativeInvoke({ primitive: "Download", methods: ["cancel"] })),
      permissions.declare(P.nativeInvoke({ primitive: "Download", methods: ["list"] }))
    ])
  )
  return permissions
}

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
