import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolError,
  type HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError,
  type HostProtocolRequestEnvelope,
  makeHostProtocolInternalError
} from "@orika/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  P,
  PermissionActor
} from "@orika/core"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Schema, Stream } from "effect"

import {
  ExtensionPackage,
  ExtensionPackageClient,
  ExtensionPackageSurface,
  makeExtensionPackageMemoryClient,
  makeExtensionPackageServiceLayer,
  makeExtensionPackageUnsupportedClient,
  type ExtensionPackageClientApi
} from "./extension-package.js"
import {
  ExtensionPackageActor,
  ExtensionPackageCapabilityDeclaration,
  ExtensionPackageCompatibility,
  ExtensionPackageEvent,
  ExtensionPackageInstallInput,
  ExtensionPackageInstallRequest,
  ExtensionPackageManifest,
  ExtensionPackageRemoveRequest,
  ExtensionPackageSource,
  ExtensionPackageUpdateInput,
  ExtensionPackageUpdateRequest
} from "./contracts/extension-package.js"

test("ExtensionPackage service installs validated manifests, registers capabilities, emits events, and audits use", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const client = yield* makeExtensionPackageMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const packages = yield* ExtensionPackage
          const installed = yield* packages.install(installRequest())
          const listed = yield* packages.list()
          const event = yield* packages.events().pipe(Stream.runHead)
          return { event, installed, listed }
        }),
        makeExtensionPackageServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          hostVersion: "1.2.0",
          nextTraceId: () => "trace-package"
        })
      )

      expect(result.installed).toMatchObject({
        packageId: "extension-1",
        version: "1.0.0",
        registeredCapabilities: [manifestCapability()]
      })
      expect(result.listed.packages.map((entry) => entry.packageId)).toEqual(["extension-1"])
      expect(result.event._tag).toBe("Some")
      expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
      expect(rows.some((row) => row.kind === "permission-granted")).toBe(true)

      const scopedRules = yield* permissions.query(
        "filesystem.read",
        new PermissionActor({ kind: "resource", id: "extension:extension-1" })
      )
      expect(scopedRules.map((rule) => rule.source)).toContain(
        "extension-package:extension-1@1.0.0"
      )
    })
  ))

test("ExtensionPackage denies before host side effects or capability registration", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      let installs = 0
      const baseClient = yield* makeExtensionPackageMemoryClient()
      const client: ExtensionPackageClientApi = {
        ...baseClient,
        install: (input) =>
          Effect.sync(() => {
            installs += 1
          }).pipe(Effect.andThen(baseClient.install(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const packages = yield* ExtensionPackage
          return yield* Effect.exit(packages.install(installRequest()))
        }),
        makeExtensionPackageServiceLayer(client, { permissions })
      )
      const scopedRules = yield* permissions.query(
        "filesystem.read",
        new PermissionActor({ kind: "resource", id: "extension:extension-1" })
      )

      expect(installs).toBe(0)
      expect(scopedRules).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "ExtensionPackage.install"
        })
      })
    })
  ))

test("ExtensionPackage denies undeclared manifest capabilities before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([], { includeManifestCapabilities: false })
      let installs = 0
      const baseClient = yield* makeExtensionPackageMemoryClient()
      const client: ExtensionPackageClientApi = {
        ...baseClient,
        install: (input) =>
          Effect.sync(() => {
            installs += 1
          }).pipe(Effect.andThen(baseClient.install(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const packages = yield* ExtensionPackage
          return yield* Effect.exit(packages.install(installRequest()))
        }),
        makeExtensionPackageServiceLayer(client, { permissions })
      )
      const scopedRules = yield* permissions.query(
        "filesystem.read",
        new PermissionActor({ kind: "resource", id: "extension:extension-1" })
      )

      expect(installs).toBe(0)
      expect(scopedRules).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "ExtensionPackage.install"
        })
      })
    })
  ))

