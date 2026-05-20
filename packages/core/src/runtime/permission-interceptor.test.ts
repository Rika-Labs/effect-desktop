import { expect, test } from "bun:test"
import { Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect"
import { Headers } from "effect/unstable/http"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { RequestId } from "effect/unstable/rpc/RpcMessage"

import { RpcCapability, rpcCapability } from "@effect-desktop/bridge"

import {
  DesktopConfigError,
  makePermissionInterceptorLayer,
  P,
  PermissionDenied,
  PermissionInterceptor,
  validatePermissions
} from "./permission-interceptor.js"
import {
  makePermissionRegistry,
  type NormalizedCapability,
  PermissionRegistry
} from "./permission-registry.js"

const RegistryLayer = Layer.effect(
  PermissionRegistry,
  makePermissionRegistry({ traceId: () => "trace-test", nextToken: () => "token-test" })
)

const deniedHandler = (onRun: () => void) =>
  Effect.sync(onRun).pipe(
    Effect.andThen(Effect.die("permission interceptor should deny before invoking handler"))
  )

const rpcHandlerOptions = (headers: Headers.Headers = Headers.empty) => ({
  client: new Rpc.ServerClient(1),
  requestId: RequestId(1n),
  headers
})

const rpcMiddlewareOptions = (
  rpc: Rpc.AnyWithProps,
  payload: unknown,
  headers: Headers.Headers = Headers.empty
) => ({
  ...rpcHandlerOptions(headers),
  rpc,
  payload
})

const permissionMiddlewareRpc = (rpc: unknown): Rpc.AnyWithProps =>
  // Effect RPC's erased middleware view widens middleware errors; these direct
  // middleware tests preserve the concrete RPC value and erase it only here.
  rpc as Rpc.AnyWithProps

test("P.filesystemRead produces a valid filesystem.read capability", () => {
  const cap = P.filesystemRead({ roots: ["/tmp/app"] })
  expect(cap.kind).toBe("filesystem.read")
  if (cap.kind === "filesystem.read") {
    expect(cap.roots).toEqual(["/tmp/app"])
    expect(cap.audit).toBe("always")
  }
})

test("P.filesystemWrite produces a valid filesystem.write capability", () => {
  const cap = P.filesystemWrite({ roots: ["/tmp/app"], deny: ["/tmp/app/secret"] })
  expect(cap.kind).toBe("filesystem.write")
  if (cap.kind === "filesystem.write") {
    expect(cap.roots).toEqual(["/tmp/app"])
    expect(cap.deny).toEqual(["/tmp/app/secret"])
  }
})

test("P.filesystemDelete produces a valid filesystem.delete capability", () => {
  const cap = P.filesystemDelete({ roots: ["/tmp/app"] })
  expect(cap.kind).toBe("filesystem.delete")
})

test("P.processSpawn produces a valid process.spawn capability", () => {
  const cap = P.processSpawn({ commands: ["git", "npm"] })
  expect(cap.kind).toBe("process.spawn")
  if (cap.kind === "process.spawn") {
    expect(cap.commands).toEqual(["git", "npm"])
    expect(cap.shell).toBe(false)
    expect(cap.environment).toBe("none")
  }
})

test("P.ptySpawn produces a valid pty.spawn capability", () => {
  const cap = P.ptySpawn({ commands: ["bash"], environment: "allowlist" })
  expect(cap.kind).toBe("pty.spawn")
  if (cap.kind === "pty.spawn") {
    expect(cap.environment).toBe("allowlist")
  }
})

test("P.networkConnect produces a valid network.connect capability", () => {
  const cap = P.networkConnect({ hosts: ["api.example.com"], askUnknownHosts: true })
  expect(cap.kind).toBe("network.connect")
  if (cap.kind === "network.connect") {
    expect(cap.hosts).toEqual(["api.example.com"])
    expect(cap.askUnknownHosts).toBe(true)
  }
})

test("P.secretsRead produces a valid secrets.read capability", () => {
  const cap = P.secretsRead({ namespaces: ["app-secrets"] })
  expect(cap.kind).toBe("secrets.read")
  if (cap.kind === "secrets.read") {
    expect(cap.namespaces).toEqual(["app-secrets"])
  }
})

test("P.secretsWrite produces a valid secrets.write capability", () => {
  const cap = P.secretsWrite({ namespaces: ["app-secrets"] })
  expect(cap.kind).toBe("secrets.write")
})

test("P.safeStorageRead produces a valid safeStorage.read capability", () => {
  const cap = P.safeStorageRead({ namespaces: ["app"] })
  expect(cap.kind).toBe("safeStorage.read")
})

test("P.safeStorageWrite produces a valid safeStorage.write capability", () => {
  const cap = P.safeStorageWrite({ namespaces: ["app"] })
  expect(cap.kind).toBe("safeStorage.write")
})

test("P.nativeInvoke produces a valid native.invoke capability", () => {
  const cap = P.nativeInvoke({ primitive: "clipboard", methods: ["read", "write"] })
  expect(cap.kind).toBe("native.invoke")
  if (cap.kind === "native.invoke") {
    expect(cap.primitive).toBe("clipboard")
    expect(cap.methods).toEqual(["read", "write"])
  }
})

test("P capability constructors return frozen objects", () => {
  const cap = P.filesystemRead({ roots: ["/tmp"] })
  expect(Object.isFrozen(cap)).toBe(true)
})

test("PermissionInterceptor class is defined as an RpcMiddleware service", () => {
  expect(PermissionInterceptor).toBeDefined()
  expect(typeof PermissionInterceptor.key).toBe("string")
})

test("RpcCapability stores capability metadata in Rpc annotations", () => {
  const cap = P.filesystemRead({ roots: ["/tmp/app"] })
  const rpc = Rpc.make("TestMethod").pipe(RpcCapability(cap))
  const retrieved = rpcCapability(rpc)
  expect(Option.isSome(retrieved)).toBe(true)
  if (Option.isSome(retrieved)) {
    expect(retrieved.value.kind).toBe("filesystem.read")
  }
})

test("Rpc without RpcCapability returns Option.none from annotations", () => {
  const rpc = Rpc.make("PublicMethod")
  const retrieved = rpcCapability(rpc)
  expect(Option.isNone(retrieved)).toBe(true)
})

test("makePermissionInterceptorLayer passes through Rpc without annotation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const PublicRpc = Rpc.make("Public", {
        payload: { message: Schema.String },
        success: Schema.String
      }).middleware(PermissionInterceptor)

      const group = RpcGroup.make(PublicRpc)
      const interceptorLayer = makePermissionInterceptorLayer()
      const combined = Layer.provideMerge(interceptorLayer, RegistryLayer)

      const result = yield* runScoped(
        Effect.gen(function* () {
          const ctx = yield* group.toHandlers({
            Public: ({ message }) => Effect.succeed(`echo: ${message}`)
          })
          return ctx
        }),
        combined
      )

      expect(result).toBeDefined()
    })
  ))

