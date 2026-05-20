import type { HostProtocolInvalidArgumentError } from "@orika/bridge"
import { makeHostProtocolInvalidArgumentError } from "@orika/bridge"
import {
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Result,
  Schedule,
  Schema,
  Scope,
  Stream,
  SubscriptionRef
} from "effect"

import { Process } from "./process.js"
import { ResourceRegistry } from "./resources.js"
import type { ProcessApi, ProcessError, ProcessExitStatus, ProcessHandle } from "./process.js"
import type { ManagedResourceHandle, ResourceRegistryApi } from "./resources.js"

const { NonEmptyString } = Schema

export class SidecarCommand extends Schema.Class<SidecarCommand>("SidecarCommand")({
  args: Schema.Array(Schema.String),
  command: NonEmptyString,
  cwd: Schema.optionalKey(NonEmptyString),
  env: Schema.optionalKey(Schema.Record(NonEmptyString, Schema.String)),
  ownerScope: NonEmptyString,
  shell: Schema.optionalKey(Schema.Boolean)
}) {}

export class SidecarReadyPayload extends Schema.Class<SidecarReadyPayload>("SidecarReadyPayload")({
  line: Schema.String,
  pid: Schema.Number,
  stream: Schema.Literals(["stdout", "stderr"])
}) {}

export type SidecarReadiness =
  | {
      readonly _tag: "Line"
      readonly match: string
      readonly stream: "stdout" | "stderr"
    }
  | {
      readonly _tag: "None"
    }

export interface SidecarRetryPolicy {
  readonly delay?: Duration.Input
  readonly idempotent: boolean
  readonly retries: number
}

export interface SidecarStartOptions {
  readonly readiness: SidecarReadiness
  readonly retry?: SidecarRetryPolicy
}

export type SidecarState =
  | { readonly _tag: "Starting"; readonly attempt: number; readonly command: string }
  | { readonly _tag: "Ready"; readonly ready: SidecarReadyPayload }
  | { readonly _tag: "Retrying"; readonly attempt: number; readonly message: string }
  | { readonly _tag: "Failed"; readonly message: string; readonly recoverable: boolean }
  | { readonly _tag: "Exited"; readonly exit: ProcessExitStatus }
  | { readonly _tag: "Closing" }
  | { readonly _tag: "Closed" }

export class SidecarError extends Data.TaggedError("SidecarError")<{
  readonly message: string
  readonly operation: string
  readonly recoverable: boolean
}> {}

export interface SidecarHandle {
  readonly close: () => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<SidecarState, never, never>
  readonly process: ProcessHandle
  readonly ready: Effect.Effect<SidecarReadyPayload, SidecarError, never>
  readonly resource: ManagedResourceHandle<"sidecar", "running">
  readonly status: Effect.Effect<SidecarState, never, never>
}

export interface SidecarApi {
  readonly start: (
    command: SidecarCommand,
    options: SidecarStartOptions
  ) => Effect.Effect<SidecarHandle, SidecarError, never>
}

export const makeSidecar = (
  process: ProcessApi,
  registry: ResourceRegistryApi
): Effect.Effect<SidecarApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      start: (command: SidecarCommand, options: SidecarStartOptions) =>
        startSidecar(process, registry, command, options)
    } satisfies SidecarApi)
  )

export class Sidecar extends Context.Service<Sidecar, SidecarApi>()(
  "@orika/core/runtime/sidecar"
) {}

export const SidecarLive = Layer.effect(
  Sidecar,
  Effect.gen(function* SidecarLive() {
    const process = yield* Process
    const registry = yield* ResourceRegistry
    return yield* makeSidecar(process, registry)
  })
)

const startSidecar = (
  process: ProcessApi,
  registry: ResourceRegistryApi,
  command: SidecarCommand,
  options: SidecarStartOptions
): Effect.Effect<SidecarHandle, SidecarError, never> =>
  Effect.gen(function* startSidecar() {
    const scope = yield* Scope.make()
    const status = yield* SubscriptionRef.make<SidecarState>({
      _tag: "Starting",
      attempt: 1,
      command: command.command
    })
    const ready = yield* Deferred.make<SidecarReadyPayload, SidecarError>()
    const closed = yield* Ref.make(false)
    const attempt = yield* Ref.make(0)

    const publish = (state: SidecarState): Effect.Effect<void, never, never> =>
      SubscriptionRef.set(status, state)

    const publishStartFailure = (error: SidecarError): Effect.Effect<boolean, never, never> =>
      publish({ _tag: "Failed", message: error.message, recoverable: error.recoverable }).pipe(
        Effect.andThen(Deferred.fail(ready, error))
      )

    const start = Effect.gen(function* startAttempt() {
      const nextAttempt = yield* Ref.updateAndGet(attempt, (current) => current + 1)
      yield* publish({ _tag: "Starting", attempt: nextAttempt, command: command.command })
      const child = yield* process
        .spawn(command.command, command.args, {
          ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
          ...(command.env === undefined ? {} : { env: command.env }),
          ...(command.shell === undefined ? {} : { shell: command.shell })
        })
        .pipe(Effect.mapError((error) => sidecarError(error, "Sidecar.start", true)))

      const resource = yield* registry
        .register({
          dispose: closeSidecar(scope, closed, publish, child),
          kind: "sidecar",
          ownerScope: command.ownerScope,
          state: "running"
        })
        .pipe(Effect.orDie)

      const handle = makeHandle(resource, child, status, ready)
      yield* observeReadiness(child, options.readiness, ready, publish).pipe(
        Effect.forkScoped,
        Scope.provide(scope)
      )
      yield* observeExit(child, resource, ready, closed, publish).pipe(
        Effect.forkScoped,
        Scope.provide(scope)
      )
      return handle
    })

    const retry = options.retry
    if (retry?.idempotent === true && retry.retries > 0) {
      return yield* start.pipe(
        Effect.tapError((error) =>
          Ref.get(attempt).pipe(
            Effect.flatMap((current) =>
              current <= retry.retries
                ? publish({ _tag: "Retrying", attempt: current + 1, message: error.message })
                : Effect.void
            )
          )
        ),
        Effect.retry(
          Schedule.both(
            Schedule.spaced(retry.delay ?? "100 millis"),
            Schedule.recurs(retry.retries)
          ).pipe(Schedule.setInputType<SidecarError>())
        ),
        Effect.tapError(publishStartFailure)
      )
    }

    return yield* start.pipe(Effect.tapError(publishStartFailure))
  }).pipe(Effect.withSpan("Sidecar.start", { attributes: { command: command.command } }))