test("ExtensionPackage rejects malformed manifests before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: {
              packageId: "extension-1",
              version: "1.0.0",
              revision: 1,
              registeredCapabilities: [manifestCapability()]
            }
          })
        },
        subscribe: () => Stream.empty
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ExtensionPackageClient
          return yield* Effect.exit(
            client.install(
              new ExtensionPackageInstallInput({
                actor: actor(),
                source: source(),
                manifest: manifest({ entrypoint: "../escape.js" })
              })
            )
          )
        }),
        ExtensionPackageSurface.bridgeClientLayer(exchange)
      )

      expect(requests).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ExtensionPackage.install"
        })
      })
    })
  ))

test("ExtensionPackage checks compatibility before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      let installs = 0
      const baseClient = yield* makeExtensionPackageMemoryClient()
      const client: ExtensionPackageClientApi = {
        ...baseClient,
        install: (input) =>
          Effect.sync(() => {
            installs += 1
          }).pipe(Effect.andThen(baseClient.install(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const packages = yield* ExtensionPackage
          return yield* Effect.exit(
            packages.install(
              installRequest({
                manifest: manifest({
                  compatibility: new ExtensionPackageCompatibility({ minHostVersion: "9.0.0" })
                })
              })
            )
          )
        }),
        makeExtensionPackageServiceLayer(client, { permissions, hostVersion: "1.2.0" })
      )

      expect(installs).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ExtensionPackage.install"
        })
      })
    })
  ))

test("ExtensionPackage rejects malformed SemVer before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: {
              packageId: "extension-1",
              version: "1.0.0-",
              revision: 1,
              registeredCapabilities: [manifestCapability()]
            }
          })
        },
        subscribe: () => Stream.empty
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ExtensionPackageClient
          return yield* Effect.exit(
            client.install(
              new ExtensionPackageInstallInput({
                actor: actor(),
                source: source(),
                manifest: manifest({ version: "1.0.0-" })
              })
            )
          )
        }),
        ExtensionPackageSurface.bridgeClientLayer(exchange)
      )

      expect(requests).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ExtensionPackage.install"
        })
      })
    })
  ))

test("ExtensionPackage rejects dot-segment package ids before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: {
              packageId: "..",
              version: "1.0.0",
              revision: 1,
              registeredCapabilities: [manifestCapability()]
            }
          })
        },
        subscribe: () => Stream.empty
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ExtensionPackageClient
          return yield* Effect.exit(
            client.install(
              new ExtensionPackageInstallInput({
                actor: actor(),
                source: source(),
                manifest: manifest({ id: ".." })
              })
            )
          )
        }),
        ExtensionPackageSurface.bridgeClientLayer(exchange)
      )

      expect(requests).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ExtensionPackage.install"
        })
      })
    })
  ))

test("ExtensionPackage unsupported client exposes typed unsupported failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeExtensionPackageUnsupportedClient()
      const supported = yield* client.isSupported()
      const exit = yield* Effect.exit(client.install(installInput()))

      expect(supported).toEqual({ supported: false, reason: "host-adapter-unimplemented" })
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "ExtensionPackage.install" })
      })
    })
  ))

test("ExtensionPackage memory client exposes typed host failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeExtensionPackageMemoryClient({
        failure: {
          install: makeHostProtocolInternalError(
            "extension package failed",
            "ExtensionPackage.install"
          )
        }
      })

      const exit = yield* Effect.exit(client.install(installInput()))

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "ExtensionPackage.install" })
      })
    })
  ))