test("makePermissionInterceptorLayer allows call when capability is declared", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cap = P.filesystemRead({ roots: ["/tmp/app"] })

      const GuardedRpc = Rpc.make("ReadFile", {
        payload: { path: Schema.String },
        success: Schema.String
      })
        .pipe(RpcCapability(cap))
        .middleware(PermissionInterceptor)

      const group = RpcGroup.make(GuardedRpc)
      const interceptorLayer = makePermissionInterceptorLayer()

      const registryWithDeclaration = Layer.effect(
        PermissionRegistry,
        Effect.gen(function* () {
          const registry = yield* makePermissionRegistry({
            traceId: () => "trace-test",
            nextToken: () => "token-test"
          })
          yield* registry.declare(cap, { source: "test", effect: "allow" })
          return registry
        })
      )

      const result = yield* runScoped(
        Effect.gen(function* () {
          const ctx = yield* group.toHandlers({
            ReadFile: ({ path }) => Effect.succeed(`contents of ${path}`)
          })
          return ctx
        }),
        Layer.provideMerge(interceptorLayer, registryWithDeclaration)
      )

      expect(result).toBeDefined()
    })
  ))

test("makePermissionInterceptorLayer fails denied calls as typed middleware errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cap = P.filesystemRead({ roots: ["/tmp/app"] })
      let handlerCalls = 0
      const GuardedRpc = Rpc.make("ReadFile", {
        payload: { path: Schema.String },
        success: Schema.String
      })
        .pipe(RpcCapability(cap))
        .middleware(PermissionInterceptor)

      const interceptorLayer = makePermissionInterceptorLayer()

      const exit = yield* runScopedExit(
        Effect.scoped(
          Effect.gen(function* () {
            const middleware = yield* PermissionInterceptor
            return yield* middleware(
              deniedHandler(() => {
                handlerCalls += 1
              }),
              rpcMiddlewareOptions(permissionMiddlewareRpc(GuardedRpc), {
                path: "/tmp/app/file.txt"
              })
            )
          })
        ),
        Layer.provideMerge(interceptorLayer, RegistryLayer)
      )

      expect(handlerCalls).toBe(0)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((r) => r._tag === "Fail")
        expect(fail).toBeDefined()
        if (fail?._tag === "Fail") {
          expect(fail.error).toBeInstanceOf(PermissionDenied)
          const error = fail.error as PermissionDenied
          expect(error.reason).toBe("default-deny")
          expect(error.capability.kind).toBe("filesystem.read")
        }
      }
    })
  ))

