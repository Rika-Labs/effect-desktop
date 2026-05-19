import { randomBytes } from "node:crypto"

import { makeInspectorSafetyPolicy } from "@effect-desktop/core"
import { Context, Data, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"

const NonEmptyString = Schema.NonEmptyString
const LoopbackHost = "127.0.0.1"
const TokenBytes = 32
const TokenFileMode = 0o600

export class DevtoolsStartInput extends Schema.Class<DevtoolsStartInput>("DevtoolsStartInput")({
  profile: Schema.Literals(["dev", "prod"]),
  stateDir: NonEmptyString,
  devtoolsFlag: Schema.optionalKey(Schema.Boolean),
  securityDevtoolsInProd: Schema.optionalKey(Schema.Boolean),
  inspectorCapture: Schema.optionalKey(Schema.Literals(["disabled", "safe"])),
  openShell: Schema.optionalKey(Schema.Boolean)
}) {}

export class DevtoolsInvalidInputError extends Data.TaggedError("InvalidInput")<{
  readonly operation: string
  readonly cause: unknown
}> {}

export class DevtoolsTokenError extends Data.TaggedError("TokenError")<{
  readonly operation: string
  readonly path: string
  readonly cause: unknown
}> {}

export class DevtoolsBindError extends Data.TaggedError("BindError")<{
  readonly operation: string
  readonly host: string
  readonly cause: unknown
}> {}

export class DevtoolsCleanupError extends Data.TaggedError("CleanupError")<{
  readonly operation: string
  readonly path: string
  readonly cause: unknown
}> {}

export class DevtoolsShellOpenError extends Data.TaggedError("ShellOpenError")<{
  readonly operation: string
  readonly url: string
  readonly cause: unknown
}> {}

export class DevtoolsUnsafeProductionCaptureError extends Data.TaggedError(
  "UnsafeProductionCapture"
)<{
  readonly operation: string
  readonly message: string
}> {}

export type DevtoolsError =
  | DevtoolsInvalidInputError
  | DevtoolsTokenError
  | DevtoolsBindError
  | DevtoolsCleanupError
  | DevtoolsShellOpenError
  | DevtoolsUnsafeProductionCaptureError

export interface DevtoolsHandle {
  readonly status: "disabled" | "enabled"
  readonly url: Option.Option<string>
  readonly tokenPath: Option.Option<string>
  readonly disable: Effect.Effect<void, DevtoolsTokenError | DevtoolsCleanupError, never>
}

export interface DevtoolsShellApi {
  readonly start: (
    input: typeof DevtoolsStartInput.Encoded
  ) => Effect.Effect<DevtoolsHandle, DevtoolsError, never>
}

export interface DevtoolsListener {
  readonly url: string
  readonly close: Effect.Effect<void, DevtoolsCleanupError, never>
}

export interface DevtoolsLoopbackTransport {
  readonly listen: (input: {
    readonly host: string
    readonly token: string
  }) => Effect.Effect<DevtoolsListener, DevtoolsBindError, never>
}

export interface DevtoolsShellWindow {
  readonly open: (input: {
    readonly url: string
    readonly tokenPath: string
  }) => Effect.Effect<void, DevtoolsShellOpenError, never>
}

export interface DevtoolsShellOptions {
  readonly transport?: DevtoolsLoopbackTransport
  readonly shellWindow?: DevtoolsShellWindow
  readonly tokenName?: string
}

export class DevtoolsShell extends Context.Service<DevtoolsShell, DevtoolsShellApi>()(
  "@effect-desktop/devtools/shell/DevtoolsShell"
) {}

export const DevtoolsShellLive = (
  options: DevtoolsShellOptions = {}
): Layer.Layer<DevtoolsShell, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(DevtoolsShell)(makeDevtoolsShell(options))

export const makeDevtoolsShell = (
  options: DevtoolsShellOptions = {}
): Effect.Effect<DevtoolsShellApi, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const transport = options.transport ?? BunLoopbackDevtoolsTransport
    const shellWindow = options.shellWindow ?? UnavailableDevtoolsShellWindow
    const tokenName = options.tokenName ?? "devtools-token"

    return Object.freeze({
      start: (rawInput) =>
        Effect.gen(function* () {
          const input = yield* decodeStartInput(rawInput)
          yield* rejectUnsafeProductionCapture(input)
          if (!shouldStartDevtools(input)) {
            return disabledHandle
          }
          yield* assertDevtoolsCapturePolicy(input)

          const token = mintToken()
          const tokenPath = path.join(input.stateDir, tokenName)
          yield* writeToken(fs, path, tokenPath, token)
          const listener = yield* transport
            .listen({ host: LoopbackHost, token })
            .pipe(Effect.tapError(() => removeToken(fs, tokenPath)))
          const cleanup = listener.close.pipe(Effect.andThen(removeToken(fs, tokenPath)))
          if (input.openShell !== false) {
            yield* shellWindow
              .open({ url: listener.url, tokenPath })
              .pipe(Effect.tapError(() => cleanup))
          }

          return enabledHandle(listener.url, tokenPath, cleanup)
        })
    } satisfies DevtoolsShellApi)
  })

