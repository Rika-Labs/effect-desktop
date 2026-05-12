import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  Rpc,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"

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
  "native.invoke:Dialog.openFile"
)
export const DialogOpenDirectory = dialogRpc(
  "openDirectory",
  DialogOpenDirectoryInput,
  DialogOpenResult,
  "native.invoke:Dialog.openDirectory"
)
export const DialogSaveFile = dialogRpc(
  "saveFile",
  DialogSaveFileInput,
  DialogSaveResult,
  "native.invoke:Dialog.saveFile"
)
export const DialogMessage = dialogRpc(
  "message",
  DialogMessageInput,
  Schema.Void,
  "native.invoke:Dialog.message"
)
export const DialogConfirm = dialogRpc(
  "confirm",
  DialogConfirmInput,
  DialogConfirmResult,
  "native.invoke:Dialog.confirm"
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

export const DialogRpcs = BridgeRpc.fromGroup("Dialog", DialogRpcGroup, DialogRpcEvents)

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

export type DialogRpcSpec = (typeof DialogRpcs)["spec"]

export const makeHostDialogBridgeRpcLayer = <Handlers extends BridgeRpcHandlers<DialogRpcSpec>>(
  handlers: Handlers
): BridgeRpcLayer<"Dialog", DialogRpcSpec, Handlers, DialogRpcEvents> =>
  BridgeRpc.layer(DialogRpcs)(handlers)

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

const makeDialogBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): DialogClientApi => {
  const client = Client({ Dialog: DialogRpcs }, exchange, options).Dialog as unknown as {
    readonly openFile: (
      input: DialogOpenFileInput
    ) => Effect.Effect<DialogOpenResult, DialogError, never>
    readonly openDirectory: (
      input: DialogOpenDirectoryInput
    ) => Effect.Effect<DialogOpenResult, DialogError, never>
    readonly saveFile: (
      input: DialogSaveFileInput
    ) => Effect.Effect<DialogSaveResult, DialogError, never>
    readonly message: (input: DialogMessageInput) => Effect.Effect<void, DialogError, never>
    readonly confirm: (
      input: DialogConfirmInput
    ) => Effect.Effect<DialogConfirmResult, DialogError, never>
  }

  const dialogClient: DialogClientApi = {
    openFile: (input = {}) =>
      decodeDialogOpenFileInput(input).pipe(Effect.flatMap(client.openFile)),
    openDirectory: (input = {}) =>
      decodeDialogOpenDirectoryInput(input).pipe(Effect.flatMap(client.openDirectory)),
    saveFile: (input = {}) =>
      decodeDialogSaveFileInput(input).pipe(Effect.flatMap(client.saveFile)),
    message: (input) => decodeDialogMessageInput(input).pipe(Effect.flatMap(client.message)),
    confirm: (input) => decodeDialogConfirmInput(input).pipe(Effect.flatMap(client.confirm))
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
  decodeInput(DialogOpenFileInput, input, "Dialog.openFile") as Effect.Effect<
    DialogOpenFileInput,
    DialogError,
    never
  >

const decodeDialogOpenDirectoryInput = (
  input: unknown
): Effect.Effect<DialogOpenDirectoryInput, DialogError, never> =>
  decodeInput(DialogOpenDirectoryInput, input, "Dialog.openDirectory") as Effect.Effect<
    DialogOpenDirectoryInput,
    DialogError,
    never
  >

const decodeDialogSaveFileInput = (
  input: unknown
): Effect.Effect<DialogSaveFileInput, DialogError, never> =>
  decodeInput(DialogSaveFileInput, input, "Dialog.saveFile") as Effect.Effect<
    DialogSaveFileInput,
    DialogError,
    never
  >

const decodeDialogMessageInput = (
  input: unknown
): Effect.Effect<DialogMessageInput, DialogError, never> =>
  decodeInput(DialogMessageInput, input, "Dialog.message") as Effect.Effect<
    DialogMessageInput,
    DialogError,
    never
  >

const decodeDialogConfirmInput = (
  input: unknown
): Effect.Effect<DialogConfirmInput, DialogError, never> =>
  decodeInput(DialogConfirmInput, input, "Dialog.confirm") as Effect.Effect<
    DialogConfirmInput,
    DialogError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, DialogError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function dialogRpc<Payload extends Schema.Schema<unknown>, Success extends Schema.Schema<unknown>>(
  method: string,
  payload: Payload,
  success: Success,
  capability: string
) {
  return Rpc.make(`Dialog.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