test("makePermissionInterceptorLayer fails malformed capabilities closed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let handlerCalls = 0
      const GuardedRpc = Rpc.make("ReadFile", {
        payload: { path: Schema.String },
        success: Schema.String
      })
        .pipe(RpcCapability({ kind: "filesystem.read" }))
        .middleware(PermissionInterceptor)

      const exit = yield* runScopedExit(
        Effect.scoped(
          Effect.gen(function* () {
            const middleware = yield* PermissionInterceptor
            return yield* middleware(
              deniedHandler(() => {
                handlerCalls += 1
              }),
              rpcMiddlewareOptions(permissionMiddlewareRpc(GuardedRpc), {
                path: "/tmp/app/file.txt"
              })
            )
          })
        ),
        Layer.provideMerge(makePermissionInterceptorLayer(), RegistryLayer)
      )

      expect(handlerCalls).toBe(0)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((r) => r._tag === "Fail")
        expect(fail).toBeDefined()
        if (fail?._tag === "Fail") {
          expect(fail.error).toBeInstanceOf(PermissionDenied)
          const error = fail.error as PermissionDenied
          expect(error.reason).toBe("invalid-capability")
          expect(error.capability.kind).toBe("filesystem.read")
        }
      }
    })
  ))

test("makePermissionInterceptorLayer builds actor and trace context from RPC headers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cap = P.filesystemRead({ roots: ["/tmp/app"] })
      const GuardedRpc = Rpc.make("ReadFile", {
        payload: { path: Schema.String },
        success: Schema.String
      })
        .pipe(RpcCapability(cap))
        .middleware(PermissionInterceptor)

      const exit = yield* runScopedExit(
        Effect.scoped(
          Effect.gen(function* () {
            const middleware = yield* PermissionInterceptor
            return yield* middleware(
              Effect.die("permission interceptor should deny before invoking handler"),
              rpcMiddlewareOptions(
                permissionMiddlewareRpc(GuardedRpc),
                { path: "/tmp/app/file.txt" },
                Headers.fromInput({
                  "x-effect-desktop-window-id": "window-main",
                  "x-effect-desktop-trace-id": "trace-renderer"
                })
              )
            )
          })
        ),
        Layer.provideMerge(makePermissionInterceptorLayer(), RegistryLayer)
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((r) => r._tag === "Fail")
        expect(fail).toBeDefined()
        if (fail?._tag === "Fail") {
          expect(fail.error).toBeInstanceOf(PermissionDenied)
          const error = fail.error as PermissionDenied
          expect(error.actor).toMatchObject({ kind: "window", id: "window-main" })
          expect(error.traceId).toBe("trace-renderer")
        }
      }
    })
  ))