test("ExtensionPackage memory client enforces host lifecycle state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeExtensionPackageMemoryClient()
      yield* client.install(installInput())

      const duplicate = yield* Effect.exit(client.install(installInput()))
      const staleUpdate = yield* Effect.exit(
        client.update(
          new ExtensionPackageUpdateInput({
            actor: actor(),
            source: source(),
            manifest: manifest({ version: "1.1.0" }),
            expectedVersion: "0.9.0",
            traceId: "trace-update"
          })
        )
      )
      const missingClient = yield* makeExtensionPackageMemoryClient()
      const missingUpdate = yield* Effect.exit(
        missingClient.update(
          new ExtensionPackageUpdateInput({
            actor: actor(),
            source: source(),
            manifest: manifest({ version: "1.1.0" }),
            traceId: "trace-update"
          })
        )
      )

      expectExitFailure(duplicate, (error) => {
        expect(error).toMatchObject({ tag: "AlreadyExists", operation: "ExtensionPackage.install" })
      })
      expectExitFailure(staleUpdate, (error) => {
        expect(error).toMatchObject({ tag: "InvalidState", operation: "ExtensionPackage.update" })
      })
      expectExitFailure(missingUpdate, (error) => {
        expect(error).toMatchObject({ tag: "NotFound", operation: "ExtensionPackage.update" })
      })
    })
  ))

test("ExtensionPackage update and remove publish lifecycle state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const client = yield* makeExtensionPackageMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const packages = yield* ExtensionPackage
          yield* packages.install(installRequest())
          const updated = yield* packages.update(
            new ExtensionPackageUpdateRequest({
              actor: actor(),
              source: source(),
              manifest: manifest({ version: "1.1.0" }),
              expectedVersion: "1.0.0",
              traceId: "trace-update"
            })
          )
          const removed = yield* packages.remove(removeRequest())
          const listed = yield* packages.list()
          return { listed, removed, updated }
        }),
        makeExtensionPackageServiceLayer(client, { permissions })
      )

      expect(result.updated.previousVersion).toBe("1.0.0")
      expect(result.updated.version).toBe("1.1.0")
      expect(result.removed.removed).toBe(true)
      expect(result.listed.packages).toEqual([])
    })
  ))

test("ExtensionPackage events reject inconsistent failure reasons", () => {
  for (const phase of [
    "installing",
    "installed",
    "updating",
    "updated",
    "removing",
    "removed"
  ] as const) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(ExtensionPackageEvent)({
        ...eventBase(),
        phase,
        reason: "host failed"
      })
    )
    expect(exit._tag).toBe("Failure")
  }

  const failedWithoutReason = Effect.runSyncExit(
    Schema.decodeUnknownEffect(ExtensionPackageEvent)({
      ...eventBase(),
      phase: "failed"
    })
  )
  expect(failedWithoutReason._tag).toBe("Failure")

  for (const phase of [
    "installing",
    "installed",
    "updating",
    "updated",
    "removing",
    "removed"
  ] as const) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(ExtensionPackageEvent)({
        ...eventBase(),
        phase
      })
    )
    expect(exit._tag).toBe("Success")
  }

  const failedWithReason = Effect.runSyncExit(
    Schema.decodeUnknownEffect(ExtensionPackageEvent)({
      ...eventBase(),
      phase: "failed",
      reason: "host failed"
    })
  )
  expect(failedWithReason._tag).toBe("Success")
})

test("ExtensionPackage bridge client decodes native lifecycle events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const nativeEvent: HostProtocolEventEnvelope = {
        kind: "event",
        method: "ExtensionPackage.Event",
        timestamp: 1710000000000,
        traceId: "trace-extension-package-event",
        payload: {
          type: "extension-package-event",
          timestamp: 1710000000000,
          packageId: "extension-1",
          phase: "installed",
          version: "1.0.0",
          revision: 1
        }
      }
      const exchange: BridgeClientExchange = {
        request: () => Effect.fail(makeHostProtocolInternalError("unexpected request", "test")),
        subscribe: (method) => {
          expect(method).toBe("ExtensionPackage.Event")
          return Stream.make(nativeEvent)
        }
      }
      const event = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ExtensionPackageClient
          return yield* client.events().pipe(Stream.runHead)
        }),
        ExtensionPackageSurface.bridgeClientLayer(exchange)
      )

      expect(event._tag).toBe("Some")
      if (event._tag === "Some") {
        expect(event.value).toMatchObject({
          packageId: "extension-1",
          phase: "installed",
          version: "1.0.0",
          revision: 1
        })
      }
    })
  ))

