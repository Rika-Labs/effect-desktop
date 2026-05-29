import { Data, Effect, Schema } from "effect"

export const ProviderKind = Schema.Literals([
  "runtime",
  "webview",
  "storage",
  "transport",
  "updater",
  "packaging",
  "native"
])

export type ProviderKind = Schema.Schema.Type<typeof ProviderKind>

export class ProviderCapability extends Schema.Class<ProviderCapability>("ProviderCapability")({
  name: Schema.NonEmptyString,
  description: Schema.String
}) {}

export interface Provider<Kind extends ProviderKind, Id extends string> {
  readonly kind: Kind
  readonly id: Id
  readonly capabilities: readonly ProviderCapability[]
}

export interface AnyProvider {
  readonly kind: ProviderKind
  readonly id: string
  readonly capabilities: readonly ProviderCapability[]
}

export class ProviderRegistryError extends Data.TaggedError("ProviderRegistryError")<{
  readonly reason: "duplicate-provider" | "missing-provider"
  readonly kind: ProviderKind
  readonly provider: string
  readonly message: string
}> {}

export interface ProviderRegistry<
  Providers extends readonly AnyProvider[] = readonly AnyProvider[]
> {
  readonly providers: ReadonlyArray<Providers[number]>
  readonly get: (
    kind: Providers[number]["kind"],
    provider: string
  ) => Effect.Effect<Providers[number], ProviderRegistryError, never>
  readonly capabilitiesFor: (
    kind: Providers[number]["kind"],
    provider: string
  ) => Effect.Effect<readonly ProviderCapability[], ProviderRegistryError, never>
}

export const makeProviderRegistry = <const Providers extends readonly AnyProvider[]>(
  providers: Providers
): Effect.Effect<ProviderRegistry<Providers>, ProviderRegistryError, never> =>
  Effect.gen(function* () {
    const seen = new Set<string>()
    const frozenProviders: Providers[number][] = []

    for (const provider of providers) {
      const key = providerKey(provider.kind, provider.id)
      if (seen.has(key)) {
        return yield* new ProviderRegistryError({
          reason: "duplicate-provider",
          kind: provider.kind,
          provider: provider.id,
          message: `Provider "${provider.kind}:${provider.id}" is registered more than once`
        })
      }
      seen.add(key)
      frozenProviders.push(freezeProvider(provider))
    }

    const registeredProviders: ReadonlyArray<Providers[number]> = Object.freeze(frozenProviders)

    const get = (
      kind: Providers[number]["kind"],
      provider: string
    ): Effect.Effect<Providers[number], ProviderRegistryError, never> => {
      const entry = registeredProviders.find(
        (candidate) => candidate.kind === kind && candidate.id === provider
      )
      if (entry !== undefined) {
        return Effect.succeed(entry)
      }
      return Effect.fail(
        new ProviderRegistryError({
          reason: "missing-provider",
          kind,
          provider,
          message: `${capitalizeProviderKind(kind)} provider "${provider}" is not available`
        })
      )
    }

    return Object.freeze({
      providers: registeredProviders,
      get,
      capabilitiesFor: (kind: Providers[number]["kind"], provider: string) =>
        get(kind, provider).pipe(Effect.map((entry) => entry.capabilities))
    })
  })

const providerKey = (kind: ProviderKind, provider: string): string => `${kind}:${provider}`

const freezeProvider = <Provider extends AnyProvider>(provider: Provider): Provider =>
  Object.freeze({
    ...provider,
    capabilities: Object.freeze(
      provider.capabilities.map((capability) => Object.freeze(capability))
    )
  })

const capitalizeProviderKind = (kind: ProviderKind): string =>
  `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`
