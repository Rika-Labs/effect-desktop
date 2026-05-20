import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
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

export type DialogError = HostProtocolError

const DialogLinuxMultiSelectionReason = "linux-zenity-multi-selection-unavailable"
const DialogSelectionSupport = NativeSurface.support.partial(DialogLinuxMultiSelectionReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "supported" },
    { platform: "linux", status: "partial", reason: DialogLinuxMultiSelectionReason }
  ]
}) satisfies RpcSupportMetadata

export const DialogOpenFile = dialogRpc(
  "openFile",
  DialogOpenFileInput,
  DialogOpenResult,
  P.nativeInvoke({ primitive: "Dialog", methods: ["openFile"] }),
  DialogSelectionSupport
)
export const DialogOpenDirectory = dialogRpc(
  "openDirectory",
  DialogOpenDirectoryInput,
  DialogOpenResult,
  P.nativeInvoke({ primitive: "Dialog", methods: ["openDirectory"] }),
  DialogSelectionSupport
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
  "@orika/native/DialogClient"
) {}

export interface DialogServiceApi {
  readonly openFile: (
    input?: DialogOpenFileOptions
  ) => Effect.Effect<ReadonlyArray<string>, DialogError, never>
  readonly openDirectory: (
    input?: DialogOpenDirectoryOptions
  ) => Effect.Effect<ReadonlyArray<string>, DialogError, never>
  readonly saveFile: (
    input?: DialogSaveFileOptions
  ) => Effect.Effect<string | undefined, DialogError, never>
  readonly message: (input: DialogMessageOptions) => Effect.Effect<void, DialogError, never>
  readonly confirm: (input: DialogConfirmOptions) => Effect.Effect<boolean, DialogError, never>
}

export class Dialog extends Context.Service<Dialog, DialogServiceApi>()("@orika/native/Dialog") {
  static readonly layer = Layer.effect(Dialog)(
    Effect.gen(function* () {
      const client = yield* DialogClient
      return Dialog.of(makeDialogService(client))
    })
  )
}

export const DialogLive = Dialog.layer

export const makeDialogClientLayer = (client: DialogClientApi): Layer.Layer<DialogClient> =>
  Layer.succeed(DialogClient)(client)

export const makeDialogServiceLayer = (client: DialogClientApi): Layer.Layer<Dialog> =>
  Layer.provide(DialogLive, makeDialogClientLayer(client))

export const makeDialogBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<DialogClient> => DialogSurface.bridgeClientLayer(exchange, options)

export type DialogRpcHandlers = RpcGroup.HandlersFrom<DialogRpc>

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
      return path === undefined ? new DialogSaveResult({}) : new DialogSaveResult({ path })
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

export const DialogSurface = NativeSurface.make("Dialog", DialogRpcGroup, {
  service: DialogClient,
  capabilities: DialogMethodNames,
  handlers: DialogHandlersLive,
  client: (client) => dialogClientFromRpcClient(client)
})

export const makeHostDialogRpcRuntime = (
  handlers: DialogRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => DialogSurface.hostRuntime(handlers, runtimeOptions)

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

const decodeDialogOpenFileInput = (
  input: unknown
): Effect.Effect<DialogOpenFileInput, DialogError, never> =>
  decodeNativeInput(DialogOpenFileInput, input, "Dialog.openFile")

const decodeDialogOpenDirectoryInput = (
  input: unknown
): Effect.Effect<DialogOpenDirectoryInput, DialogError, never> =>
  decodeNativeInput(DialogOpenDirectoryInput, input, "Dialog.openDirectory")

const decodeDialogSaveFileInput = (
  input: unknown
): Effect.Effect<DialogSaveFileInput, DialogError, never> =>
  decodeNativeInput(DialogSaveFileInput, input, "Dialog.saveFile")

const decodeDialogMessageInput = (
  input: unknown
): Effect.Effect<DialogMessageInput, DialogError, never> =>
  decodeNativeInput(DialogMessageInput, input, "Dialog.message")

const decodeDialogConfirmInput = (
  input: unknown
): Effect.Effect<DialogConfirmInput, DialogError, never> =>
  decodeNativeInput(DialogConfirmInput, input, "Dialog.confirm")

const runDialogRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DialogError, never> => runNativeRpc(effect, operation, "Dialog")

function dialogRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata,
  support: RpcSupportMetadata = NativeSurface.support.supported
) {
  return NativeSurface.rpc("Dialog", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support
  })
}
