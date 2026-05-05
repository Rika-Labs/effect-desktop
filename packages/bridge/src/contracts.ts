import { Data, Effect, Option, Schema } from "effect"

export interface ApiMethodSpec {
  readonly input: Schema.Schema<unknown>
  readonly output: Schema.Schema<unknown>
  readonly error: Schema.Schema<unknown>
  readonly permission?: string
  readonly timeoutMs?: number
  readonly cachedResultMs?: number
  readonly idempotent?: boolean
  readonly cancellable?: boolean
  readonly backpressure?: BackpressureSpec
}

export interface BackpressureSpec {
  readonly strategy: "buffer" | "drop" | "block"
  readonly size?: number
  readonly overflow?: "error" | "dropOldest" | "dropNewest" | "block"
}

export type ApiContractSpec = Readonly<Record<string, ApiMethodSpec>>

export interface ApiContractClass<
  Tag extends string = string,
  Spec extends ApiContractSpec = ApiContractSpec
> {
  new (): object
  readonly tag: Tag
  readonly spec: Spec
  readonly layer: <Handlers extends ApiHandlers<Spec>>(
    handlers: Handlers
  ) => ApiLayer<Tag, Spec, Handlers>
}

export type ApiHandlers<Spec extends ApiContractSpec> = {
  readonly [Method in keyof Spec]: (
    input: Schema.Schema.Type<Spec[Method]["input"]>
  ) => Effect.Effect<
    Schema.Schema.Type<Spec[Method]["output"]>,
    Schema.Schema.Type<Spec[Method]["error"]>,
    unknown
  >
}

export interface ApiLayer<
  Tag extends string,
  Spec extends ApiContractSpec,
  Handlers extends ApiHandlers<Spec>
> {
  readonly contract: ApiContractClass<Tag, Spec>
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
  Tag: <Tag extends string>(tag: Tag) =>
    function ApiTagSelf<Self>() {
      void (undefined as Self | undefined)

      return <Spec extends ApiContractSpec>(
        spec: Spec
      ): Effect.Effect<ApiContractClass<Tag, Spec>, ApiContractError, never> =>
        registerApiContract(tag, spec)
    },
  entries: (): Effect.Effect<readonly ApiContractClass[], never, never> =>
    Effect.sync(apiContractEntries),
  freeze: (): Effect.Effect<void, never, never> =>
    Effect.sync(() => {
      registryFrozen = true
    }),
  get: (tag: string): Effect.Effect<Option.Option<ApiContractClass>, never, never> =>
    Effect.sync(() => Option.fromUndefinedOr(apiContracts.get(tag)))
})

export const apiContractEntries = (): readonly ApiContractClass[] =>
  Object.freeze(Array.from(apiContracts.values()))

const registerApiContract = <Tag extends string, Spec extends ApiContractSpec>(
  tag: Tag,
  spec: Spec
): Effect.Effect<ApiContractClass<Tag, Spec>, ApiContractError, never> =>
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

    const frozenSpec = freezeContractSpec(spec)
    const contract = class {
      static readonly tag = tag
      static readonly spec = frozenSpec

      static layer<Handlers extends ApiHandlers<Spec>>(
        handlers: Handlers
      ): ApiLayer<Tag, Spec, Handlers> {
        const frozenHandlers = Object.freeze({ ...handlers }) as Handlers

        return Object.freeze({
          contract,
          handlers: frozenHandlers
        })
      }
    } as ApiContractClass<Tag, Spec>

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
    if (!isSchema(spec.output)) {
      return yield* Effect.fail(invalidSpec(tag, method, "output schema is required"))
    }
    if (!isSchema(spec.error)) {
      return yield* Effect.fail(invalidSpec(tag, method, "error schema is required"))
    }
    if (spec.permission !== undefined && typeof spec.permission !== "string") {
      return yield* Effect.fail(invalidSpec(tag, method, "permission must be a string"))
    }
    if (spec.timeoutMs !== undefined && (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs < 0)) {
      return yield* Effect.fail(
        invalidSpec(tag, method, "timeoutMs must be a non-negative finite number")
      )
    }
    if (
      spec.cachedResultMs !== undefined &&
      (!Number.isFinite(spec.cachedResultMs) || spec.cachedResultMs < 0)
    ) {
      return yield* Effect.fail(
        invalidSpec(tag, method, "cachedResultMs must be a non-negative finite number")
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
    Object.freeze(methodSpec)
  }

  return Object.freeze(spec)
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

const apiContracts = new Map<string, ApiContractClass>()
const backpressureStrategies = new Set<BackpressureSpec["strategy"]>(["buffer", "drop", "block"])
const backpressureOverflows = new Set<NonNullable<BackpressureSpec["overflow"]>>([
  "error",
  "dropOldest",
  "dropNewest",
  "block"
])
let registryFrozen = false
