import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolError,
  type HostProtocolEventEnvelope,
  type HostProtocolRequestEnvelope,
  type SecretBytes,
  makeHostProtocolInternalError,
  makeSecretBytes,
  unsafeSecretBytes
} from "@effect-desktop/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Stream } from "effect"

import {
  ExtensionConfig,
  ExtensionConfigClient,
  type ExtensionConfigClientApi,
  ExtensionConfigSurface,
  type ExtensionConfigSecretStoreApi,
  type ExtensionConfigWriteRequest,
  makeExtensionConfigBridgeClientLayer,
  makeExtensionConfigMemoryClient,
  makeExtensionConfigServiceLayer,
  makeExtensionConfigUnsupportedClient
} from "./extension-config.js"
import {
  ExtensionConfigActor,
  ExtensionConfigField,
  ExtensionConfigReadInput,
  ExtensionConfigReadRequest,
  ExtensionConfigRedactRequest,
  ExtensionConfigResetRequest,
  ExtensionConfigValueEntry,
  ExtensionConfigWriteInput
} from "./contracts/extension-config.js"

test("ExtensionConfig service writes typed values, stores secrets safely, redacts exports, and audits use", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const client = await Effect.runPromise(makeExtensionConfigMemoryClient())
  const secrets = memorySecretStore()

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      const written = yield* config.write(writeRequest())
      const read = yield* config.read(readRequest())
      const redacted = yield* config.redact(redactRequest())
      const event = yield* config.events().pipe(Stream.runHead)
      return { event, read, redacted, written }
    }).pipe(
      Effect.provide(
        makeExtensionConfigServiceLayer(client, {
          permissions,
          secrets,
          audit: memoryAudit(rows),
          nextTraceId: () => "trace-config"
        })
      )
    )
  )

  expect(result.written.writtenKeys).toEqual(["theme", "apiKey"])
  expect(result.read.values).toEqual([
    new ExtensionConfigValueEntry({ key: "theme", value: "dark" })
  ])
  expect(result.read.secrets).toEqual([{ key: "apiKey", present: true }])
  expect(result.redacted.values).toEqual([
    new ExtensionConfigValueEntry({ key: "theme", value: "dark" }),
    new ExtensionConfigValueEntry({ key: "apiKey", value: "<redacted:ExtensionConfigSecret>" })
  ])
  expect(result.redacted.redactions).toEqual([{ key: "apiKey", reason: "secret-field" }])
  expect(result.event._tag).toBe("Some")
  expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
  expect(JSON.stringify(result.redacted)).not.toContain("1,2,3")
})

test("ExtensionConfig service denies before client or safe storage side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  let writes = 0
  const client = await Effect.runPromise(makeExtensionConfigMemoryClient())
  const secrets: ExtensionConfigSecretStoreApi = {
    set: () =>
      Effect.sync(() => {
        writes += 1
      }),
    get: () => Effect.fail(makeHostProtocolInternalError("unexpected safe storage get", "test")),
    delete: () => Effect.void,
    list: () => Effect.succeed([]),
    isAvailable: () => Effect.succeed(true)
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* Effect.exit(config.write(writeRequest()))
    }).pipe(Effect.provide(makeExtensionConfigServiceLayer(client, { permissions, secrets })))
  )

  expect(writes).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "ExtensionConfig.write" })
  })
})

test("ExtensionConfig write does not mutate config when safe storage fails", async () => {
  const permissions = await configuredPermissions([])
  let writes = 0
  const client = await Effect.runPromise(
    makeExtensionConfigMemoryClient({
      failure: {}
    })
  )
  const countingClient = {
    ...client,
    write: (input: ExtensionConfigWriteInput) =>
      Effect.sync(() => {
        writes += 1
      }).pipe(Effect.andThen(client.write(input)))
  }
  const secrets: ExtensionConfigSecretStoreApi = {
    set: () => Effect.fail(makeHostProtocolInternalError("safe storage failed", "SafeStorage.set")),
    get: () => Effect.fail(makeHostProtocolInternalError("unexpected safe storage get", "test")),
    delete: () => Effect.void,
    list: () => Effect.succeed([]),
    isAvailable: () => Effect.succeed(true)
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* Effect.exit(config.write(writeRequest()))
    }).pipe(
      Effect.provide(makeExtensionConfigServiceLayer(countingClient, { permissions, secrets }))
    )
  )

  expect(writes).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "SafeStorage.set" })
  })
})

