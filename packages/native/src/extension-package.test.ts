import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  type HostProtocolError,
  type HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  rpcSupport
} from "@orika/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  P,
  PermissionActor
} from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import {
  ExtensionPackage,
  ExtensionPackageClient,
  ExtensionPackageMethodNames,
  ExtensionPackageRpcs,
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
  ExtensionPackageManifest,
  ExtensionPackageRemoveInput,
  ExtensionPackageSource,
  ExtensionPackageUpdateInput
} from "./contracts/extension-package.js"

test("ExtensionPackage public surface omits shallow event and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("extension-package.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of ["ExtensionPackageRpcEvents", "ExtensionPackageLive"]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("ExtensionPackage mutating operations use one canonical input schema", async () => {
  const contractModule = await import("./contracts/extension-package.js")
  const contractSource = await readFile(
    new URL("contracts/extension-package.ts", import.meta.url),
    "utf8"
  )
  const source = await readFile(new URL("extension-package.ts", import.meta.url), "utf8")
  const installRpc = ExtensionPackageRpcs.requests.get("ExtensionPackage.install")
  const updateRpc = ExtensionPackageRpcs.requests.get("ExtensionPackage.update")
  const removeRpc = ExtensionPackageRpcs.requests.get("ExtensionPackage.remove")

  for (const removedName of [
    "ExtensionPackageInstallRequest",
    "ExtensionPackageUpdateRequest",
    "ExtensionPackageRemoveRequest"
  ]) {
    expect(removedName in contractModule).toBe(false)
    expect(contractSource).not.toContain(removedName)
    expect(source).not.toContain(removedName)
  }

  expect(source).not.toContain("validateInstallRequest")
  expect(source).not.toContain("validateUpdateRequest")
  expect(source).not.toContain("validateRemoveRequest")
  expect(source).not.toContain("toInstallInput")
  expect(source).not.toContain("toUpdateInput")
  expect(source).not.toContain("toRemoveInput")
  expect(installRpc?.payloadSchema).toBe(ExtensionPackageInstallInput)
  expect(updateRpc?.payloadSchema).toBe(ExtensionPackageUpdateInput)
  expect(removeRpc?.payloadSchema).toBe(ExtensionPackageRemoveInput)
})

test("ExtensionPackage event schema is owned by the RPC stream contract", async () => {
  const extensionPackageModule = await import("./extension-package.js")
  const rootModule = await import("./index.js")
  const callableTags = Array.from(ExtensionPackageRpcs.requests.keys()).toSorted()
  const eventRpc = ExtensionPackageRpcs.requests.get("ExtensionPackage.events.Event")

  expect("ExtensionPackageRpcEvents" in extensionPackageModule).toBe(false)
  expect("ExtensionPackageRpcEvents" in rootModule).toBe(false)
  expect("ExtensionPackageLive" in extensionPackageModule).toBe(false)
  expect("ExtensionPackageLive" in rootModule).toBe(false)
  expect([...ExtensionPackageMethodNames]).toEqual([
    "install",
    "update",
    "remove",
    "list",
    "isSupported"
  ])
  expect(callableTags).toEqual([
    "ExtensionPackage.events.Event",
    "ExtensionPackage.install",
    "ExtensionPackage.isSupported",
    "ExtensionPackage.list",
    "ExtensionPackage.remove",
    "ExtensionPackage.update"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(ExtensionPackageEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }

  const eventDoc = ExtensionPackageSurface.schemaDocs.find(
    (doc) => doc.tag === "ExtensionPackage.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual({ status: "supported" })
})

test("ExtensionPackage direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const requests: HostProtocolRequestEnvelope[] = []
      const protocolLayer = Layer.effect(RpcClient.Protocol)(
        makeDesktopClientProtocol(
          {
            send: (envelope) => {
              if (envelope.kind !== "request") {
                return Effect.void
              }
              requests.push(envelope)
              return Effect.all(
                [
                  Queue.offer(
                    queue,
                    new HostProtocolStreamByRequestEnvelope({
                      kind: "stream",
                      id: envelope.id,
                      timestamp: 1_710_000_000_001,
                      traceId: envelope.traceId,
                      payload: eventPayload("installed")
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolResponseEnvelope({
                      kind: "response",
                      id: envelope.id,
                      timestamp: 1_710_000_000_002,
                      traceId: envelope.traceId
                    })
                  )
                ],
                { discard: true }
              )
            },
            run: (onEnvelope) =>
              Stream.fromQueue(queue).pipe(
                Stream.runForEach(onEnvelope),
                Effect.andThen(Effect.never)
              )
          },
          {
            nextRequestId: () => "extension-package-event-rpc",
            nextTraceId: () => "trace-extension-package-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ExtensionPackageClient
          return yield* client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(ExtensionPackageSurface.clientLayer, protocolLayer)
      )

      expect(event).toMatchObject({
        packageId: "extension-1",
        phase: "installed",
        version: "1.0.0",
        revision: 1
      })
      expect(requests.map((request) => request.method)).toEqual(["ExtensionPackage.events.Event"])
    })
  ))

test("ExtensionPackage bridge client subscribes to the host event channel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const methods: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.fail(makeHostProtocolInternalError("unexpected request", "test")),
        subscribe: (method) => {
          methods.push(method)
          return Stream.make({
            kind: "event",
            method,
            timestamp: 1_710_000_000_000,
            traceId: "trace-extension-package-host-event",
            payload: eventPayload("installed")
          })
        }
      }
      const client = yield* runScoped(
        Effect.gen(function* () {
          return yield* ExtensionPackageClient
        }),
        ExtensionPackageSurface.bridgeClientLayer(exchange)
      )
      const event = yield* client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))

      expect(event).toMatchObject({
        packageId: "extension-1",
        phase: "installed",
        version: "1.0.0",
        revision: 1
      })
      expect(methods).toEqual(["ExtensionPackage.Event"])
    })
  ))

