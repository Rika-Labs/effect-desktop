import {
  ResourceRegistry,
  type ManagedResourceHandle,
  type ResourceId,
  type ResourceKind,
  type ScopeId
} from "@effect-desktop/core"
import { Effect, Exit, Option, Scope, Stream } from "effect"

export interface ScopedCommandBindingOptions<Kind extends ResourceKind, Event, RegisterE> {
  readonly kind: Kind
  readonly id: ResourceId
  readonly ownerScope: ScopeId
  readonly register: Effect.Effect<void, RegisterE, never>
  readonly events: Stream.Stream<Event, RegisterE, never>
  readonly invoke: (event: Event) => Effect.Effect<void, never, never>
  readonly release?: Effect.Effect<void, never, never>
}

export const bindScopedCommand = <Kind extends ResourceKind, Event, RegisterE>(
  options: ScopedCommandBindingOptions<Kind, Event, RegisterE>
): Effect.Effect<ManagedResourceHandle<Kind, "registered">, RegisterE, ResourceRegistry> =>
  Effect.gen(function* () {
    const resources = yield* ResourceRegistry
    const existing = yield* resources.get(options.id)
    if (Option.isSome(existing)) {
      return existing.value.handle as ManagedResourceHandle<Kind, "registered">
    }

    const bindingScope = yield* Scope.make()
    let completed = false

    return yield* Effect.gen(function* () {
      yield* options.register
      if (options.release !== undefined) {
        yield* Scope.addFinalizer(bindingScope, options.release)
      }
      yield* options.events.pipe(
        Stream.runForEach(options.invoke),
        Effect.forkScoped,
        Scope.provide(bindingScope)
      )

      const handle = yield* resources
        .register({
          kind: options.kind,
          id: options.id,
          ownerScope: options.ownerScope,
          state: "registered",
          dispose: Scope.close(bindingScope, Exit.void)
        })
        .pipe(Effect.orDie)

      completed = true
      return handle
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() => (completed ? Effect.void : Scope.close(bindingScope, Exit.void)))
      )
    )
  })
