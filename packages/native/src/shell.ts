import {
  Api,
  Client,
  type ApiClientExchange,
  type ApiClientOptions,
  type ApiContractClass,
  type ApiContractError,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema } from "effect"

import {
  ShellOpenExternalInput,
  type ShellOpenExternalOptions,
  ShellOpenPathInput,
  type ShellOpenPathOptions,
  ShellShowItemInFolderInput,
  ShellTrashItemInput
} from "./contracts/shell.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const DefaultExternalSchemes = Object.freeze(["http", "https", "mailto", "tel"])
const ExecutableExtensions = Object.freeze([
  ".exe",
  ".bat",
  ".sh",
  ".ps1",
  ".js",
  ".command",
  ".app"
])
const ShellMetacharacters = /[;|&><`\n]|\$\(/u
const NUL_BYTE = String.fromCharCode(0)

export type ShellError = HostProtocolError

export const ShellApiSpec = Object.freeze({
  openExternal: shellMethodSpec(ShellOpenExternalInput, "native.invoke:Shell.openExternal"),
  showItemInFolder: shellMethodSpec(
    ShellShowItemInFolderInput,
    "native.invoke:Shell.showItemInFolder"
  ),
  openPath: shellMethodSpec(ShellOpenPathInput, "native.invoke:Shell.openPath"),
  trashItem: shellMethodSpec(ShellTrashItemInput, "native.invoke:Shell.trashItem")
}) satisfies ApiContractSpec

export type ShellApiSpec = typeof ShellApiSpec

export const ShellApiEvents = Object.freeze({})

export type ShellApiEvents = typeof ShellApiEvents

export const ShellApi: ApiContractClass<"Shell", ShellApiSpec, ShellApiEvents> = (() => {
  const contract = class {
    static readonly tag = "Shell"
    static readonly spec = ShellApiSpec
    static readonly events = ShellApiEvents

    static layer<Handlers extends ApiHandlers<ShellApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"Shell", ShellApiSpec, Handlers, ShellApiEvents> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<"Shell", ShellApiSpec, ShellApiEvents>

  return Object.freeze(contract)
})()

export const registerShellApi = (): Effect.Effect<
  ApiContractClass<"Shell", ShellApiSpec, ShellApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Shell")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Shell", ShellApiSpec, ShellApiEvents>
    }

    return yield* Api.Tag("Shell")<unknown>()(ShellApiSpec, ShellApiEvents)
  })

export const ShellMethodNames = Object.freeze(
  Object.keys(ShellApiSpec) as ReadonlyArray<keyof ShellApiSpec>
)

export interface ShellClientApi {
  readonly openExternal: (
    url: string,
    options?: Omit<ShellOpenExternalOptions, "url">
  ) => Effect.Effect<void, ShellError, never>
  readonly showItemInFolder: (path: string) => Effect.Effect<void, ShellError, never>
  readonly openPath: (
    path: string,
    options?: Omit<ShellOpenPathOptions, "path">
  ) => Effect.Effect<void, ShellError, never>
  readonly trashItem: (path: string) => Effect.Effect<void, ShellError, never>
}

export class ShellClient extends Context.Service<ShellClient, ShellClientApi>()(
  "@effect-desktop/native/ShellClient"
) {}

export type ShellServiceApi = ShellClientApi

export class Shell extends Context.Service<Shell, ShellServiceApi>()(
  "@effect-desktop/native/Shell"
) {}

export const ShellLive = Layer.effect(Shell)(
  Effect.gen(function* () {
    const client = yield* ShellClient
    return Object.freeze({
      openExternal: (url, options) => client.openExternal(url, options),
      showItemInFolder: (path) => client.showItemInFolder(path),
      openPath: (path, options) => client.openPath(path, options),
      trashItem: (path) => client.trashItem(path)
    } satisfies ShellServiceApi)
  })
)

export const makeShellClientLayer = (client: ShellClientApi): Layer.Layer<ShellClient> =>
  Layer.succeed(ShellClient)(client)

export const makeShellServiceLayer = (client: ShellClientApi): Layer.Layer<Shell> =>
  Layer.provide(ShellLive, makeShellClientLayer(client))

export const makeShellBridgeClientLayer = (
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<ShellClient> => Layer.succeed(ShellClient)(makeShellBridgeClient(exchange, options))

export const makeHostShellApiLayer = <Handlers extends ApiHandlers<ShellApiSpec>>(
  handlers: Handlers
): ApiLayer<"Shell", ShellApiSpec, Handlers, ShellApiEvents> => ShellApi.layer(handlers)

const makeShellBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): ShellClientApi => {
  const client = Client({ Shell: ShellApi }, exchange, options).Shell

  const shellClient: ShellClientApi = {
    openExternal: (url, options) =>
      decodeShellOpenExternalInput({ url, ...normalizeOpenExternalOptions(options) }).pipe(
        Effect.flatMap(validateExternalUrl),
        Effect.flatMap(client.openExternal)
      ),
    showItemInFolder: (path) =>
      decodeShellShowItemInFolderInput({ path }).pipe(
        Effect.flatMap((input) => validatePathInput(input, "Shell.showItemInFolder")),
        Effect.flatMap(client.showItemInFolder)
      ),
    openPath: (path, options) =>
      decodeShellOpenPathInput({ path, ...normalizeOpenPathOptions(options) }).pipe(
        Effect.flatMap(validateOpenPathInput),
        Effect.flatMap(client.openPath)
      ),
    trashItem: (path) =>
      decodeShellTrashItemInput({ path }).pipe(
        Effect.flatMap((input) => validatePathInput(input, "Shell.trashItem")),
        Effect.flatMap(client.trashItem)
      )
  }

  return Object.freeze(shellClient)
}

export const makeUnsupportedShellClient = (): ShellClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, ShellError, never> =>
    Effect.fail(unsupportedError(method))

  const client: ShellClientApi = {
    openExternal: () => unsupportedEffect<void>("Shell.openExternal"),
    showItemInFolder: () => unsupportedEffect<void>("Shell.showItemInFolder"),
    openPath: () => unsupportedEffect<void>("Shell.openPath"),
    trashItem: () => unsupportedEffect<void>("Shell.trashItem")
  }

  return Object.freeze(client)
}

const validateExternalUrl = (
  input: ShellOpenExternalInput
): Effect.Effect<ShellOpenExternalInput, ShellError, never> =>
  Effect.gen(function* () {
    const parsed = yield* parseUrl(input.url, "Shell.openExternal")
    const scheme = parsed.protocol.replace(/:$/u, "").toLowerCase()

    if (parsed.protocol === "file:") {
      return yield* Effect.fail(
        permissionDenied("native.invoke:Shell.openExternal", input.url, "Shell.openExternal")
      )
    }

    if (!DefaultExternalSchemes.includes(scheme)) {
      return yield* Effect.fail(
        permissionDenied("native.invoke:Shell.openExternal", scheme, "Shell.openExternal")
      )
    }

    return input
  })

const validateOpenPathInput = (
  input: ShellOpenPathInput
): Effect.Effect<ShellOpenPathInput, ShellError, never> =>
  validatePathInput(input, "Shell.openPath").pipe(
    Effect.flatMap((validated) => {
      if (!isExecutablePath(validated.path) || validated.allowExecutable === true) {
        return Effect.succeed(validated)
      }

      return Effect.fail(
        permissionDenied("native.invoke:Shell.openPath", validated.path, "Shell.openPath")
      )
    })
  )

const validatePathInput = <A extends { readonly path: string }>(
  input: A,
  operation: string
): Effect.Effect<A, ShellError, never> => {
  if (input.path.length === 0) {
    return Effect.fail(makeHostProtocolInvalidArgumentError("path", "must not be empty", operation))
  }

  if (input.path.includes(NUL_BYTE)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError("path", "must not contain NUL bytes", operation)
    )
  }

  if (ShellMetacharacters.test(input.path)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError("path", "contains shell metacharacters", operation)
    )
  }

  return Effect.succeed(input)
}

const parseUrl = (url: string, operation: string): Effect.Effect<URL, ShellError, never> =>
  Effect.try({
    try: () => new URL(url),
    catch: (error) =>
      makeHostProtocolInvalidArgumentError("url", formatUnknownError(error), operation)
  })

const permissionDenied = (
  capability: string,
  resource: string,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability,
    resource,
    message: `permission denied for ${resource}`,
    operation,
    recoverable: false
  })

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Shell platform adapter is not implemented yet",
    message: `unsupported Shell method: ${method}`,
    operation: method,
    recoverable: false
  })

const normalizeOpenExternalOptions = (
  _options: Omit<ShellOpenExternalOptions, "url"> | undefined
): Omit<ShellOpenExternalOptions, "url"> => ({})

const normalizeOpenPathOptions = (
  options: Omit<ShellOpenPathOptions, "path"> | undefined
): Omit<ShellOpenPathOptions, "path"> =>
  options?.allowExecutable === undefined ? {} : { allowExecutable: options.allowExecutable }

const isExecutablePath = (path: string): boolean => {
  const lower = path.toLowerCase()
  return ExecutableExtensions.some((extension) => lower.endsWith(extension))
}

const decodeShellOpenExternalInput = (
  input: unknown
): Effect.Effect<ShellOpenExternalInput, ShellError, never> =>
  decodeInput(ShellOpenExternalInput, input, "Shell.openExternal") as Effect.Effect<
    ShellOpenExternalInput,
    ShellError,
    never
  >

const decodeShellShowItemInFolderInput = (
  input: unknown
): Effect.Effect<ShellShowItemInFolderInput, ShellError, never> =>
  decodeInput(ShellShowItemInFolderInput, input, "Shell.showItemInFolder") as Effect.Effect<
    ShellShowItemInFolderInput,
    ShellError,
    never
  >

const decodeShellOpenPathInput = (
  input: unknown
): Effect.Effect<ShellOpenPathInput, ShellError, never> =>
  decodeInput(ShellOpenPathInput, input, "Shell.openPath") as Effect.Effect<
    ShellOpenPathInput,
    ShellError,
    never
  >

const decodeShellTrashItemInput = (
  input: unknown
): Effect.Effect<ShellTrashItemInput, ShellError, never> =>
  decodeInput(ShellTrashItemInput, input, "Shell.trashItem") as Effect.Effect<
    ShellTrashItemInput,
    ShellError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, ShellError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function shellMethodSpec<Input extends Schema.Schema<unknown>>(input: Input, permission: string) {
  return {
    input,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission
  } as const
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