test("ExtensionPackage service installs validated manifests, registers capabilities, emits events, and audits use", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const client = yield* makeExtensionPackageMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const packages = yield* ExtensionPackage
          const installed = yield* packages.install(installInput())
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
          return yield* Effect.exit(packages.install(installInput()))
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
          return yield* Effect.exit(packages.install(installInput()))
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
              installInput({
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

test("ExtensionPackage rejects compatibility ranges inverted only by prerelease precedence", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeExtensionPackageMemoryClient()

      const exit = yield* Effect.exit(
        client.install(
          installInput({
            manifest: manifest({
              compatibility: new ExtensionPackageCompatibility({
                minHostVersion: "1.0.0",
                maxHostVersion: "1.0.0-rc.1"
              })
            })
          })
        )
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ExtensionPackage.install"
        })
      })
    })
  ))

test("ExtensionPackage gates host versions by prerelease precedence", () =>
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
              installInput({
                manifest: manifest({
                  compatibility: new ExtensionPackageCompatibility({ maxHostVersion: "1.0.0-rc.1" })
                })
              })
            )
          )
        }),
        makeExtensionPackageServiceLayer(client, { permissions, hostVersion: "1.0.0" })
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
      const eventExit = yield* Effect.exit(client.events().pipe(Stream.runHead))

      expect(supported).toEqual({ supported: false, reason: "host-adapter-unimplemented" })
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "ExtensionPackage.install" })
      })
      expectExitFailure(eventExit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "ExtensionPackage.events.Event"
        })
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
          yield* packages.install(installInput())
          const updated = yield* packages.update(
            new ExtensionPackageUpdateInput({
              actor: actor(),
              source: source(),
              manifest: manifest({ version: "1.1.0" }),
              expectedVersion: "1.0.0",
              traceId: "trace-update"
            })
          )
          const removed = yield* packages.remove(removeInput())
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
    { tag: "ExtensionPackage.isSupported", support: { status: "supported" } },
    { tag: "ExtensionPackage.events.Event", support: { status: "supported" } }
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

const eventPayload = (phase: "installed") => ({
  ...eventBase(),
  phase,
  version: "1.0.0",
  revision: 1
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

const installInput = (
  overrides: Partial<{
    readonly manifest: ExtensionPackageManifest
  }> = {}
): ExtensionPackageInstallInput =>
  new ExtensionPackageInstallInput({
    actor: actor(),
    source: source(),
    manifest: overrides.manifest ?? manifest(),
    traceId: "trace-install"
  })

const removeInput = (): ExtensionPackageRemoveInput =>
  new ExtensionPackageRemoveInput({
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
