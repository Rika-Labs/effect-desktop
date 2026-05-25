import {
  type BridgeClientExchange,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  CookieStoreEvent,
  CookieStoreGetInput,
  type CookieStoreGetOptions,
  CookieStoreGetResult,
  CookieStoreRemoveInput,
  type CookieStoreRemoveOptions,
  CookieStoreSetInput,
  type CookieStoreSetOptions,
  CookieStoreSupportedResult
} from "./contracts/cookie-store.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { decodeNativeInput, runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/cookie-store.js"

const Surface = "CookieStore"
const UnsupportedReason = "host-cookie-store-unavailable"
const LiveWebViewRequiredReason = "host-cookie-store-live-webview-required"
const EventMethod = "CookieStore.Event"
const LiveWebViewSupport = NativeSurface.support.partial(LiveWebViewRequiredReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: LiveWebViewRequiredReason },
    { platform: "windows", status: "partial", reason: LiveWebViewRequiredReason },
    { platform: "linux", status: "partial", reason: LiveWebViewRequiredReason }
  ]
})

export type CookieStoreError = HostProtocolError

export const CookieStoreGet = NativeSurface.rpc(Surface, "get", {
  payload: CookieStoreGetInput,
  success: CookieStoreGetResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["get"] })
  ),
  endpoint: "query",
  support: LiveWebViewSupport
})

export const CookieStoreRemove = NativeSurface.rpc(Surface, "remove", {
  payload: CookieStoreRemoveInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["remove"] })
  ),
  endpoint: "mutation",
  support: LiveWebViewSupport
})

export const CookieStoreSet = NativeSurface.rpc(Surface, "set", {
  payload: CookieStoreSetInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["set"] })
  ),
  endpoint: "mutation",
  support: LiveWebViewSupport
})

export const CookieStoreIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: CookieStoreSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const CookieStoreEventStream = NativeSurface.event(Surface, "Event", {
  payload: CookieStoreEvent,
  support: LiveWebViewSupport
})

const CookieStoreRpcGroup = RpcGroup.make(
  CookieStoreGet,
  CookieStoreRemove,
  CookieStoreSet,
  CookieStoreIsSupported,
  CookieStoreEventStream
)

export const CookieStoreRpcs: RpcGroup.RpcGroup<CookieStoreRpc> = CookieStoreRpcGroup

export const CookieStoreMethodNames = Object.freeze(["get", "remove", "set"] as const)

export interface CookieStoreClientApi {
  readonly get: (
    input: CookieStoreGetOptions
  ) => Effect.Effect<CookieStoreGetResult, CookieStoreError, never>
  readonly remove: (input: CookieStoreRemoveOptions) => Effect.Effect<void, CookieStoreError, never>
  readonly set: (input: CookieStoreSetOptions) => Effect.Effect<void, CookieStoreError, never>
  readonly isSupported: () => Effect.Effect<CookieStoreSupportedResult, CookieStoreError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<CookieStoreEvent, CookieStoreError, never>
}

export class CookieStore extends Context.Service<CookieStore, CookieStoreClientApi>()(
  "@orika/native/CookieStore"
) {}

export type CookieStoreRpc = RpcGroup.Rpcs<typeof CookieStoreRpcGroup>
export type CookieStoreRpcHandlers<R = never> = NativeRpcHandlers<typeof CookieStoreRpcGroup, R>

export const CookieStoreHandlersLive = CookieStoreRpcGroup.toLayer({
  "CookieStore.get": (input) =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* store.get(input)
    }),
  "CookieStore.remove": (input) =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      yield* store.remove(input)
    }),
  "CookieStore.set": (input) =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      yield* store.set(input)
    }),
  "CookieStore.isSupported": () =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* store.isSupported()
    }),
  "CookieStore.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const store = yield* CookieStore
        return store.events()
      })
    )
})

export const CookieStoreSurface = NativeSurface.make(Surface, CookieStoreRpcGroup, {
  service: CookieStore,
  capabilities: CookieStoreMethodNames,
  handlers: CookieStoreHandlersLive,
  client: (client) => cookieStoreClientFromRpcClient(client),
  bridgeClient: (client, exchange) => cookieStoreBridgeClientFromRpcClient(client, exchange)
})

