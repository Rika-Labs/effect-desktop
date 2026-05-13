import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  Rpc,
  RpcClient,
  RpcCapability,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import type { PermissionRegistry } from "@effect-desktop/core"
import { P, DesktopRpc, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema } from "effect"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import {
  DialogConfirmInput,
  type DialogConfirmOptions,
  DialogConfirmResult,
  DialogMessageInput,
  type DialogMessageOptions,
  DialogOpenDirectoryInput,
  type DialogOpenDirectoryOptions,
  DialogOpenFileInput,
  type DialogOpenFileOptions,
  DialogOpenResult,
  DialogSaveFileInput,
  type DialogSaveFileOptions,
  DialogSaveResult
} from "./contracts/dialog.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type DialogError = HostProtocolError

export const DialogOpenFile = dialogRpc(
  "openFile",
  DialogOpenFileInput,
  DialogOpenResult,
  P.nativeInvoke({ primitive: "Dialog", methods: ["openFile"] })
)
export const DialogOpenDirectory = dialogRpc(
  "openDirectory",
  DialogOpenDirectoryInput,
  DialogOpenResult,
  P.nativeInvoke({ primitive: "Dialog", methods: ["openDirectory"] })
)
export const DialogSaveFile = dialogRpc(
  "saveFile",
  DialogSaveFileInput,
  DialogSaveResult,
  P.nativeInvoke({ primitive: "Dialog", methods: ["saveFile"] })
)
export const DialogMessage = dialogRpc(
  "message",
  DialogMessageInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dialog", methods: ["message"] })
)
export const DialogConfirm = dialogRpc(
  "confirm",
  DialogConfirmInput,
  DialogConfirmResult,
  P.nativeInvoke({ primitive: "Dialog", methods: ["confirm"] })
)

export const DialogRpcEvents = Object.freeze({})

export type DialogRpcEvents = typeof DialogRpcEvents

const DialogRpcGroup = RpcGroup.make(
  DialogOpenFile,
  DialogOpenDirectory,
  DialogSaveFile,
  DialogMessage,
  DialogConfirm
)

export const DialogRpcs: RpcGroup.RpcGroup<DialogRpc> = DialogRpcGroup

export type DialogRpc = RpcGroup.Rpcs<typeof DialogRpcGroup>

export const DialogMethodNames = Object.freeze([
  "openFile",
  "openDirectory",
  "saveFile",
  "message",
  "confirm"
] as const)

export interface DialogClientApi {
  readonly openFile: (
    input?: DialogOpenFileOptions
  ) => Effect.Effect<DialogOpenResult, DialogError, never>
  readonly openDirectory: (
    input?: DialogOpenDirectoryOptions
  ) => Effect.Effect<DialogOpenResult, DialogError, never>
  readonly saveFile: (
    input?: DialogSaveFileOptions
  ) => Effect.Effect<DialogSaveResult, DialogError, never>
  readonly message: (input: DialogMessageOptions) => Effect.Effect<void, DialogError, never>
  readonly confirm: (
    input: DialogConfirmOptions
  ) => Effect.Effect<DialogConfirmResult, DialogError, never>
}

export class DialogClient extends Context.Service<DialogClient, DialogClientApi>()(
  "@effect-desktop/native/DialogClient"
) {}

export interface DialogServiceApi {
  readonly openFile: (
    input?: DialogOpenFileOptions
  ) => Effect.Effect<ReadonlyArray<string>, DialogError, never>
  readonly openDirectory: (
    input?: DialogOpenDirectoryOptions
  ) => Effect.Effect<ReadonlyArray<string>, DialogError, never>
  readonly saveFile: (input?: DialogSaveFileOptions) => Effect.Effect<string, DialogError, never>
  readonly message: (input: DialogMessageOptions) => Effect.Effect<void, DialogError, never>
  readonly confirm: (input: DialogConfirmOptions) => Effect.Effect<boolean, DialogError, never>
}

export class Dialog extends Context.Service<Dialog, DialogServiceApi>()(
  "@effect-desktop/native/Dialog"
) {}

export const DialogLive = Layer.effect(Dialog)(
  Effect.gen(function* () {
    const client = yield* DialogClient
    return makeDialogService(client)
  })
)

export const makeDialogClientLayer = (client: DialogClientApi): Layer.Layer<DialogClient> =>
  Layer.succeed(DialogClient)(client)

export const makeDialogServiceLayer = (client: DialogClientApi): Layer.Layer<Dialog> =>
  Layer.provide(DialogLive, makeDialogClientLayer(client))

export const makeDialogBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<DialogClient> =>
  Layer.succeed(DialogClient)(makeDialogBridgeClient(exchange, options))

export type DialogRpcHandlers = Parameters<typeof DialogRpcGroup.toLayer>[0]

export const DialogHandlersLive = DialogRpcGroup.toLayer({
  "Dialog.openFile": (input) =>
    Effect.gen(function* () {
      const dialog = yield* Dialog
      const paths = yield* dialog.openFile(input)
      return new DialogOpenResult({ paths })
    }),
  "Dialog.openDirectory": (input) =>
    Effect.gen(function* () {
      const dialog = yield* Dialog
      const paths = yield* dialog.openDirectory(input)
      return new DialogOpenResult({ paths })
    }),
  "Dialog.saveFile": (input) =>
    Effect.gen(function* () {
      const dialog = yield* Dialog
      const path = yield* dialog.saveFile(input)
      return new DialogSaveResult({ path })
    }),
  "Dialog.message": (input) =>
    Effect.gen(function* () {
      const dialog = yield* Dialog
      yield* dialog.message(input)
    }),
  "Dialog.confirm": (input) =>
    Effect.gen(function* () {
      const dialog = yield* Dialog
      const confirmed = yield* dialog.confirm(input)
      return new DialogConfirmResult({ confirmed })
    })
})