test("ExtensionPackage bridge client rejects inconsistent lifecycle events as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const nativeEvent: HostProtocolEventEnvelope = {
        kind: "event",
        method: "ExtensionPackage.Event",
        timestamp: 1710000000000,
        traceId: "trace-extension-package-event",
        payload: {
          ...eventBase(),
          phase: "installed",
          version: "1.0.0",
          revision: 1,
          reason: "host failed"
        }
      }
      const exchange: BridgeClientExchange = {
        request: () => Effect.fail(makeHostProtocolInternalError("unexpected request", "test")),
        subscribe: () => Stream.make(nativeEvent)
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ExtensionPackageClient
          return yield* Effect.exit(client.events().pipe(Stream.runHead))
        }),
        ExtensionPackageSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
    })
  ))

test("ExtensionPackage RPC metadata reports host methods as supported", () => {
  expect(
    ExtensionPackageSurface.schemaDocs.map((doc) => ({
      support: doc.support,
      tag: doc.tag
    }))
  ).toEqual([
    { tag: "ExtensionPackage.install", support: { status: "supported" } },
    { tag: "ExtensionPackage.update", support: { status: "supported" } },
    { tag: "ExtensionPackage.remove", support: { status: "supported" } },
    { tag: "ExtensionPackage.list", support: { status: "supported" } },
    { tag: "ExtensionPackage.isSupported", support: { status: "supported" } }
  ])
})

const actor = (): ExtensionPackageActor =>
  new ExtensionPackageActor({ kind: "extension", id: "extension-1" })

const source = (): ExtensionPackageSource =>
  new ExtensionPackageSource({
    kind: "directory",
    uri: "file:///tmp/effect-desktop/extensions/extension-1",
    digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  })

const manifestCapability = () => P.filesystemRead({ roots: ["/tmp/effect-desktop/extensions"] })

const eventBase = () => ({
  type: "extension-package-event",
  timestamp: 1_710_000_000_000,
  packageId: "extension-1"
})

const manifest = (
  overrides: Partial<{
    readonly compatibility: ExtensionPackageCompatibility
    readonly entrypoint: string
    readonly id: string
    readonly version: string
  }> = {}
): ExtensionPackageManifest =>
  new ExtensionPackageManifest({
    id: overrides.id ?? "extension-1",
    name: "Extension One",
    version: overrides.version ?? "1.0.0",
    entrypoint: overrides.entrypoint ?? "dist/main.js",
    compatibility:
      overrides.compatibility ??
      new ExtensionPackageCompatibility({ minHostVersion: "1.0.0", maxHostVersion: "2.0.0" }),
    capabilities: [
      new ExtensionPackageCapabilityDeclaration({
        capability: manifestCapability(),
        reason: "read packaged extension assets"
      })
    ]
  })

const installRequest = (
  overrides: Partial<{
    readonly manifest: ExtensionPackageManifest
  }> = {}
): ExtensionPackageInstallRequest =>
  new ExtensionPackageInstallRequest({
    actor: actor(),
    source: source(),
    manifest: overrides.manifest ?? manifest(),
    traceId: "trace-install"
  })

const installInput = (): ExtensionPackageInstallInput =>
  new ExtensionPackageInstallInput({
    actor: actor(),
    source: source(),
    manifest: manifest(),
    traceId: "trace-install"
  })

const removeRequest = (): ExtensionPackageRemoveRequest =>
  new ExtensionPackageRemoveRequest({
    actor: actor(),
    packageId: "extension-1",
    traceId: "trace-remove"
  })

const configuredPermissions = (
  rows: AuditEvent[],
  options: { readonly includeManifestCapabilities?: boolean } = {}
) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
    yield* permissions.declare(
      P.nativeInvoke({
        primitive: "ExtensionPackage",
        methods: ["install", "update", "remove"]
      })
    )
    if (options.includeManifestCapabilities ?? true) {
      yield* permissions.declare(manifestCapability(), {
        source: "test-extension-package-manifest"
      })
    }
    return permissions
  })

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
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

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
  }
}