const makeHandle = (
  resource: ManagedResourceHandle<"sidecar", "running">,
  process: ProcessHandle,
  status: SubscriptionRef.SubscriptionRef<SidecarState>,
  ready: Deferred.Deferred<SidecarReadyPayload, SidecarError>
): SidecarHandle =>
  Object.freeze({
    close: () => resource.dispose(),
    events: SubscriptionRef.changes(status),
    process,
    ready: Deferred.await(ready),
    resource,
    status: SubscriptionRef.get(status)
  })

const observeReadiness = (
  process: ProcessHandle,
  readiness: SidecarReadiness,
  ready: Deferred.Deferred<SidecarReadyPayload, SidecarError>,
  publish: (state: SidecarState) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> => {
  if (readiness._tag === "None") {
    const payload = new SidecarReadyPayload({ line: "", pid: process.pid, stream: "stdout" })
    return publish({ _tag: "Ready", ready: payload }).pipe(
      Effect.andThen(Deferred.succeed(ready, payload))
    )
  }

  return readinessLines(process, readiness).pipe(
    Stream.runHead,
    Effect.flatMap((match) =>
      Option.isSome(match)
        ? publish({ _tag: "Ready", ready: match.value }).pipe(
            Effect.andThen(Deferred.succeed(ready, match.value))
          )
        : Effect.fail(
            new SidecarError({
              message: "sidecar exited before readiness was observed",
              operation: "Sidecar.readiness",
              recoverable: false
            })
          )
    ),
    Effect.tapError((error) =>
      Deferred.fail(ready, error).pipe(
        Effect.andThen(publish({ _tag: "Failed", message: error.message, recoverable: false }))
      )
    ),
    Effect.ignore
  )
}

const observeExit = (
  process: ProcessHandle,
  resource: ManagedResourceHandle<"sidecar", "running">,
  ready: Deferred.Deferred<SidecarReadyPayload, SidecarError>,
  closed: Ref.Ref<boolean>,
  publish: (state: SidecarState) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  process.exit.pipe(
    Effect.flatMap((exit) =>
      Deferred.await(ready).pipe(
        Effect.exit,
        Effect.flatMap((readyExit) =>
          Exit.isFailure(readyExit)
            ? Effect.void
            : publish({ _tag: "Exited", exit }).pipe(
                Effect.andThen(
                  Ref.modify(closed, (current) => [current, true] as const).pipe(
                    Effect.flatMap((wasClosed) => (wasClosed ? Effect.void : resource.dispose()))
                  )
                )
              )
        )
      )
    ),
    Effect.tapError((error) =>
      publish({ _tag: "Failed", message: error.message, recoverable: false })
    ),
    Effect.ignore
  )

const readinessLines = (
  process: ProcessHandle,
  readiness: Extract<SidecarReadiness, { readonly _tag: "Line" }>
): Stream.Stream<SidecarReadyPayload, SidecarError, never> => {
  const source = readiness.stream === "stdout" ? process.stdout : process.stderr
  return source.pipe(
    Stream.mapError((error) => sidecarError(error, "Sidecar.readiness", false)),
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filterMap((line) =>
      lineMatches(line, readiness.match)
        ? Result.succeed(
            new SidecarReadyPayload({ line, pid: process.pid, stream: readiness.stream })
          )
        : Result.failVoid
    )
  )
}

const closeSidecar = (
  scope: Scope.Closeable,
  closed: Ref.Ref<boolean>,
  publish: (state: SidecarState) => Effect.Effect<void, never, never>,
  process: ProcessHandle
): Effect.Effect<void, never, never> =>
  Ref.modify(closed, (current) => [current, true] as const).pipe(
    Effect.flatMap((wasClosed) =>
      wasClosed
        ? Effect.void
        : publish({ _tag: "Closing" }).pipe(
            Effect.andThen(process.kill().pipe(Effect.ignore)),
            Effect.andThen(Scope.close(scope, Exit.void)),
            Effect.andThen(publish({ _tag: "Closed" }))
          )
    )
  )

const lineMatches = (line: string, match: string): boolean => line.includes(match)

const sidecarError = (error: ProcessError, operation: string, recoverable: boolean): SidecarError =>
  new SidecarError({
    message: error.message,
    operation,
    recoverable
  })

export const decodeSidecarCommand = (
  input: unknown,
  operation: string
): Effect.Effect<SidecarCommand, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(SidecarCommand)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", String(error), operation)
    )
  )