export const DialogSurface = DesktopRpc.surface("Dialog", DialogRpcGroup, {
  service: DialogClient,
  handlers: DialogHandlersLive,
  client: (client) => dialogClientFromRpcClient(client)
})

export const makeHostDialogRpcRuntime = (
  handlers: DialogRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  makeNativeHostRpcRuntime(DialogRpcGroup, DialogRpcGroup.toLayer(handlers), runtimeOptions)

const makeDialogService = (client: DialogClientApi): DialogServiceApi => {
  const service: DialogServiceApi = {
    openFile: (input) => client.openFile(input ?? {}).pipe(Effect.map((result) => result.paths)),
    openDirectory: (input) =>
      client.openDirectory(input ?? {}).pipe(Effect.map((result) => result.paths)),
    saveFile: (input) => client.saveFile(input ?? {}).pipe(Effect.map((result) => result.path)),
    message: (input) => client.message(input),
    confirm: (input) => client.confirm(input).pipe(Effect.map((result) => result.confirmed))
  }

  return Object.freeze(service)
}

const makeDialogBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const makeDialogBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): DialogClientApi => {
  const useClient = <A>(
    use: (client: DialogClientApi) => Effect.Effect<A, DialogError, never>
  ): Effect.Effect<A, DialogError, never> =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* DialogClient
        return yield* use(client)
      }).pipe(
        Effect.provide(DialogSurface.clientLayer),
        Effect.provide(makeDialogBridgeProtocolLayer(exchange, options))
      )
    )

  return Object.freeze({
    openFile: (input) => useClient((client) => client.openFile(input)),
    openDirectory: (input) => useClient((client) => client.openDirectory(input)),
    saveFile: (input) => useClient((client) => client.saveFile(input)),
    message: (input) => useClient((client) => client.message(input)),
    confirm: (input) => useClient((client) => client.confirm(input))
  } satisfies DialogClientApi)
}

const dialogClientFromRpcClient = (client: DesktopRpcClient<DialogRpc>): DialogClientApi => {
  const dialogClient: DialogClientApi = {
    openFile: (input = {}) =>
      decodeDialogOpenFileInput(input).pipe(
        Effect.flatMap((decoded) =>
          runDialogRpc(client["Dialog.openFile"](decoded), "Dialog.openFile")
        )
      ),
    openDirectory: (input = {}) =>
      decodeDialogOpenDirectoryInput(input).pipe(
        Effect.flatMap((decoded) =>
          runDialogRpc(client["Dialog.openDirectory"](decoded), "Dialog.openDirectory")
        )
      ),
    saveFile: (input = {}) =>
      decodeDialogSaveFileInput(input).pipe(
        Effect.flatMap((decoded) =>
          runDialogRpc(client["Dialog.saveFile"](decoded), "Dialog.saveFile")
        )
      ),
    message: (input) =>
      decodeDialogMessageInput(input).pipe(
        Effect.flatMap((decoded) =>
          runDialogRpc(client["Dialog.message"](decoded), "Dialog.message")
        )
      ),
    confirm: (input) =>
      decodeDialogConfirmInput(input).pipe(
        Effect.flatMap((decoded) =>
          runDialogRpc(client["Dialog.confirm"](decoded), "Dialog.confirm")
        )
      )
  }

  return Object.freeze(dialogClient)
}

export const makeUnsupportedDialogClient = (): DialogClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, DialogError, never> =>
    Effect.fail(unsupportedError(method))

  const client: DialogClientApi = {
    openFile: () => unsupportedEffect<DialogOpenResult>("Dialog.openFile"),
    openDirectory: () => unsupportedEffect<DialogOpenResult>("Dialog.openDirectory"),
    saveFile: () => unsupportedEffect<DialogSaveResult>("Dialog.saveFile"),
    message: () => unsupportedEffect<void>("Dialog.message"),
    confirm: () => unsupportedEffect<DialogConfirmResult>("Dialog.confirm")
  }

  return Object.freeze(client)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Dialog platform adapter is not implemented yet",
    message: `unsupported Dialog method: ${method}`,
    operation: method,
    recoverable: false
  })

const decodeDialogOpenFileInput = (
  input: unknown
): Effect.Effect<DialogOpenFileInput, DialogError, never> =>
  decodeInput(DialogOpenFileInput, input, "Dialog.openFile")

const decodeDialogOpenDirectoryInput = (
  input: unknown
): Effect.Effect<DialogOpenDirectoryInput, DialogError, never> =>
  decodeInput(DialogOpenDirectoryInput, input, "Dialog.openDirectory")

const decodeDialogSaveFileInput = (
  input: unknown
): Effect.Effect<DialogSaveFileInput, DialogError, never> =>
  decodeInput(DialogSaveFileInput, input, "Dialog.saveFile")

const decodeDialogMessageInput = (
  input: unknown
): Effect.Effect<DialogMessageInput, DialogError, never> =>
  decodeInput(DialogMessageInput, input, "Dialog.message")

const decodeDialogConfirmInput = (
  input: unknown
): Effect.Effect<DialogConfirmInput, DialogError, never> =>
  decodeInput(DialogConfirmInput, input, "Dialog.confirm")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, DialogError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const runDialogRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DialogError, never> =>
  effect.pipe(
    Effect.mapError(mapDialogRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapDialogRpcClientError = (error: unknown): DialogError =>
  isDialogError(error) ? error : makeHostProtocolInternalError("Dialog RPC client failed", "Dialog")

const isDialogError = (error: unknown): error is DialogError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

function dialogRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return Rpc.make(`Dialog.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability(capability))
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
