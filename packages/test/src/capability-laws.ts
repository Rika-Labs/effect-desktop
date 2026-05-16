import { expect, test } from "bun:test"
import { Cause, Context, Effect, Exit, Fiber, Layer } from "effect"

export interface CapabilityLaw<Service, E = unknown> {
  readonly name: string
  readonly check: (service: Service) => Effect.Effect<void, E, never>
}

export interface CapabilityLawSuite<ServiceId, Service, E = unknown> {
  readonly name: string
  readonly service: Context.Key<ServiceId, Service>
  readonly laws: readonly CapabilityLaw<Service, E>[]
}

export interface CapabilityLayerCase<ServiceId, Service = unknown, E = unknown> {
  readonly name: string
  readonly layer:
    | Layer.Layer<ServiceId, E, never>
    | ((law: CapabilityLaw<Service, E>) => Layer.Layer<ServiceId, E, never>)
}

type LawRecord<Service, E> = Readonly<Record<string, (service: Service) => Effect.Effect<void, E>>>

export const CapabilityLaws = Object.freeze({
  make: <ServiceId, Service, E = unknown>(
    name: string,
    service: Context.Key<ServiceId, Service>,
    laws: LawRecord<Service, E>
  ): CapabilityLawSuite<ServiceId, Service, E> =>
    Object.freeze({
      name,
      service,
      laws: Object.freeze(
        Object.entries(laws).map(([lawName, check]) =>
          Object.freeze({
            name: lawName,
            check
          })
        )
      )
    }),
  run: <ServiceId, Service, E>(
    suite: CapabilityLawSuite<ServiceId, Service, E>,
    layers: readonly CapabilityLayerCase<ServiceId, Service, E>[]
  ): void => {
    for (const layerCase of layers) {
      for (const law of suite.laws) {
        test(`${suite.name} / ${layerCase.name} / ${law.name}`, async () => {
          const layer =
            typeof layerCase.layer === "function" ? layerCase.layer(law) : layerCase.layer
          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const service = yield* Effect.service(suite.service)
                yield* law.check(service)
              }).pipe(Effect.provide(layer))
            )
          )
        })
      }
    }
  }
})

export const LayerMatrix = Object.freeze({
  interrupt: <ServiceId, E, R>(
    layer: Layer.Layer<ServiceId, E, R>,
    body: Effect.Effect<never, E, ServiceId>
  ): Effect.Effect<Exit.Exit<never, E>, E, R> =>
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* body.pipe(Effect.provide(layer), Effect.forkScoped)
        yield* Effect.yieldNow
        yield* Fiber.interrupt(fiber)
        return yield* Fiber.await(fiber)
      })
    )
})

export const FailureAssertions = Object.freeze({
  expectFailureTag: <A, E extends { readonly tag?: string; readonly _tag?: string }>(
    exit: Exit.Exit<A, E>,
    tag: string
  ): void => {
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause.reasons.find(Cause.isFailReason)
      expect(failure?.error).toMatchObject({ tag })
    }
  },
  expectInterrupted: <A, E>(exit: Exit.Exit<A, E>): void => {
    expect(Exit.hasInterrupts(exit)).toBe(true)
  }
})
