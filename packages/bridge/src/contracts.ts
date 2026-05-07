import { Data, Effect, Option, Schema, Stream } from "effect"

export interface ApiMethodSpec {
  readonly input: Schema.Schema<unknown>
  readonly output: Schema.Schema<unknown> | ApiStreamSpec | ApiResourceSpec
  readonly error: Schema.Schema<unknown>
  readonly permission?: string
  readonly timeoutMs?: number
  readonly cachedResultMs?: number
  readonly idempotent?: boolean
  readonly cancellable?: boolean
  readonly backpressure?: BackpressureSpec
}

export interface ApiEventSpec {
  readonly payload: Schema.Schema<unknown>
  readonly backpressure?: BackpressureSpec
}

export interface ApiStreamSpec {
  readonly _tag: "ApiStreamSpec"
  readonly chunk: Schema.Schema<unknown>
  readonly error: Schema.Schema<unknown>
  readonly backpressure?: BackpressureSpec
}

export interface ApiResourceHandle<Kind extends string = string, State extends string = string> {
  readonly kind: Kind
  readonly id: string
  readonly generation: number
  readonly ownerScope: string
  readonly state: State
}

export class ApiResourceHandleShape extends Schema.Class<ApiResourceHandleShape>(
  "ApiResourceHandle"
)({
  kind: Schema.String,
  id: Schema.String,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ownerScope: Schema.String,
  state: Schema.String
}) {}

export interface ApiResourceSpec<Kind extends string = string, State extends string = string> {
  readonly _tag: "ApiResourceSpec"
  readonly kind: Kind
  readonly state: State
  readonly schema: typeof ApiResourceHandleShape
}

type ApiOutputType<Output> = Output extends ApiStreamSpec
  ? Stream.Stream<Schema.Schema.Type<Output["chunk"]>, Schema.Schema.Type<Output["error"]>, unknown>
  : Output extends ApiResourceSpec<infer Kind, infer State>
    ? ApiResourceHandle<Kind, State>
    : Output extends Schema.Schema<unknown>
      ? Schema.Schema.Type<Output>
      : never

export interface BackpressureSpec {
  readonly strategy: "buffer" | "drop" | "block"
  readonly size?: number
  readonly overflow?: "error" | "dropOldest" | "dropNewest" | "block"
}

export type ApiContractSpec = Readonly<Record<string, ApiMethodSpec>>
export type ApiContractEvents = Readonly<Record<string, ApiEventSpec>>

export interface ApiContractClass<
  Tag extends string = string,
  Spec extends ApiContractSpec = ApiContractSpec,
  Events extends ApiContractEvents = ApiContractEvents
> {
  new (): object
  readonly tag: Tag
  readonly spec: Spec
  readonly events: Events
  readonly layer: <Handlers extends ApiHandlers<Spec>>(
    handlers: Handlers
  ) => ApiLayer<Tag, Spec, Handlers, Events>
}

export type ApiHandlers<Spec extends ApiContractSpec> = {
  readonly [Method in keyof Spec]: (
    input: Schema.Schema.Type<Spec[Method]["input"]>
  ) => Spec[Method]["output"] extends ApiStreamSpec
    ? ApiOutputType<Spec[Method]["output"]>
    : Effect.Effect<
        ApiOutputType<Spec[Method]["output"]>,
        Schema.Schema.Type<Spec[Method]["error"]>,
        unknown
      >
}

export interface ApiLayer<
  Tag extends string,
  Spec extends ApiContractSpec,
  Handlers extends ApiHandlers<Spec>,
  Events extends ApiContractEvents = ApiContractEvents
> {
  readonly contract: ApiContractClass<Tag, Spec, Events>
  readonly handlers: Handlers
}

export class DuplicateApiContractTag extends Data.TaggedError("DuplicateApiContractTag")<{
  readonly tag: string
  readonly message: string
}> {}

export class ApiContractRegistryFrozen extends Data.TaggedError("ApiContractRegistryFrozen")<{
  readonly tag: string
  readonly message: string
}> {}

export class InvalidApiContractSpec extends Data.TaggedError("InvalidApiContractSpec")<{
  readonly tag: string
  readonly method: string
  readonly reason: string
  readonly message: string
}> {}

export type ApiContractError =
  | DuplicateApiContractTag
  | ApiContractRegistryFrozen
  | InvalidApiContractSpec