test("ExtensionConfig write restores prior secrets when config commit fails", async () => {
  const permissions = await configuredPermissions([])
  const secrets = memorySecretStore()
  await Effect.runPromise(
    secrets.set("extension-config/extension-1/apiKey", makeSecretBytes(new Uint8Array([9])))
  )
  const client = await Effect.runPromise(
    makeExtensionConfigMemoryClient({
      failure: {
        write: makeHostProtocolInternalError("config failed", "ExtensionConfig.write")
      }
    })
  )

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* Effect.exit(config.write(writeRequest()))
    }).pipe(Effect.provide(makeExtensionConfigServiceLayer(client, { permissions, secrets })))
  )
  const restored = await Effect.runPromise(secrets.get("extension-config/extension-1/apiKey"))

  expect(Array.from(unsafeSecretBytes(restored))).toEqual([9])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "ExtensionConfig.write" })
  })
})

test("ExtensionConfig read does not require safe storage without secret fields", async () => {
  const permissions = await nativeReadPermissions()
  const client = await Effect.runPromise(makeExtensionConfigMemoryClient())
  const secrets = unavailableSecretStore()

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* config.read(
        new ExtensionConfigReadRequest({
          actor: actor(),
          extensionId: "extension-1",
          fields: [
            new ExtensionConfigField({
              key: "theme",
              valueType: "string",
              secret: false,
              defaultValue: "light"
            })
          ],
          traceId: "trace-read"
        })
      )
    }).pipe(Effect.provide(makeExtensionConfigServiceLayer(client, { permissions, secrets })))
  )

  expect(result.values).toEqual([new ExtensionConfigValueEntry({ key: "theme", value: "light" })])
  expect(result.secrets).toEqual([])
})

test("ExtensionConfig read reports missing required values as invalid input", async () => {
  const permissions = await nativeReadPermissions()
  const client = await Effect.runPromise(makeExtensionConfigMemoryClient())

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* Effect.exit(
        config.read(
          new ExtensionConfigReadRequest({
            actor: actor(),
            extensionId: "extension-1",
            fields: [
              new ExtensionConfigField({
                key: "tenant",
                valueType: "string",
                secret: false,
                required: true
              })
            ],
            traceId: "trace-read"
          })
        )
      )
    }).pipe(
      Effect.provide(
        makeExtensionConfigServiceLayer(client, { permissions, secrets: memorySecretStore() })
      )
    )
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "ExtensionConfig.read" })
  })
})

test("ExtensionConfig rejects secret field defaults before native transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: { extensionId: "extension-1", values: [], secrets: [], revision: 0 }
      })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* ExtensionConfigClient
      return yield* Effect.exit(
        client.read(
          new ExtensionConfigReadInput({
            actor: actor(),
            extensionId: "extension-1",
            fields: [
              new ExtensionConfigField({
                key: "apiKey",
                valueType: "string",
                secret: true,
                defaultValue: "not-allowed"
              })
            ]
          })
        )
      )
    }).pipe(Effect.provide(makeExtensionConfigBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "ExtensionConfig.read",
      field: "fields.defaultValue"
    })
  })
})

test("ExtensionConfig rejects malformed values before native transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: { extensionId: "extension-1", writtenKeys: ["enabled"], revision: 1 }
      })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* ExtensionConfigClient
      return yield* Effect.exit(
        client.write(
          new ExtensionConfigWriteInput({
            actor: actor(),
            extensionId: "extension-1",
            fields: [
              new ExtensionConfigField({ key: "enabled", valueType: "boolean", secret: false })
            ],
            values: [new ExtensionConfigValueEntry({ key: "enabled", value: "yes" })]
          })
        )
      )
    }).pipe(Effect.provide(makeExtensionConfigBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "ExtensionConfig.write" })
  })
})

test("ExtensionConfig service bridge write sends secret presence without secret bytes", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: { extensionId: "extension-1", writtenKeys: ["theme", "apiKey"], revision: 1 }
      })
    },
    subscribe: () => Stream.empty
  }
  const client = bridgeExtensionConfigClient(exchange)
  const permissions = await configuredPermissions([])

  const written = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      return yield* config.write(writeRequest())
    }).pipe(
      Effect.provide(
        makeExtensionConfigServiceLayer(client, {
          permissions,
          secrets: memorySecretStore(),
          nextTraceId: () => "trace-config"
        })
      )
    )
  )

  expect(written.writtenKeys).toEqual(["theme", "apiKey"])
  expect(requests).toHaveLength(1)
  const [request] = requests
  if (request === undefined) {
    throw new Error("bridge write request should be captured")
  }
  expect(request.method).toBe("ExtensionConfig.write")
  expect(request.payload).toMatchObject({
    extensionId: "extension-1",
    secretKeys: ["apiKey"],
    values: [{ key: "theme", value: "dark" }]
  })
  expect(JSON.stringify(request)).not.toContain("1,2,3")
})

