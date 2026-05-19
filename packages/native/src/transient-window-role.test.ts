import { expect, test } from "bun:test"
import { type BridgeClientExchange, HostProtocolInternalError } from "@effect-desktop/bridge"
import {
  type AuditEvent,
  makePermissionRegistry,
  makeResourceRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  TransientWindowRole,
  TransientWindowRoleClient,
  makeTransientWindowRoleBridgeClientLayer,
  makeTransientWindowRoleMemoryClient,
  makeTransientWindowRoleServiceLayer,
  makeTransientWindowRoleUnsupportedClient,
  type TransientWindowRoleClientApi
} from "./transient-window-role.js"
import {
  TransientWindowRoleActor,
  TransientWindowRoleOpenRequest,
  TransientWindowRolePlacement,
  TransientWindowRolePolicy
} from "./contracts/transient-window-role.js"

test("TransientWindowRole opens generation-stamped scoped handles", async () => {
  const rows: AuditEvent[] = []
  const { permissions, resources } = await configuredRuntime(rows)
  const client = await Effect.runPromise(makeTransientWindowRoleMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      const handle = yield* roles.open(openRequest())
      const snapshot = yield* resources.list()
      return { handle, snapshot }
    }).pipe(
      Effect.provide(
        makeTransientWindowRoleServiceLayer(client, {
          permissions,
          resources,
          audit: memoryAudit(rows)
        })
      )
    )
  )

  expect(result.handle).toMatchObject({
    kind: "transient-window-role",
    id: "palette-1",
    generation: 0,
    ownerScope: "workspace:workspace-1",
    state: "open"
  })
  expect(result.snapshot.entries).toHaveLength(1)
  expect(rows.some((row) => row.outcome === "opened")).toBe(true)
})

test("TransientWindowRole rejects malformed input before client side effects", async () => {
  const { permissions, resources } = await configuredRuntime([])
  const baseClient = await Effect.runPromise(makeTransientWindowRoleMemoryClient())
  let calls = 0
  const client: TransientWindowRoleClientApi = {
    ...baseClient,
    open: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.open(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      return yield* Effect.exit(
        roles.open({
          actor: actor(),
          roleId: "bad",
          policy: {
            role: "palette",
            focus: "take-focus",
            dismissal: "escape",
            zOrder: "floating",
            placement: { kind: "point" },
            restoration: "restore-focus"
          }
        })
      )
    }).pipe(Effect.provide(makeTransientWindowRoleServiceLayer(client, { permissions, resources })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "TransientWindowRole.open"
    })
  })
})

test("TransientWindowRole rejects placement variants before client side effects", async () => {
  const { permissions, resources } = await configuredRuntime([])
  const baseClient = await Effect.runPromise(makeTransientWindowRoleMemoryClient())
  let calls = 0
  const client: TransientWindowRoleClientApi = {
    ...baseClient,
    open: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.open(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      return yield* Effect.exit(
        roles.open({
          actor: actor(),
          roleId: "bad",
          policy: {
            role: "palette",
            focus: "take-focus",
            dismissal: "escape",
            zOrder: "floating",
            placement: { kind: "owner-relative", point: { x: 1, y: 1 } },
            restoration: "restore-focus"
          }
        })
      )
    }).pipe(Effect.provide(makeTransientWindowRoleServiceLayer(client, { permissions, resources })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "TransientWindowRole.open"
    })
  })
})

test("TransientWindowRole denies before resource registration and client calls", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeTransientWindowRoleMemoryClient())
  let calls = 0
  const client: TransientWindowRoleClientApi = {
    ...baseClient,
    open: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.open(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      return yield* Effect.exit(roles.open(openRequest()))
    }).pipe(
      Effect.provide(
        makeTransientWindowRoleServiceLayer(client, {
          permissions,
          resources,
          audit: memoryAudit(rows)
        })
      )
    )
  )

  const snapshot = await Effect.runPromise(resources.list())
  expect(calls).toBe(0)
  expect(snapshot.entries).toHaveLength(0)
  expect(rows.some((row) => row.kind === "permission-denied")).toBe(true)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "PermissionDenied",
      operation: "TransientWindowRole.open"
    })
  })
})

test("TransientWindowRole cleans registered resource on host failure", async () => {
  const { permissions, resources } = await configuredRuntime([])
  const failure = internalFailure("host failed", "TransientWindowRole.open")
  const client = await Effect.runPromise(
    makeTransientWindowRoleMemoryClient({ failure: { open: failure } })
  )

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      return yield* Effect.exit(roles.open(openRequest()))
    }).pipe(Effect.provide(makeTransientWindowRoleServiceLayer(client, { permissions, resources })))
  )

  const snapshot = await Effect.runPromise(resources.list())
  expect(snapshot.entries).toHaveLength(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Internal",
      operation: "TransientWindowRole.open"
    })
  })
})