export const Api = Object.freeze({
  Resource: <Kind extends string, State extends string>(
    kind: Kind,
    state: State
  ): ApiResourceSpec<Kind, State> =>
    Object.freeze({
      _tag: "ApiResourceSpec",
      kind,
      state,
      schema: ApiResourceHandleShape
    }),
  Stream: <Chunk extends Schema.Schema<unknown>, Error extends Schema.Schema<unknown>>(
    chunk: Chunk,
    error: Error,
    backpressure?: BackpressureSpec
  ): ApiStreamSpec & {
    readonly chunk: Chunk
    readonly error: Error
  } =>
    Object.freeze({
      _tag: "ApiStreamSpec",
      chunk,
      error,
      ...(backpressure === undefined ? {} : { backpressure: Object.freeze(backpressure) })
    }),
  Tag: <Tag extends string>(tag: Tag) =>
    function ApiTagSelf<Self>() {
      void (undefined as Self | undefined)

      return <
        Spec extends ApiContractSpec,
        Events extends ApiContractEvents = Record<never, never>
      >(
        spec: Spec,
        events: Events = {} as Events
      ): Effect.Effect<ApiContractClass<Tag, Spec, Events>, ApiContractError, never> =>
        registerApiContract(tag, spec, events)
    },
  entries: (): Effect.Effect<readonly ApiContractClass[], never, never> =>
    Effect.sync(apiContractEntries),
  freeze: (): Effect.Effect<void, never, never> =>
    Effect.sync(() => {
      registryFrozen = true
    }),
  get: (tag: string): Effect.Effect<Option.Option<ApiContractClass>, never, never> =>
    Effect.sync(() => {
      const contract = apiContracts.get(tag)
      return contract === undefined ? Option.none() : Option.some(contract)
    })
})

export const apiContractEntries = (): readonly ApiContractClass[] =>
  Object.freeze(Array.from(apiContracts.values()))

const registerApiContract = <
  Tag extends string,
  Spec extends ApiContractSpec,
  Events extends ApiContractEvents
>(
  tag: Tag,
  spec: Spec,
  events: Events
): Effect.Effect<ApiContractClass<Tag, Spec, Events>, ApiContractError, never> =>
  Effect.gen(function* () {
    if (registryFrozen) {
      return yield* Effect.fail(
        new ApiContractRegistryFrozen({
          tag,
          message: `API contract registry is frozen; cannot register ${tag}`
        })
      )
    }

    if (apiContracts.has(tag)) {
      return yield* Effect.fail(
        new DuplicateApiContractTag({
          tag,
          message: `API contract tag already registered: ${tag}`
        })
      )
    }

    yield* validateContractSpec(tag, spec)
    yield* validateContractEvents(tag, events)

    const frozenSpec = freezeContractSpec(spec)
    const frozenEvents = freezeContractEvents(events)
    const contract = class {
      static readonly tag = tag
      static readonly spec = frozenSpec
      static readonly events = frozenEvents

      static layer<Handlers extends ApiHandlers<Spec>>(
        handlers: Handlers
      ): ApiLayer<Tag, Spec, Handlers, Events> {
        const frozenHandlers = Object.freeze(handlers)

        return Object.freeze({
          contract,
          handlers: frozenHandlers
        })
      }
    } as ApiContractClass<Tag, Spec, Events>

    Object.freeze(contract)
    apiContracts.set(tag, contract)

    return contract
  })

const validateContractSpec = (
  tag: string,
  spec: ApiContractSpec
): Effect.Effect<void, InvalidApiContractSpec, never> =>
  Effect.gen(function* () {
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      return yield* Effect.fail(invalidSpec(tag, "<contract>", "contract spec must be an object"))
    }

    for (const [method, methodSpec] of Object.entries(spec)) {
      if (method === "events") {
        return yield* Effect.fail(invalidSpec(tag, method, "events is a reserved method name"))
      }
      yield* validateMethodSpec(tag, method, methodSpec)
    }
  })

const validateMethodSpec = (
  tag: string,
  method: string,
  spec: ApiMethodSpec
): Effect.Effect<void, InvalidApiContractSpec, never> =>
  Effect.gen(function* () {
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      return yield* Effect.fail(invalidSpec(tag, method, "method spec must be an object"))
    }

    if (!isSchema(spec.input)) {
      return yield* Effect.fail(invalidSpec(tag, method, "input schema is required"))
    }
    if (!isSchema(spec.output) && !isStreamSpec(spec.output) && !isResourceSpec(spec.output)) {
      return yield* Effect.fail(
        invalidSpec(tag, method, "output schema, stream, or resource is required")
      )
    }
    if (!isSchema(spec.error)) {
      return yield* Effect.fail(invalidSpec(tag, method, "error schema is required"))
    }
    if (spec.permission !== undefined && typeof spec.permission !== "string") {
      return yield* Effect.fail(invalidSpec(tag, method, "permission must be a string"))
    }
    if (
      spec.timeoutMs !== undefined &&
      (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs < 0 || !Number.isInteger(spec.timeoutMs))
    ) {
      return yield* Effect.fail(
        invalidSpec(tag, method, "timeoutMs must be a non-negative integer")
      )
    }
    if (
      spec.cachedResultMs !== undefined &&
      (!Number.isFinite(spec.cachedResultMs) ||
        spec.cachedResultMs < 0 ||
        !Number.isInteger(spec.cachedResultMs))
    ) {
      return yield* Effect.fail(
        invalidSpec(tag, method, "cachedResultMs must be a non-negative integer")
      )
    }
    if (spec.idempotent !== undefined && typeof spec.idempotent !== "boolean") {
      return yield* Effect.fail(invalidSpec(tag, method, "idempotent must be a boolean"))
    }
    if (spec.idempotent === true && spec.cachedResultMs === undefined) {
      return yield* Effect.fail(
        invalidSpec(tag, method, "idempotent methods must declare cachedResultMs")
      )
    }
    if (spec.cancellable !== undefined && typeof spec.cancellable !== "boolean") {
      return yield* Effect.fail(invalidSpec(tag, method, "cancellable must be a boolean"))
    }
    if (spec.backpressure !== undefined) {
      yield* validateBackpressureSpec(tag, method, spec.backpressure)
    }
  })