test("ExtensionConfig bridge client decodes native lifecycle events", async () => {
  const nativeEvent: HostProtocolEventEnvelope = {
    kind: "event",
    method: "ExtensionConfig.Event",
    timestamp: 1710000000000,
    traceId: "trace-extension-config-event",
    payload: {
      type: "extension-config-event",
      timestamp: 1710000000000,
      extensionId: "extension-1",
      phase: "written",
      keys: ["theme", "apiKey"],
      revision: 1
    }
  }
  const exchange: BridgeClientExchange = {
    request: () => Effect.fail(makeHostProtocolInternalError("unexpected request", "test")),
    subscribe: (method) => {
      expect(method).toBe("ExtensionConfig.Event")
      return Stream.make(nativeEvent)
    }
  }
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* ExtensionConfigClient
    }).pipe(Effect.provide(makeExtensionConfigBridgeClientLayer(exchange)))
  )

  const event = await Effect.runPromise(client.events().pipe(Stream.runHead))

  expect(event._tag).toBe("Some")
  if (event._tag === "Some") {
    expect(event.value).toMatchObject({
      extensionId: "extension-1",
      phase: "written",
      keys: ["theme", "apiKey"],
      revision: 1
    })
  }
})

test("ExtensionConfig unsupported client exposes typed unsupported failures", async () => {
  const client = makeExtensionConfigUnsupportedClient()
  const supported = await Effect.runPromise(client.isSupported())
  const exit = await Effect.runPromiseExit(client.read(readInput()))

  expect(supported).toEqual({ supported: false, reason: "host-adapter-unimplemented" })
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "ExtensionConfig.read" })
  })
})

test("ExtensionConfig RPC metadata reports host methods as supported", () => {
  expect(
    ExtensionConfigSurface.schemaDocs.map((doc) => ({
      support: doc.support,
      tag: doc.tag
    }))
  ).toEqual([
    { tag: "ExtensionConfig.read", support: { status: "supported" } },
    { tag: "ExtensionConfig.write", support: { status: "supported" } },
    { tag: "ExtensionConfig.reset", support: { status: "supported" } },
    { tag: "ExtensionConfig.redact", support: { status: "supported" } },
    { tag: "ExtensionConfig.isSupported", support: { status: "supported" } }
  ])
})

test("ExtensionConfig memory client exposes typed host failures", async () => {
  const client = await Effect.runPromise(
    makeExtensionConfigMemoryClient({
      failure: {
        write: makeHostProtocolInternalError("extension config failed", "ExtensionConfig.write")
      }
    })
  )

  const exit = await Effect.runPromiseExit(client.write(writeInput()))

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "ExtensionConfig.write" })
  })
})

test("ExtensionConfig reset removes non-secret and secret state", async () => {
  const permissions = await configuredPermissions([])
  const client = await Effect.runPromise(makeExtensionConfigMemoryClient())
  const secrets = memorySecretStore()

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      yield* config.write(writeRequest())
      const reset = yield* config.reset(resetRequest())
      const read = yield* config.read(readRequest())
      return { read, reset }
    }).pipe(Effect.provide(makeExtensionConfigServiceLayer(client, { permissions, secrets })))
  )

  expect(result.reset.resetKeys).toEqual(["theme", "apiKey"])
  expect(result.read.values).toEqual([
    new ExtensionConfigValueEntry({ key: "theme", value: "light" })
  ])
  expect(result.read.secrets).toEqual([{ key: "apiKey", present: false }])
})

test("ExtensionConfig reset restores deleted secrets when config reset fails", async () => {
  const permissions = await configuredPermissions([])
  const client = await Effect.runPromise(
    makeExtensionConfigMemoryClient({
      failure: {
        reset: makeHostProtocolInternalError("config failed", "ExtensionConfig.reset")
      }
    })
  )
  const secrets = memorySecretStore()

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ExtensionConfig
      yield* config.write(writeRequest())
      return yield* Effect.exit(config.reset(resetRequest()))
    }).pipe(Effect.provide(makeExtensionConfigServiceLayer(client, { permissions, secrets })))
  )
  const restored = await Effect.runPromise(secrets.get("extension-config/extension-1/apiKey"))

  expect(Array.from(unsafeSecretBytes(restored))).toEqual([1, 2, 3])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "ExtensionConfig.reset" })
  })
})

const actor = (): ExtensionConfigActor =>
  new ExtensionConfigActor({ kind: "extension", id: "extension-1" })

const fields = (): readonly ExtensionConfigField[] => [
  new ExtensionConfigField({
    key: "theme",
    valueType: "string",
    secret: false,
    defaultValue: "light"
  }),
  new ExtensionConfigField({ key: "apiKey", valueType: "string", secret: true })
]