export const makeCookieStoreMemoryClient = (): Effect.Effect<CookieStoreClientApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      get: (input) =>
        decodeCookieStoreGetInput(input, "CookieStore.get").pipe(
          Effect.map(() => new CookieStoreGetResult({ cookies: [] }))
        ),
      remove: (input) =>
        decodeCookieStoreRemoveInput(input, "CookieStore.remove").pipe(Effect.asVoid),
      set: (input) => decodeCookieStoreSetInput(input, "CookieStore.set").pipe(Effect.asVoid),
      isSupported: () => Effect.succeed(new CookieStoreSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies CookieStoreClientApi)
  )

export const makeCookieStoreUnsupportedClient = (): CookieStoreClientApi =>
  Object.freeze({
    get: () => Effect.fail(unsupportedError("CookieStore.get")),
    remove: () => Effect.fail(unsupportedError("CookieStore.remove")),
    set: () => Effect.fail(unsupportedError("CookieStore.set")),
    isSupported: () =>
      Effect.succeed(
        new CookieStoreSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies CookieStoreClientApi)

const cookieStoreClientFromRpcClient = (
  client: DesktopRpcClient<CookieStoreRpc>
): CookieStoreClientApi =>
  Object.freeze({
    get: (input) =>
      decodeCookieStoreGetInput(input, "CookieStore.get").pipe(
        Effect.flatMap((decoded) =>
          runCookieStoreRpc(client["CookieStore.get"](decoded), "CookieStore.get")
        )
      ),
    remove: (input) =>
      decodeCookieStoreRemoveInput(input, "CookieStore.remove").pipe(
        Effect.flatMap((decoded) =>
          runCookieStoreRpc(client["CookieStore.remove"](decoded), "CookieStore.remove")
        )
      ),
    set: (input) =>
      decodeCookieStoreSetInput(input, "CookieStore.set").pipe(
        Effect.flatMap((decoded) =>
          runCookieStoreRpc(client["CookieStore.set"](decoded), "CookieStore.set")
        )
      ),
    isSupported: () =>
      runCookieStoreRpc(client["CookieStore.isSupported"](undefined), "CookieStore.isSupported"),
    events: (profile) =>
      runCookieStoreRpcStream(
        client["CookieStore.events.Event"](undefined),
        "CookieStore.events.Event"
      ).pipe(Stream.filter((event) => profile === undefined || event.profile.id === profile.id))
  } satisfies CookieStoreClientApi)

const cookieStoreBridgeClientFromRpcClient = (
  client: DesktopRpcClient<CookieStoreRpc>,
  exchange: BridgeClientExchange
): CookieStoreClientApi =>
  Object.freeze({
    get: (input) =>
      decodeCookieStoreGetInput(input, "CookieStore.get").pipe(
        Effect.flatMap((decoded) =>
          runCookieStoreRpc(client["CookieStore.get"](decoded), "CookieStore.get")
        )
      ),
    remove: (input) =>
      decodeCookieStoreRemoveInput(input, "CookieStore.remove").pipe(
        Effect.flatMap((decoded) =>
          runCookieStoreRpc(client["CookieStore.remove"](decoded), "CookieStore.remove")
        )
      ),
    set: (input) =>
      decodeCookieStoreSetInput(input, "CookieStore.set").pipe(
        Effect.flatMap((decoded) =>
          runCookieStoreRpc(client["CookieStore.set"](decoded), "CookieStore.set")
        )
      ),
    isSupported: () =>
      runCookieStoreRpc(client["CookieStore.isSupported"](undefined), "CookieStore.isSupported"),
    events: (profile) =>
      NativeSurface.subscribeEvent(exchange, CookieStoreEventStream).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies CookieStoreClientApi)

const decodeCookieStoreGetInput = (
  input: unknown,
  operation: string
): Effect.Effect<CookieStoreGetInput, CookieStoreError, never> =>
  decodeNativeInput(CookieStoreGetInput, input, operation)

const decodeCookieStoreRemoveInput = (
  input: unknown,
  operation: string
): Effect.Effect<CookieStoreRemoveInput, CookieStoreError, never> =>
  decodeNativeInput(CookieStoreRemoveInput, input, operation)

const decodeCookieStoreSetInput = (
  input: unknown,
  operation: string
): Effect.Effect<CookieStoreSetInput, CookieStoreError, never> =>
  decodeNativeInput(CookieStoreSetInput, input, operation)

const runCookieStoreRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, CookieStoreError, never> => runNativeRpc(effect, operation, Surface)

const runCookieStoreRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, CookieStoreError, never> => runNativeRpcStream(stream, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