test("TransientWindowRole dismiss disposes exactly once", async () => {
  const { permissions, resources } = await configuredRuntime([])
  const baseClient = await Effect.runPromise(makeTransientWindowRoleMemoryClient())
  let dismissCalls = 0
  const client: TransientWindowRoleClientApi = {
    ...baseClient,
    dismiss: (input) =>
      Effect.sync(() => {
        dismissCalls += 1
      }).pipe(Effect.andThen(baseClient.dismiss(input)))
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      const handle = yield* roles.open(openRequest())
      yield* roles.dismiss({ actor: actor(), handle })
      const stale = yield* Effect.exit(roles.dismiss({ actor: actor(), handle }))
      const snapshot = yield* resources.list()
      return { stale, snapshot }
    }).pipe(Effect.provide(makeTransientWindowRoleServiceLayer(client, { permissions, resources })))
  )

  expect(result.snapshot.entries).toHaveLength(0)
  expect(dismissCalls).toBe(1)
  expectExitFailure(result.stale, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "TransientWindowRole.dismiss"
    })
  })
})

test("TransientWindowRole surfaces dismiss host failures without local disposal", async () => {
  const { permissions, resources } = await configuredRuntime([])
  const failure = internalFailure("host failed", "TransientWindowRole.dismiss")
  const client = await Effect.runPromise(
    makeTransientWindowRoleMemoryClient({ failure: { dismiss: failure } })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      const handle = yield* roles.open(openRequest())
      const exit = yield* Effect.exit(roles.dismiss({ actor: actor(), handle }))
      const snapshot = yield* resources.list()
      return { exit, snapshot }
    }).pipe(Effect.provide(makeTransientWindowRoleServiceLayer(client, { permissions, resources })))
  )

  expect(result.snapshot.entries).toHaveLength(1)
  expectExitFailure(result.exit, (error) => {
    expect(error).toMatchObject({
      tag: "Internal",
      operation: "TransientWindowRole.dismiss"
    })
  })
})

test("TransientWindowRole rejects handles owned by a different actor", async () => {
  const { permissions, resources } = await configuredRuntime([])
  const client = await Effect.runPromise(makeTransientWindowRoleMemoryClient())

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      const handle = yield* roles.open(openRequest())
      return yield* Effect.exit(
        roles.dismiss({
          actor: new TransientWindowRoleActor({ kind: "workspace", id: "other-workspace" }),
          handle
        })
      )
    }).pipe(Effect.provide(makeTransientWindowRoleServiceLayer(client, { permissions, resources })))
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "TransientWindowRole.dismiss"
    })
  })
})

test("TransientWindowRole closes scoped resources through ResourceRegistry", async () => {
  const { permissions, resources } = await configuredRuntime([])
  const client = await Effect.runPromise(makeTransientWindowRoleMemoryClient())

  await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      yield* roles.open(openRequest())
      yield* resources.closeScope("workspace:workspace-1")
    }).pipe(Effect.provide(makeTransientWindowRoleServiceLayer(client, { permissions, resources })))
  )

  const snapshot = await Effect.runPromise(resources.list())
  expect(snapshot.entries).toHaveLength(0)
})

test("TransientWindowRole unsupported client fails as typed unsupported", async () => {
  const { permissions, resources } = await configuredRuntime([])

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const roles = yield* TransientWindowRole
      return yield* Effect.exit(roles.open(openRequest()))
    }).pipe(
      Effect.provide(
        makeTransientWindowRoleServiceLayer(makeTransientWindowRoleUnsupportedClient(), {
          permissions,
          resources
        })
      )
    )
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Unsupported",
      operation: "TransientWindowRole.open"
    })
  })
})

test("TransientWindowRole emits substitutable events", async () => {
  const client = await Effect.runPromise(makeTransientWindowRoleMemoryClient())

  const event = await Effect.runPromise(
    client
      .open(openRequest())
      .pipe(
        Effect.ignore,
        Effect.andThen(client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow)))
      )
  )

  expect(event).toMatchObject({
    phase: "opened",
    roleId: "palette-1"
  })
})

test("TransientWindowRole bridge client fails event stream as unsupported before subscribing", async () => {
  const subscriptions: string[] = []
  const exchange: BridgeClientExchange = {
    request: () => Effect.die("unexpected request"),
    subscribe: (method) => {
      subscriptions.push(method)
      return Stream.empty
    }
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* TransientWindowRoleClient
      return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
    }).pipe(Effect.provide(makeTransientWindowRoleBridgeClientLayer(exchange)))
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

const configuredRuntime = async (rows: AuditEvent[]) => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const resources = await Effect.runPromise(makeResourceRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "TransientWindowRole", methods: ["open"] })),
      permissions.declare(
        P.nativeInvoke({ primitive: "TransientWindowRole", methods: ["reposition"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "TransientWindowRole", methods: ["dismiss"] })
      )
    ])
  )
  rows.length = 0
  return { permissions, resources }
}

const memoryAudit = (rows: AuditEvent[]) => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const internalFailure = (message: string, operation: string) =>
  new HostProtocolInternalError({
    tag: "Internal",
    message,
    operation,
    recoverable: false
  })

const actor = () => new TransientWindowRoleActor({ kind: "workspace", id: "workspace-1" })

const policy = () =>
  new TransientWindowRolePolicy({
    role: "palette",
    focus: "take-focus",
    dismissal: "escape",
    zOrder: "floating",
    placement: new TransientWindowRolePlacement({
      kind: "point",
      point: { x: 20, y: 40 }
    }),
    restoration: "restore-focus"
  })

const openRequest = () =>
  new TransientWindowRoleOpenRequest({
    actor: actor(),
    roleId: "palette-1",
    policy: policy()
  })

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