export const shouldStartDevtools = (input: typeof DevtoolsStartInput.Type): boolean =>
  input.profile === "dev" ||
  (input.profile === "prod" &&
    input.devtoolsFlag === true &&
    input.securityDevtoolsInProd === true &&
    input.inspectorCapture === "safe")

export const BunLoopbackDevtoolsTransport: DevtoolsLoopbackTransport = Object.freeze({
  listen: (input: { readonly host: string; readonly token: string }) =>
    Effect.try({
      try: () => {
        const server = Bun.serve({
          hostname: input.host,
          port: 0,
          fetch: (request) => {
            const header = request.headers.get("x-effect-devtools-token")
            if (header !== input.token) {
              return new Response("unauthorized", { status: 401 })
            }
            return Response.json({ status: "ok" })
          }
        })

        return {
          url: `http://${input.host}:${server.port}`,
          close: Effect.tryPromise({
            try: () => server.stop(true).then(() => undefined),
            catch: (cause) =>
              new DevtoolsCleanupError({
                operation: "Devtools.listen.close",
                path: server.hostname + ":" + server.port,
                cause
              })
          })
        } satisfies DevtoolsListener
      },
      catch: (cause) =>
        new DevtoolsBindError({
          operation: "Devtools.listen",
          host: input.host,
          cause
        })
    })
})

export const UnavailableDevtoolsShellWindow: DevtoolsShellWindow = Object.freeze({
  open: (input: { readonly url: string; readonly tokenPath: string }) =>
    Effect.fail(
      new DevtoolsShellOpenError({
        operation: "Devtools.shell.open",
        url: input.url,
        cause: "No devtools shell window port is configured."
      })
    )
})

const disabledHandle: DevtoolsHandle = Object.freeze({
  status: "disabled",
  url: Option.none(),
  tokenPath: Option.none(),
  disable: Effect.void
})

const enabledHandle = (
  url: string,
  tokenPath: string,
  cleanup: Effect.Effect<void, DevtoolsTokenError | DevtoolsCleanupError, never>
): DevtoolsHandle =>
  Object.freeze({
    status: "enabled",
    url: Option.some(url),
    tokenPath: Option.some(tokenPath),
    disable: cleanup
  })

const decodeStartInput = (
  input: unknown
): Effect.Effect<DevtoolsStartInput, DevtoolsInvalidInputError, never> =>
  Schema.decodeUnknownEffect(DevtoolsStartInput)(input, {
    onExcessProperty: "error"
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DevtoolsInvalidInputError({
          operation: "Devtools.start",
          cause
        })
    )
  )

const mintToken = (): string => randomBytes(TokenBytes).toString("hex")

const rejectUnsafeProductionCapture = (
  input: DevtoolsStartInput
): Effect.Effect<void, DevtoolsUnsafeProductionCaptureError, never> =>
  input.profile === "prod" &&
  input.devtoolsFlag === true &&
  input.securityDevtoolsInProd === true &&
  input.inspectorCapture !== "safe"
    ? Effect.fail(
        new DevtoolsUnsafeProductionCaptureError({
          operation: "Devtools.start",
          message: "production devtools capture requires inspectorCapture: safe"
        })
      )
    : Effect.void

const assertDevtoolsCapturePolicy = (
  input: DevtoolsStartInput
): Effect.Effect<void, DevtoolsUnsafeProductionCaptureError, never> =>
  input.profile === "prod"
    ? makeInspectorSafetyPolicy(
        input.inspectorCapture === undefined
          ? { mode: "production" }
          : { mode: "production", productionCapture: input.inspectorCapture }
      ).pipe(
        Effect.flatMap((policy) => policy.assertProductionCapture()),
        Effect.mapError(
          () =>
            new DevtoolsUnsafeProductionCaptureError({
              operation: "Devtools.start",
              message: "production devtools capture requires a validated safe inspector policy"
            })
        )
      )
    : Effect.void

const writeToken = (path: string, token: string): Effect.Effect<void, DevtoolsTokenError, never> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, token, { mode: TokenFileMode })
      await chmod(path, TokenFileMode)
    },
    catch: (cause) =>
      new DevtoolsTokenError({
        operation: "Devtools.token.write",
        path,
        cause
      })
  })

const removeToken = (path: string): Effect.Effect<void, DevtoolsTokenError, never> =>
  Effect.tryPromise({
    try: () => rm(path, { force: true }),
    catch: (cause) =>
      new DevtoolsTokenError({
        operation: "Devtools.token.remove",
        path,
        cause
      })
  })