const validateContractEvents = (
  tag: string,
  events: ApiContractEvents
): Effect.Effect<void, InvalidApiContractSpec, never> =>
  Effect.gen(function* () {
    if (typeof events !== "object" || events === null || Array.isArray(events)) {
      return yield* Effect.fail(invalidSpec(tag, "<events>", "events spec must be an object"))
    }

    for (const [event, eventSpec] of Object.entries(events)) {
      yield* validateEventSpec(tag, event, eventSpec)
    }
  })

const validateEventSpec = (
  tag: string,
  event: string,
  spec: ApiEventSpec
): Effect.Effect<void, InvalidApiContractSpec, never> =>
  Effect.gen(function* () {
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      return yield* Effect.fail(invalidSpec(tag, event, "event spec must be an object"))
    }

    if (!isSchema(spec.payload)) {
      return yield* Effect.fail(invalidSpec(tag, event, "event payload schema is required"))
    }
    if (spec.backpressure !== undefined) {
      yield* validateBackpressureSpec(tag, event, spec.backpressure)
    }
  })

const validateBackpressureSpec = (
  tag: string,
  method: string,
  spec: BackpressureSpec
): Effect.Effect<void, InvalidApiContractSpec, never> =>
  Effect.gen(function* () {
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      return yield* Effect.fail(invalidSpec(tag, method, "backpressure must be an object"))
    }

    if (!backpressureStrategies.has(spec.strategy)) {
      return yield* Effect.fail(
        invalidSpec(tag, method, "backpressure.strategy must be buffer, drop, or block")
      )
    }
    if (spec.size !== undefined && (!Number.isInteger(spec.size) || spec.size < 0)) {
      return yield* Effect.fail(
        invalidSpec(tag, method, "backpressure.size must be a non-negative integer")
      )
    }
    if (spec.overflow !== undefined && !backpressureOverflows.has(spec.overflow)) {
      return yield* Effect.fail(
        invalidSpec(
          tag,
          method,
          "backpressure.overflow must be error, dropOldest, dropNewest, or block"
        )
      )
    }
  })

const freezeContractSpec = <Spec extends ApiContractSpec>(spec: Spec): Spec => {
  for (const methodSpec of Object.values(spec)) {
    if (methodSpec.backpressure !== undefined) {
      Object.freeze(methodSpec.backpressure)
    }
    if (isStreamSpec(methodSpec.output) && methodSpec.output.backpressure !== undefined) {
      Object.freeze(methodSpec.output.backpressure)
    }
    if (isStreamSpec(methodSpec.output)) {
      Object.freeze(methodSpec.output)
    }
    if (isResourceSpec(methodSpec.output)) {
      Object.freeze(methodSpec.output)
    }
    Object.freeze(methodSpec)
  }

  return Object.freeze(spec)
}

const freezeContractEvents = <Events extends ApiContractEvents>(events: Events): Events => {
  for (const eventSpec of Object.values(events)) {
    if (eventSpec.backpressure !== undefined) {
      Object.freeze(eventSpec.backpressure)
    }
    Object.freeze(eventSpec)
  }

  return Object.freeze(events)
}

const invalidSpec = (tag: string, method: string, reason: string): InvalidApiContractSpec =>
  new InvalidApiContractSpec({
    tag,
    method,
    reason,
    message: `Invalid API contract ${tag}.${method}: ${reason}`
  })

const isSchema = (value: unknown): value is Schema.Schema<unknown> => {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null && "ast" in value
  )
}

export const isStreamSpec = (value: unknown): value is ApiStreamSpec =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { readonly _tag?: unknown })._tag === "ApiStreamSpec" &&
  "chunk" in value &&
  "error" in value &&
  isSchema((value as { readonly chunk?: unknown }).chunk) &&
  isSchema((value as { readonly error?: unknown }).error)

export const isResourceSpec = (value: unknown): value is ApiResourceSpec =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { readonly _tag?: unknown })._tag === "ApiResourceSpec" &&
  "kind" in value &&
  "state" in value &&
  typeof (value as { readonly kind?: unknown }).kind === "string" &&
  typeof (value as { readonly state?: unknown }).state === "string"

const apiContracts = new Map<string, ApiContractClass>()
const backpressureStrategies = new Set<BackpressureSpec["strategy"]>(["buffer", "drop", "block"])
const backpressureOverflows = new Set<NonNullable<BackpressureSpec["overflow"]>>([
  "error",
  "dropOldest",
  "dropNewest",
  "block"
])
let registryFrozen = false
