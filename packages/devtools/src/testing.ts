import {
  emptyInspectorSafetySummary,
  InspectorSafetyPolicy,
  InspectorSafetyPolicyLive,
  InspectorSafetySummary,
  type InspectorSafetyPolicyApi,
  type InspectorSafetyPolicyInvalidArgumentError
} from "@orika/core/runtime/inspector-safety-policy"
import { Context, Data, Effect, Layer, Option, Queue, Schema, Stream } from "effect"

const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

export const InspectorSurface = Schema.Literals([
  "commands",
  "workers",
  "liveRuntime",
  "diagnostics",
  "performance",
  "logs",
  "eventLog",
  "workflows",
  "reactivity",
  "persistence",
  "cluster"
])

export type InspectorSurface = typeof InspectorSurface.Type

export class RecordedInspectorFrame extends Schema.Class<RecordedInspectorFrame>(
  "RecordedInspectorFrame"
)({
  atMs: Schema.Number,
  surface: InspectorSurface,
  payload: Schema.Unknown,
  safety: Schema.optionalKey(InspectorSafetySummary)
}) {}

export class RecordedSession extends Schema.Class<RecordedSession>("RecordedSession")({
  id: Schema.NonEmptyString,
  startedAt: Schema.Number,
  frames: Schema.Array(RecordedInspectorFrame)
}) {}

export class InspectorFixtureError extends Data.TaggedError("InspectorFixtureError")<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

export interface InspectorTestApi {
  readonly record: (
    surface: InspectorSurface,
    payload: unknown,
    options?: { readonly atMs?: number }
  ) => Effect.Effect<Option.Option<RecordedInspectorFrame>, never, never>
  readonly session: () => Effect.Effect<RecordedSession, never, never>
  readonly observe: () => Stream.Stream<RecordedInspectorFrame, never, never>
}

export class InspectorTest extends Context.Service<InspectorTest, InspectorTestApi>()(
  "@orika/devtools/testing/InspectorTest"
) {}

export interface ReplayTransportApi {
  readonly session: () => Effect.Effect<RecordedSession, never, never>
  readonly frames: () => Stream.Stream<RecordedInspectorFrame, never, never>
  readonly surface: (
    surface: InspectorSurface
  ) => Stream.Stream<RecordedInspectorFrame, never, never>
}

export class ReplayTransport extends Context.Service<ReplayTransport, ReplayTransportApi>()(
  "@orika/devtools/testing/ReplayTransport"
) {}

export interface InspectorTestOptions {
  readonly id?: string
  readonly startedAt?: number
  readonly now?: () => number
  readonly seed?: RecordedSession
  readonly inspectorSafety?: InspectorSafetyPolicyApi
}

export const InspectorTestLayer = (
  options: InspectorTestOptions = {}
): Layer.Layer<InspectorTest, never, InspectorSafetyPolicy> =>
  Layer.effect(InspectorTest)(makeInspectorTest(options))

export const InspectorTestWithPolicy = (
  options: Omit<InspectorTestOptions, "inspectorSafety"> = {}
): Layer.Layer<InspectorTest, InspectorSafetyPolicyInvalidArgumentError, never> =>
  Layer.provide(InspectorTestLayer(options), InspectorSafetyPolicyLive())

export const ReplayTransportFromSession = (
  session: RecordedSession
): Layer.Layer<ReplayTransport, InspectorFixtureError, never> =>
  Layer.effect(ReplayTransport)(
    Effect.map(decodeRecordedSession(session), (decoded) => makeReplayTransport(decoded))
  )

export const ReplayTransportFromInspectorTest: Layer.Layer<ReplayTransport, never, InspectorTest> =
  Layer.effect(ReplayTransport)(
    Effect.gen(function* () {
      const inspector = yield* InspectorTest
      const session = yield* inspector.session()
      return makeReplayTransport(session)
    })
  )

export const decodeRecordedSession = (
  input: unknown
): Effect.Effect<RecordedSession, InspectorFixtureError, never> =>
  Schema.decodeUnknownEffect(RecordedSession)(input).pipe(
    Effect.mapError(
      (cause) =>
        new InspectorFixtureError({
          operation: "RecordedSession.decode",
          message: "recorded Inspector session fixture is invalid",
          cause
        })
    )
  )

export interface CollectorLaw<A> {
  readonly name: string
  readonly check: (value: A) => Effect.Effect<void, InspectorFixtureError, never>
}