const readRequest = (): ExtensionConfigReadRequest =>
  new ExtensionConfigReadRequest({
    actor: actor(),
    extensionId: "extension-1",
    fields: fields(),
    traceId: "trace-read"
  })

const readInput = (): ExtensionConfigReadInput =>
  new ExtensionConfigReadInput({
    actor: actor(),
    extensionId: "extension-1",
    fields: fields(),
    traceId: "trace-read"
  })

const writeRequest = (): ExtensionConfigWriteRequest => ({
  actor: actor(),
  extensionId: "extension-1",
  fields: fields(),
  values: [new ExtensionConfigValueEntry({ key: "theme", value: "dark" })],
  secrets: [{ key: "apiKey", value: makeSecretBytes(new Uint8Array([1, 2, 3])) }],
  traceId: "trace-write"
})

const writeInput = (): ExtensionConfigWriteInput =>
  new ExtensionConfigWriteInput({
    actor: actor(),
    extensionId: "extension-1",
    fields: fields(),
    values: [new ExtensionConfigValueEntry({ key: "theme", value: "dark" })],
    secretKeys: ["apiKey"],
    traceId: "trace-write"
  })

const redactRequest = (): ExtensionConfigRedactRequest =>
  new ExtensionConfigRedactRequest({
    actor: actor(),
    extensionId: "extension-1",
    fields: fields(),
    traceId: "trace-redact"
  })

const resetRequest = (): ExtensionConfigResetRequest =>
  new ExtensionConfigResetRequest({
    actor: actor(),
    extensionId: "extension-1",
    fields: fields(),
    traceId: "trace-reset"
  })

const configuredPermissions = async (rows: AuditEvent[]) => {
  const permissions = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
  )
  await Effect.runPromise(
    Effect.all([
      permissions.declare(
        P.nativeInvoke({
          primitive: "ExtensionConfig",
          methods: ["read", "write", "reset", "redact"]
        })
      ),
      permissions.declare(P.safeStorageRead({ namespaces: ["extension-config.extension-1"] })),
      permissions.declare(P.safeStorageWrite({ namespaces: ["extension-config.extension-1"] }))
    ])
  )
  return permissions
}

const nativeReadPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    permissions.declare(P.nativeInvoke({ primitive: "ExtensionConfig", methods: ["read"] }))
  )
  return permissions
}

const memorySecretStore = (): ExtensionConfigSecretStoreApi => {
  const values = new Map<string, SecretBytes>()
  return {
    set: (key, value) =>
      Effect.sync(() => {
        values.set(key, value)
      }),
    get: (key) =>
      Effect.suspend(() => {
        const value = values.get(key)
        if (value === undefined) {
          return Effect.fail(
            makeHostProtocolInternalError(`missing secret: ${key}`, "SafeStorage.get")
          )
        }
        return Effect.succeed(value)
      }),
    delete: (key) =>
      Effect.sync(() => {
        values.delete(key)
      }),
    list: () => Effect.sync(() => [...values.keys()]),
    isAvailable: () => Effect.succeed(true)
  }
}

const unavailableSecretStore = (): ExtensionConfigSecretStoreApi => ({
  set: () => Effect.fail(makeHostProtocolInternalError("unexpected safe storage write", "test")),
  get: () => Effect.fail(makeHostProtocolInternalError("unexpected safe storage get", "test")),
  delete: () =>
    Effect.fail(makeHostProtocolInternalError("unexpected safe storage delete", "test")),
  list: () => Effect.fail(makeHostProtocolInternalError("unexpected safe storage list", "test")),
  isAvailable: () => Effect.succeed(false)
})

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const bridgeExtensionConfigClient = (exchange: BridgeClientExchange): ExtensionConfigClientApi => {
  const layer = makeExtensionConfigBridgeClientLayer(exchange)
  const withClient = <A, E>(
    run: (client: ExtensionConfigClientApi) => Effect.Effect<A, E, never>
  ): Effect.Effect<A, E, never> =>
    Effect.gen(function* () {
      const client = yield* ExtensionConfigClient
      return yield* run(client)
    }).pipe(Effect.provide(layer))

  return {
    read: (input) => withClient((client) => client.read(input)),
    write: (input) => withClient((client) => client.write(input)),
    reset: (input) => withClient((client) => client.reset(input)),
    redact: (input) => withClient((client) => client.redact(input)),
    isSupported: () => withClient((client) => client.isSupported()),
    events: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* ExtensionConfigClient
          return client.events()
        }).pipe(Effect.provide(layer))
      )
  }
}

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}