test("makePermissionInterceptorLayer returns typed denial for malformed RPC headers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cap = P.filesystemRead({ roots: ["/tmp/app"] })
      let handlerCalls = 0
      const GuardedRpc = Rpc.make("ReadFile", {
        payload: { path: Schema.String },
        success: Schema.String
      })
        .pipe(RpcCapability(cap))
        .middleware(PermissionInterceptor)

      const exit = yield* runScopedExit(
        Effect.scoped(
          Effect.gen(function* () {
            const middleware = yield* PermissionInterceptor
            return yield* middleware(
              deniedHandler(() => {
                handlerCalls += 1
              }),
              rpcMiddlewareOptions(
                permissionMiddlewareRpc(GuardedRpc),
                { path: "/tmp/app/file.txt" },
                Headers.fromInput({
                  "x-effect-desktop-window-id": "window\nforged",
                  "x-effect-desktop-trace-id": "trace-renderer"
                })
              )
            )
          })
        ),
        Layer.provideMerge(makePermissionInterceptorLayer(), RegistryLayer)
      )

      expect(handlerCalls).toBe(0)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((r) => r._tag === "Fail")
        expect(fail).toBeDefined()
        if (fail?._tag === "Fail") {
          expect(fail.error).toBeInstanceOf(PermissionDenied)
          const error = fail.error as PermissionDenied
          expect(error.reason).toBe("invalid-context")
          expect(error.capability.kind).toBe("filesystem.read")
        }
      }
    })
  ))

test("validatePermissions succeeds when all required capabilities are declared", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const declared: readonly NormalizedCapability[] = [
        P.filesystemRead({ roots: ["/tmp"] }),
        P.networkConnect({ hosts: ["api.example.com"] })
      ]
      const required: readonly NormalizedCapability[] = [P.filesystemRead({ roots: ["/tmp"] })]

      const exit = yield* Effect.exit(validatePermissions(declared, required))
      expect(Exit.isSuccess(exit)).toBe(true)
    })
  ))

test("validatePermissions fails with DesktopConfigError when capability kind is missing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const declared: readonly NormalizedCapability[] = [P.filesystemRead({ roots: ["/tmp"] })]
      const required: readonly NormalizedCapability[] = [
        P.networkConnect({ hosts: ["api.example.com"] })
      ]

      const exit = yield* Effect.exit(validatePermissions(declared, required))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((r) => r._tag === "Fail")
        expect(fail).toBeDefined()
        if (fail?._tag === "Fail") {
          expect(fail.error).toBeInstanceOf(DesktopConfigError)
          const error = fail.error
          expect(error.reason).toBe("undeclared-capability")
          expect(error.contract).toBe("network.connect")
        }
      }
    })
  ))

test("validatePermissions fails when declared capability does not cover the required scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const declared: readonly NormalizedCapability[] = [P.filesystemRead({ roots: ["/tmp/app"] })]
      const required: readonly NormalizedCapability[] = [
        P.filesystemRead({ roots: ["/tmp/other"] })
      ]

      const exit = yield* Effect.exit(validatePermissions(declared, required))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find((r) => r._tag === "Fail")
        expect(fail).toBeDefined()
        if (fail?._tag === "Fail") {
          expect(fail.error).toBeInstanceOf(DesktopConfigError)
          const error = fail.error
          expect(error.reason).toBe("undeclared-capability")
          expect(error.contract).toBe("filesystem.read")
        }
      }
    })
  ))

test("validatePermissions succeeds with empty required list", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const declared: readonly NormalizedCapability[] = []
      const required: readonly NormalizedCapability[] = []
      const exit = yield* Effect.exit(validatePermissions(declared, required))
      expect(Exit.isSuccess(exit)).toBe(true)
    })
  ))

test("makePermissionInterceptorLayer is a Layer", () => {
  const layer = makePermissionInterceptorLayer()
  expect(Layer.isLayer(layer)).toBe(true)
})

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

const runScopedExit = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<Exit.Exit<A, E | LE>, never, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    try {
      return yield* Effect.promise(() => runtime.runPromiseExit(effect))
    } finally {
      yield* Effect.promise(() => runtime.dispose())
    }
  })