export const CollectorLaws = Object.freeze({
  recordedSessionDecodes: {
    name: "RecordedSession decodes",
    check: (value: unknown) => Effect.asVoid(decodeRecordedSession(value))
  } satisfies CollectorLaw<unknown>,
  framesUseKnownSurfaces: {
    name: "RecordedSession frames use known Inspector surfaces",
    check: (session: RecordedSession) =>
      Effect.forEach(session.frames, (frame) =>
        Schema.decodeUnknownEffect(InspectorSurface)(frame.surface).pipe(
          Effect.mapError(
            (cause) =>
              new InspectorFixtureError({
                operation: "CollectorLaws.framesUseKnownSurfaces",
                message: `unknown Inspector surface: ${String(frame.surface)}`,
                cause
              })
          )
        )
      ).pipe(Effect.asVoid)
  } satisfies CollectorLaw<RecordedSession>,
  fixturesAreRedacted: {
    name: "RecordedSession fixtures are redacted",
    check: (session: RecordedSession) =>
      Effect.gen(function* () {
        const text = encodeJsonString(session)
        if (SECRET_TEXT_PATTERN.test(text)) {
          return yield* new InspectorFixtureError({
            operation: "CollectorLaws.fixturesAreRedacted",
            message: "recorded Inspector session contains unredacted secret-shaped text"
          })
        }
      })
  } satisfies CollectorLaw<RecordedSession>
})

export const collectorPayloadsDecode = <
  S extends Schema.Top & { readonly DecodingServices: never }
>(
  surface: InspectorSurface,
  schema: S
): CollectorLaw<RecordedSession> => ({
  name: `${surface} payloads decode`,
  check: (session) =>
    Effect.forEach(
      session.frames.filter((frame) => frame.surface === surface),
      (frame) =>
        Schema.decodeUnknownEffect(schema)(frame.payload).pipe(
          Effect.mapError(
            (cause) =>
              new InspectorFixtureError({
                operation: "CollectorLaws.collectorPayloadsDecode",
                message: `Inspector ${surface} payload failed its schema`,
                cause
              })
          )
        )
    ).pipe(Effect.asVoid)
})

export const assertRecordedSessionFixture = (
  input: unknown
): Effect.Effect<RecordedSession, InspectorFixtureError, never> =>
  Effect.gen(function* () {
    const session = yield* CollectorLaws.recordedSessionDecodes
      .check(input)
      .pipe(Effect.andThen(decodeRecordedSession(input)))
    yield* CollectorLaws.framesUseKnownSurfaces.check(session)
    yield* CollectorLaws.fixturesAreRedacted.check(session)
    return session
  })

export const recordedDiagnosticsSession = new RecordedSession({
  id: "diagnostics-redacted",
  startedAt: 1_000,
  frames: [
    new RecordedInspectorFrame({
      atMs: 1_000,
      surface: "diagnostics",
      payload: {
        logs: [
          {
            level: "error",
            subsystem: "bridge",
            operation: "Bridge.call",
            message: "bridge failed",
            fields: { token: "<redacted:redacted>", safe: "value" }
          }
        ],
        traces: [],
        metrics: []
      },
      safety: emptyInspectorSafetySummary
    })
  ]
})

const SECRET_TEXT_PATTERN = /(secret|token|password|api[-_]?key)["']?\s*:\s*["'](?!<redacted:)/iu

const makeInspectorTest = (
  options: InspectorTestOptions
): Effect.Effect<InspectorTestApi, never, InspectorSafetyPolicy> =>
  Effect.gen(function* () {
    const inspectorSafety = options.inspectorSafety ?? (yield* InspectorSafetyPolicy)
    const queue = yield* Queue.unbounded<RecordedInspectorFrame>()
    let frames = [...(options.seed?.frames ?? [])]
    const sessionId = options.seed?.id ?? options.id ?? "inspector-test"
    const startedAt = options.seed?.startedAt ?? options.startedAt ?? 0
    const now = options.now ?? (() => startedAt)

    const record = (
      surface: InspectorSurface,
      payload: unknown,
      recordOptions: { readonly atMs?: number } = {}
    ): Effect.Effect<Option.Option<RecordedInspectorFrame>, never, never> =>
      Effect.gen(function* () {
        const decision = yield* inspectorSafety.sanitize({
          source: `devtools.${surface}`,
          payload
        })
        if (Option.isNone(decision.value)) {
          return Option.none()
        }

        const frame = new RecordedInspectorFrame({
          atMs: recordOptions.atMs ?? now(),
          surface,
          payload: decision.value.value,
          safety: decision.summary
        })
        frames = [...frames, frame]
        yield* Queue.offer(queue, frame)
        return Option.some(frame)
      })

    return Object.freeze({
      record,
      session: () =>
        Effect.succeed(
          new RecordedSession({
            id: sessionId,
            startedAt,
            frames
          })
        ),
      observe: () => Stream.fromQueue(queue)
    } satisfies InspectorTestApi)
  })

export const makeReplayTransport = (session: RecordedSession): ReplayTransportApi =>
  Object.freeze({
    session: () => Effect.succeed(session),
    frames: () => Stream.fromIterable(session.frames),
    surface: (surface: InspectorSurface) =>
      Stream.fromIterable(session.frames).pipe(Stream.filter((frame) => frame.surface === surface))
  })
