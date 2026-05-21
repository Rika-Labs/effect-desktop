import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"
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
const ReservedExternalSchemes = Object.freeze(["file", "javascript"])
const ExecutableExtensions = Object.freeze([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".msi",
  ".sh",
  ".ps1",
  ".vbs",
  ".wsf",
  ".js",
  ".desktop",
  ".lnk",
  ".url",
  ".command",
  ".app"
])
const ShellMetacharacters = /[;|&><`\n]|\$\(/u
// eslint-disable-next-line no-control-regex -- Shell URLs must not carry raw control bytes.
const ShellUrlControlCharacters = /[\u0000-\u001f\u007f]/u
// eslint-disable-next-line no-control-regex -- Shell paths must not carry raw control bytes.
const ShellPathControlCharacters = /[\u0000-\u001f\u007f]/u

export type ShellError = HostProtocolError

export const ShellOpenExternal = shellRpc(
  "openExternal",
  ShellOpenExternalInput,
  P.nativeInvoke({ primitive: "Shell", methods: ["openExternal"] })
)
export const ShellShowItemInFolder = shellRpc(
  "showItemInFolder",
  ShellShowItemInFolderInput,
  P.nativeInvoke({ primitive: "Shell", methods: ["showItemInFolder"] })
)
export const ShellOpenPath = shellRpc(
  "openPath",
  ShellOpenPathInput,
  P.nativeInvoke({ primitive: "Shell", methods: ["openPath"] })
)
export const ShellTrashItem = shellRpc(
  "trashItem",
  ShellTrashItemInput,
  P.nativeInvoke({ primitive: "Shell", methods: ["trashItem"] })
)

export const ShellRpcEvents = Object.freeze({})

export type ShellRpcEvents = typeof ShellRpcEvents

const ShellRpcGroup = RpcGroup.make(
  ShellOpenExternal,
  ShellShowItemInFolder,
  ShellOpenPath,
  ShellTrashItem
)

export const ShellRpcs: RpcGroup.RpcGroup<ShellRpc> = ShellRpcGroup

export const ShellMethodNames = Object.freeze([
  "openExternal",
  "showItemInFolder",
  "openPath",
  "trashItem"
] as const)

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
) {
  static readonly layer = Layer.effect(Shell)(
    Effect.gen(function* () {
      const client = yield* ShellClient
      return Shell.of({
        openExternal: (url, options) => client.openExternal(url, options),
        showItemInFolder: (path) => client.showItemInFolder(path),
        openPath: (path, options) => client.openPath(path, options),
        trashItem: (path) => client.trashItem(path)
      } satisfies ShellServiceApi)
    })
  )
}

export const ShellLive = Shell.layer

export const makeShellClientLayer = (client: ShellClientApi): Layer.Layer<ShellClient> =>
  Layer.succeed(ShellClient)(client)

export const makeShellServiceLayer = (client: ShellClientApi): Layer.Layer<Shell> =>
  Layer.provide(ShellLive, makeShellClientLayer(client))

export const makeShellBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ShellClient> => ShellSurface.bridgeClientLayer(exchange, options)

export type ShellRpc = RpcGroup.Rpcs<typeof ShellRpcGroup>

export type ShellRpcHandlers = RpcGroup.HandlersFrom<ShellRpc>

export const ShellHandlersLive = ShellRpcGroup.toLayer({
  "Shell.openExternal": (input) =>
    Effect.gen(function* () {
      const shell = yield* Shell
      yield* shell.openExternal(
        input.url,
        input.allowedSchemes === undefined ? undefined : { allowedSchemes: input.allowedSchemes }
      )
    }),
  "Shell.showItemInFolder": (input) =>
    Effect.gen(function* () {
      const shell = yield* Shell
      yield* shell.showItemInFolder(input.path)
    }),
  "Shell.openPath": (input) =>
    Effect.gen(function* () {
      const shell = yield* Shell
      yield* shell.openPath(
        input.path,
        input.allowExecutable === undefined ? undefined : { allowExecutable: input.allowExecutable }
      )
    }),
  "Shell.trashItem": (input) =>
    Effect.gen(function* () {
      const shell = yield* Shell
      yield* shell.trashItem(input.path)
    })
})

export const ShellSurface = NativeSurface.make("Shell", ShellRpcGroup, {
  service: ShellClient,
  capabilities: ShellMethodNames,
  handlers: ShellHandlersLive,
  client: (client) => shellClientFromRpcClient(client)
})

export const makeHostShellRpcRuntime = (
  handlers: ShellRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => ShellSurface.hostRuntime(handlers, runtimeOptions)

const shellClientFromRpcClient = (client: DesktopRpcClient<ShellRpc>): ShellClientApi => {
  const shellClient: ShellClientApi = {
    openExternal: (url, options) =>
      decodeShellOpenExternalInput({ url, ...normalizeOpenExternalOptions(options) }).pipe(
        Effect.flatMap(validateExternalUrl),
        Effect.flatMap((decoded) =>
          runShellRpc(client["Shell.openExternal"](decoded), "Shell.openExternal")
        )
      ),
    showItemInFolder: (path) =>
      decodeShellShowItemInFolderInput({ path }).pipe(
        Effect.flatMap((input) => validatePathInput(input, "Shell.showItemInFolder")),
        Effect.flatMap((decoded) =>
          runShellRpc(client["Shell.showItemInFolder"](decoded), "Shell.showItemInFolder")
        )
      ),
    openPath: (path, options) =>
      decodeShellOpenPathInput({ path, ...normalizeOpenPathOptions(options) }).pipe(
        Effect.flatMap(validateOpenPathInput),
        Effect.flatMap((decoded) =>
          runShellRpc(client["Shell.openPath"](decoded), "Shell.openPath")
        )
      ),
    trashItem: (path) =>
      decodeShellTrashItemInput({ path }).pipe(
        Effect.flatMap((input) => validatePathInput(input, "Shell.trashItem")),
        Effect.flatMap((decoded) =>
          runShellRpc(client["Shell.trashItem"](decoded), "Shell.trashItem")
        )
      )
  }

  return Object.freeze(shellClient)
}

const validateExternalUrl = (
  input: ShellOpenExternalInput
): Effect.Effect<ShellOpenExternalInput, ShellError, never> =>
  Effect.gen(function* () {
    if (ShellUrlControlCharacters.test(input.url)) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "url",
          "must not contain control characters",
          "Shell.openExternal"
        )
      )
    }

    const parsed = yield* parseUrl(input.url, "Shell.openExternal")
    const scheme = parsed.protocol.replace(/:$/u, "").toLowerCase()
    const allowedSchemes = new Set([
      ...DefaultExternalSchemes,
      ...(input.allowedSchemes?.map(normalizeScheme) ?? [])
    ])

    if (ReservedExternalSchemes.includes(scheme)) {
      return yield* Effect.fail(
        permissionDenied(
          P.nativeInvoke({ primitive: "Shell", methods: ["openExternal"] }),
          input.url,
          "Shell.openExternal"
        )
      )
    }

    if (!allowedSchemes.has(scheme)) {
      return yield* Effect.fail(
        permissionDenied(
          P.nativeInvoke({ primitive: "Shell", methods: ["openExternal"] }),
          scheme,
          "Shell.openExternal"
        )
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
        permissionDenied(
          P.nativeInvoke({ primitive: "Shell", methods: ["openPath"] }),
          validated.path,
          "Shell.openPath"
        )
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

  if (ShellPathControlCharacters.test(input.path)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError("path", "must not contain control characters", operation)
    )
  }

  if (ShellMetacharacters.test(input.path)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError("path", "contains shell metacharacters", operation)
    )
  }

  if (input.path.startsWith("-")) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(
        "path",
        "must not begin with an option prefix",
        operation
      )
    )
  }

  if (hasParentTraversal(input.path)) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError("path", "must not contain parent traversal", operation)
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
  capability: RpcCapabilityMetadata,
  resource: string,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: capability.kind,
    resource,
    message: `permission denied for ${resource}`,
    operation,
    recoverable: false
  })

const normalizeOpenExternalOptions = (
  options: Omit<ShellOpenExternalOptions, "url"> | undefined
): Omit<ShellOpenExternalOptions, "url"> =>
  options?.allowedSchemes === undefined ? {} : { allowedSchemes: options.allowedSchemes }

const normalizeOpenPathOptions = (
  options: Omit<ShellOpenPathOptions, "path"> | undefined
): Omit<ShellOpenPathOptions, "path"> =>
  options?.allowExecutable === undefined ? {} : { allowExecutable: options.allowExecutable }

const isExecutablePath = (path: string): boolean => {
  const lower = path.toLowerCase()
  return ExecutableExtensions.some((extension) => lower.endsWith(extension))
}

const normalizeScheme = (scheme: string): string => scheme.replace(/:$/u, "").toLowerCase()

const hasParentTraversal = (path: string): boolean =>
  path.split(/[\\/]+/u).some((segment) => segment === "..")

const decodeShellOpenExternalInput = (
  input: unknown
): Effect.Effect<ShellOpenExternalInput, ShellError, never> =>
  decodeInput(ShellOpenExternalInput, input, "Shell.openExternal")

const decodeShellShowItemInFolderInput = (
  input: unknown
): Effect.Effect<ShellShowItemInFolderInput, ShellError, never> =>
  decodeInput(ShellShowItemInFolderInput, input, "Shell.showItemInFolder")

const decodeShellOpenPathInput = (
  input: unknown
): Effect.Effect<ShellOpenPathInput, ShellError, never> =>
  decodeInput(ShellOpenPathInput, input, "Shell.openPath")

const decodeShellTrashItemInput = (
  input: unknown
): Effect.Effect<ShellTrashItemInput, ShellError, never> =>
  decodeInput(ShellTrashItemInput, input, "Shell.trashItem")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, ShellError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function shellRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  capability: RpcCapabilityMetadata,
  support: RpcSupportMetadata = NativeSurface.support.supported
) {
  return NativeSurface.rpc("Shell", method, {
    payload,
    success: Schema.Void,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support
  })
}

const runShellRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ShellError, never> =>
  effect.pipe(
    Effect.mapError(mapShellRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapShellRpcClientError = (error: unknown): ShellError =>
  isShellError(error) ? error : makeHostProtocolInternalError("Shell RPC client failed", "Shell")

const isShellError = (error: unknown): error is ShellError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
