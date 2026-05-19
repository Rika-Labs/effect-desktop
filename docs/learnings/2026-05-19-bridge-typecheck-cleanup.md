# Bridge typecheck cleanup

`packages/bridge` carried a backlog of `@effect/language-service` diagnostics
that `tsconfig.base.json` promotes to errors. The package typecheck started
this branch at 183 errors and still has work remaining; this note records
the patterns that landed so the next session can keep grinding without
re-deriving them.

## Patterns

**Concise predicate bodies.** Single-return `(x) => { return expr }` arrow
helpers are rewritten as `(x) => expr`. Applied to `isBridgeClientResponse`,
`isSchema`, and `hostProtocolErrorRecoverableDefault`. Linter rule:
`effect(unnecessaryArrowBlock)`.

**Pipe form for chained helpers.** When a helper accepts the value as its
first argument (`rpcEndpointKind`, `rpcSupport`, `unsafeSecretString`), the
canonical form is `value.pipe(helper)`, not `helper(value)`. Linter rule:
`effect(missedPipeableOpportunity)`.

**`Schema.is` instead of `instanceof` for Schema classes.** Tagged errors
and stream-frame classes built via `Schema.TaggedErrorClass` or
`Schema.Class` carry a schema-aware type guard. Use
`Schema.is(SomeClass)(value)` rather than `value instanceof SomeClass` so
the check matches the schema-defined shape, not the JS prototype chain.
Linter rule: `effect(instanceOfSchema)`.

**Inline trivial `Effect.gen` wrappers.** `Effect.gen(function* () { return
yield* X })` is identity — pass `X` directly. Linter rule:
`effect(unnecessaryEffectGen)`.

**Effect-first test bodies.** Test callbacks shaped as
`async () => { await Effect.runPromise(eff); ... }` become
`() => Effect.runPromise(Effect.gen(function* () { yield* eff; ... }))`.
`await` becomes `yield*`. Linter rule: `effect(asyncFunction)`.

**Effect-first `expectEffectFailure`.** The async helper that wrapped
`Effect.runPromise` in `try/catch` becomes an Effect-returning combinator:

```ts
class ExpectedFailureMissing extends Schema.TaggedErrorClass<ExpectedFailureMissing>()(
  "ExpectedFailureMissing",
  {}
) {}

const expectEffectFailure = <A, E>(
  effect: Effect.Effect<A, E, never>,
  predicate: (error: unknown) => boolean
): Effect.Effect<void, ExpectedFailureMissing, never> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause.reasons.find(Cause.isFailReason)
      expect(predicate(failure?.error)).toBe(true)
      return
    }
    return yield* new ExpectedFailureMissing()
  })
```

Two subtleties:

- Effect v4 does not expose `Cause.failureOption`; walk `cause.reasons`
  with `Cause.isFailReason` instead.
- A `Schema.TaggedError` instance is yieldable on its own. Use
  `return yield* new TaggedError()` instead of `yield* Effect.fail(new
  TaggedError())`; the linter has both `missingReturnYieldStar` and
  `unnecessaryFailYieldableError` rules for that pattern.

## Architecture-debt sweep

No new wrappers, DSLs, or convenience adapters were introduced. All changes
are stylistic refactors of existing call sites; the public Bridge contract
(client, contracts, protocol, events, handshake) is unchanged. No
`unknown as` was added. No host or capability metadata moved.

## Known remaining gaps in `packages/bridge`

The biggest gates that still need substantive (not mechanical) work:

- **`cryptoRandomUUID` defaults in `BridgeClientOptions`,
  `BridgeEventHubOptions`, and `UnaryDesktopTransportFromBridgeClientExchangeOptions`.**
  The current option types expose `() => string` factory defaults that
  call `globalThis.crypto.randomUUID()`. Effect-first defaults need to
  return `Effect.Effect<string>` so the runtime can inject randomness via
  the `Random` service. This is an API-shape change; downstream callers
  in `@effect-desktop/native` and tests will need to thread an Effect
  through trace/request id resolution.
- **`Context.Service` declared as a variable in `contracts.ts` and
  `rpc-endpoint.ts`.** The Effect-idiomatic shape is the class form
  `class Foo extends Context.Service<Foo, T>()("@effect-desktop/bridge/Foo") {}`.
  The variable form was used because these annotations are private to the
  module and have no runtime registration; flipping them to the class form
  exposes a slot for future Layer composition but does not change behavior
  today.
- **`Schema.Struct` with literal `_tag` in `protocol.ts` for
  `RpcPermissionDeniedError`.** The construction-API change to
  `Schema.TaggedStruct("PermissionDenied", { ... })` makes the tag
  optional in the constructor, which simplifies callers but requires
  audit of every `new RpcPermissionDeniedError({ _tag: "PermissionDenied",
  ... })` to drop the redundant tag argument.
- **`fs`/`path` Node imports in `index.test.ts`.** The Effect-first
  replacement is `FileSystem` and `Path` from `effect/platform`, provided
  as Layers at the test entry point. Test reads a fixture directory and
  multiple JSON files; the refactor needs a layered `Effect.runPromise(
  program.pipe(Effect.provide(FileSystem.layer)))` style.

These are all individually tractable but each has downstream ripples; they
belong in their own focused commits rather than batched into the
mechanical cleanup lane.
